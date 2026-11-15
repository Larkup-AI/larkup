import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from harness.common import DomainError
from harness.gpu_capacity import Policy, candidates, capture_checkpoint, checkpoint

class CapacityPolicyTest(unittest.TestCase):
    def test_candidates_are_cuda_compatible_and_inside_incremental_budget(self):
        rows=[{'id':'NVIDIA lower','memoryInGb':24,'lowestPrice':{'uninterruptablePrice':.4}},
              {'id':'NVIDIA next','memoryInGb':48,'lowestPrice':{'uninterruptablePrice':.68}},
              {'id':'NVIDIA expensive','memoryInGb':80,'lowestPrice':{'uninterruptablePrice':1.2}},
              {'id':'AMD alternate','memoryInGb':192,'lowestPrice':{'uninterruptablePrice':.2}},
              {'id':'NVIDIA small','memoryInGb':8,'lowestPrice':{'uninterruptablePrice':.1}}]
        policy=Policy()
        self.assertEqual([x['gpuTypeId'] for x in candidates(rows,'SECURE',policy.budget(.59,0),policy)],['NVIDIA lower'])
        self.assertEqual([x['gpuTypeId'] for x in candidates(rows,'SECURE',policy.budget(.59,2),policy)],['NVIDIA lower','NVIDIA next'])
        self.assertLessEqual(policy.budget(.59,100),.75)
    def test_unavailable_cheap_quotes_do_not_starve_a_new_price_tier(self):
        from harness.gpu_capacity import ranked_candidates
        low={'gpuTypeId':'NVIDIA lower','cloudType':'COMMUNITY','quotedHourlyUsd':.3}
        upper={'gpuTypeId':'NVIDIA upper','cloudType':'SECURE','quotedHourlyUsd':.65}
        history={'COMMUNITY:NVIDIA lower':1000}
        self.assertEqual(ranked_candidates([low,upper],history,1100),[upper,low])
        self.assertEqual(ranked_candidates([low,upper],history,1700),[low,upper])

    def test_invalid_policy_does_not_create_an_unbounded_rental(self):
        for doc in [{'retrySeconds':0},{'maxHourlyUsd':-1},{'maxCandidatesPerPass':100},{'enabled':'yes'}]:
            with self.subTest(doc=doc),self.assertRaises(DomainError):Policy.from_document(doc)

class RecoveryCheckpointTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();root=Path(self.tmp.name)
        self.remote=SimpleNamespace(data=root/'data',deployment=root/'data/deployment',state={'podId':'source-pod'})
        self.remote.deployment.mkdir(parents=True);(self.remote.data/'state').mkdir()
        self.database=self.remote.data/'state/remote-backup.sqlite3'
        c=sqlite3.connect(self.database);c.executescript("create table runs(id text,state text);create table tasks(id text,state text);insert into runs values('historic','paused');");c.close()
        (self.remote.deployment/'remote-evidence.tar').write_bytes(b'fixture archive')
    def tearDown(self):self.tmp.cleanup()
    def test_checkpoint_preserves_a_consistent_immutable_generation(self):
        saved=capture_checkpoint(self.remote);self.database.write_bytes(b'later diagnostic snapshot')
        restored=checkpoint(self.remote)
        self.assertEqual(restored['sourcePodId'],'source-pod');self.assertEqual(restored['generation'],saved['generation'])
        self.assertNotEqual(Path(restored['database']).read_bytes(),self.database.read_bytes())
    def test_pending_paid_work_or_changed_checkpoint_blocks_relocation(self):
        c=sqlite3.connect(self.database);c.execute("insert into tasks values('paid','submitted')");c.commit();c.close()
        with self.assertRaises(DomainError):capture_checkpoint(self.remote)
        c=sqlite3.connect(self.database);c.execute('delete from tasks');c.commit();c.close()
        capture_checkpoint(self.remote);saved=checkpoint(self.remote);Path(saved['database']).write_bytes(b'corrupt')
        with self.assertRaises(DomainError):checkpoint(self.remote)
    def test_checkpoint_from_another_source_is_not_silently_replayed(self):
        capture_checkpoint(self.remote);self.remote.state={'podId':'different-pod'}
        with self.assertRaises(DomainError):checkpoint(self.remote)

