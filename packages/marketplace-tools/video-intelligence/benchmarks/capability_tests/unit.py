"""Machine-readable offline contract-test results, not video model accuracy."""
import time,unittest,sys
from pathlib import Path
from harness.common import atomic,utc,identifier
from .runner import B,revision,implementation

def main():
    suite=unittest.defaultTestLoader.loadTestsFromName('capability_tests.test_capabilities')
    result=unittest.TextTestRunner(verbosity=1).run(suite)
    report={'schema_version':1,'measurement':'synthetic_contract_tests','created_at':utc(),
        'implementation_revision':revision(),'implementation':implementation(),'tests':result.testsRun,'failures':len(result.failures),
        'errors':len(result.errors),'skipped':len(result.skipped),'passed':result.wasSuccessful(),
        'not_model_accuracy':True}
    folder=B/'data/capability-tests/contracts';atomic(folder/'scores.json',report)
    atomic(folder/'runs'/ (identifier('contracts')+'.json'),report)
    raise SystemExit(0 if result.wasSuccessful() else 1)
if __name__=='__main__':main()
