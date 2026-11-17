from __future__ import annotations
import argparse,csv,fcntl,hashlib,json,re,sqlite3,subprocess,time,urllib.request,urllib.error
from pathlib import Path
from harness.common import atomic,canonical,digest,utc,Secrets,identifier
from harness.answer_contract import final_answer_prompt,answer_schema
from .common import choice_result,ratio,wilson
from .answer_formatting import evaluate as formatting
from .abstention import evaluate as abstention

B=Path(__file__).resolve().parents[1]
CATEGORIES=['evidence_retrieval','temporal_understanding','visual_precision','full_video_info','agentic_live_analysis','answer_formatting','abstention']

def read(path):return json.loads(Path(path).read_text())

def implementation():
    repo=B.parents[3]
    paths=list((B.parent/'src').glob('*.ts'))+list((repo/'packages/core/src/video-knowledge').glob('*.ts'))+list(Path(__file__).parent.glob('*.py'))
    paths += [B/'harness/tool-bridge.mjs',B/'harness/evidence-pages.mjs',B/'harness/answer_contract.py', B/'harness/quick-look-bridge.mjs', B/'harness/paid-rewatch-cache.mjs', repo/'packages/workspace-server/src/lib/media/video/quick-look.ts']
    hashes={str(p.relative_to(repo)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(set(paths)) if p.is_file()}
    return {'git_revision':revision(),'source_tree_sha256':digest(hashes),'files':hashes}

def revision():
    return subprocess.check_output(['git','rev-parse','HEAD'],cwd=B,text=True).strip()

def prepare(args):
    database=Path(args.database).resolve()
    cx=sqlite3.connect(database.as_uri()+'?mode=ro&immutable=1',uri=True);cx.row_factory=sqlite3.Row
    cases=[]
    for item in args.case:
        category,question_id=item.split(':',1)
        if category not in CATEGORIES:raise ValueError('Unknown category')
        rows=cx.execute("""SELECT t.id,t.variant_id,t.source_id,t.output,t.state,t.depends_on,
            q.document question,q.gold,s.document source,a.config_revision
            FROM tasks t JOIN questions q ON q.run_id=t.run_id AND q.id=t.question_id
            JOIN sources s ON s.run_id=t.run_id AND s.id=t.source_id
            LEFT JOIN attempts a ON a.id=t.current_attempt
            WHERE t.run_id=? AND t.kind='answer' AND t.question_id=? ORDER BY t.variant_id""",(args.run,question_id)).fetchall()
        if not rows:raise ValueError('Question missing from selected run: '+question_id)
        for row in rows:
            if not re.search(args.variant_regex,row['variant_id']):continue
            source=json.loads(row['source']);question=json.loads(row['question'])
            prep=cx.execute('SELECT output FROM tasks WHERE id=?',(row['depends_on'],)).fetchone()
            prepared=json.loads(prep[0] or '{}');path=(B/'data/deployment/watcher-final/evidence'/prepared.get('evidencePath','')).resolve()
            case=dict(id=question_id+'::'+row['variant_id'],category=category,source_id=row['source_id'],
                source_duration_ms=source.get('durationMs'),media_path=source['path'],source_sha256=source.get('sha256'),
                public_question={k:question[k] for k in ['question','options']},reference={'expected_option':row['gold']},
                variant_id=row['variant_id'],config_revision=row['config_revision'],
                archived_state=row['state'],archived_output=json.loads(row['output'] or '{}'),
                index_path=str(path) if path.is_file() else None,
                index_sha256=hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None)
            cases.append(case)
    if not cases or not 1<=len({c['source_id'] for c in cases})<=3:raise ValueError('Demo needs 1-3 distinct videos and at least one selected case')
    manifest=dict(schema_version=1,created_at=utc(),source_run=args.run,
        source_database_sha256=hashlib.sha256(database.read_bytes()).hexdigest(),
        purpose='development_demo_not_independent_test_set',cases=cases)
    atomic(Path(args.out),manifest);print(canonical({'manifest':args.out,'videos':len({c['source_id'] for c in cases}),'cases':len(cases)}))

def bridge(case,investigation):
    path=Path(case['index_path']);assert hashlib.sha256(path.read_bytes()).hexdigest()==case['index_sha256'],'Index changed; freeze a new manifest'
    code={k:v for k,v in implementation()['files'].items()
          if '/capability_tests/' not in k and not k.endswith('.test.ts')}
    cache_key=digest({'source':case['source_id'],'index':case['index_sha256'],
                      'question':case['public_question'],'investigation':investigation,'code':code})
    cached=B/'data/capability-tests/evidence-cache'/(cache_key+'.json')
    if cached.exists():return read(cached)['response'],True
    public=dict(evidencePath=str(path),sourceId=case['source_id'],question=case['public_question'],
        investigation=investigation,protocol={'maxEvidencePages':64},roles={},
        runtimeEndpoint='http://127.0.0.1:1',runtimeToken='offline-no-runtime')
    result=subprocess.run(['node','--import','tsx',str(B/'harness/tool-bridge.mjs')],
        cwd=B.parent.parents[1]/'core',input=canonical(public),text=True,capture_output=True,timeout=180)
    if result.returncode:raise RuntimeError('Canonical bridge failed; no answer scored')
    response=json.loads(result.stdout)
    if not response.get('success'):raise RuntimeError('Canonical evidence unavailable; no answer scored')
    atomic(cached,{'response':response,'source_sha256':case['source_sha256'],'index_sha256':case['index_sha256'],'canonical_code':code})
    return response,False

def paid_answer(case,evidence,args,cache):
    prompt=final_answer_prompt(case['public_question'],evidence)
    if len(prompt)>args.max_input_chars:raise RuntimeError('Input budget exceeded; no truncation and no paid call')
    request={'model':args.model,'messages':[{'role':'user','content':prompt}],'temperature':0,
        'max_tokens':args.max_output_tokens,'response_format':{'type':'json_schema','json_schema':{
        'name':'video_answer','strict':True,'schema':answer_schema(case['public_question'])}}}
    key=digest({'request':request,'source':case['source_sha256'],'index':case['index_sha256']})
    target=cache/(key+'.json')
    if target.exists():
        old=read(target)
        if old['state']!='completed':raise RuntimeError('Paid outcome requires reconciliation; automatic retry refused')
        return old['output'],True
    for pending_file in cache.glob('*.json'):
        pending=read(pending_file)
        if pending.get('case_id')==case['id'] and pending.get('state')!='completed':
            raise RuntimeError('This case has an unresolved paid outcome; changed prompts/models cannot bypass reconciliation')
    if args.calls>=args.max_paid_calls:raise RuntimeError('Paid-call limit reached')
    token=Secrets(B/'benchmark.env').get('VERCEL_GATEWAY_API_KEY')
    atomic(target,{'state':'submitted','submitted_at':utc(),'request_fingerprint':key,'case_id':case['id']})
    args.calls+=1
    r=urllib.request.Request('https://ai-gateway.vercel.sh/v1/chat/completions',data=canonical(request).encode(),
        headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(r,timeout=90) as response:payload=json.load(response)
        atomic(target,{'state':'response_received','provider_response':payload,'request_fingerprint':key,'case_id':case['id']})
        output={'answer':payload['choices'][0]['message']['content'],'usage':payload.get('usage',{}),
            'resolvedModel':payload.get('model')}
        atomic(target,{'state':'completed','output':output,'completed_at':utc(),'request_fingerprint':key,'case_id':case['id']})
        return output,False
    except Exception:
        # submitted fence is deliberately retained. Never replay an unknown paid request.
        raise RuntimeError('Paid request unresolved; inspect saved fence before any retry') from None

def run(args):
    manifest=read(args.manifest);cases=manifest['cases']
    if args.suite:cases=[c for c in cases if c['category']==args.suite]
    if not cases:raise ValueError('No cases selected')
    folder=Path(args.out);folder.mkdir(parents=True,exist_ok=True);cache=B/'data/capability-tests/paid-cache';cache.mkdir(parents=True,exist_ok=True)
    args.calls=0;rows=[];start=time.monotonic();halted=False;code_at_start=implementation()
    # One process owns this demo ledger; parallel launch must not duplicate paid calls.
    with (cache/'run.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        for case in cases:
            row=dict(case_id=case['id'],category=case['category'],source_id=case['source_id'],
                variant_id=case['variant_id'],source_config_revision=case['config_revision'],state='running')
            atomic(folder/'progress.json',{'mode':args.mode,'rows':rows+[row],'updated_at':utc()})
            try:
                if halted:raise RuntimeError('Not started after earlier infrastructure/budget failure')
                if args.mode!='replay' and implementation()['source_tree_sha256']!=code_at_start['source_tree_sha256']:raise RuntimeError('Source changed during run; freeze code before continuing')
                if args.mode=='replay':
                    if case['archived_state']!='completed':raise RuntimeError('Archived infrastructure outcome excluded')
                    output=case['archived_output'];row['cache_reused']=True
                else:
                    if not case.get('index_path'):raise RuntimeError('Saved index missing; automatic reindex refused')
                    directive={'scope':'source','goal':'synthesize','evidence':['visual','speech']} if case['category']=='full_video_info' else {'scope':'focused','goal':'answer','evidence':['visual']}
                    evidence,evidence_reused=bridge(case,directive);row['retrieval']={'success':True,'cache_reused':evidence_reused,'pages':len(evidence.get('pages',[])),
                        'actions':evidence.get('actions',[]),'metric':'execution_only_not_relevance_accuracy'}
                    if args.mode=='integration':
                        row['state']='integration_completed';row['correct']=None;rows.append(row)
                        atomic(folder/'progress.json',{'mode':args.mode,'rows':rows,'updated_at':utc()})
                        continue
                    output,reused=paid_answer(case,evidence,args,cache);row['cache_reused']=reused
                row.update(choice_result(output.get('answer',''),case['reference']['expected_option'],case['public_question']['options']))
                row.update(state='completed',answer=output.get('answer',''),usage=output.get('usage',{}),
                    output_contract=formatting(output.get('answer',''),len(case['public_question']['options'])),
                    answerable=True)
                row['explicit_abstention']=row['output_contract'].get('explicit_abstention') is True
                row['invalid_output']=not row['output_contract']['valid']
                row['new_reported_cost_usd']=0 if args.mode!='live' or row['cache_reused'] else row['usage'].get('cost')
                if args.mode=='replay':
                    row['historical_correct']=case['archived_output'].get('correct')
                    if row['correct'] != row['historical_correct']:raise RuntimeError('Historical evaluation mismatch; no score migration allowed')
            except Exception as error:
                row.update(state='blocked',correct=None,error=str(error));halted=args.mode!='replay'
            rows.append(row)
            atomic(folder/'progress.json',{'mode':args.mode,'rows':rows,'updated_at':utc()})
        complete=[r for r in rows if r['state']=='completed'];correct=sum(r['correct'] for r in complete)
        summary=[]
        for category in sorted({r['category'] for r in rows}):
            subset=[r for r in complete if r['category']==category];wins=sum(r['correct'] for r in subset)
            summary.append({'category':category,'metric':'mcq_answer_accuracy_proxy','correct':wins,'denominator':len(subset),
                'value':ratio(wins,len(subset)),'wilson_95':wilson(wins,len(subset)),
                'limitation':'Does not measure exhaustive fact recall, live inspection success or evidence relevance.'})
        enough=len(complete)>=args.min_samples
        gate='not_measured' if args.mode=='integration' else 'insufficient_samples' if not enough else 'passed' if correct/len(complete)>=args.target_accuracy and not any(r['state']=='blocked' for r in rows) else 'not_met'
        source_changed=implementation()['source_tree_sha256']!=code_at_start['source_tree_sha256']
        if source_changed:gate='source_changed_during_run'
        report=dict(schema_version=1,run_id=identifier('cap'),created_at=utc(),
            mode=args.mode,manifest_sha256=digest(manifest),implementation_revision=code_at_start['git_revision'],implementation=code_at_start,source_changed_during_run=source_changed,valid_for_comparison=not source_changed,
            measurement='historical_replay' if args.mode=='replay' else 'saved_index_integration' if args.mode=='integration' else 'answer_only_ablation_on_saved_index',
            run_parameters={k:getattr(args,k) for k in ['max_paid_calls','max_input_chars','max_output_tokens','target_accuracy','min_samples']},
            environment={'python':__import__('sys').version.split()[0],'node':subprocess.check_output(['node','--version'],text=True).strip(),
                         'lockfile_sha256':hashlib.sha256((B.parents[3]/'pnpm-lock.yaml').read_bytes()).hexdigest()},
            model=args.model if args.mode=='live' else None,videos=len({r['source_id'] for r in rows}),
            planned=len(rows),completed=len(complete),integration_completed=sum(r['state']=='integration_completed' for r in rows),blocked=sum(r['state']=='blocked' for r in rows),
            accuracy=ratio(correct,len(complete)),accuracy_wilson_95=wilson(correct,len(complete)),
            categories=summary,abstention=abstention(rows),rows=rows,paid_calls_this_run=args.calls,
            reported_new_cost_usd=sum(float(r.get('new_reported_cost_usd') or 0) for r in rows),
            unknown_new_charge_count=max(0,args.calls-sum(args.mode=='live' and r.get('cache_reused') is False and r.get('new_reported_cost_usd') is not None for r in rows)),
            elapsed_seconds=time.monotonic()-start,gate={'status':gate,'target':args.target_accuracy,'min_samples':args.min_samples},
            missing_capability_annotations=['evidence relevance IDs','event instance order','source-wide fact inventory','live inspection completion/consumption trace'],
            research_limitations=['Development cases previously inspected during debugging; not held-out evidence.',
                'Repeated questions/models on the same video are correlated; Wilson intervals are descriptive, not cluster-adjusted.',
                'Repricing or replay does not establish post-change accuracy; no automatic model/code optimization.',
                'Each repeated live call may cost money unless exact cached request is reused.'])
        atomic(folder/'scores.json',report);atomic(folder/'runs'/ (report['run_id']+'.json'),report)
        with (folder/'results.csv').open('w',newline='',encoding='utf-8-sig') as file:
            writer=csv.DictWriter(file,fieldnames=['category','metric','correct','denominator','value']);writer.writeheader()
            writer.writerows({k:r[k] for k in writer.fieldnames} for r in summary)
        print(canonical({k:report[k] for k in ['run_id','mode','videos','planned','completed','blocked','accuracy','paid_calls_this_run','gate']}))
    return 2 if report['blocked'] or source_changed else 3 if args.enforce_gate and gate!='passed' else 0

def main():
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='command',required=True)
    p=sub.add_parser('prepare-demo');p.add_argument('--database',default=str(B/'data/state/remote-backup.sqlite3'));p.add_argument('--run',required=True);p.add_argument('--case',action='append',required=True);p.add_argument('--variant-regex',default='vb-gemini-');p.add_argument('--out',required=True)
    p=sub.add_parser('run');p.add_argument('--manifest',required=True);p.add_argument('--out',required=True);p.add_argument('--mode',choices=['replay','integration','live'],default='replay');p.add_argument('--suite',choices=CATEGORIES);p.add_argument('--model',default='anthropic/claude-sonnet-4.5');p.add_argument('--max-paid-calls',type=int,default=3);p.add_argument('--max-input-chars',type=int,default=60000);p.add_argument('--max-output-tokens',type=int,default=512);p.add_argument('--target-accuracy',type=float,default=.85);p.add_argument('--min-samples',type=int,default=30);p.add_argument('--enforce-gate',action='store_true')
    p=sub.add_parser('score-capabilities');p.add_argument('--cases',required=True);p.add_argument('--predictions',required=True);p.add_argument('--out',required=True)
    args=parser.parse_args()
    if args.command=='prepare-demo':prepare(args)
    elif args.command=='score-capabilities':
        from .score_annotations import score
        atomic(Path(args.out),score(read(args.cases),read(args.predictions)))
    else:
        if not 0<=args.target_accuracy<=1 or args.min_samples<1 or args.max_paid_calls<0 or args.max_input_chars<1 or args.max_output_tokens<1:parser.error('Invalid bounds')
        raise SystemExit(run(args))
