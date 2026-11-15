from __future__ import annotations

import argparse
import collections
import hashlib
import io
import json
import random
import struct
import subprocess
import urllib.request
import zipfile
import tarfile
import bisect
import urllib.error
import http.client
from pathlib import Path

from .common import DomainError, atomic, digest
from .main import BENCHMARK, default_profile


def select(mme: list[dict], lvb: list[dict], seed=731) -> dict:
    """Select on metadata, never predictions. Gold stays sealed in the resulting manifest."""
    rng = random.Random(seed)
    sources, questions, reserve = [], [], []
    for dataset, rows, key, field, strata in [('Video-MME', mme, 'videoID', 'duration', ['short', 'short', 'medium', 'long']),
                                             ('LongVideoBench', lvb, 'video_id', 'duration_group', [15, 60, 600, 3600])]:
        grouped = collections.defaultdict(list)
        for row in rows:
            grouped[row[key]].append(row)
        used = set()
        for stratum in strata:
            candidates = sorted(k for k, v in grouped.items() if v[0][field] == stratum and k not in used
                                and (stratum != 3600 or v[0]['duration'] >= 1800))
            rng.shuffle(candidates)
            if not candidates:
                raise DomainError('COHORT_STRATUM_UNAVAILABLE')
            chosen = candidates[0]
            used.add(chosen)
            reserve.extend(dict(dataset=dataset, stratum=stratum, videoId=x) for x in candidates[1:6])
            selected = grouped[chosen][:3]
            row = selected[0]
            sid = dataset.lower() + '-' + chosen
            duration = round(row['duration'] * 1000) if dataset == 'LongVideoBench' else None
            group = row['duration'] if dataset == 'Video-MME' else 'short' if duration < 120000 else 'medium' if duration < 900000 else 'long'
            sources.append(dict(id=sid, dataset=dataset, videoId=chosen, durationGroup=group,
                                durationMs=duration, path='sources/' + sid + '.mp4',
                                officialMediaName=Path(row.get('video_path', chosen + '.mp4')).name,
                                officialSubtitleName=row.get('subtitle_path', chosen + '.srt'),
                                subtitleOffsetSecs=row.get('starting_timestamp_for_subtitles', 0),
                                sourceUrl=row.get('url', 'https://www.youtube.com/watch?v=' + chosen),
                                license='Original dataset/source license; research evaluation only; no media redistribution.'))
            for q in selected:
                if dataset == 'Video-MME':
                    options, answer = q['options'], q['answer']
                else:
                    options = [q['option' + str(i)] for i in range(5)]
                    # N/A is an officially supplied option slot. Preserve it; do not drop or reorder.
                    answer = 'ABCDE'[q['correct_choice']]
                questions.append(dict(id=dataset.lower() + '-' + q.get('question_id', q.get('id', '')),
                                      sourceId=sid, question=q['question'], options=options,
                                      correctOption=answer, capability=q.get('task_type', q.get('question_category'))))
    profile=default_profile('frozen-at-execution')
    arms = [dict(id=k, adapter=profile['variants'][k]['adapter']) for k in profile['protocol']['variantIds']]
    core = [a['id'] for a in arms if a['adapter'] != 'retrieval']
    subset = [q['id'] for q in questions if q['sourceId'] in {sources[0]['id'], sources[2]['id']}]
    return dict(id=profile['protocol'].get('manifestId','pilot-v1'), seed=seed, sources=sources, questions=questions, reserves=reserve,
                protocol=dict(revision=profile['protocol']['revision'], arms=arms, coreVariantIds=core,
                              variantQuestionIds={a['id']: subset for a in arms if a['adapter'] == 'retrieval'},
                              minimumSources=8, minimumNetWins=2, groundingAudit='pending',
                              missingness='original planned denominator retained; infrastructure failures null',
                              continueRule='positive net correctness over strongest native arm on multiple sources/capabilities; independent grounding audit',
                              stopRule='completed valid pilot with no positive correctness benefit',
                              inconclusiveRule='missing core coverage, weak/mixed signal, missing audit; pause expansion',
                              extensionLimit=1, extensionPlanned=False,
                              metadataChecksums={'Video-MME': digest(mme), 'LongVideoBench': digest(lvb)},
                              datasetReleases={'Video-MME': 'lmms-lab/Video-MME official test annotations',
                                               'LongVideoBench': 'longvideobench/LongVideoBench-Meta validation'},
                              inputConditions='Video-MME supplied subtitles separate from audio; LVB timestamped official subtitles required',
                              disclosure='Qwen Gateway timestamped 128-frame input, no native audio; generated ASR must be declared separately'))


