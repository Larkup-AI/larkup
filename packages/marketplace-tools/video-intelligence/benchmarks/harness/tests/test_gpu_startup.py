import tempfile,unittest
from pathlib import Path
from unittest.mock import Mock
from types import SimpleNamespace
from harness.common import DomainError
from harness.remote import Remote

class Clock:
    def __init__(self):self.value=0;self.sleeps=[]
    def now(self):return self.value
    def sleep(self,n):self.value+=n;self.sleeps.append(n)

class GPUStartupTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.r=object.__new__(Remote)
        self.r.deployment=Path(self.tmp.name);self.r.state={'podId':'fixture-pod'}
        self.r.capacity_fallback=Mock(return_value=False);self.r.ssh=Mock(return_value=SimpleNamespace(returncode=0,stderr=b''));self.r.account=Mock(return_value={'clientBalance':10});self.clock=Clock();self.events=[]
    def tearDown(self):self.tmp.cleanup()
    def resume(self,**kwargs):
        return self.r.resume(on_progress=self.events.append,sleep=self.clock.sleep,clock=self.clock.now,**kwargs)
    def test_capacity_failures_wait_then_start_once_and_update_connection(self):
        accepted=False;starts=[]
        def api(query):
            nonlocal accepted
            if 'podResume' in query:
                starts.append(query)
                if len(starts)<3:raise DomainError('RUNPOD_GPU_UNAVAILABLE')
                accepted=True;return {'podResume':{'desiredStatus':'RUNNING'}}
            return {'pod':{'desiredStatus':'RUNNING' if accepted else 'EXITED','runtime':{'ports':[{'privatePort':22,'publicPort':30022,'isIpPublic':True,'ip':'127.0.0.1'}]} if accepted else None}}
        self.r.gql=Mock(side_effect=api);self.resume()
        self.assertEqual(len(starts),3);self.assertEqual(self.clock.value,180)
        waits=[e for e in self.events if e['phase']=='waiting_capacity']
        self.assertEqual([e['retrySeconds'] for e in waits],[60,120])
        self.assertEqual(self.events[-1]['phase'],'ready');self.assertEqual(self.r.state['sshPort'],30022)
        self.assertTrue(all(x<=1 for x in self.clock.sleeps))
    def test_capacity_fallback_is_attempted_after_one_minute_without_another_original_rental(self):
        self.r.gql=Mock(side_effect=lambda q: (_ for _ in ()).throw(DomainError('RUNPOD_GPU_UNAVAILABLE')) if 'podResume' in q else {'pod':{'desiredStatus':'EXITED'}})
        self.r.capacity_fallback.return_value=True
        self.resume()
        self.assertEqual(self.clock.value,60)
        self.assertEqual(self.r.capacity_fallback.call_count,1)
        self.assertEqual(self.r.capacity_fallback.call_args.kwargs['attempt'],2)
        self.assertEqual(self.events[-1]['phase'],'ready')

    def test_ui_capacity_rejection_opens_alternatives_without_backoff(self):
        self.r.gql=Mock(side_effect=lambda q: (_ for _ in ()).throw(DomainError('RUNPOD_GPU_UNAVAILABLE')) if 'podResume' in q else {'pod':{'desiredStatus':'EXITED'}})
        self.r.capacity_fallback.return_value=True
        self.resume(require_choice=True)
        self.assertEqual(self.clock.sleeps,[])
        self.r.capacity_fallback.assert_called_once()
        self.assertEqual(sum('podResume' in c.args[0] for c in self.r.gql.call_args_list),1)

    def test_waiting_can_be_cancelled_before_another_resume_or_connection(self):
        self.r.gql=Mock(side_effect=lambda q: (_ for _ in ()).throw(DomainError('RUNPOD_GPU_UNAVAILABLE')) if 'podResume' in q else {'pod':{'desiredStatus':'EXITED'}})
        def check():
            if self.clock.value>=2:raise DomainError('START_CANCELLED')
        with self.assertRaises(DomainError) as error:self.resume(check_cancelled=check)
        self.assertEqual(error.exception.code,'START_CANCELLED')
        self.assertEqual(sum('podResume' in c.args[0] for c in self.r.gql.call_args_list),1)
        self.assertFalse((self.r.deployment/'remote.json').exists())
    def test_waking_gpu_polls_ports_without_sending_duplicate_resume(self):
        reads=0
        def api(query):
            nonlocal reads
            if 'podResume' in query:return {'podResume':{'desiredStatus':'RUNNING'}}
            reads+=1
            return {'pod':{'desiredStatus':'EXITED' if reads<3 else 'RUNNING','runtime':{'ports':[] if reads<4 else [{'privatePort':22,'publicPort':40022,'isIpPublic':True,'ip':'127.0.0.1'}]}}}
        self.r.gql=Mock(side_effect=api);self.resume()
        self.assertEqual(sum('podResume' in c.args[0] for c in self.r.gql.call_args_list),1)
        self.assertEqual(self.r.state['sshPort'],40022)
    def test_port_advertisement_does_not_skip_actual_ssh_readiness(self):
        self.r.gql=Mock(return_value={'pod':{'desiredStatus':'RUNNING','runtime':{'ports':[{'privatePort':22,'publicPort':50022,'isIpPublic':True,'ip':'127.0.0.1'}]}}})
        self.r.ssh.side_effect=[SimpleNamespace(returncode=255,stderr=b'Connection refused'),SimpleNamespace(returncode=0,stderr=b'')]
        self.resume();self.assertEqual(self.r.ssh.call_count,2);self.assertEqual(self.clock.value,5)
        self.assertEqual(self.events[-1]['phase'],'ready')
    def test_ssh_authentication_and_host_key_errors_are_permanent(self):
        self.r.gql=Mock(return_value={'pod':{'desiredStatus':'RUNNING','runtime':{'ports':[{'privatePort':22,'publicPort':50022,'isIpPublic':True,'ip':'127.0.0.1'}]}}})
        for reason,code in [(b'Permission denied (publickey)','SSH_AUTH_INVALID'),(b'Host key verification failed','SSH_HOST_KEY_CHANGED')]:
            self.r.ssh.return_value=SimpleNamespace(returncode=255,stderr=reason)
            with self.subTest(code=code),self.assertRaises(DomainError) as e:self.resume()
            self.assertEqual(e.exception.code,code);self.assertEqual(self.clock.sleeps,[])

    def test_controller_alone_does_not_admit_work_without_runtime_health(self):
        observations=0
        def api(path,**kw):
            nonlocal observations
            if path=='/health':return {'availability':'available'}
            observations+=1;return {'items':[{'name':'canonical video runtime','state':'running' if observations==3 else 'unreachable'}]}
        self.r.api=Mock(side_effect=api);self.r.wait_ready(sleep=self.clock.sleep,clock=self.clock.now)
        self.assertEqual(observations,3);self.assertEqual(self.clock.value,4)
    def test_failed_bootstrap_is_reported_without_waiting_for_the_service_deadline(self):
        self.r.api=Mock(side_effect=DomainError('CONTROLLER_UNAVAILABLE'))
        self.r.ssh.return_value=SimpleNamespace(returncode=1)
        with self.assertRaises(DomainError) as error:
            self.r.wait_ready(sleep=self.clock.sleep,clock=self.clock.now)
        self.assertEqual(error.exception.code,'REMOTE_BOOTSTRAP_FAILED')
        self.assertEqual(self.clock.value,10)

    def test_service_wait_reports_the_actual_bootstrap_stage(self):
        self.r.private=SimpleNamespace(clean=lambda value:value)
        self.r.api=Mock(side_effect=lambda path,**kw: {'availability':'available','items':[{'name':'canonical video runtime','state':'running'}]} if self.clock.value>=12 else (_ for _ in ()).throw(DomainError('CONTROLLER_UNAVAILABLE')))
        self.r.ssh.return_value=SimpleNamespace(returncode=0,stdout=b'Preparing Python dependencies')
        progress=[]
        self.r.wait_ready(sleep=self.clock.sleep,clock=self.clock.now,on_progress=progress.append)
        self.assertEqual(progress,['Preparing Python dependencies'])
        self.assertEqual(self.clock.value,12)

    def test_service_wait_cancellation_is_not_swallowed_as_health_failure(self):
        self.r.api=Mock(return_value={'availability':'available','items':[{'name':'canonical video runtime','state':'running'}]})
        checks=0
        def cancel():
            nonlocal checks
            checks+=1
            if checks==2:raise DomainError('START_CANCELLED')
        with self.assertRaises(DomainError) as e:self.r.wait_ready(check_cancelled=cancel,sleep=self.clock.sleep,clock=self.clock.now)
        self.assertEqual(e.exception.code,'START_CANCELLED');self.assertEqual(self.clock.sleeps,[])

    def test_permanent_rejection_and_credit_exhaustion_do_not_retry(self):
        for code in ['RUNPOD_AUTH_INVALID','RUNPOD_REQUEST_REJECTED','CREDIT_EXHAUSTED']:
            with self.subTest(code=code):
                self.r.gql=Mock(side_effect=DomainError(code));self.clock=Clock()
                with self.assertRaises(DomainError) as e:self.resume()
                self.assertEqual(e.exception.code,code);self.assertEqual(self.clock.sleeps,[])
        self.r.account.return_value={'clientBalance':0};self.r.gql.reset_mock()
        with self.assertRaises(DomainError):self.resume()
        self.r.gql.assert_not_called()
    def test_already_running_gpu_is_not_resumed_again(self):
        self.r.gql=Mock(return_value={'pod':{'desiredStatus':'RUNNING','runtime':{'ports':[{'privatePort':22,'publicPort':50022,'isIpPublic':True,'ip':'127.0.0.1'}]}}})
        self.resume();self.assertEqual(self.r.gql.call_count,1);self.assertEqual(self.clock.sleeps,[])
    def test_capacity_backoff_is_capped_and_checks_balance_on_retry(self):
        starts=0
        def api(query):
            nonlocal starts
            if 'podResume' in query:
                starts+=1
                if starts<7:raise DomainError('RUNPOD_GPU_UNAVAILABLE')
            return {'pod':{'desiredStatus':'RUNNING' if starts==7 else 'EXITED','runtime':{'ports':[{'privatePort':22,'publicPort':22,'isIpPublic':True,'ip':'127.0.0.1'}]}},'podResume':{}}
        self.r.gql=Mock(side_effect=api);self.resume()
        self.assertEqual([e['retrySeconds'] for e in self.events if e['phase']=='waiting_capacity'],[60,120,120,120,120,120])
        self.assertEqual(self.r.account.call_count,7)
    def test_accepted_but_stuck_start_has_a_bounded_boot_deadline(self):
        self.r.gql=Mock(return_value={'pod':{'desiredStatus':'RUNNING','runtime':{'ports':[]}},'podResume':{}})
        with self.assertRaises(DomainError) as e:self.resume()
        self.assertEqual(e.exception.code,'RUNPOD_STARTUP_INCOMPLETE');self.assertLessEqual(self.clock.value,1800)

if __name__=='__main__':unittest.main()
