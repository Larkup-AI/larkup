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

class WakeChoiceTest(unittest.TestCase):
 def test_wake_requests_quotes_before_any_saved_host_rental(self):
  from unittest.mock import Mock,patch
  from harness.remote import Remote
  from harness.gpu_capacity import Policy
  with tempfile.TemporaryDirectory() as folder:
   remote=object.__new__(Remote);remote.deployment=Path(folder);remote.state={'podId':'saved'}
   remote.gql=Mock(return_value={'pod':{'desiredStatus':'EXITED'}})
   remote.capacity_fallback=Mock(return_value=True)
   with patch('harness.gpu_capacity.load_policy',return_value=Policy()):
    remote.resume(require_choice=True,on_progress=Mock())
   remote.capacity_fallback.assert_called_once()
   self.assertTrue(all('mutation' not in call.args[0] for call in remote.gql.call_args_list))