class RangeFile(io.RawIOBase):
    """Read selected ZIP members without downloading multi-GB official archives."""
    def __init__(self, url: str, size: int):
        self.url, self.size, self.position, self.transferred = url, size, 0, 0
        self.cache = b''
        self.cache_start = -1
        self.resolved_url = None
        self.connection = None

    def seekable(self):
        return True

    def readable(self):
        return True

    def seek(self, offset, whence=0):
        position = offset if whence == 0 else self.position + offset if whence == 1 else self.size + offset
        if position < 0:
            raise ValueError('Negative seek')
        self.position = position
        return position

    def tell(self):
        return self.position

    def read(self, length=-1):
        if length < 0:
            length = self.size - self.position
        if length == 0 or self.position >= self.size:
            return b''
        if self.cache_start <= self.position and self.position + length <= self.cache_start + len(self.cache):
            offset = self.position - self.cache_start
            self.position += length
            return self.cache[offset:offset + length]
        original_length = length
        if length < 65536:
            length = min(65536, self.size - self.position)
        end = min(self.size - 1, self.position + length - 1)
        try:
            response = None
            if self.resolved_url:
                from urllib.parse import urlsplit
                parsed = urlsplit(self.resolved_url)
                if self.connection is None:
                    self.connection = http.client.HTTPSConnection(parsed.hostname, timeout=90)
                try:
                    self.connection.request('GET', parsed.path + ('?' + parsed.query if parsed.query else ''),
                                            headers={'Range': f'bytes={self.position}-{end}'})
                    response = self.connection.getresponse()
                    if response.status == 403:
                        response.read()
                        self.connection.close()
                        self.connection = None
                        self.resolved_url = None
                        response = None
                except (OSError, http.client.HTTPException):
                    self.connection.close()
                    self.connection = None
                    self.resolved_url = None
                    response = None
            if response is None:
                response = hf_open(self.url, headers={'Range': f'bytes={self.position}-{end}'})
                self.resolved_url = response.geturl()
            with response:
                if response.status != 206:
                    raise DomainError('DATASET_RANGE_UNSUPPORTED')
                expected = f'bytes {self.position}-{end}/{self.size}'
                if response.headers.get('Content-Range') != expected:
                    raise DomainError('DATASET_RANGE_INVALID')
                data = response.read(end - self.position + 1)
        except urllib.error.HTTPError:
            raise DomainError('SOURCE_UNAVAILABLE') from None
        self.cache_start, self.cache = self.position, data
        self.position += min(original_length, len(data))
        self.transferred += len(data)
        return data[:original_length]


def hf_open(url: str, headers=None):
    from urllib.parse import urlsplit
    from .common import Secrets
    headers = dict(headers or {})
    if urlsplit(url).hostname == 'huggingface.co':
        private = Secrets(BENCHMARK / 'benchmark.env')
        token = private.values.get('HUGGINGFACE_APIKEY')
        if token:
            headers['Authorization'] = 'Bearer ' + token
    class Redirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, response_headers, newurl):
            result = super().redirect_request(req, fp, code, msg, response_headers, newurl)
            if urlsplit(newurl).hostname != 'huggingface.co':
                result.remove_header('Authorization')
            return result
    return urllib.request.build_opener(Redirect()).open(urllib.request.Request(url, headers=headers), timeout=90)


