from __future__ import annotations

import csv
import io
import json
import random
import re
from collections import defaultdict
from pathlib import Path

from .common import atomic, canonical, digest, utc


def parse_option(answer: str, count: int = 4) -> str | None:
    """Strict answer contract; explanations containing a letter are not an option."""
    text = answer.strip()
    if text.startswith('```'):
        text = re.sub(r'^```(?:json)?\s*|\s*```$', '', text)
    try:
        parsed = json.loads(text)
        value = parsed.get('option') if isinstance(parsed, dict) else parsed
    except (ValueError, AttributeError):
        value = text
    if not isinstance(value, str):
        return None
    value = value.strip().upper()
    return value if len(value) == 1 and value in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[:count] else None


def results(store, run: str) -> list[dict]:
    rows = store.rows('''SELECT t.*,a.route_id,a.route,a.config_revision,a.output answer_output,a.started_at
      FROM tasks t LEFT JOIN attempts a ON a.id=t.current_attempt WHERE t.run_id=? AND t.kind='answer'
      ORDER BY t.source_id,t.question_id,t.variant_id''', (run,))
    output = []
    for t in rows:
        variant = json.loads(store.one('SELECT document FROM variants WHERE run_id=? AND id=?', (run, t['variant_id']))['document'])
        source = json.loads(store.one('SELECT document FROM sources WHERE run_id=? AND id=?', (run, t['source_id']))['document'])
        question = json.loads(store.one('SELECT document FROM questions WHERE run_id=? AND id=?', (run, t['question_id']))['document'])
        route = json.loads(t['route'] or '{}')
        out = json.loads(t['answer_output'] or '{}')
        prep = store.one('SELECT output FROM tasks WHERE id=?', (t['depends_on'],))
        index = json.loads(prep['output'] or '{}')
        timing = dict(queueMs=None, prepareMs=None, uploadMs=None, indexMs=None, answerMs=None,
                      firstTokenMs=None, endToEndMs=None, coldFirstAnswerMs=None, inputReuse=None,
                      measurementProfileId='bounded-independent-v1',
                      unavailableReasons={'firstTokenMs': 'non-streaming provider call', 'indexMs': 'referenced by indexArtifactId'})
        timing.update(out.get('timing', {}))
        usage = out.get('usage', {})
        usage = dict(inputTokens=usage.get('promptTokenCount', usage.get('prompt_tokens')),
                     outputTokens=usage.get('candidatesTokenCount', usage.get('completion_tokens')),
                     reasoningTokens=usage.get('thoughtsTokenCount'), cachedTokens=usage.get('cachedContentTokenCount'),
                     processingSeconds=usage.get('processingSeconds'), freeAllowanceConsumed=None)
        evidence = [dict(sourceId=t['source_id'], startMs=e['startMs'], endMs=e['endMs'],
                         kind=e.get('kind', 'other'), supportedClaim=e.get('claim', e.get('supportedClaim')))
                    for e in out.get('evidence', [])]
        output.append(dict(runId=run, sourceId=t['source_id'], dataset=source.get('dataset'),
                           questionId=t['question_id'], variantId=t['variant_id'], attemptId=t['current_attempt'],
                           configRevision=t['config_revision'], durationGroup=source.get('durationGroup'),
                           sourceDurationMs=source.get('durationMs'), capability=question.get('capability'),
                           logicalModel=route.get('logicalModel'), resolvedModel=out.get('resolvedModel', route.get('model')),
                           routeId=t['route_id'], provider=route.get('provider'), system=variant['adapter'], accountAlias=route.get('secretAlias'),
                           tier=route.get('tier'), state=t['state'], answer=out.get('answer'),
                           predictedOption=out.get('predictedOption'), correct=out.get('correct'),
                           evaluationRevision=out.get('evaluationRevision'), evidence=evidence,
                           cost=store.cost(run, t['current_attempt']) if t['current_attempt'] else dict(currency='USD', actual=None, estimated=None, unknownAttemptCount=0, reconciled=False),
                           taskCost=store.cost(run, task=t['id']),
                           timing=timing, usage=store.attempt_usage(t['current_attempt']),
                           indexArtifactId=index.get('artifactId'), issue=json.loads(t['issue']) if t['issue'] else None))
    return output


