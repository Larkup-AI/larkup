import tempfile,time,unittest,json
from pathlib import Path
from types import SimpleNamespace
from harness.common import atomic,DomainError
from harness.gpu_offers import decide,choose
class OffersTest(unittest.TestCase):
 def test_expired_or_changed_quotes_cannot_authorize_rentals(self):
  with tempfile.TemporaryDirectory() as folder:
   r=SimpleNamespace(deployment=Path(folder));p=r.deployment/'gpu-offers.json'
   atomic(p,dict(id='one',state='pending',expiresAt=time.time()-1,offers=[{}]))
   with self.assertRaises(DomainError):decide(r,'one','0')
   atomic(p,dict(id='two',state='pending',expiresAt=time.time()+60,offers=[{}]))
   with self.assertRaises(DomainError):decide(r,'one','0')
   decide(r,'two','wait');self.assertEqual(json.loads(p.read_text())['state'],'wait')
 def test_only_the_selected_quote_is_returned(self):
  with tempfile.TemporaryDirectory() as folder:
   r=SimpleNamespace(deployment=Path(folder));offers=[{'gpuTypeId':'first'},{'gpuTypeId':'second'}]
   def check():
    doc=json.loads((r.deployment/'gpu-offers.json').read_text());decide(r,doc['id'],'1')
   self.assertEqual(choose(r,offers,check,lambda *a,**k:None),offers[1])