class MultipartTar(io.RawIOBase):
    def __init__(self, files, revision):
        self.parts = [RangeFile('https://huggingface.co/datasets/longvideobench/LongVideoBench/resolve/' + revision + '/' + f['path'] + '?download=true', f['size']) for f in files]
        self.offsets = [0]
        for part in self.parts:
            self.offsets.append(self.offsets[-1] + part.size)
        self.position = 0

    def seek(self, offset, whence=0):
        self.position = offset if whence == 0 else self.position + offset if whence == 1 else self.offsets[-1] + offset
        return self.position

    def tell(self):
        return self.position

    def read(self, size=-1):
        if size < 0:
            size = self.offsets[-1] - self.position
        chunks = []
        while size > 0 and self.position < self.offsets[-1]:
            index = bisect.bisect_right(self.offsets, self.position) - 1
            part = self.parts[index]
            local = self.position - self.offsets[index]
            part.seek(local)
            chunk = part.read(min(size, part.size - local))
            if not chunk:
                raise DomainError('DATASET_ARCHIVE_TRUNCATED')
            chunks.append(chunk)
            self.position += len(chunk)
            size -= len(chunk)
        return b''.join(chunks)


def official_lvb(manifest: dict, data: Path):
    with hf_open('https://huggingface.co/api/datasets/longvideobench/LongVideoBench') as r:
        repo = json.load(r)
    revision = repo['sha']
    with hf_open('https://huggingface.co/api/datasets/longvideobench/LongVideoBench/tree/' + revision) as r:
        files = json.load(r)
    manifest['protocol']['longVideoBenchMediaRevision'] = revision
    targets = {s['officialMediaName']: s for s in manifest['sources'] if s['dataset'] == 'LongVideoBench' and not (data / s['path']).exists()}
    parts = sorted([f for f in files if f['path'].startswith('videos.tar.part.')], key=lambda f: f['path'])
    reader = MultipartTar(parts, revision)
    index_file = data / 'datasets-cache/lvb-archive-index.json'
    index = json.loads(index_file.read_text()) if index_file.exists() else {'revision': revision, 'members': {}, 'nextOffset': 0}
    if index['revision'] != revision:
        raise DomainError('DATASET_REVISION_CHANGED')
    # Reuse the persisted source archive index after interruptions.
    for name, source in list(targets.items()):
        if name in index['members']:
            item = index['members'][name]
            reader.seek(item['offset'])
            save_member(reader, item['size'], data / source['path'])
            targets.pop(name)
    if targets:
        reader.seek(index['nextOffset'])
        with tarfile.open(fileobj=reader, mode='r:') as archive:
            for member in archive:
                name = Path(member.name).name
                if member.isfile():
                    index['members'][name] = {'offset': member.offset_data, 'size': member.size}
                index['nextOffset'] = archive.offset
                if name in targets:
                    source = targets.pop(name)
                    reader.seek(member.offset_data)
                    save_member(reader, member.size, data / source['path'])
                    print(json.dumps({'dataset': 'LongVideoBench', 'preparedSource': source['id'], 'bytes': member.size}), flush=True)
                if len(index['members']) % 25 == 0 or not targets:
                    atomic(index_file, index)
                    print(json.dumps({'dataset': 'LongVideoBench', 'indexedArchiveMembers': len(index['members']), 'remainingSources': len(targets)}), flush=True)
                if not targets:
                    break
    atomic(index_file, index)
    if targets:
        raise DomainError('SOURCE_UNAVAILABLE')
    subtitles = data / 'datasets-cache/lvb-subtitles.tar'
    if not subtitles.exists():
        with hf_open('https://huggingface.co/datasets/longvideobench/LongVideoBench/resolve/' + revision + '/subtitles.tar?download=true') as r:
            save_member(r, next(f['size'] for f in files if f['path'] == 'subtitles.tar'), subtitles)
    with tarfile.open(subtitles) as archive:
        for source in manifest['sources']:
            if source['dataset'] != 'LongVideoBench':
                continue
            member = next((m for m in archive if Path(m.name).name == source['officialSubtitleName']), None)
            if member:
                raw = json.load(archive.extractfile(member))
                source['officialSubtitlesRaw'] = raw


