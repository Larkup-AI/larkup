import json,tempfile,unittest
from pathlib import Path
from harness.main import default_profile
from harness.common import atomic
from harness.config import Config

class FundedMatrixTest(unittest.TestCase):
    def test_fresh_cells_preserve_history_separate_text_brain_and_vision_and_declare_fallbacks(self):
        from harness.profiles import funded_deepseek_matrix
        base=default_profile('revision');original=json.loads(json.dumps(base))
        candidate=funded_deepseek_matrix(base,gemini_aliases=['GEMINI_APIKEY2','GEMINI_APIKEY1'])
        self.assertEqual(base,original)
        for key,value in original['variants'].items():self.assertEqual(candidate['variants'][key],value)
        cells=candidate['protocol']['variantIds'];self.assertEqual(len(cells),5)
        visions=[candidate['variants'][v]['roles']['vision']['model'] for v in cells]
        self.assertEqual(sum('qwen' in m.lower() for m in visions),1)
        self.assertIn('deepseek-ai/DeepSeek-V4.1-Flash-1017',visions)
        for cell in cells:
            v=candidate['variants'][cell]
            self.assertEqual(v['roles']['brain']['model'],'deepseek-ai/DeepSeek-V4-Pro')
            self.assertEqual(v['inputProtocol']['roleInputModalities']['brain'],['text'])
            self.assertEqual(v['extraction']['mode'],'balanced')
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)
            aliases={r['secretAlias'] for r in candidate['routes'].values()}|{r['secretAlias'] for v in candidate['variants'].values() for r in v.get('roles',{}).values()}
            atomic(p/'benchmark.env',''.join(k+'=fixture-'+k+'\n' for k in aliases),raw=True)
            Config(candidate,p/'benchmark.env')
