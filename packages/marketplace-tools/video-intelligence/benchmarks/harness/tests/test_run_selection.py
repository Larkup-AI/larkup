import json,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
from harness.common import atomic,DomainError
from harness.run_selection import create,activate,status

class RunSelectionTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.data=Path(self.tmp.name)
        self.r=SimpleNamespace(data=self.data,deployment=self.data/'deployment')
        atomic(self.data/'deployment/workflow.json',{'smoke':'run-smoke'})
        atomic(self.data/'configs/active.json',{'protocol':{'variantIds':['arm'],'manifestId':'pilot-new'}})
        atomic(self.data/'datasets/smoke-v1.json',{'questions':[{'id':'visual'},{'id':'audio'}]})
        atomic(self.data/'datasets/pilot-new.json',{'protocol':{'revision':'frozen-next'}})
        self.runs={'run-history':{'id':'run-history','state':'paused','revision':'1','phase':'pilot','decision':'not_evaluated'}}
        self.calls=[]
        self.r.api_items=Mock(side_effect=lambda path: list(self.runs.values()) if path=='/runs' else [{'variantId':'arm','questionId':q,'correct':True,'state':'completed','answer':'{"option":"A"}'} for q in ['visual','audio']])
        def api(path,doc=None,**kw):
            self.calls.append((path,doc,kw))
            if path=='/runs':
                rid='run-new-'+str(len(self.runs));self.runs[rid]={'id':rid,'state':'draft','revision':'1','phase':doc['phase'],'decision':'not_evaluated'}
                return self.runs[rid]
            rid=path.split('/')[2]
            if path.endswith('/start') or path.endswith('/resume'):self.runs[rid]['state']='running'
            return dict(self.runs[rid])
        self.r.api=Mock(side_effect=api)
    def tearDown(self):self.tmp.cleanup()
    def test_new_runs_have_distinct_ids_and_preserve_history_and_manifest(self):
        first=create(self.r,'one')['runId'];self.runs[first]['state']='completed'
        second=create(self.r,'two')['runId']
        self.assertNotEqual(first,second);self.assertEqual(self.runs['run-history']['state'],'paused')
        requests=[x for x in self.calls if x[0]=='/runs']
        self.assertEqual(requests[0][1]['datasetManifestId'],'pilot-new')
        self.assertNotEqual(requests[0][2]['key'],requests[1][2]['key'])
        self.assertEqual(status(self.r)['runId'],second)
    def test_resume_exactly_selected_and_poll_does_not_unpause(self):
        activate(self.r,'run-history');self.runs['run-history']['state']='paused'
        self.r.api.reset_mock();self.assertEqual(status(self.r)['state'],'paused')
        self.assertEqual(self.r.api.call_count,1);self.assertEqual(self.r.api.call_args.args[0],'/runs/run-history')
    def test_another_active_run_rejected_before_creation_or_selection(self):
        self.runs['run-other']={'id':'run-other','state':'running'}
        with self.assertRaises(DomainError):create(self.r,'one')
        with self.assertRaises(DomainError):activate(self.r,'run-history')
        self.r.api.assert_not_called()
    def test_missing_smoke_certificate_runs_smoke_then_exactly_one_pilot(self):
        complete=False
        self.r.api_items.side_effect=lambda path: list(self.runs.values()) if path=='/runs' else [{'variantId':'arm','questionId':q,'correct':True,'state':'completed','answer':'{"option":"A"}'} for q in ['visual','audio']] if complete else []
        smoke=create(self.r,'one');self.assertEqual(smoke['phase'],'smoke')
        self.assertFalse(any(c[1].get('phase')=='pilot' for c in self.calls if c[0]=='/runs'))
        self.assertEqual(status(self.r)['state'],'running')
        self.runs[smoke['runId']]['state']='completed';complete=True
        pilot=status(self.r);self.assertEqual(pilot['phase'],'pilot');self.assertNotEqual(pilot['runId'],smoke['runId'])
        status(self.r)
        self.assertEqual(sum(c[1].get('phase')=='pilot' for c in self.calls if c[0]=='/runs'),1)
        self.assertEqual(self.runs['run-history']['state'],'paused')

    def test_empty_answer_smoke_cannot_admit_pilot(self):
        self.r.api_items.side_effect=lambda path:list(self.runs.values()) if path=='/runs' else []
        smoke=create(self.r,'empty');self.runs[smoke['runId']]['state']='completed'
        self.r.api_items.side_effect=lambda path:list(self.runs.values()) if path=='/runs' else [{'variantId':'arm','questionId':q,'correct':False,'state':'completed','answer':''} for q in ['visual','audio']]
        self.assertEqual(status(self.r)['state'],'smoke_requires_review')
        self.assertFalse(any(c[1].get('phase')=='pilot' for c in self.calls if c[0]=='/runs'))

    def test_service_readiness_does_not_require_correct_or_scored_answers(self):
        self.r.api_items.side_effect=lambda path:list(self.runs.values()) if path=='/runs' else [
            {'variantId':'arm','questionId':q,'correct':score,'state':'completed','answer':'A non-empty provider response'}
            for q,score in [('visual',False),('audio',None)]]
        result=create(self.r,'functional-only')
        self.assertEqual(result['phase'],'pilot')

    def test_finished_run_cannot_be_resumed_or_overwritten(self):
        self.runs['run-history']['state']='completed'
        with self.assertRaises(DomainError):activate(self.r,'run-history')
        self.assertEqual(len(self.calls),1)

