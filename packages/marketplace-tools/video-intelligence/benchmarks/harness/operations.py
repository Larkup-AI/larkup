"""PC-owned operator controls. Reads never start a GPU or submit inference."""
from __future__ import annotations
import json
from contextlib import contextmanager
import os
import signal
import sqlite3
import subprocess
import threading
import time
from .common import DomainError, atomic, canonical, digest, identifier, utc
from .inspection import logs

ACTIONS={'new-run','resume-run','start','pause','resume','stop-gpu','force-stop-gpu','cancel-start'}


def intent(deployment, mode=None):
    path=deployment/'supervisor.json'
    if mode is not None:atomic(path,{'mode':mode,'updatedAt':utc()})
    return json.loads(path.read_text()) if path.exists() else {'mode':'observe','updatedAt':None}


@contextmanager
def control_lock(deployment):
    import fcntl
    with (deployment/'control.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        yield


class Operator:
    def __init__(self, remote, *, readonly=False):
        self.remote,self.readonly=remote,readonly
        self.lock=threading.RLock();self.generation=0;self.cancelled_generations=set();self.pod={'state':'unknown','observedAt':None}
        observation=remote.deployment/'pod-observation.json'
        if observation.exists():self.pod=json.loads(observation.read_text())
        self.pod_refresh_at=0;self.refreshing=False
        (remote.data/'state').mkdir(parents=True,exist_ok=True,mode=0o700)
        self.db=sqlite3.connect(remote.data/'state/operator.sqlite3',check_same_thread=False,isolation_level=None)
        self.db.row_factory=sqlite3.Row
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,key TEXT UNIQUE,body_hash TEXT,action TEXT,state TEXT,document TEXT)')
        self.db.execute("UPDATE operations SET state='interrupted' WHERE state IN ('pending','running')")
        # These are generated benchmark credentials, not provider secrets. Redact both kinds.
        path=remote.deployment/'relay.json'
        if path.exists():remote.private.values.update({'relay_'+k:v for k,v in json.loads(path.read_text()).items()})

    def jobs(self):
        with self.lock:
            return [{**json.loads(x['document']),'state':x['state']} for x in self.db.execute('SELECT * FROM operations ORDER BY rowid DESC LIMIT 20')]

    def revision(self):
        return digest({'intent':intent(self.remote.deployment),'operations':self.jobs()})

    def observe_pod(self):
        try:
            pod=self.remote.gql('query { pod(input:{podId:'+json.dumps(self.remote.state['podId'])+'}) { id desiredStatus } }')['pod']
            self.pod={'state':pod['desiredStatus'] if pod else 'unavailable','observedAt':utc()}
            atomic(self.remote.deployment/'pod-observation.json',self.pod)
        except DomainError as error:
            self.pod={**self.pod,'issue':error.issue()}
        finally:self.refreshing=False

    def status(self):
        if not self.readonly and time.monotonic()-self.pod_refresh_at>30 and not self.refreshing:
            self.pod_refresh_at=time.monotonic();self.refreshing=True
            threading.Thread(target=self.observe_pod,daemon=True).start()
        try:
            if self.readonly:raise DomainError('OFFLINE_READONLY')
            health=self.remote.api('/health',timeout=1);live=health.get('availability')=='available'
        except DomainError:live=False
        services=[{'name':'dashboard bridge','state':'running','location':'PC','pid':os.getpid()},
                  {'name':'benchmark controller','state':'running' if live else 'unreachable','location':'RunPod'},
                  {'name':'GPU Pod','state':self.pod['state'],'location':'RunPod'}]
        if live:
            try:
                remote_services=self.remote.api('/services',timeout=3)['items']
                services.extend(s for s in remote_services if s['name']!='benchmark controller')
            except (DomainError,KeyError,TypeError):
                services.append({'name':'canonical video runtime','state':'unknown','location':'RunPod'})
        path=self.remote.deployment/'local-processes.json'
        for record in json.loads(path.read_text()).get('processes',[]) if path.exists() else []:
            observed=subprocess.run(['ps','-p',str(record['pid']),'-o','lstart='],capture_output=True,text=True).stdout.strip()
            services.append({'name':record.get('service','launcher child'),'pid':record['pid'],'location':'PC',
                             'state':'running' if record.get('started') and observed==record['started'] else 'stopped'})
        from .run_selection import selected
        selection=selected(self.remote)
        readiness_path=self.remote.deployment/'provider-readiness-summary.json'
        readiness=self.remote.private.clean(json.loads(readiness_path.read_text())) if readiness_path.exists() else None
        offers_path=self.remote.deployment/'gpu-offers.json'
        offers=json.loads(offers_path.read_text()) if offers_path.exists() else None
        if offers and (offers.get('state')!='pending' or offers.get('expiresAt',0)<=time.time()):offers=None
        return dict(gpuOffers=offers,readiness=readiness,selectedRunId=selection['runId'] if selection else None,revision=self.revision(),readonly=self.readonly,controllerAvailable=live,pod=self.pod,
                    supervisor=intent(self.remote.deployment),services=services,operations=self.jobs(),serverTime=utc())

    def submit(self, action, body, key):
        if self.readonly:raise DomainError('OFFLINE_READONLY',status=409)
        if action=='gpu-choice':
            from .gpu_offers import decide
            with self.lock:return decide(self.remote,body.get('offerId'),body.get('selection'))
        if action not in ACTIONS:raise DomainError('NOT_FOUND',status=404)
        if not key or len(key)>200:raise DomainError('IDEMPOTENCY_KEY_REQUIRED',status=400)
        fingerprint=digest({'action':action,'body':body})
        with self.lock:
            old=self.db.execute('SELECT * FROM operations WHERE key=?',(key,)).fetchone()
            if old:
                if old['body_hash']!=fingerprint:raise DomainError('IDEMPOTENCY_CONFLICT',status=409)
                return {**json.loads(old['document']),'state':old['state']}
            if body.get('expectedRevision')!=self.revision():raise DomainError('REVISION_CONFLICT',status=409)
            if action=='force-stop-gpu' and body.get('confirmation')!='STOP GPU':
                raise DomainError('FORCE_STOP_CONFIRMATION_REQUIRED',status=400)
            active=self.db.execute("SELECT 1 FROM operations WHERE state IN ('pending','running')").fetchone()
            if action=='cancel-start':
                if not any(j['state'] in {'pending','running'} and j.get('cancellable') for j in self.jobs()):
                    raise DomainError('NO_CANCELLABLE_STARTUP',status=409)
                self.cancelled_generations.add(self.generation);self.generation+=1
            if active and action not in {'force-stop-gpu','cancel-start'}:raise DomainError('OPERATION_IN_PROGRESS',status=409)
            if action=='force-stop-gpu':self.generation+=1
            if action=='resume-run' and (not isinstance(body.get('runId'),str) or not body['runId'].startswith('run-')):
                raise DomainError('RUN_ID_INVALID',status=400)
            generation=self.generation
            job={'id':identifier('operation'),'action':action,'state':'pending','createdAt':utc(),'cancellable':action in {'start','new-run','resume-run'},**({'runId':body['runId']} if action=='resume-run' else {})}
            self.db.execute('INSERT INTO operations VALUES(?,?,?,?,?,?)',(job['id'],key,fingerprint,action,'pending',canonical(job)))
            if action in {'pause','stop-gpu','force-stop-gpu','cancel-start'}:intent(self.remote.deployment,'stopped' if action=='force-stop-gpu' else 'paused')
            threading.Thread(target=self.execute,args=(job,generation),daemon=True).start()
            return job

    def update(self,job,state,**fields):
        if state in {'completed','failed','cancelled'}:fields['cancellable']=False
        job.update(state=state,**fields)
        with self.lock:
            self.db.execute('UPDATE operations SET state=?,document=? WHERE id=?',(state,canonical(job),job['id']))
        with (self.remote.deployment/'operator.log').open('a') as stream:
            stream.write(canonical(self.remote.private.clean({'at':utc(),**job}))+'\n')

    def check(self,generation):
        if generation in self.cancelled_generations:raise DomainError('START_CANCELLED')
        if generation!=self.generation:raise DomainError('OPERATION_SUPERSEDED')

    def start_transports(self,generation,on_progress=None):
        self.remote.stop_local_services({'ssh tunnel','credential relay'})
        self.check(generation);self.remote.tunnel();self.remote.relay()
        self.remote.wait_ready(check_cancelled=lambda:self.check(generation),on_progress=on_progress)

    def execute(self,job,generation):
        if job['action']=='force-stop-gpu':
            return self._execute(job,generation)
        try:
            with control_lock(self.remote.deployment):
                self.check(generation)
                return self._execute(job,generation)
        except DomainError as error:
            self.update(job,'cancelled' if error.code=='START_CANCELLED' else 'failed',cancellable=False,issue=error.issue(),finishedAt=utc())

    def _execute(self,job,generation):
        remote=self.remote;action=job['action'];self.update(job,'running')
        previous_intent=intent(remote.deployment)['mode'];started_here=False
        try:
            if action in {'start','new-run','resume-run'}:
                try:
                    live=remote.api('/health',timeout=1).get('availability')=='available'
                except DomainError:live=False
                if action=='start' and live and any(r['state'] in {'running','pausing'} for r in remote.api_items('/runs')):
                    intent(remote.deployment,'active')
                    self.update(job,'completed',stage='Existing benchmark is already active; transports preserved',finishedAt=utc())
                    return
                from .run_selection import assert_available
                if live and action in {'new-run','resume-run'}:
                    assert_available(remote,job.get('runId'))
                intent(remote.deployment,'starting')
                if not live:
                    started_here=True
                    self.update(job,'running',stage='Starting GPU; bounded alternative-host search is enabled')
                    def progress(state):
                        self.check(generation)
                        if state['phase']=='ready':
                            self.pod={'state':'RUNNING','observedAt':utc()}
                            atomic(remote.deployment/'pod-observation.json',self.pod)
                        self.update(job,'running',startup=state,stage=state['stage'])
                        intent(remote.deployment,'waiting_gpu' if state['phase']=='waiting_capacity' else 'starting')
                    remote.resume(on_progress=progress,check_cancelled=lambda:self.check(generation),require_choice=True);self.check(generation)
                    self.update(job,'running',stage='Starting the benchmark controller and canonical video runtime.')
                    remote.ensure_started();self.check(generation)
                    self.start_transports(generation,lambda stage:self.update(job,'running',stage=stage));self.check(generation)
                with self.lock:
                    self.check(generation)
                    self.update(job,'running',cancellable=False,stage='Services are ready. Starting the selected experiment.')
                remote.workflow_admitted=set()
                from .run_selection import create,activate,selected
                saved_selection=selected(remote)
                if action=='new-run':result=create(remote,job['id'])
                elif action=='resume-run':result=activate(remote,job['runId'])
                elif saved_selection:result=activate(remote,saved_selection['runId'])
                else:result=remote.workflow()
                self.check(generation)
                intent(remote.deployment,'active')
                self.update(job,'completed',result=result,finishedAt=utc())
            elif action=='cancel-start':
                intent(remote.deployment,'stopped')
                self.update(job,'completed',stage='Startup cancelled. No benchmark was started.',finishedAt=utc())
            elif action in {'pause','resume','stop-gpu'}:
                runs=remote.api_items('/runs')
                if action=='resume':
                    from .run_selection import selected,activate
                    selection=selected(remote)
                    if not selection:raise DomainError('SELECT_A_RUN_TO_RESUME',status=409)
                    result=activate(remote,selection['runId']);intent(remote.deployment,'active')
                    self.update(job,'completed',result=result,finishedAt=utc());return
                for run in runs:
                    self.check(generation)
                    if run['state']=='running':
                        remote.api('/runs/'+run['id']+'/pause',{'expectedRevision':run['revision']})
                if action=='stop-gpu':
                    self.update(job,'running',stage='Draining paid work before backup and GPU stop')
                    deadline=time.monotonic()+240
                    while any(r['state']=='pausing' for r in remote.api_items('/runs')):
                        self.check(generation)
                        if time.monotonic()>deadline:raise DomainError('DRAIN_TIMEOUT_USE_EXPLICIT_FORCE_STOP')
                        time.sleep(1)
                    self.check(generation);remote.checkpoint_evidence=True;remote.backup();self.check(generation)
                    remote.stop();intent(remote.deployment,'stopped');self.pod={'state':'EXITED','observedAt':utc()}
                self.update(job,'completed',finishedAt=utc())
            else:
                # Deliberately bypass drain/backup only after the operator's typed confirmation.
                remote.stop();intent(remote.deployment,'stopped');self.pod={'state':'EXITED','observedAt':utc()}
                self.update(job,'completed',warning='In-flight outcomes may be unknown; use saved handles for recovery.',finishedAt=utc())
        except Exception as error:
            if action in {'start','new-run','resume-run'}:
                intent(remote.deployment,'stopped' if started_here or isinstance(error,DomainError) and error.code=='START_CANCELLED' else previous_intent)
                if started_here:
                    try:remote.stop()
                    except Exception:pass
            issue=error.issue() if isinstance(error,DomainError) else DomainError('OPERATION_FAILED').issue()
            self.update(job,'cancelled' if isinstance(error,DomainError) and error.code=='START_CANCELLED' else 'failed',cancellable=False,issue=issue,finishedAt=utc())

    def log_page(self,query):
        service=query.get('service',['operator'])[0]
        if service in {'runtime','controller','bootstrap'}:
            try:
                if self.readonly:raise DomainError('OFFLINE_READONLY')
                from urllib.parse import urlencode
                return self.remote.api('/logs?'+urlencode({k:v[0] for k,v in query.items()}),timeout=2)
            except DomainError:
                snapshot=logs(self.remote.data,self.remote.private,service,query,log_directory=self.remote.deployment/'remote-logs')
                if snapshot['available']:
                    return {**snapshot,'snapshot':True}
                return {'service':service,'lines':[],'nextCursor':query.get('cursor',['0'])[0],
                        'hasMore':False,'available':False,'reason':'Remote logs unavailable while the Pod or tunnel is stopped.'}
        return logs(self.remote.data,self.remote.private,service,query)
