import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from harness.common import DomainError
from harness.recovery_contract import completed_evidence, evidence_closure, runtime_command

class RecoveryContractTest(unittest.TestCase):
    def test_completed_canonical_job_keeps_nonfatal_coverage_warning(self):
        result={'semanticObservations':[{'text':'observed action'}], 'semanticDiagnostics':{'error':'one clip unavailable'}}
        self.assertIs(completed_evidence({'status':'completed','result':result}),result)
        self.assertEqual(result['semanticDiagnostics']['error'],'one clip unavailable')

    def test_failed_or_empty_jobs_are_not_accepted(self):
        for job in [{'status':'failed','result':{'semanticObservations':[{}]}}, {'status':'completed','result':{'semanticObservations':[]}}]:
            with self.assertRaises(DomainError):completed_evidence(job)

    def test_backup_checks_actual_evidence_and_rejects_path_escape(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);db=root/'backup.sqlite3'
            with sqlite3.connect(db) as cx:
                cx.execute('create table tasks(id text, kind text, state text, output text)')
                for name,path in [('saved','artifacts/saved.json'),('lost','artifacts/lost.json'),('escape','../elsewhere')]:
                    cx.execute('insert into tasks values(?,?,?,?)',(name,'prepare','completed',json.dumps({'evidencePath':path})))
            (root/'artifacts').mkdir();(root/'artifacts/saved.json').write_text('{}')
            result=evidence_closure(db,root)
            self.assertEqual(result['checked'],3)
            self.assertEqual(result['missingTaskIds'],['escape','lost'])

    def test_timeout_budget_is_bounded_and_benchmark_local(self):
        command=runtime_command('python',{})
        self.assertIn('REQUEST_TIMEOUT_BASE_SECS=240',command[2])
        self.assertIn('REQUEST_TIMEOUT_CEILING_SECS=540',command[2])
        for env in [{'BENCHMARK_VISION_TIMEOUT_BASE':'0'},{'BENCHMARK_VISION_TIMEOUT_CEILING':'900'},{'BENCHMARK_VISION_TIMEOUT_BASE':'oops'}]:
            with self.assertRaises(DomainError):runtime_command('python',env)


class InspectionFenceTest(unittest.IsolatedAsyncioTestCase):
    async def test_next_task_waits_until_saved_inspection_is_terminal(self):
        from unittest.mock import AsyncMock
        from types import SimpleNamespace
        from harness.recovery_contract import settle_inspections
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'inspection.json'
            path.write_text(json.dumps({'range':{'submitted':True,'jobId':'remote-job'}}))
            request=AsyncMock(side_effect=[SimpleNamespace(json=lambda:{'status':'running'}),SimpleNamespace(json=lambda:{'status':'completed'})])
            await settle_inspections(path,request,timeout=2,interval=0)
            self.assertEqual(request.await_count,2)
            request.assert_awaited_with('remote-job')

    async def test_paid_fence_without_remote_id_requires_reconciliation(self):
        from unittest.mock import AsyncMock
        from harness.recovery_contract import settle_inspections
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'inspection.json'
            path.write_text(json.dumps({'range':{'submitted':True}}))
            request=AsyncMock()
            with self.assertRaises(DomainError) as error:await settle_inspections(path,request)
            self.assertEqual(error.exception.code,'REMOTE_OUTCOME_UNKNOWN')
            request.assert_not_awaited()

    async def test_failed_remote_inspection_is_infrastructure_failure(self):
        from unittest.mock import AsyncMock
        from types import SimpleNamespace
        from harness.recovery_contract import settle_inspections
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'inspection.json';path.write_text(json.dumps({'range':{'jobId':'remote-job','submitted':True}}))
            request=AsyncMock(return_value=SimpleNamespace(json=lambda:{'status':'failed'}))
            with self.assertRaises(DomainError) as error:await settle_inspections(path,request)
            self.assertEqual(error.exception.code,'CANONICAL_INDEX_FAILED')


class SerialRelayTest(unittest.TestCase):
    def test_overlapping_tasks_are_rejected_before_any_paid_request(self):
        from types import SimpleNamespace
        from unittest.mock import patch
        from harness.adapters import Larkup
        context=SimpleNamespace(snapshot=SimpleNamespace(config={'limits':{'global':2}}))
        with patch.dict('os.environ',{'BENCHMARK_PROVIDER_PROXY':'http://localhost:18891'}):
            with self.assertRaises(DomainError) as error:Larkup.require_serial_relay(context)
            self.assertEqual(error.exception.code,'ROLE_CONTEXT_UNSAFE')