def accuracy(rows: list[dict]) -> dict:
    complete = [x for x in rows if x['correct'] is not None and x['state'] == 'completed']
    return dict(value=sum(x['correct'] for x in complete) / len(complete) if complete else None,
                denominator=len(complete), completedCount=len(complete), plannedCount=len(rows))


def percentile(values: list, p: float):
    values = sorted(v for v in values if v is not None)
    return values[min(len(values) - 1, int((len(values) - 1) * p))] if values else None


def metrics(store, run: str) -> dict:
    rows = results(store, run)
    variants = sorted({x['variantId'] for x in rows})
    sets = {v: {x['questionId'] for x in rows if x['variantId'] == v and x['correct'] is not None} for v in variants}
    run_document = json.loads(store.one('SELECT document FROM runs WHERE id=?', (run,))['document'])
    core = run_document['protocol'].get('coreVariantIds', variants)
    core_sets = [sets[v] for v in core if v in sets]
    shared = set.intersection(*core_sets) if core_sets else set()
    groups = defaultdict(list)
    for row in rows:
        groups[(row['variantId'], row['durationGroup'])].append(row)
    paired = []
    for left in variants:
        for right in variants:
            if left >= right:
                continue
            cohort = sets[left] & sets[right]
            a = {x['questionId']: x for x in rows if x['variantId'] == left and x['questionId'] in cohort}
            b = {x['questionId']: x for x in rows if x['variantId'] == right and x['questionId'] in cohort}
            by_source = defaultdict(list)
            for qid in cohort:
                by_source[a[qid]['sourceId']].append(int(a[qid]['correct']) - int(b[qid]['correct']))
            rng = random.Random(731)
            sources = sorted(by_source)
            samples = []
            for _ in range(2000 if sources else 0):
                selected = [rng.choice(sources) for _ in sources]
                differences = [d for source in selected for d in by_source[source]]
                samples.append(sum(differences) / len(differences))
            paired.append(dict(leftVariantId=left, rightVariantId=right, variantA=left, variantB=right,
                               cohortId=digest(sorted(cohort)), comparedSourceCount=len(sources),
                               completedSourceIds=sources, denominator=len(cohort),
                               wins=sum(a[q]['correct'] and not b[q]['correct'] for q in cohort),
                               losses=sum(b[q]['correct'] and not a[q]['correct'] for q in cohort),
                               ties=sum(a[q]['correct'] == b[q]['correct'] for q in cohort),
                               clusterBootstrap95=[percentile(samples, .025), percentile(samples, .975)]))
    by_variant = []
    summaries = []
    for vid in variants:
        subset = [x for x in rows if x['variantId'] == vid]
        latency = [x['timing']['answerMs'] for x in subset if x['state'] == 'completed']
        by_variant.append(dict(variantId=vid, accuracy=accuracy(subset),
                               sharedAccuracy=accuracy([x for x in subset if x['questionId'] in shared]),
                               answerTiming=dict(p50Ms=percentile(latency, .5), p95Ms=percentile(latency, .95), count=len(latency))))
        counts = defaultdict(int)
        for x in subset:
            counts[x['state']] += 1
        variant_document=json.loads(store.one('SELECT document FROM variants WHERE run_id=? AND id=?',(run,vid))['document'])
        summaries.append(dict(variantId=vid, system=subset[0]['system'], logicalModel=variant_document['logicalModel'], plannedCount=len(subset),
                              completedCount=counts['completed'], correctCount=sum(x['correct'] is True for x in subset),
                              incorrectCount=sum(x['correct'] is False for x in subset),
                              blockedCount=sum(counts[s] for s in ('blocked', 'failed', 'waiting_quota')),
                              stateCounts=dict(counts), accuracy=accuracy(subset),
                              cost=store.cost(run, variant=vid),
                              preparationCost=store.cost(run, variant=vid, kind='prepare'),
                              questionCost=store.cost(run, variant=vid, kind='answer')))
    accuracy_metrics, timings = [], []
    for vid in variants:
        subset = [x for x in rows if x['variantId'] == vid]
        for group in ['all'] + sorted({x['durationGroup'] for x in subset}):
            group_rows = [x for x in subset if group == 'all' or x['durationGroup'] == group]
            a = accuracy(group_rows)
            accuracy_metrics.append(dict(cohortId=digest(sorted(x['questionId'] for x in group_rows)), variantId=vid,
                                         durationGroup=group, denominator=a['denominator'], completedCount=a['completedCount'],
                                         plannedCount=a['plannedCount'], correctCount=sum(x['correct'] is True for x in group_rows),
                                         blockedCount=sum(x['state'] in {'blocked', 'failed', 'waiting_quota'} for x in group_rows), accuracy=a['value']))
        for stage in ('answer', 'firstToken', 'queue', 'endToEnd', 'coldFirstAnswer'):
            measured = [x['timing'][stage + 'Ms'] for x in subset if x['state'] == 'completed' and x['timing'][stage + 'Ms'] is not None]
            timings.append(dict(cohortId=digest(sorted(x['questionId'] for x in subset)), variantId=vid, stage=stage,
                                p50Ms=percentile(measured, .5), p95Ms=percentile(measured, .95), sampleCount=len(measured),
                                nullReason=None if measured else 'No completed observed measurements'))
        preparations = store.rows("SELECT output FROM tasks WHERE run_id=? AND variant_id=? AND kind='prepare' AND state='completed'", (run, vid))
        indexing = [json.loads(x['output']).get('timing', {}).get('indexMs') for x in preparations]
        indexing = [x for x in indexing if x is not None]
        timings.append(dict(cohortId=digest(sorted(x['sourceId'] for x in subset)), variantId=vid, stage='index',
                            p50Ms=percentile(indexing, .5), p95Ms=percentile(indexing, .95), sampleCount=len(indexing),
                            nullReason=None if indexing else 'Native service has no persistent index, or indexing incomplete'))
    run_snapshot = store.snapshot(run)
    provider_records = defaultdict(list)
    for item in store.rows('''SELECT u.document,u.attempt_id,r.actual override,a.route FROM usage_events u
      JOIN attempts a ON a.id=u.attempt_id LEFT JOIN usage_reconciliations r ON r.usage_id=u.id WHERE u.run_id=?''', (run,)):
        record, route = json.loads(item['document']), json.loads(item['route'])
        if item['override'] is not None:
            record['actual'] = item['override']
        provider_records[(record.get('provider', route['provider']), record.get('accountAlias', route['secretAlias']))].append(record)
    from decimal import Decimal
    def sum_decimal(entries, field):
        values = [Decimal(str(e[field])) for e in entries if e.get(field) is not None]
        return str(sum(values)) if values else None
    provider_usage = [dict(provider=key[0], accountAlias=key[1], cashSpent=sum_decimal(entries, 'actual'),
                           freeAllowanceConsumed=sum_decimal(entries, 'freeAllowanceConsumed'),
                           listPriceEquivalent=sum_decimal(entries, 'estimated'), currency='USD',
                           unknownRecordCount=sum(e.get('actual') is None for e in entries))
                      for key, entries in sorted(provider_records.items())]
    return dict(runId=run, configRevision=run_snapshot['configRevision'], evaluationRevision='official-mcq-v1',
                accuracy=accuracy_metrics, timing=timings, providerUsage=provider_usage, coverage=run_snapshot['coverage'],
                partial=any(x['state'] != 'completed' for x in rows), cohortId=digest(sorted(x['questionId'] for x in rows)),
                variants=by_variant, summary=summaries, paired=paired, plannedCount=len(rows),
                sharedCompletedQuestions=len(shared), cost=store.cost(run),
                durationGroups=[dict(variantId=k[0], durationGroup=k[1], accuracy=accuracy(v)) for k, v in groups.items()])