def save_member(reader, size: int, destination: Path):
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = destination.with_suffix('.partial')
    with temporary.open('wb') as out:
        while size:
            chunk = reader.read(min(size, 1024 * 1024))
            if not chunk:
                raise DomainError('DATASET_ARCHIVE_TRUNCATED')
            out.write(chunk)
            size -= len(chunk)
    temporary.replace(destination)


def official_zip(manifest: dict, data: Path):
    url = 'https://huggingface.co/api/datasets/lmms-lab/Video-MME/tree/main'
    with urllib.request.urlopen(url, timeout=30) as r:
        files = json.load(r)
    targets = {s['officialMediaName']: s for s in manifest['sources'] if s['dataset'] == 'Video-MME'}
    for info in files:
        name = info['path']
        if not name.startswith('videos_chunked_') or not name.endswith('.zip'):
            continue
        reader = RangeFile('https://huggingface.co/datasets/lmms-lab/Video-MME/resolve/main/' + name, info['size'])
        with zipfile.ZipFile(reader) as archive:
            for member in archive.infolist():
                source = targets.get(Path(member.filename).name)
                if not source:
                    continue
                destination = data / source['path']
                destination.parent.mkdir(parents=True, exist_ok=True)
                if not destination.exists():
                    temporary = destination.with_suffix('.partial')
                    with archive.open(member) as f, temporary.open('wb') as out:
                        while chunk := f.read(1024 * 1024):
                            out.write(chunk)
                    temporary.replace(destination)
                source['archive'] = name
                source['archiveCrc32'] = f'{member.CRC:08x}'
                targets.pop(Path(member.filename).name)
        if not targets:
            return
    if targets:
        raise DomainError('SOURCE_UNAVAILABLE')


def verify_source(source: dict, data: Path):
    path = data / source['path']
    if not path.is_file():
        raise DomainError('SOURCE_UNAVAILABLE')
    p = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', str(path)],
                       check=True, capture_output=True, text=True)
    duration = round(float(json.loads(p.stdout)['format']['duration']) * 1000)
    if source.get('durationMs') and abs(source['durationMs'] - duration) > 1000:
        raise DomainError('SOURCE_DURATION_MISMATCH')
    source['durationMs'] = duration
    h = hashlib.sha256()
    with path.open('rb') as f:
        while chunk := f.read(1024 * 1024):
            h.update(chunk)
    source['sha256'] = h.hexdigest()


def aligned_subtitles(raw: list, duration_ms: int, offset_seconds=0) -> list:
    def seconds(value):
        if isinstance(value, (int, float)):
            return float(value)
        fields = str(value).replace(',', '.').split(':')
        return sum(float(v) * 60**i for i, v in enumerate(reversed(fields)))
    output = []
    for item in raw:
        if 'timestamp' in item:
            start, end = item['timestamp']
            end = end if isinstance(end, (int, float)) else duration_ms / 1000 + offset_seconds
            text = item['text']
        else:
            start, end, text = item['start'], item['end'], item['line']
        start = round((seconds(start) - offset_seconds) * 1000)
        end = round((seconds(end) - offset_seconds) * 1000)
        if end > 0 and start < duration_ms:
            output.append(dict(startMs=max(0, start), endMs=min(duration_ms, end), text=text))
    return sorted(output, key=lambda x: (x['startMs'], x['endMs']))


