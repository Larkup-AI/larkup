import tempfile,unittest
from pathlib import Path
from harness.common import atomic,DomainError
from harness.config import Config
from harness.store import Store
from harness.scheduler import Scheduler
from harness.tests.test_harness import profile,manifest

class InfrastructurePauseTest(unittest.TestCase):
    def test_infrastructure_failure_stops_admitting_other_paid_tasks(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);atomic(root/'benchmark.env','KEY_ONE=fixture-one\nKEY_TWO=fixture-two\n',raw=True)
            doc=profile();doc['protocol']={'stopOnInfrastructureFailure':True}
            config=Config(doc,root/'benchmark.env');store=Store(root/'state.sqlite3')
            run=store.create(manifest(2),['arm-one'],config.active,'smoke');store.control(run['id'],'start',run['revision'])
            scheduler=Scheduler(store,config,root,root)
            scheduler.pause_after_infrastructure_failure({'run_id':run['id']},config.active,DomainError('CAPABILITY_UNSUPPORTED'))
            self.assertEqual(store.snapshot(run['id'])['state'],'paused')
            self.assertEqual(store.ready(),[])
            self.assertEqual(store.rows('SELECT * FROM attempts'),[])
            store.close()
