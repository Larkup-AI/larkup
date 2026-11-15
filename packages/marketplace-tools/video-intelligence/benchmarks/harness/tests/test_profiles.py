import json,tempfile,unittest
from pathlib import Path
from harness.main import default_profile
from harness.profiles import FRAME_MODELS,requested_models_manifest,requested_models_profile
from harness.common import atomic
from harness.config import Config
from harness.store import Store
from harness.scoring import metrics
from harness.tests.test_harness import manifest

class RequestedProfileTest(unittest.TestCase):
    def test_matrix_has_requested_models_and_preserves_prior_variants(self):
        base=default_profile('revision');before=json.loads(json.dumps(base));new=requested_models_profile(base)
        self.assertEqual(base,before)
        for key,variant in base['variants'].items():self.assertEqual(new['variants'][key],variant)
        selected=new['protocol']['variantIds'];self.assertEqual(len(selected),7)
        for vid,rid,adapter,model,_,_ in FRAME_MODELS:
            self.assertIn(vid,selected);self.assertEqual(new['routes'][rid]['model'],model);self.assertEqual(new['variants'][vid]['adapter'],adapter)
        self.assertEqual(new['routes']['twelvelabs-direct']['model'],'pegasus1.5')
        self.assertNotIn('qwen-frames',selected)
    def test_new_systems_are_distinct_in_cost_score_exports_and_manifest(self):
        profile=default_profile('revision')
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory);aliases={r['secretAlias'] for r in profile['routes'].values()}|{s['secretAlias'] for v in profile['variants'].values() for s in v.get('roles',{}).values()}
            atomic(p/'benchmark.env',''.join(k+'=private-fixture-'+k+'\n' for k in aliases),raw=True);config=Config(profile,p/'benchmark.env');store=Store(p/'state.sqlite3')
            original=manifest(2);original['protocol']['variantQuestionIds']={};m=requested_models_manifest(original,profile)
            self.assertEqual(m['sources'],original['sources']);self.assertEqual(m['questions'],original['questions']);self.assertEqual(len(m['protocol']['coreVariantIds']),6)
            run=store.create(m,profile['protocol']['variantIds'],config.active,'pilot');summary=metrics(store,run['id'])['summary']
            self.assertTrue({'qwen','muse','minimax','gemini','larkup','twelvelabs'}<={x['system'] for x in summary})
            self.assertIn('muse-spark-1.3',{x['logicalModel'] for x in summary});self.assertTrue(all(x['accuracy']['value'] is None for x in summary));store.close()

if __name__=='__main__':unittest.main()