def decision(store, run: str) -> tuple[str, str]:
    r = store.one('SELECT document,phase FROM runs WHERE id=?', (run,))
    if r['phase'] != 'pilot':
        return 'not_evaluated', 'Only a preregistered comparative pilot can open expansion.'
    protocol = json.loads(r['document'])['protocol']
    rows = results(store, run)
    if any(x['state'] != 'completed' or x['correct'] is None for x in rows):
        return 'inconclusive', 'Core coverage incomplete; infrastructure failures are not wrong answers.'
    sources = {x['sourceId'] for x in rows}
    if len(sources) < protocol.get('minimumSources', 8):
        return 'inconclusive', 'Too few independent sources.'
    variants = {x['variantId'] for x in rows}
    arms = {v['id']: v['adapter'] for v in protocol.get('arms', [])}
    if not {'larkup', 'gemini', 'qwen', 'twelvelabs', 'retrieval'} <= set(arms.values()):
        return 'inconclusive', 'Canonical tool-action and fixed-backbone ablation tracks are required.'
    larkup = next((v for v in variants if arms.get(v) == 'larkup'), None)
    native = [v for v in variants if arms.get(v) in {'gemini', 'qwen', 'twelvelabs'}]
    if not larkup or len(native) < 3:
        return 'inconclusive', 'Required native comparators are missing.'
    totals = {v: accuracy([x for x in rows if x['variantId'] == v])['value'] for v in variants}
    strongest = max(native, key=lambda v: totals[v])
    if totals[larkup] <= totals[strongest]:
        return 'stop', 'Completed pilot shows no positive accuracy benefit over the strongest native arm.'
    left = {x['questionId']: x for x in rows if x['variantId'] == larkup}
    right = {x['questionId']: x for x in rows if x['variantId'] == strongest}
    wins = [x for q, x in left.items() if x['correct'] and not right[q]['correct']]
    losses = [x for q, x in left.items() if not x['correct'] and right[q]['correct']]
    if len(wins) - len(losses) < protocol.get('minimumNetWins', 2) or len({x['sourceId'] for x in wins}) < 2 or len({x['capability'] for x in wins}) < 2:
        return 'inconclusive', 'Positive signal is small or confined to one source/capability.'
    audits = store.rows('SELECT document FROM audits WHERE run_id=?', (run,))
    if not audits or json.loads(audits[0]['document']).get('status') != 'passed':
        return 'inconclusive', 'Independent paired grounding audit is required; MCQ labels cannot certify citations.'
    return 'continue', 'Preregistered feasibility criteria satisfied; this is not proof of statistical superiority.'


