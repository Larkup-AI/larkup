from __future__ import annotations

import argparse
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from harness.common import DomainError, atomic
from harness.remote import Remote, launch_session
from harness.config import Config
from harness.store import Store
from harness.tests.test_harness import manifest, profile


class RemoteWorkflowTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.remote = object.__new__(Remote)
        self.remote.data = self.root / 'data'
        self.remote.deployment = self.root / 'data/deployment'
        atomic(self.remote.data / 'configs/active.json', {'protocol': {'variantIds': ['a', 'b']}})
        atomic(self.remote.data / 'datasets/smoke-v1.json', manifest(1))
        atomic(self.remote.data / 'datasets/pilot-v1.json', {**manifest(1), 'protocol': {'revision': 'frozen'}})
        atomic(self.remote.deployment / 'workflow.json', {'smoke': 'smoke-run'})

    def tearDown(self):
        self.tmp.cleanup()

    def test_missing_smoke_cells_never_open_pilot(self):
        self.remote.api = MagicMock(side_effect=lambda path, *a, **kw: {'items': []} if '/results' in path else {'id': 'smoke-run', 'state': 'completed'})
        self.assertEqual(self.remote.workflow()['state'], 'smoke_requires_review')
        self.assertFalse(any(c.args[0] == '/runs' for c in self.remote.api.call_args_list))

    def test_backup_pagination_preserves_all_results_and_detects_broken_cursor(self):
        self.remote.api = MagicMock(side_effect=[
            {'items': [{'id': 'a'}], 'hasMore': True, 'nextCursor': '1'},
            {'items': [{'id': 'b'}], 'hasMore': False, 'nextCursor': None}])
        self.assertEqual(self.remote.api_items('/runs'), [{'id': 'a'}, {'id': 'b'}])
        self.assertIn('cursor=1', self.remote.api.call_args_list[-1].args[0])
        self.remote.api = MagicMock(return_value={'items': [], 'hasMore': True, 'nextCursor': 'same'})
        with self.assertRaises(DomainError) as error:
            self.remote.api_items('/runs')
        self.assertEqual(error.exception.code, 'CONTROLLER_PAGINATION_INVALID')

    def test_pilot_creation_survives_restart_without_duplicate_work(self):
        calls = []
        runs = {'smoke-run': {'id': 'smoke-run', 'state': 'completed'}}
        def api(path, doc=None, **kwargs):
            calls.append((path, kwargs.get('key')))
            if path.endswith('/results?limit=200'):
                return {'items': [{'variantId': v, 'questionId': 'q-0', 'state': 'completed', 'correct': True, 'answer': 'A response'} for v in ['a', 'b']]}
            if path == '/runs':
                runs['pilot-run'] = {'id': 'pilot-run', 'state': 'draft', 'revision': '1'}
                return runs['pilot-run']
            if path.endswith('/start'):
                runs['pilot-run'] = {'id': 'pilot-run', 'state': 'running', 'revision': '2'}
                return runs['pilot-run']
            return runs[path.split('/')[2]]
        self.remote.api = api
        self.assertEqual(self.remote.workflow()['phase'], 'pilot')
        self.assertEqual(self.remote.workflow()['state'], 'running')
        creations = [key for path, key in calls if path == '/runs']
        self.assertEqual(len(creations), 1)
        self.assertTrue(creations[0].startswith('workflow-'))
        runs['pilot-run'].update(state='completed', decision='stop')
        self.assertEqual(self.remote.workflow()['decision'], 'stop')
        self.assertEqual(len([p for p, _ in calls if p == '/runs']), 1)

    def test_workflow_respects_operator_pause_after_initial_session_admission(self):
        state = {'id': 'smoke-run', 'state': 'running', 'revision': '1'}
        self.remote.api = MagicMock(side_effect=lambda *a, **kw: dict(state))
        self.assertEqual(self.remote.workflow()['state'], 'running')
        state['state'] = 'paused'
        self.assertEqual(self.remote.workflow()['state'], 'paused')
        self.assertFalse(any(c.args[0].endswith('/resume') for c in self.remote.api.call_args_list))
        self.remote.workflow_admitted.clear()  # An explicit new launcher session may resume.
        self.remote.workflow()
        self.assertTrue(any(c.args[0].endswith('/resume') for c in self.remote.api.call_args_list))

    def test_launcher_lock_refuses_an_overlapping_session_before_side_effects(self):
        import fcntl
        from harness.remote import main
        with (self.remote.deployment / 'launcher.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with patch('harness.remote.Remote', return_value=self.remote), patch('harness.remote.launch_session') as launch, patch('sys.argv', ['remote', 'launch', '--no-dashboard']):
                with self.assertRaises(DomainError) as error:
                    main()
                self.assertEqual(error.exception.code, 'LAUNCHER_ALREADY_RUNNING')
                launch.assert_not_called()

    def test_repeated_dashboard_command_reuses_authenticated_operator_without_restarting_children(self):
        import fcntl,io
        from harness.remote import main
        atomic(self.remote.deployment/'relay.json',{'controllerToken':'test-token'})
        with (self.remote.deployment/'launcher.lock').open('a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            with patch('harness.remote.Remote',return_value=self.remote),patch('harness.remote.launch_session') as launch,patch('harness.remote.urllib.request.urlopen',return_value=io.BytesIO(b'{"operations":[]}')) as read,patch('sys.argv',['remote','dashboard']),patch('builtins.print'):
                main()
                launch.assert_not_called()
                self.assertEqual(read.call_args.args[0].get_method(),'GET')

    def test_port_guard_allows_closed_connections_but_rejects_a_live_listener(self):
        import socket
        original=socket.socket
        listener=original();listener.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
        listener.bind(('127.0.0.1',0));listener.listen();port=listener.getsockname()[1]
        class Probe:
            def __init__(self,*args,**kwargs):self.socket=original(*args,**kwargs)
            def __enter__(self):return self
            def __exit__(self,*args):self.socket.close()
            def __getattr__(self,name):return getattr(self.socket,name)
            def bind(self,address):self.socket.bind(('127.0.0.1',port))
        try:
            with patch('socket.socket',Probe):
                with self.assertRaises(DomainError):self.remote.local_ports(True,preserve_transports=True)
            client=original();client.connect(('127.0.0.1',port));accepted,_=listener.accept()
            accepted.close();client.recv(1);client.close();listener.close()
            with patch('socket.socket',Probe):self.remote.local_ports(True,preserve_transports=True)
        finally:listener.close()

    def test_dashboard_only_does_not_start_or_disconnect_existing_gpu_work(self):
        remote=MagicMock();remote.children=[];remote.deployment=self.remote.deployment
        args=argparse.Namespace(command='dashboard',view_only=False,no_dashboard=True,detach=False)
        with patch('harness.remote.threading.Event') as event:
            event.return_value.wait.return_value=True
            launch_session(remote,args)
        for method in ['resume','gql','workflow','api','stop','relay','tunnel','stop_local_services']:
            getattr(remote,method).assert_not_called()
        self.assertTrue(remote.local_ports.call_args.kwargs['preserve_transports'])

    def test_reconnecting_legacy_transports_checks_identity_before_signalling(self):
        from types import SimpleNamespace
        self.remote.state={'keyPath':'fixture-key-path'}
        atomic(self.remote.deployment/'local-processes.json',{'processes':[{'pid':12345,'started':'known-start'}]})
        def observed(command,**kwargs):
            return SimpleNamespace(stdout='ssh -i fixture-key-path root@fixture' if command[-1]=='command=' else 'known-start')
        with patch('harness.remote.subprocess.run',side_effect=observed),patch('harness.remote.os.killpg') as kill,patch('harness.remote.time.sleep'):
            self.remote.stop_local_services({'ssh tunnel'})
        kill.assert_called_once()
        self.assertEqual(kill.call_args.args[0],12345)

    def test_stopping_an_already_stopped_gpu_is_idempotent(self):
        self.remote.state={'podId':'fixture'}
        self.remote.gql=MagicMock(side_effect=[DomainError('RUNPOD_REQUEST_REJECTED'),{'pod':{'id':'fixture','desiredStatus':'EXITED'}}])
        self.assertEqual(self.remote.stop()['podStop']['desiredStatus'],'EXITED')

    def test_next_explicit_launch_updates_only_a_drained_controller(self):
        from types import SimpleNamespace
        self.remote.ssh = MagicMock(return_value=SimpleNamespace(stdout=b'{"revision":"old-code","running":true,"active":0}'))
        self.remote.install = MagicMock()
        self.remote.ensure_started()
        self.remote.install.assert_called_once()
        self.remote.install.reset_mock()
        self.remote.ssh.return_value.stdout = b'{"revision":"old-code","running":true,"active":1}'
        self.remote.ensure_started()
        self.remote.install.assert_not_called()

    def test_idle_wake_reuses_verified_evidence_while_refreshing_database_checkpoint(self):
        import tarfile
        from types import SimpleNamespace
        from harness.gpu_capacity import capture_checkpoint,checkpoint
        self.remote.state={'podId':'fixture'}
        self.remote.data.mkdir(parents=True,exist_ok=True)
        database=self.remote.data/'state/remote-backup.sqlite3'
        store=Store(database);store.close()
        evidence=self.remote.deployment/'remote-evidence.tar'
        with tarfile.open(evidence,'w'):pass
        original=capture_checkpoint(self.remote)
        self.remote.checkpoint_evidence=True
        self.remote.api_items=MagicMock(return_value=[])
        self.remote.ssh=MagicMock(side_effect=[SimpleNamespace(stdout=b''),SimpleNamespace(stdout=database.read_bytes())])
        self.remote._backup()
        self.assertEqual(self.remote.ssh.call_count,2)
        self.assertNotEqual(checkpoint(self.remote)['generation'],original['generation'])
        self.assertEqual(checkpoint(self.remote)['evidenceSha256'],original['evidenceSha256'])

    def test_new_work_invalidates_evidence_reuse(self):
        import io,tarfile
        from types import SimpleNamespace
        from harness.gpu_capacity import capture_checkpoint,invalidate_checkpoint
        self.remote.state={'podId':'fixture'}
        database=self.remote.data/'state/remote-backup.sqlite3'
        store=Store(database);store.close()
        evidence=self.remote.deployment/'remote-evidence.tar'
        with tarfile.open(evidence,'w'):pass
        capture_checkpoint(self.remote);invalidate_checkpoint(self.remote)
        self.remote.checkpoint_evidence=True
        self.remote.api_items=MagicMock(return_value=[])
        self.remote.ssh=MagicMock(side_effect=[SimpleNamespace(stdout=b''),SimpleNamespace(stdout=database.read_bytes()),SimpleNamespace(stdout=evidence.read_bytes())])
        self.remote._backup()
        self.assertEqual(self.remote.ssh.call_count,3)

    def test_startup_failure_stops_rental(self):
        remote = MagicMock()
        remote.children = []
        remote.ensure_started.side_effect = DomainError('SSH_OPERATION_FAILED')
        args = argparse.Namespace(command='launch', view_only=False, no_dashboard=True, detach=False)
        with self.assertRaises(DomainError):
            launch_session(remote, args)
        remote.resume.assert_called_once()
        remote.stop.assert_called_once()
        remote.workflow.assert_not_called()

    def test_view_only_never_contacts_runpod_or_dispatches(self):
        remote = MagicMock()
        remote.children = []
        args = argparse.Namespace(command='launch', view_only=True, no_dashboard=True, detach=False)
        with patch('harness.remote.threading.Event') as event:
            event.return_value.wait.return_value = True
            launch_session(remote, args)
        for method in ['resume', 'gql', 'workflow', 'api', 'stop', 'relay', 'tunnel']:
            getattr(remote, method).assert_not_called()

    def test_offline_view_reads_actual_backup_without_mutation(self):
        secret = self.root / 'benchmark.env'
        atomic(secret, 'KEY_ONE=private-test-key\n', raw=True)
        atomic(self.remote.data / 'configs/active.json', profile())
        config = Config(profile(), secret)
        store = Store(self.root / 'live.sqlite3')
        run = store.create(manifest(1), ['arm-one'], config.active, 'smoke')
        target = self.remote.data / 'state/remote-backup.sqlite3'
        store.backup(target)
        store.close()
        original = target.read_bytes()
        with patch('harness.dashboard_relay.BENCHMARK', self.root):
            from harness.dashboard_relay import offline
            self.assertEqual(offline('/api/v1/health')['availability'], 'offline')
            self.assertEqual(offline('/api/v1/runs')['items'][0]['id'], run['id'])
            self.assertIsNone(offline('/api/v1/runs/' + run['id'] + '/results')['items'][0]['correct'])
        self.assertEqual(original, target.read_bytes())


if __name__ == '__main__':
    unittest.main()