def attach_subtitles(manifest: dict, data: Path):
    import re
    archive_path = data / 'datasets-cache/mme-subtitles.zip'
    if not archive_path.exists():
        with hf_open('https://huggingface.co/datasets/lmms-lab/Video-MME/resolve/main/subtitle.zip') as response:
            content = response.read(16 * 1024 * 1024)
            if len(content) >= 16 * 1024 * 1024:
                raise DomainError('SUBTITLE_ARCHIVE_TOO_LARGE')
        archive_path.parent.mkdir(parents=True, exist_ok=True)
        archive_path.write_bytes(content)
    with zipfile.ZipFile(archive_path) as archive:
        members = {Path(n).stem: n for n in archive.namelist() if n.endswith('.srt')}
        for source in manifest['sources']:
            if source['dataset'] == 'LongVideoBench':
                if 'officialSubtitlesRaw' in source:
                    source['subtitles'] = aligned_subtitles(source.pop('officialSubtitlesRaw'), source['durationMs'], source['subtitleOffsetSecs'])
                elif 'subtitles' not in source:
                    raise DomainError('OFFICIAL_SUBTITLES_UNAVAILABLE')
            else:
                name = members.get(source['videoId'])
                if not name:
                    source['subtitles'] = []
                    source['subtitleProvenance'] = 'official archive contains no subtitle file for this source; no synthesized replacement'
                    continue
                text = archive.read(name).decode('utf-8-sig')
                entries = []
                for block in re.split(r'\r?\n\s*\r?\n', text):
                    lines = block.splitlines()
                    line = next((i for i, value in enumerate(lines) if '-->' in value), None)
                    if line is None:
                        continue
                    start, end = lines[line].split('-->', 1)
                    entries.append({'start': start.strip(), 'end': end.strip().split()[0], 'line': '\n'.join(lines[line + 1:])})
                source['subtitles'] = aligned_subtitles(entries, source['durationMs'])
            source['subtitleProvenance'] = 'official supplied subtitles; offset aligned to complete benchmark source clock'
    manifest['protocol']['subtitleCondition'] = 'full aligned official subtitles for every arm; Qwen interleaves at subtitle midpoint'
    manifest['protocol']['officialScoreClaim'] = False


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('select')
    p.add_argument('--mme', type=Path, required=True)
    p.add_argument('--lvb', type=Path, required=True)
    p = sub.add_parser('prepare')
    p.add_argument('--official-mme-zip', action='store_true')
    p.add_argument('--official-lvb-tar', action='store_true')
    sub.add_parser('subtitles')
    args = parser.parse_args()
    data = BENCHMARK / 'data'
    config_path=data/'configs/active.json'
    active=json.loads(config_path.read_text()) if config_path.exists() else default_profile('frozen-at-execution')
    manifest_id=active['protocol'].get('manifestId','pilot-v1')
    if not isinstance(manifest_id,str) or not all(c.isalnum() or c in '-_' for c in manifest_id):raise DomainError('MANIFEST_INVALID')
    if args.command == 'select':
        doc = select(json.loads(args.mme.read_text()), json.loads(args.lvb.read_text()))
        path = data / 'datasets' / (doc['id']+'.json')
        if path.exists():
            raise DomainError('COHORT_ALREADY_FROZEN')
        atomic(path, doc)
        print(json.dumps({'manifest': doc['id'], 'sources': len(doc['sources']), 'questions': len(doc['questions']), 'hash': digest(doc)}))
    elif args.command == 'subtitles':
        path = data / 'datasets' / (manifest_id+'.json')
        doc = json.loads(path.read_text())
        attach_subtitles(doc, data)
        atomic(path, doc)
        print(json.dumps({'alignedSources': len(doc['sources']), 'subtitleCounts': [len(s['subtitles']) for s in doc['sources']]}))
    else:
        path = data / 'datasets' / (manifest_id+'.json')
        doc = json.loads(path.read_text())
        if args.official_mme_zip:
            official_zip(doc, data)
        if args.official_lvb_tar:
            official_lvb(doc, data)
        issues = []
        for source in doc['sources']:
            try:
                verify_source(source, data)
            except DomainError as e:
                issues.append({'sourceId': source['id'], 'code': e.code})
        atomic(data / 'datasets-cache/source-admission.json', {'issues': issues})
        atomic(path, doc)
        if issues:
            raise DomainError('SOURCE_UNAVAILABLE')
        print(json.dumps({'verifiedSources': len(doc['sources'])}))


if __name__ == '__main__':
    try:
        main()
    except DomainError as e:
        print(json.dumps({'error': e.issue()}))
        raise SystemExit(2)
