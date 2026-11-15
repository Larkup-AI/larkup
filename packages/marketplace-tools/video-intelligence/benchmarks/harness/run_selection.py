"""Explicit fresh experiments and selection-aware resume; history is never overwritten."""
from __future__ import annotations
import json
import re
from .common import DomainError, atomic, utc, digest


def selected(remote):
    path=remote.deployment/'selected-run.json'
    return json.loads(path.read_text()) if path.exists() else None


def assert_available(remote, except_id=None):
    if any(r['id']!=except_id and r['state'] in {'running','pausing','cancelling'} for r in remote.api_items('/runs')):
        raise DomainError('ANOTHER_RUN_ACTIVE_PAUSE_IT_FIRST',status=409)


def missing_smoke(remote,variants):
    state=json.loads((remote.deployment/'workflow.json').read_text())
    certificates=set(state.get('smokeCertificates',[]))|{state.get('smoke'),state.get('nativeSmoke')}
    passed=set()
    for run_id in certificates-{None}:
        for row in remote.api_items('/runs/'+run_id+'/results'):
            if row['state']=='completed' and row['correct'] is not None and isinstance(row.get('answer'),str) and row['answer'].strip():
                # This checks successful API completion, not benchmark superiority.
                passed.add((row['variantId'],row['questionId']))
    smoke=json.loads((remote.data/'datasets/smoke-v1.json').read_text())
    expected={(v,q['id']) for v in variants for q in smoke['questions']}
    return [v for v in variants if any((v,q['id']) not in passed for q in smoke['questions'])]


def smoke_verified(remote,variants):
    if missing_smoke(remote,variants):raise DomainError('SERVICE_SMOKE_REQUIRED_BEFORE_NEW_PILOT',status=409)


def activate(remote,run_id):
    if not isinstance(run_id,str) or not re.fullmatch(r'run-[A-Za-z0-9_-]+',run_id):
        raise DomainError('RUN_ID_INVALID',status=400)
    assert_available(remote,run_id)
    run=remote.api('/runs/'+run_id)
    if run['state'] not in {'draft','paused','blocked','running'}:
        raise DomainError('RUN_FINISHED_CREATE_NEW_INSTEAD',status=409)
    if run['state']!='running':
        op='start' if run['state']=='draft' else 'resume'
        run=remote.api('/runs/'+run_id+'/'+op,{'expectedRevision':run['revision']})
    atomic(remote.deployment/'selected-run.json',{'runId':run_id,'mode':'single','selectedAt':utc()})
    remote.workflow_admitted={run_id}
    return {'runId':run_id,'state':run['state'],'phase':run['phase']}


def _pilot(remote,key,config):
    manifest_id=config['protocol'].get('manifestId','pilot-v1')
    if not isinstance(manifest_id,str) or not re.fullmatch(r'[A-Za-z0-9_-]+',manifest_id):
        raise DomainError('MANIFEST_INVALID',status=400)
    manifest=json.loads((remote.data/'datasets'/(manifest_id+'.json')).read_text())
    run=remote.api('/runs',dict(datasetManifestId=manifest_id,phase='pilot',variantIds=config['protocol']['variantIds'],
                               protocolRevision=manifest['protocol']['revision']),key='new-run-'+key)
    return activate(remote,run['id'])