class ExistingLauncherCommandTest(unittest.TestCase):
    def test_cli_monitor_follows_smoke_into_automatically_selected_pilot(self):
        import io
        from unittest.mock import patch
        from harness.run_selection import request_existing
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);atomic(root/'relay.json',{'controllerToken':'test-controller-token'})
            payloads=iter([{'revision':'one'},{'id':'op','state':'completed','result':{'runId':'run-smoke'}},
                {'state':'completed','phase':'smoke','coverage':{},'cost':{}},{'summary':[]},
                {'selectedRunId':'run-pilot','supervisor':{'mode':'active'}},
                {'state':'paused','phase':'pilot','coverage':{},'cost':{}},{'summary':[]}])
            paths=[]
            def response(request,**kw):
                paths.append(request.full_url);return io.BytesIO(json.dumps(next(payloads)).encode())
            with patch('urllib.request.urlopen',side_effect=response),patch('builtins.print'):
                request_existing(SimpleNamespace(deployment=root),SimpleNamespace(command='new',detach=False,run_id=None))
            self.assertTrue(any(path.endswith('/runs/run-pilot') for path in paths))

    def test_cli_new_and_selected_resume_use_authenticated_existing_supervisor(self):
        import threading,json
        from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
        from unittest.mock import patch
        from harness.run_selection import request_existing
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);atomic(root/'relay.json',{'controllerToken':'test-controller-token'})
            remote=SimpleNamespace(deployment=root);calls=[]
            class Handler(BaseHTTPRequestHandler):
                def log_message(self,*args):pass
                def do_GET(self):
                    self.reply({'revision':'revision-one','operations':[]} if self.path.endswith('/system') else {'state':'paused','coverage':{},'cost':{}} if not self.path.endswith('/metrics') else {'summary':[]})
                def do_POST(self):
                    self.assertions=(self.headers.get('Authorization'),self.headers.get('Origin'),self.headers.get('Idempotency-Key'))
                    body=json.loads(self.rfile.read(int(self.headers['Content-Length'])));calls.append((self.path,body,self.assertions));self.reply({'id':'operation-one','state':'completed','result':{'runId':body.get('runId','run-new')}})
                def reply(self,body):
                    raw=json.dumps(body).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
            server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            import urllib.request
            original=urllib.request.urlopen
            def connect(request,**kwargs):
                request.full_url=request.full_url.replace('127.0.0.1:28891','127.0.0.1:'+str(server.server_port))
                return original(request,**kwargs)
            try:
                with patch('urllib.request.urlopen',side_effect=connect):
                    request_existing(remote,SimpleNamespace(command='new',detach=True,run_id=None))
                    request_existing(remote,SimpleNamespace(command='resume-run',detach=True,run_id='run-selected'))
            finally:server.shutdown();server.server_close();thread.join()
            self.assertTrue(calls[0][0].endswith('/new-run'));self.assertEqual(calls[1][1]['runId'],'run-selected')
            for _,body,headers in calls:
                self.assertEqual(body['expectedRevision'],'revision-one');self.assertEqual(headers[0],'Bearer test-controller-token');self.assertEqual(headers[1],'http://127.0.0.1:3100');self.assertTrue(headers[2])

if __name__=='__main__':unittest.main()
