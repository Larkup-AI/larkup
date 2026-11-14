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

    def test_pilot_creation_survives_restart_without_duplicate_work(self):
        calls = []
        runs = {'smoke-run': {'id': 'smoke-run', 'state': 'completed'}}
        def api(path, doc=None, **kwargs):
            calls.append((path, kwargs.get('key')))
            if path.endswith('/results?limit=200'):
                return {'items': [{'variantId': v, 'questionId': 'q-0', 'state': 'completed', 'correct': True} for v in ['a', 'b']]}
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
