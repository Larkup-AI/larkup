import unittest
from unittest.mock import Mock, patch
from harness.common import DomainError
from harness.idle_monitor import checkpoint

class IdleMonitorTest(unittest.TestCase):
    def test_transient_read_failure_does_not_shut_down_idle_gpu(self):
        remote=Mock();remote.backup.side_effect=DomainError('CONTROLLER_UNAVAILABLE')
        with patch('builtins.print'):self.assertFalse(checkpoint(remote))
        remote.stop.assert_not_called()
        remote.backup.side_effect=None
        self.assertTrue(checkpoint(remote))

    def test_integrity_failure_is_not_hidden(self):
        remote=Mock();remote.backup.side_effect=DomainError('BACKUP_INVALID')
        with self.assertRaises(DomainError):checkpoint(remote)

    def test_active_monitor_connection_error_is_retried_but_other_errors_propagate(self):
        from harness.idle_monitor import monitoring_error
        with patch('builtins.print'):
            monitoring_error(DomainError('CONTROLLER_UNAVAILABLE'))
        with self.assertRaises(DomainError):monitoring_error(DomainError('BACKUP_INVALID'))
