import argparse, hashlib, json, os, sqlite3, subprocess, sys, time, urllib.request, urllib.error
from pathlib import Path

B = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(B))
from harness.common import Secrets, atomic, canonical, utc
from harness.answer_contract import final_answer_prompt, investigation_source_context, parse_investigation_directive, answer_schema
from capability_tests.common import choice_result

ap = argparse.ArgumentParser()
ap.add_argument('--questions', nargs='*')
ap.add_argument('--reader', default='latest', choices=['latest', 'qwen', 'muse', 'minimax'])
ap.add_argument('--round', required=True)
ap.add_argument('--mode', default='api-rewatch', choices=['api-rewatch', 'managed'])
ap.add_argument('--final-reasoning-effort', default='high')
ap.add_argument('--defer-question', action='append', default=[])
ap.add_argument('--rewatch-timeout-ms', type=int)
ap.add_argument('--planning-reasoning-effort', default='high')
ap.add_argument('--dry-run', action='store_true')
args = ap.parse_args()
S = None
access_path = Path(os.environ.get('LARKUP_VIDEO_BENCHMARK_ACCESS_FILE', '/private/tmp/larkup-video-benchmark-managed-access.json'))
access = json.loads(access_path.read_text()) if args.mode == 'managed' and not args.dry_run else {'endpoint': 'https://1vcjmwx9ha.execute-api.eu-central-1.amazonaws.com', 'apiKey': ''}
out = B / 'data/managed-retry-working-20261117' / args.reader / args.round

manifest = json.loads((B / 'results/multimodal/video-understanding/data/managed-retries-20261117/baseline.json').read_text())
baseline = manifest['pilot']
questions = manifest['questions']
sources = {r['id']: r['document'] for r in baseline['sources']}
variants = {r['id']: r['document'] for r in baseline['variants']}
if args.reader == 'latest':
    previous = [{**r, 'variantId': r['indexReaderVariantId']} for r in manifest['latest']]
else:
    previous = [r for r in baseline['results'] if f'-vb-{args.reader}-deepseek' in r['variantId']]
assert len(previous) == 19 and len({r['questionId'] for r in previous}) == 19
recovered = set()
public_data = B / 'results/multimodal/video-understanding/data/managed-retries-20261117'
for record in json.loads((public_data / 'evaluations.json').read_text()):
    if record['reader'] == args.reader and record.get('correct') is True:
        recovered.add(record['questionId'])
for saved in out.parent.glob('managed-*/*.json'):
    doc = json.loads(saved.read_text())
    if doc.get('state') == 'completed' and doc.get('correct') is True:
        recovered.add(doc.get('questionId'))
selected = [r for r in previous if r['correct'] is False and r['questionId'] not in recovered and r['questionId'] not in args.defer_question and (not args.questions or r['questionId'] in args.questions)]
blocked_ids = {r['questionId'] for r in json.loads((public_data / 'unknown-requests.json').read_text()) if r.get('questionId')}
blocked = [r['questionId'] for r in selected if r['questionId'] in blocked_ids]
if args.dry_run:
    print(canonical({'reader': args.reader, 'baselineCorrect': sum(r['correct'] for r in previous), 'retainedRecovered': len(recovered), 'selectedOriginalFailures': [r['questionId'] for r in selected], 'blockedUnknownRequests': blocked}))
    raise SystemExit(0)
if blocked:
    raise SystemExit('Unreconciled paid requests require review; use --defer-question for independent work: ' + ', '.join(blocked))
S = Secrets(B / 'benchmark.env')
out.mkdir(parents=True, exist_ok=True)
atomic(out / 'selection.json', {'baselineRunId': 'run-79f3b55b0359ec26d60c' if args.reader == 'latest' else 'run-9d45724237e86021e098', 'baselineCorrect': sum(r['correct'] for r in previous), 'total': 19, 'selectedWrongQuestionIds': [r['questionId'] for r in selected], 'retainedCorrectQuestionIds': [r['questionId'] for r in previous if r['correct']], 'brain': 'deepseek-v4-pro', 'executionMode': args.mode, 'runtime': 'Standalone canonical re-watch through hosted APIs' if args.mode == 'api-rewatch' else 'Existing managed Cloud / Modal', 'indexPolicy': 'Reuse saved source-matched indexes from completed 2026-11-16 baseline. Latest Sonnet-run indexes are not in the local checkpoint; this is a changed-index and changed-brain development retry, not a paired causal experiment.'})

def request(url, doc=None, key=None, method=None, timeout=90):
    headers = {'Content-Type': 'application/json'}
    if key: headers['Authorization'] = 'Bearer ' + key
    req = urllib.request.Request(url, data=canonical(doc).encode() if doc is not None else None, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'HTTP {e.code} at {url.split("/")[2]}') from None

def managed(path, doc=None, method=None):
    return request(access['endpoint'] + path, doc, access['apiKey'], method)

