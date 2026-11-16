import unittest
from harness.provider_relay import runtime_payload
from harness.common import digest

class ReasoningPolicyTest(unittest.TestCase):
    def test_declared_effort_reaches_provider_without_changing_historical_default(self):
        document={'model':'old','messages':[],'max_tokens':1400}
        spec={'provider':'deepinfra','model':'reasoner'}
        projected=runtime_payload(document,spec,reasoning_effort='none')
        self.assertEqual(projected['reasoning_effort'],'none')
        self.assertNotIn('reasoning_effort',document)
        self.assertNotIn('reasoning_effort',runtime_payload(document,spec))
    def test_effort_overrides_gateway_hint_and_preserves_output_allowance(self):
        p=runtime_payload({'reasoning':{'effort':'minimal'},'max_tokens':6000}, {'provider':'deepinfra','model':'reasoner'},reasoning_effort='none')
        self.assertEqual(p['reasoning_effort'],'none');self.assertEqual(p['max_tokens'],6000)
    def test_preparation_identity_includes_protocol(self):
        from harness.adapters import preparation_fingerprint
        base={'extraction':{'mode':'balanced'},'roles':{},'canonicalRevision':'rev','inputProtocol':{}}
        changed={**base,'inputProtocol':{'roleReasoningEffort':{'brain':'none'}}}
        self.assertNotEqual(preparation_fingerprint({'sha256':'source'},base),preparation_fingerprint({'sha256':'source'},changed))
