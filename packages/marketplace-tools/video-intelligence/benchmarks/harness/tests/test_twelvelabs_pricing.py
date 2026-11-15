import unittest
from decimal import Decimal
from harness.twelvelabs_pricing import analyze_estimate, equivalent

class PricingTest(unittest.TestCase):
    def test_analyze_counts_each_request_and_output(self):
        self.assertEqual(Decimal(analyze_estimate(720, 2400)), Decimal('0.368'))
        self.assertEqual(Decimal(analyze_estimate(720, None)), Decimal('0.35'))

    def test_only_invoked_operations_and_storage_horizon_are_counted(self):
        self.assertEqual(Decimal(equivalent(analyzeVideoHour=1, marengo30VideoHour=1,
            marengo30AudioHour=1, storageGbMonth=2, searchThousandQueries='.005')),
            Decimal('4.90'))
        self.assertEqual(Decimal(equivalent(marengo35AudioMillionTokens=3)), Decimal('.195'))

    def test_free_plan_meter_keeps_estimate_separate_from_cash(self):
        from types import SimpleNamespace
        from unittest.mock import MagicMock
        from harness.adapters import Context
        c=object.__new__(Context)
        route=dict(provider='twelvelabs', model='pegasus1.6', secretAlias='test-alias', scopeId='test-scope', tier='free')
        c.attempt={'id':'attempt-test', 'route_id':'route-test', 'route':__import__('json').dumps(route)}
        c.store=MagicMock();c.snapshot=SimpleNamespace(secrets=SimpleNamespace(clean=lambda x:x))
        result=c.meter({'usage':{'output_tokens':2400}},operation='native_analyze',processing_seconds=720)
        self.assertIsNone(result['actual'])
        self.assertEqual(Decimal(result['estimated']),Decimal('.368'))
        self.assertTrue(c.store.usage.call_args.args[1]['estimateComplete'])
        c.meter({},operation='native_analyze',processing_seconds=720)
        self.assertFalse(c.store.usage.call_args.args[1]['estimateComplete'])
        self.assertIn('lower bound',c.store.usage.call_args.args[1]['estimateDisclosure'])