def brain(prompt, path, effort='none'):
    if path.exists(): return json.loads(path.read_text())
    pending = path.with_suffix('.submitted')
    if pending.exists(): raise RuntimeError('Uncertain paid outcome; reconcile before retry')
    pending.write_text(utc())
    d = request('https://api.deepseek.com/chat/completions', {'model': 'deepseek-v4-pro', 'messages': [{'role': 'user', 'content': prompt}], 'max_tokens': 8192 if effort!='none' else 4096, 'reasoning_effort': effort, 'temperature': 0, 'response_format': {'type': 'json_object'}}, S.get('DEEPSEEK_APIKEY'), timeout=240)
    result = {'answer': d['choices'][0]['message']['content'], 'usage': d.get('usage'), 'model': d.get('model'), 'createdAt': utc()}
    atomic(path, result)
    return result

def bridge(payload, file):
    if file.exists(): return json.loads(file.read_text())
    r = subprocess.run(['node', '--import', 'tsx', str(B / 'harness/tool-bridge.mjs')], cwd=B.parent.parents[1] / 'core', input=canonical(payload), text=True, capture_output=True, timeout=300)
    if r.returncode: raise RuntimeError('Canonical tool bridge failed; not scored')
    result = json.loads(r.stdout)
    if result.get('success'): atomic(file, result)
    return result