def export(store, run: str, root: Path) -> dict:
    root.mkdir(parents=True, exist_ok=True)
    rows = results(store, run)
    fields = list(rows[0]) if rows else ['runId', 'state', 'correct']
    buffer = io.StringIO(newline='')
    writer = csv.DictWriter(buffer, fieldnames=fields, lineterminator='\n')
    writer.writeheader()
    for row in rows:
        encoded = {k: canonical(v) if isinstance(v, (dict, list)) else v for k, v in row.items()}
        # Prevent spreadsheet formula execution in untrusted model/dataset text.
        encoded = {k: ("'" + str(v) if isinstance(v, str) and v[:1] in '=+-@\t\r' else v) for k, v in encoded.items()}
        writer.writerow(encoded)
    csv_text = buffer.getvalue()
    atomic(root / 'results.csv', csv_text, raw=True)
    data = root / 'data'
    measured = metrics(store, run)
    atomic(data / 'metrics.json', measured)
    atomic(data / 'snapshot.json', store.snapshot(run))
    atomic(data / 'attempts.json', store.rows('SELECT a.* FROM attempts a JOIN tasks t ON t.id=a.task_id WHERE t.run_id=?', (run,)))
    atomic(data / 'usage.json', store.rows('SELECT * FROM usage_events WHERE run_id=?', (run,)))
    def table(name, records):
        if not records:
            atomic(data / name, '', raw=True)
            return
        columns = sorted({key for record in records for key in record})
        buffer = io.StringIO(newline='')
        writer = csv.DictWriter(buffer, fieldnames=columns, lineterminator='\n')
        writer.writeheader()
        for record in records:
            cells = {k: canonical(v) if isinstance(v, (dict, list)) else v for k, v in record.items()}
            cells = {k: "'" + v if isinstance(v, str) and v[:1] in '=+-@\t\r' else v for k, v in cells.items()}
            writer.writerow(cells)
        atomic(data / name, buffer.getvalue(), raw=True)
    usage_rows = store.rows('''SELECT u.*,r.actual reconciled_actual,r.provenance reconciliation_provenance
      FROM usage_events u LEFT JOIN usage_reconciliations r ON r.usage_id=u.id WHERE u.run_id=?''', (run,))
    table('usage.csv', [{**json.loads(x['document']),
                        **({'actual': x['reconciled_actual'], 'reconciliationProvenance': x['reconciliation_provenance']} if x['reconciled_actual'] is not None else {}),
                        'id': x['id'], 'attemptId': x['attempt_id'], 'recordedAt': x['recorded_at']}
                       for x in usage_rows])
    table('attempts.csv', store.rows('SELECT a.* FROM attempts a JOIN tasks t ON t.id=a.task_id WHERE t.run_id=?', (run,)))
    indexes = store.rows('SELECT a.*,t.source_id,t.variant_id FROM artifacts a JOIN tasks t ON t.id=a.task_id WHERE t.run_id=?', (run,))
    table('indexes.csv', [dict(runId=run, sourceId=x['source_id'], variantId=x['variant_id'],
                             artifactId=x['id'], fingerprint=x['fingerprint'], taskId=x['task_id'],
                             **json.loads(x['document']).get('timing', {})) for x in indexes])
    table('metrics.csv', measured['accuracy'])
    table('timing.csv', measured['timing'])
    table('provider-usage.csv', measured['providerUsage'])
    table('paired.csv', measured['paired'])
    def flat_cost(cost, prefix):
        return {prefix + key[0].upper() + key[1:]: value for key, value in cost.items()}
    table('summary.csv', [{**{k: v for k, v in s.items() if k not in {'cost', 'preparationCost', 'questionCost', 'accuracy', 'stateCounts'}},
                           'accuracy': s['accuracy']['value'], 'accuracyDenominator': s['accuracy']['denominator'],
                           **flat_cost(s['cost'], 'total'), **flat_cost(s['preparationCost'], 'preparation'),
                           **flat_cost(s['questionCost'], 'questions')} for s in measured['summary']])
    table('questions.csv', [{**{k: x[k] for k in ('runId', 'sourceId', 'dataset', 'questionId', 'variantId', 'system', 'durationGroup', 'sourceDurationMs', 'capability', 'provider', 'routeId', 'resolvedModel', 'state', 'correct', 'predictedOption', 'indexArtifactId')},
                             **x['timing'], **x['usage'], **flat_cost(x['cost'], 'attempt'),
                             **flat_cost(x['taskCost'], 'task')} for x in rows])
    run_document = json.loads(store.one('SELECT document FROM runs WHERE id=?', (run,))['document'])
    atomic(data / 'protocol.json', run_document)
    d, reason = decision(store, run)
    report = '# Video understanding benchmark\n\n'
    report += f'Run `{run}`. Exported {utc()}. Decision: **{d}**. {reason}\n\n'
    report += '| Variant | Correct | Completed / planned | Accuracy | Answer p50 ms |\n|---|---:|---:|---:|---:|\n'
    for v in measured['variants']:
        a = v['accuracy']
        score = f"{a['value']:.1%}" if a['value'] is not None else 'unknown'
        report += f"| {v['variantId']} | {round(a['value']*a['denominator']) if a['value'] is not None else '—'} | {a['denominator']} / {a['plannedCount']} | {score} | {v['answerTiming']['p50Ms']} |\n"
    report += '\nOfficial MCQ scoring; missing infrastructure cells retain their planned denominator and null correctness. '
    report += 'Paired cluster bootstrap by source is descriptive for a small pilot. Raw index artifacts are not included. '
    report += 'Native input processing is included in response time; persistent indexing is reported once per source artifact. '
    report += 'Unknown paid charges remain unknown. No timestamp-grounding claim is inferred from MCQ accuracy. '
    report += 'Pilot/development sources must be excluded from held-out publication. Public benchmark contamination is possible.\n'
    atomic(root / 'blog.md', report, raw=True)
    return dict(decision=d, reason=reason, checksum=digest(csv_text), path=str(root))