class AllocationSafetyTest(unittest.TestCase):
    setUp=RecoveryCheckpointTest.setUp
    tearDown=RecoveryCheckpointTest.tearDown

    def exercise(self, prices=(.55,), restore_error=None, cancel=False, journal=None):
        from unittest.mock import Mock, patch
        from harness.gpu_capacity import relocate
        remote=self.remote;remote.state.update(actualGpuHourlyUsd=.59,image='pinned-image',keyPath='fixture-key')
        saved=capture_checkpoint(remote);alive=set();allocations=[];terminated=[]
        if journal:
            atomic=__import__('harness.common',fromlist=['atomic']).atomic
            atomic(remote.deployment/'gpu-relocation.json',{**journal,'generation':saved['generation']})
        def api(query):
            if query.startswith('ALLOCATE'):
                pod='target-'+str(len(allocations));allocations.append(pod);alive.add(pod)
                self.assertLessEqual(len(alive),1)
                return {'podFindAndDeployOnDemand':{'id':pod,'desiredStatus':'RUNNING','costPerHr':prices[len(allocations)-1]}}
            if 'podTerminate' in query:
                for pod in list(alive):
                    if pod in query:alive.remove(pod);terminated.append(pod)
                return {}
            if 'gpuTypes' in query:
                rows=[] if 'secureCloud:true' in query else [{'id':'NVIDIA fixture-'+str(i),'memoryInGb':24,'lowestPrice':{'uninterruptablePrice':.50+i*.01}} for i in range(len(prices))]
                return {'gpuTypes':rows}
            if 'myself' in query:return {'myself':{'pods':[{'id':'recovered-target','name':journal['name'],'desiredStatus':'RUNNING','costPerHr':.55}]}}
            return {'pod':{'desiredStatus':'EXITED'}}
        remote.gql=Mock(side_effect=api)
        def check():
            if cancel and alive:raise DomainError('START_CANCELLED')
        with patch('harness.gpu_capacity.allocation_input',side_effect=lambda *_:'ALLOCATE') as allocate,patch('harness.gpu_capacity.validate_evidence'),patch('harness.gpu_capacity.wait_ssh'),patch('harness.gpu_capacity.restore_target',side_effect=restore_error):
            if restore_error or cancel:
                with self.assertRaises(DomainError):relocate(remote,attempt=2,check=check,report=Mock())
            else:self.assertTrue(relocate(remote,attempt=2,check=check,report=Mock()))
            return allocations,terminated,allocate.call_count

    def test_above_quote_price_is_discarded_before_another_candidate_is_rented(self):
        allocations,terminated,_=self.exercise(prices=(.9,.55))
        self.assertEqual(len(allocations),2);self.assertEqual(terminated,['target-0'])
        self.assertEqual(self.remote.state['podId'],'target-1')

    def test_failed_restore_keeps_the_original_state_and_discards_only_the_replica(self):
        _,terminated,_=self.exercise(restore_error=DomainError('RESTORE_FAILED'))
        self.assertEqual(self.remote.state['podId'],'source-pod');self.assertEqual(terminated,['target-0'])
        self.assertEqual(checkpoint(self.remote)['sourcePodId'],'source-pod')

    def test_cancellation_after_allocation_cleans_up_without_touching_original_storage(self):
        _,terminated,_=self.exercise(cancel=True)
        self.assertEqual(self.remote.state['podId'],'source-pod');self.assertEqual(terminated,['target-0'])

    def test_interrupted_allocation_is_found_by_its_unique_name_not_submitted_again(self):
        journal={'status':'allocating','name':'unique-recovery-request','candidate':{'gpuTypeId':'NVIDIA fixture','cloudType':'SECURE','quotedHourlyUsd':.5}}
        allocations,_,calls=self.exercise(journal=journal)
        self.assertEqual(allocations,[]);self.assertEqual(calls,0);self.assertEqual(self.remote.state['podId'],'recovered-target')

    def test_dirty_checkpoint_and_incomplete_cleanup_prevent_another_rental(self):
        from unittest.mock import Mock
        from harness.gpu_capacity import relocate,invalidate_checkpoint
        from harness.common import atomic
        capture_checkpoint(self.remote);invalidate_checkpoint(self.remote)
        self.remote.gql=Mock(return_value={'pod':{'desiredStatus':'EXITED'}})
        with self.assertRaises(DomainError):relocate(self.remote,attempt=2,check=Mock(),report=Mock())
        self.assertFalse(any('podFindAndDeploy' in c.args[0] for c in self.remote.gql.call_args_list))
        atomic(self.remote.deployment/'gpu-relocation.json',{'status':'cleanup_required','targetPodId':'pending-cleanup'})
        self.remote.gql.reset_mock()
        with self.assertRaises(DomainError):relocate(self.remote,attempt=2,check=Mock(),report=Mock())
        self.remote.gql.assert_not_called()


class RuntimeCheckpointTest(unittest.TestCase):
    def test_unfinished_runtime_jobs_cannot_be_replayed_during_relocation(self):
        import tarfile
        from harness.gpu_capacity import validate_evidence
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);database=root/'runtime.sqlite3';archive=root/'evidence.tar'
            for state in ['running','completed']:
                if database.exists():database.unlink()
                c=sqlite3.connect(database);c.execute('create table jobs(status text)');c.execute('insert into jobs values(?)',(state,));c.commit();c.close()
                with tarfile.open(archive,'w') as stream:stream.add(database,arcname='data/runtime/runtime.sqlite3')
                if state=='running':
                    with self.assertRaises(DomainError) as e:validate_evidence(archive)
                    self.assertEqual(e.exception.code,'RECOVERY_RUNTIME_BUSY')
                else:validate_evidence(archive)

class TransferCancellationTest(unittest.TestCase):
    def test_cancel_stops_the_owned_ssh_process_during_a_long_operation(self):
        import subprocess,sys
        from unittest.mock import patch
        from harness.gpu_capacity import cancellable_ssh
        target=SimpleNamespace(connection=lambda:[sys.executable,'-c','import time; time.sleep(20)'])
        original=subprocess.Popen;children=[];checks=0
        def spawn(*args,**kwargs):
            child=original(*args,**kwargs);children.append(child);return child
        def cancel():
            nonlocal checks
            checks+=1
            if checks>=2:raise DomainError('START_CANCELLED')
        with patch('harness.gpu_capacity.subprocess.Popen',side_effect=spawn):
            with self.assertRaises(DomainError) as e:cancellable_ssh(target,'ignored',data=b'fixture',check=cancel)
        self.assertEqual(e.exception.code,'START_CANCELLED')
        self.assertIsNotNone(children[0].poll())