rows = []
for old in selected:
    qid, sid = old['questionId'], old['sourceId']
    rowfile = out / (qid + '.json')
    if rowfile.exists():
        rows.append(json.loads(rowfile.read_text())); continue
    print(canonical({'questionId': qid, 'stage': 'preparing'}), flush=True)
    row = {'questionId': qid, 'sourceId': sid, 'baselineCorrect': False, 'createdAt': utc()}
    start = time.monotonic()
    try:
        q = {k: questions[qid][k] for k in ['question', 'options']}
        src = sources[sid]
        model_name = lambda vid: variants[vid]['roles']['vision']['model'].split('/')[-1].casefold()
        candidates = [t for t in baseline['tasks'] if t['kind'] == 'prepare' and t['source_id'] == sid and t.get('output') and model_name(t['variant_id']) == model_name(old['variantId'])]
        candidates.sort(key=lambda t: t['variant_id'] != old['variantId'])
        if not candidates: raise RuntimeError('No saved index for the same source and vision model')
        prep = candidates[0]['output']
        row['indexVariantId'] = candidates[0]['variant_id']
        ep = B / 'data/deployment/watcher-final/evidence' / prep['evidencePath']
        raw = json.loads(ep.read_text())
        row['indexSha256'] = hashlib.sha256(ep.read_bytes()).hexdigest()
        media = B / 'data' / src['path']
        if not media.exists(): media = B / 'data/sources' / (sid + '.mp4')
        if hashlib.sha256(media.read_bytes()).hexdigest() != src['sha256']: raise RuntimeError('Source fingerprint mismatch')
        planfile = out / (qid + '-plan.json')
        planning = ('Plan evidence gathering for this question. Return ONLY a JSON object with scope (focused, temporal, source), goal (resolve, compare, synthesize), evidence (array of enum strings: visual, speech, visible-text, computed), and optional timeRange {startSecs,endSecs}. Do not include evidence objects or answers. Use only observed timestamps to locate the described subject and scene; EVERY qualifier must match. A performer with an unspecified shirt does not establish a white-shirt performer, and a similarly described scene is not a match. If any subject qualifier is absent or conflicting, omit timeRange entirely and use scope source, goal resolve, evidence visual so multiple candidate scenes can be inspected. For a confirmed local transition choose a window covering before and after, up to 60 seconds. For broad summaries/order use source scope. Missing details require resolve, not answering from a similar person. Do not answer the question.\nQuestion: ' + canonical(q) + '\nSource navigation: ' + canonical(investigation_source_context(raw, q['question'])))
        planning += '\nFor comparisons between quoted on-screen states, use the raw quotedAnchorPositions to include BOTH states even when far apart: scope temporal, goal compare, with a timeRange spanning the relevant states. A short look at only the common later label cannot answer a change question. Prefer the source-backed anchor times over repeated title similarity; retain subject uncertainty until both states are observed.'
        planned = brain(planning, planfile, args.planning_reasoning_effort)
        directive = parse_investigation_directive(planned['answer'])
        if not directive: raise RuntimeError('Invalid investigation directive')
        roles = {k: {**v, 'apiKey': S.get(v['secretAlias'])} for k, v in variants[old['variantId']]['roles'].items()}
        roles['brain'] = {'provider': 'deepseek', 'model': 'deepseek-v4-pro', 'apiKey': S.get('DEEPSEEK_APIKEY')}
        if roles['vision']['provider'] == 'gemini_openai':
            roles['vision']['provider'] = 'google'
        elif roles['vision']['provider'] == 'deepinfra':
            model = roles['vision']['model']
            gateway_model = {'Qwen/Qwen3.8-Max': 'alibaba/qwen3.8-max', 'MiniMaxAI/MiniMax-M3': 'minimax/minimax-m3'}
            if model not in gateway_model: raise RuntimeError('No verified managed provider mapping')
            roles['vision'] = {'provider': 'vercel_ai_gateway', 'model': gateway_model[model], 'apiKey': S.get('VERCEL_GATEWAY_API_KEY')}
        public = {'evidencePath': str(ep), 'sourcePath': str(media), 'sourceId': sid, 'question': q, 'investigation': directive, 'officialSubtitles': src.get('subtitles', []), 'protocol': {'maxEvidencePages': 64}, 'runtimeMode': 'managed-cloud', 'runtimeEndpoint': access['endpoint'], 'runtimeToken': access['apiKey'], 'roles': roles, 'inspectionStatePath': str(out / (qid + '-inspection.json'))}
        # Upload only when the canonical tool needs a managed inspection.
        toolfile = out / (qid + '-tool.json')
        if args.mode == 'api-rewatch':
            cache_directory = B / 'data/canonical-rewatch-cache'
            if args.reader != 'latest': cache_directory = cache_directory / args.reader
            os.environ.update(BENCHMARK_ENABLE_REWATCH='1', BENCHMARK_REWATCH_GATEWAY_KEY=S.get('VERCEL_GATEWAY_API_KEY'),
                BENCHMARK_REWATCH_CACHE_DIR=str(cache_directory), BENCHMARK_REWATCH_MAX_CALLS='4',
                BENCHMARK_REWATCH_MODEL=('google/' + roles['vision']['model'] if roles['vision']['provider']=='google' else roles['vision']['model']))
            if args.rewatch_timeout_ms: os.environ['BENCHMARK_REWATCH_TIMEOUT_MS'] = str(args.rewatch_timeout_ms)
            public['reconcileOnly'] = True
            evidence = bridge(public, toolfile)
        elif toolfile.exists(): evidence = json.loads(toolfile.read_text())
        else:
            uploadfile = out / (qid + '-upload.json')
            if uploadfile.exists(): upload = json.loads(uploadfile.read_text())
            else:
                upload = managed('/v1/uploads', {'fileName': media.name, 'contentType': 'video/mp4', 'sizeBytes': media.stat().st_size})
                req = urllib.request.Request(upload['uploadUrl'], data=media.read_bytes(), headers=upload.get('uploadHeaders', {}), method='PUT')
                with urllib.request.urlopen(req, timeout=240) as r: assert r.status in [200, 204]
                upload = {'uploadId': upload['uploadId']}
                atomic(uploadfile, upload)
            public['runtimeUploadId'] = upload['uploadId']
            print(canonical({'questionId': qid, 'stage': 'canonical-tool', 'directive': directive}), flush=True)
            evidence = bridge(public, toolfile)
            inspection = Path(public['inspectionStatePath'])
            if not evidence.get('success') and inspection.exists():
                deadline = time.monotonic() + 600
                for entry in json.loads(inspection.read_text()).values():
                    if not entry.get('jobId'): raise RuntimeError('Uncertain managed submit; do not replay')
                    while True:
                        job = managed('/v1/jobs/' + entry['jobId'])
                        print(canonical({'questionId': qid, 'stage': 'managed-job', 'status': job['status']}), flush=True)
                        if job['status'] == 'completed': break
                        if job['status'] in ['failed', 'cancelled']: raise RuntimeError('Managed job failed: ' + str(job.get('error', 'unknown'))[:300])
                        if time.monotonic() > deadline: raise RuntimeError('Managed job pending; reconcile saved job')
                        time.sleep(5)
                evidence = bridge({**public, 'reconcileOnly': True}, toolfile)
        if not evidence.get('success'): raise RuntimeError('Canonical evidence incomplete; not scored')
        print(canonical({'questionId': qid, 'stage': 'answer'}), flush=True)
        answer = brain(final_answer_prompt(q, evidence) + '\nSchema:\n' + canonical(answer_schema(q)), out / (qid + '-answer.json'), args.final_reasoning_effort)
        row.update(choice_result(answer['answer'], questions[qid]['gold'], q['options']))
        row.update(state='completed', answer=answer['answer'], expected=questions[qid]['gold'], usage=answer['usage'], actions=evidence.get('actions', []), executionMode=args.mode, finalReasoningEffort=args.final_reasoning_effort, rewatchTimeoutMs=args.rewatch_timeout_ms or 'interactive-default', latencySecs=round(time.monotonic()-start, 2))
        atomic(rowfile, row)
        rows.append(row)
        print(canonical({'questionId': qid, 'stage': 'completed', 'correct': row['correct']}), flush=True)
    except Exception as e:
        row.update(state='blocked', correct=None, error=S.clean(type(e).__name__ + ': ' + str(e)))
        atomic(out / 'blocked.json', row)
        print(canonical(row), flush=True)
        break
atomic(out / 'progress.json', {'reader': args.reader, 'baselineCorrect': sum(r['correct'] for r in previous), 'plannedWrong': sum(not r['correct'] for r in previous), 'completedRetries': len(rows), 'recovered': sum(r.get('correct') is True for r in rows), 'rows': rows, 'method': 'Cumulative development recovery. Previously correct answers retained without retesting.'})
