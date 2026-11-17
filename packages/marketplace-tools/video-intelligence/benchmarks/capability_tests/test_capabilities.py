import json,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from . import evidence_retrieval as retrieval,temporal_understanding as temporal,full_video_info as full
from . import agentic_live_analysis as live,visual_precision as visual,answer_formatting as formatting
from .abstention import evaluate as abstention
from .score_annotations import score

class CapabilityMetricsTest(unittest.TestCase):
    def test_retrieval_measures_missing_relevant_records(self):
        r=retrieval.evaluate(['r1','r2'],['noise','r2'],2)
        self.assertEqual(r['recall_at_k'],.5);self.assertEqual(r['reciprocal_rank'],.5)
    def test_order_checks_missing_events_instead_of_only_shared_pairs(self):
        self.assertEqual(temporal.evaluate(['a','b','c'],['b','a','c'])['pairwise_order_accuracy'],2/3)
        self.assertEqual(temporal.evaluate(['a','b','c'],['a','b'])['pairwise_order_accuracy'],1/3)
    def test_duplicate_event_instances_are_not_silently_deduplicated(self):
        self.assertEqual(temporal.evaluate(['a','b'],['a','a','b'])['status'],'invalid')
    def test_fact_inventory_does_not_certify_unannotated_facts(self):
        r=full.evaluate(['f1','f2'],['f1','new'])
        self.assertEqual(r['annotated_fact_recall'],.5);self.assertEqual(r['annotated_fact_precision'],.5)
        self.assertIn('adjudication',r['limitation'])
    def test_missing_reference_is_unavailable_not_a_perfect_score(self):
        self.assertEqual(full.evaluate([],[])['status'],'unavailable')
        self.assertEqual(retrieval.evaluate([],[])['status'],'unavailable')
    def test_visual_precision_compares_annotated_attributes(self):
        self.assertEqual(visual.evaluate({'object.color':'blue'},{'object.color':'red'})['attribute_accuracy'],0)
    def test_live_submission_is_not_proof_of_completed_consumed_analysis(self):
        self.assertFalse(live.evaluate([{'event':'inspection_submitted','job_id':'job'}])['all_submitted_results_consumed'])
        self.assertTrue(live.evaluate([{'event':'inspection_submitted','job_id':'job'},
            {'event':'inspection_completed','job_id':'job'},{'event':'evidence_requeried','job_id':'job'}])['all_submitted_results_consumed'])
        self.assertEqual(live.evaluate([])['status'],'not_exercised')
    def test_schema_rejects_text_choice_and_reversed_timestamps(self):
        answer={'option':'square','explanation':'observed','evidence':[]}
        self.assertFalse(formatting.evaluate(json.dumps(answer),2)['valid'])
        answer.update(option='B',evidence=[{'startMs':200,'endMs':100,'kind':'visual','claim':'shape'}])
        self.assertFalse(formatting.evaluate(json.dumps(answer),2)['valid'])
    def test_infrastructure_excluded_from_accuracy_and_abstention(self):
        r=abstention([{'state':'completed','predicted':None,'correct':False,'answerable':True,'explicit_abstention':True},{'state':'blocked','correct':None}])
        self.assertEqual(r['infrastructure_excluded'],1);self.assertEqual(r['false_abstentions'],1)
    def test_external_predictions_cannot_override_reference(self):
        with self.assertRaises(ValueError):score([{'id':'x','capability':'visual_precision','reference':{'expected':{'color':'blue'}}}],
            [{'id':'x','prediction':{'expected':{'color':'red'},'predicted':{'color':'red'}}}])
    def test_completed_paid_request_is_reused_without_network(self):
        from .runner import paid_answer
        from harness.common import digest
        from harness.answer_contract import final_answer_prompt,answer_schema
        case={'id':'case','public_question':{'question':'Which shape?','options':['circle','square']},'source_sha256':'source','index_sha256':'index'}
        args=SimpleNamespace(model='fixture-model',max_input_chars=10000,max_output_tokens=128,calls=0,max_paid_calls=0)
        evidence={};request={'model':args.model,'messages':[{'role':'user','content':final_answer_prompt(case['public_question'],evidence)}],
            'temperature':0,'max_tokens':128,'response_format':{'type':'json_schema','json_schema':{'name':'video_answer','strict':True,'schema':answer_schema(case['public_question'])}}}
        key=digest({'request':request,'source':'source','index':'index'})
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/(key+'.json');path.write_text(json.dumps({'state':'completed','output':{'answer':'B'}}))
            with patch('urllib.request.urlopen') as network:
                output,reused=paid_answer(case,evidence,args,Path(folder));self.assertTrue(reused);network.assert_not_called()
            path.write_text(json.dumps({'state':'submitted'}))
            with self.assertRaises(RuntimeError):paid_answer(case,evidence,args,Path(folder))

    def test_paid_response_is_saved_even_when_output_cannot_be_parsed(self):
        from .runner import paid_answer
        from unittest.mock import MagicMock
        import io
        case={'id':'case','public_question':{'question':'Which shape?','options':['circle','square']},'source_sha256':'source','index_sha256':'index'}
        args=SimpleNamespace(model='fixture-model',max_input_chars=10000,max_output_tokens=128,calls=0,max_paid_calls=1)
        with tempfile.TemporaryDirectory() as folder:
            response=MagicMock();response.__enter__.return_value=io.StringIO(json.dumps({'choices':[],'usage':{'cost':.001}}))
            with patch('capability_tests.runner.Secrets') as secrets,patch('urllib.request.urlopen',return_value=response) as network:
                secrets.return_value.get.return_value='fixture-only-token'
                with self.assertRaises(RuntimeError):paid_answer(case,{},args,Path(folder))
                self.assertEqual(network.call_count,1)
                stored=json.loads(next(Path(folder).glob('*.json')).read_text())
                self.assertEqual(stored['state'],'response_received')
                self.assertEqual(stored['provider_response']['usage']['cost'],.001)
                with self.assertRaises(RuntimeError):paid_answer(case,{},args,Path(folder))
                self.assertEqual(network.call_count,1)

    def test_invalid_output_is_not_misreported_as_false_abstention(self):
        r=abstention([{'state':'completed','predicted':None,'correct':False,'answerable':True,'invalid_output':True}])
        self.assertEqual(r['false_abstentions'],0)
        self.assertEqual(r['invalid_output_count'],1)

    def test_changing_model_cannot_bypass_unknown_paid_outcome(self):
        from .runner import paid_answer
        case={'id':'same-case','public_question':{'question':'Which shape?','options':['circle','square']},'source_sha256':'source','index_sha256':'index'}
        args=SimpleNamespace(model='changed-model',max_input_chars=10000,max_output_tokens=128,calls=0,max_paid_calls=1)
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder)/'old-request.json').write_text(json.dumps({'state':'submitted','case_id':'same-case'}))
            with patch('urllib.request.urlopen') as network:
                with self.assertRaises(RuntimeError):paid_answer(case,{},args,Path(folder))
                network.assert_not_called()
