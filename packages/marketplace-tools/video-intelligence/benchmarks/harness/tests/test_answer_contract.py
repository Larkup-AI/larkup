import unittest
from harness.answer_contract import final_answer_prompt, answer_schema

class AnswerContractTest(unittest.TestCase):
    def test_dynamic_labels_and_null_allow_abstention_without_guessing(self):
        schema=answer_schema({'options':['north','south','east']})
        self.assertEqual(schema['properties']['option']['enum'],['A','B','C',None])
        self.assertFalse(schema['additionalProperties'])
    def test_final_stage_never_receives_executable_agent_policy(self):
        q={'question':'Which direction?','options':['north','south']}
        prompt=final_answer_prompt(q,{'policy':'CALL_ANOTHER_TOOL','pages':[{'text':'observed north'}]})
        self.assertNotIn('CALL_ANOTHER_TOOL',prompt)
        self.assertIn('observed north',prompt)
        self.assertIn('"option":"B","text":"south"',prompt)
        self.assertIn('cannot call tools',prompt)
        self.assertNotIn('correctOption',prompt)