def create(remote,key):
    import fcntl
    with (remote.deployment/'workflow.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        assert_available(remote)
        config=json.loads((remote.data/'configs/active.json').read_text())
        missing=missing_smoke(remote,config['protocol']['variantIds'])
        if not missing:return _pilot(remote,key,config)
        manifest=json.loads((remote.data/'datasets/smoke-v1.json').read_text())
        run=remote.api('/runs',dict(datasetManifestId='smoke-v1',phase='smoke',variantIds=missing,
                                   protocolRevision=manifest.get('protocol',{}).get('revision','engineering-smoke-v1')),key='new-smoke-'+key)
        result=activate(remote,run['id'])
        atomic(remote.deployment/'selected-run.json',{'runId':run['id'],'mode':'smoke-before-pilot','pilotKey':key,'profileRevision':digest(config),'selectedAt':utc()})
        return result


def status(remote):
    selection=selected(remote)
    if not selection:return None
    run=remote.api('/runs/'+selection['runId'])
    if selection.get('mode')=='smoke-before-pilot' and run['state']=='completed':
        # Remote.workflow holds workflow.lock. Reusing the request key prevents duplicate pilots.
        workflow_path=remote.deployment/'workflow.json'
        workflow=json.loads(workflow_path.read_text())
        workflow['smokeCertificates']=sorted(set(workflow.get('smokeCertificates',[]))|{run['id']})
        atomic(workflow_path,workflow)
        config=json.loads((remote.data/'configs/active.json').read_text())
        if selection.get('profileRevision')!=digest(config) or missing_smoke(remote,config['protocol']['variantIds']):
            return {'runId':run['id'],'phase':'smoke','state':'smoke_requires_review','decision':'inconclusive'}
        return _pilot(remote,selection['pilotKey'],config)
    return {'runId':run['id'],'phase':run['phase'],'state':'finished' if run['state']=='completed' else run['state'],
            'decision':run['decision']}


def request_existing(remote,args):
    """Use the authenticated existing dashboard supervisor instead of opening duplicate services."""
    import time,urllib.request,urllib.error
    from .common import canonical,identifier
    credentials=json.loads((remote.deployment/'relay.json').read_text())
    def call(path,body=None,key=None):
        headers={'Authorization':'Bearer '+credentials['controllerToken'],'Origin':'http://127.0.0.1:3100'}
        if body is not None:headers.update({'Content-Type':'application/json','Idempotency-Key':key or identifier('cli')})
        req=urllib.request.Request('http://127.0.0.1:28891/api/v1'+path,data=None if body is None else canonical(body).encode(),headers=headers)
        try:
            with urllib.request.urlopen(req,timeout=10) as response:return json.load(response)
        except urllib.error.HTTPError as error:
            try:code=json.load(error)['error']['code']
            except (ValueError,KeyError):code='OPERATOR_REQUEST_REJECTED'
            raise DomainError(code,status=error.code) from None
        except OSError:raise DomainError('EXISTING_LAUNCHER_UNREACHABLE') from None
    state=call('/system');action='new-run' if args.command=='new' else 'resume-run'
    job=call('/system/'+action,{'expectedRevision':state['revision'],**({'runId':args.run_id} if action=='resume-run' else {})})
    print('Request accepted by the running dashboard supervisor: '+job['id'],flush=True)
    while job['state'] in {'pending','running'}:
        time.sleep(1);jobs=call('/system')['operations'];job=next((j for j in jobs if j['id']==job['id']),job)
        print(job.get('stage') or job['state'],flush=True)
    if job['state']!='completed':raise DomainError((job.get('issue') or {}).get('code','OPERATION_FAILED'))
    run_id=job['result']['runId'];print('Tracking run: '+run_id,flush=True)
    print('Dashboard: http://127.0.0.1:3100/?run='+run_id,flush=True)
    if args.detach:return
    print('Press Ctrl-C to leave this terminal monitor. The dashboard keeps supervising the run.',flush=True)
    try:
        while True:
            snap=call('/runs/'+run_id);scores=call('/runs/'+run_id+'/metrics')
            print(canonical({'runId':run_id,'state':snap['state'],'coverage':snap['coverage'],'cost':snap['cost'],'providers':scores.get('summary',[])}),flush=True)
            if snap['state'] not in {'running','pausing','cancelling'}:break
            time.sleep(5)
    except KeyboardInterrupt:print('Monitor closed; use dashboard Pause or Save & stop GPU to stop work.',flush=True)
