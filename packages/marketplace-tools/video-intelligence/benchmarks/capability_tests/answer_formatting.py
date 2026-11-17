"""Validate the actual output contract independently of whether its choice is correct."""
import json

def evaluate(answer,option_count):
    try:
        text=answer.strip()
        if text.startswith('```json') and text.endswith('```'):text=text[7:-3].strip()
        obj=json.loads(text)
    except (ValueError,AttributeError):return {'valid':False,'reason':'invalid_json'}
    if not isinstance(obj,dict) or set(obj)!={'option','explanation','evidence'}:return {'valid':False,'reason':'wrong_fields'}
    if obj['option'] not in [chr(65+i) for i in range(option_count)]+[None]:return {'valid':False,'reason':'invalid_option'}
    if not isinstance(obj['explanation'],str) or not isinstance(obj['evidence'],list):return {'valid':False,'reason':'invalid_types'}
    for e in obj['evidence']:
        if not isinstance(e,dict) or set(e)!={'startMs','endMs','kind','claim'}:return {'valid':False,'reason':'invalid_evidence_fields'}
        a,b=e['startMs'],e['endMs']
        if type(a) not in [int,float] or type(b) not in [int,float] or not 0<=a<=b:return {'valid':False,'reason':'invalid_timestamps'}
        if not isinstance(e['kind'],str) or not isinstance(e['claim'],str):return {'valid':False,'reason':'invalid_evidence_types'}
    return {'valid':True,'explicit_abstention':obj['option'] is None}

if __name__ == '__main__':
    from .single import main
    main('answer_formatting')
