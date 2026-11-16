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
   r=SimpleNamespace(deployment=Path(folder));offers=[{'gpuTypeId':'first','quotedHourlyUsd':.3},{'gpuTypeId':'second','quotedHourlyUsd':.4}]
   def check():
    doc=json.loads((r.deployment/'gpu-offers.json').read_text());decide(r,doc['id'],'1')
   self.assertEqual(choose(r,offers,check,lambda *a,**k:None),offers[1])

class WakeChoiceTest(unittest.TestCase):
 def test_wake_resumes_saved_host_without_relocation_or_price_dialog(self):
  from unittest.mock import Mock,patch
  from harness.remote import Remote
  from harness.gpu_capacity import Policy
  with tempfile.TemporaryDirectory() as folder:
   remote=object.__new__(Remote);remote.deployment=Path(folder);remote.state={'podId':'saved'}
   remote.account=Mock(return_value={'clientBalance':10})
   remote.ssh=Mock(return_value=SimpleNamespace(returncode=0,stderr=b''))
   port={'ip':'127.0.0.1','isIpPublic':True,'privatePort':22,'publicPort':30022}
   remote.gql=Mock(side_effect=[{'pod':{'desiredStatus':'EXITED'}},
     {'podResume':{'desiredStatus':'RUNNING'}},
     {'pod':{'desiredStatus':'RUNNING','runtime':{'ports':[port]}}}])
   remote.capacity_fallback=Mock(return_value=True)
   with patch('harness.gpu_capacity.load_policy',return_value=Policy()):
    remote.resume(require_choice=True,on_progress=Mock())
   remote.capacity_fallback.assert_not_called()
   self.assertEqual(sum('podResume' in call.args[0] for call in remote.gql.call_args_list),1)


class DuplicateChoiceTest(unittest.TestCase):
 def test_retry_after_lost_response_returns_same_decision_without_renting_again(self):
  with tempfile.TemporaryDirectory() as folder:
   r=SimpleNamespace(deployment=Path(folder));p=r.deployment/'gpu-offers.json'
   atomic(p,dict(id='offer',state='pending',expiresAt=time.time()+60,offers=[{},{}]))
   first=decide(r,'offer','1');self.assertEqual(first,decide(r,'offer','1'))
   with self.assertRaises(DomainError):decide(r,'offer','0')
