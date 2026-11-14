import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock,patch
from harness.common import Secrets,DomainError,atomic
from harness.inspection import database,logs
from harness.operations import Operator,intent
from harness.store import Store
from harness.config import Config
from harness.tests.test_harness import profile,manifest


class InspectionOperationsTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.data=self.root/'data';self.deployment=self.data/'deployment';self.deployment.mkdir(parents=True)
        secret=self.root/'benchmark.env';atomic(secret,'KEY_ONE=private-key-value-123\n',raw=True)
        self.private=Secrets(secret);self.store=Store(self.data/'state/benchmark.sqlite3')
        self.config=Config(profile(),secret);self.run=self.store.create(manifest(2),['arm-one'],self.config.active,'smoke')
        self.remote=MagicMock();self.remote.data=self.data;self.remote.deployment=self.deployment;self.remote.private=self.private
        self.remote.state={'podId':'fixture-pod'};self.remote.api.side_effect=DomainError('CONTROLLER_UNAVAILABLE')
        self.operator=Operator(self.remote)
    def tearDown(self):
        self.operator.db.close();self.store.close();self.tmp.cleanup()
    def test_database_pages_raw_rows_but_never_labels_or_keys(self):
        page=database(self.store,self.private,'questions',{'limit':['1']})
        self.assertEqual(len(page['items']),1);self.assertTrue(page['hasMore']);self.assertNotIn('gold',page['columns'])
        second=database(self.store,self.private,'questions',{'limit':['1'],'cursor':[page['nextCursor']]})
        self.assertNotEqual(page['items'][0]['id'],second['items'][0]['id'])
        with self.store.transaction() as cx:cx.execute('INSERT INTO settings VALUES(?,?)',('fixture',json.dumps({'apiKey':'private-key-value-123','nested':{'relayCapability':'generated-capability','value':'safe'}})))
        exported=database(self.store,self.private,'settings',{},export=True)
        text=json.dumps(exported);self.assertNotIn('private-key-value-123',text);self.assertNotIn('generated-capability',text)
        self.assertIn('safe',text)
        with self.assertRaises(DomainError):database(self.store,self.private,'questions; DROP TABLE runs',{})
        self.assertTrue(self.store.snapshot(self.run['id']))
    def test_logs_are_bounded_redacted_and_reject_paths(self):
        path=self.deployment/'operator.log';path.write_text('first private-key-value-123\nAuthorization: Bearer unknown-provider-value\nlast\n')
        page=logs(self.data,self.private,'operator',{'limit':['1']})
        self.assertTrue(page['hasMore']);self.assertNotIn('private-key-value-123',json.dumps(page))
        second=logs(self.data,self.private,'operator',{'cursor':[page['nextCursor']]})
        self.assertNotIn('unknown-provider-value',json.dumps(second))
        self.assertEqual(len(second['lines']),2)
        with self.assertRaises(DomainError):logs(self.data,self.private,'../../benchmark.env',{})
        path.write_text('rotated\n');self.assertTrue(logs(self.data,self.private,'operator',{'cursor':['999']})['reset'])
    def test_readonly_operator_cannot_start_and_does_not_query_runpod(self):
        self.operator.readonly=True;self.operator.status()
        self.remote.gql.assert_not_called()
        with self.assertRaises(DomainError):self.operator.submit('start',{'expectedRevision':self.operator.revision()},'key')
        self.remote.resume.assert_not_called()
    def test_force_stop_requires_confirmation_and_idempotency(self):
        body={'expectedRevision':self.operator.revision()}
        with self.assertRaises(DomainError) as error:self.operator.submit('force-stop-gpu',body,'force-key')
        self.assertEqual(error.exception.code,'FORCE_STOP_CONFIRMATION_REQUIRED');self.remote.stop.assert_not_called()
        body['confirmation']='STOP GPU'
        with patch('harness.operations.threading.Thread') as thread:
            accepted=self.operator.submit('force-stop-gpu',body,'force-key')
            duplicate=self.operator.submit('force-stop-gpu',body,'force-key')
            self.assertEqual(accepted['id'],duplicate['id']);self.assertEqual(thread.call_count,1)
            with self.assertRaises(DomainError):self.operator.submit('force-stop-gpu',{**body,'confirmation':'different'},'force-key')
    def test_force_stop_supersedes_a_queued_start_without_leaving_it_pending(self):
        with patch('harness.operations.threading.Thread'):
            job=self.operator.submit('start',{'expectedRevision':self.operator.revision()},'queued-start')
        self.operator.generation+=1
        self.operator.execute(job,0)
        self.assertEqual(self.operator.jobs()[0]['state'],'failed')
        self.remote.resume.assert_not_called()

    def test_stale_revision_and_concurrent_start_are_rejected(self):
        with self.assertRaises(DomainError):self.operator.submit('start',{'expectedRevision':'stale'},'key')
        with patch('harness.operations.threading.Thread'):
            self.operator.submit('start',{'expectedRevision':self.operator.revision()},'start-key')
            with self.assertRaises(DomainError) as error:self.operator.submit('start',{'expectedRevision':self.operator.revision()},'other-key')
            self.assertEqual(error.exception.code,'OPERATION_IN_PROGRESS')
    def test_graceful_stop_backs_up_before_stopping_gpu(self):
        self.remote.api.side_effect=None;self.remote.api_items.side_effect=[[{'id':'run-fixture','state':'running','revision':'1'}],[]]
        order=[];self.remote.backup.side_effect=lambda:order.append('backup');self.remote.stop.side_effect=lambda:order.append('stop')
        self.operator.execute({'id':'fixture','action':'stop-gpu'},0)
        self.assertEqual(order,['backup','stop']);self.assertEqual(intent(self.deployment)['mode'],'stopped')
        self.assertTrue(self.remote.api.call_args.args[0].endswith('/pause'))
    def test_force_stop_does_not_wait_for_unreachable_controller(self):
        self.operator.execute({'id':'fixture','action':'force-stop-gpu'},0)
        self.remote.stop.assert_called_once();self.remote.backup.assert_not_called();self.remote.api_items.assert_not_called()
    def test_starting_active_benchmark_preserves_transports_and_paid_work(self):
        self.remote.api.side_effect=None;self.remote.api.return_value={'availability':'available'}
        self.remote.api_items.return_value=[{'state':'running'}]
        self.operator.execute({'id':'fixture','action':'start'},0)
        self.remote.resume.assert_not_called();self.remote.tunnel.assert_not_called();self.remote.workflow.assert_not_called()
        self.assertEqual(intent(self.deployment)['mode'],'active')
    def test_full_json_run_export_uses_all_rows_and_preserves_null_accuracy(self):
        from harness.api import Controller
        ctl=Controller(self.store,self.config,self.data,'test-token',readonly=True)
        result=ctl.get('/runs/'+self.run['id']+'/exports/results.json',{})
        self.assertEqual(len(result['results']),2);self.assertTrue(all(x['correct'] is None for x in result['results']))
        self.assertEqual(len(result['tasks']),4)
        self.assertEqual(len(result['questions']),2)
        self.assertTrue(all('gold' not in q for q in result['questions']))
        self.assertIn('events',result)
        self.assertIn('attempts',result)

    def test_operator_http_auth_origin_and_confirmed_replay(self):
        import threading,http.client
        from http.server import ThreadingHTTPServer
        from harness.dashboard_relay import handler
        server=ThreadingHTTPServer(('127.0.0.1',0),handler(self.operator,'fixture-controller-token'))
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        def request(method,path,body=None,**overrides):
            headers={'Authorization':'Bearer fixture-controller-token','Content-Type':'application/json',
                     'Origin':'http://127.0.0.1:3100','Idempotency-Key':'http-fixture',**overrides}
            connection=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=3)
            connection.request(method,'/api/v1'+path,body=json.dumps(body).encode() if body is not None else None,headers=headers)
            response=connection.getresponse();value=json.loads(response.read());status=response.status;connection.close()
            return status,value
        try:
            self.assertEqual(request('GET','/system',Authorization='Bearer wrong')[0],401)
            body={'expectedRevision':self.operator.revision(),'confirmation':'STOP GPU'}
            self.assertEqual(request('POST','/system/force-stop-gpu',body,Origin='https://untrusted.example')[0],403)
            with patch.object(self.operator,'execute'):
                accepted=request('POST','/system/force-stop-gpu',body)
                replay=request('POST','/system/force-stop-gpu',body)
                self.assertEqual(accepted[0],202);self.assertEqual(accepted[1]['id'],replay[1]['id'])
            self.remote.stop.assert_not_called()
            self.operator.readonly=True
            with patch('harness.dashboard_relay.offline',return_value={'items':[{'id':'saved-row'}]}),patch('harness.dashboard_relay.urllib.request.urlopen') as upstream:
                self.assertEqual(request('GET','/database/tasks')[1]['items'][0]['id'],'saved-row')
                upstream.assert_not_called()
        finally:server.shutdown();server.server_close();thread.join()

if __name__=='__main__':unittest.main()
