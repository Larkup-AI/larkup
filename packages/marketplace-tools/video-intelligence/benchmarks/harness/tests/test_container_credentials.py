import tempfile,unittest
from pathlib import Path
from harness.common import Secrets
from harness.container_credentials import install

class ContainerCredentialsTest(unittest.TestCase):
 def test_permissive_volume_files_are_replaced_by_private_container_links(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);bench=root/'volume';(bench/'data/deployment').mkdir(parents=True)
   for path in [bench/'benchmark.env',bench/'data/deployment/tokens.env']:
    path.write_text('previous');path.chmod(0o666)
   private=root/'container'
   install(bench,['PROVIDER_ALIAS'],'scoped-relay','controller','runtime',private_root=private)
   secrets=Secrets(bench/'benchmark.env')
   self.assertEqual(secrets.get('PROVIDER_ALIAS'),'scoped-relay')
   self.assertEqual(secrets.get('BENCHMARK_RUNTIME_TOKEN'),'runtime')
   for p in private.iterdir():self.assertEqual(p.stat().st_mode & 0o777,0o600)
   install(bench,['PROVIDER_ALIAS'],'new-relay','controller','new-runtime',private_root=private)
   self.assertEqual(Secrets(bench/'benchmark.env').get('BENCHMARK_RUNTIME_TOKEN'),'new-runtime')
