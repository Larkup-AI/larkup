"""Evaluate independently annotated capability cases; gold never goes to inference."""
from importlib import import_module

FIELDS={
 'evidence_retrieval':({'expected_ids','k'},{'retrieved_ids'}),
 'temporal_understanding':({'expected_sequence'},{'predicted_sequence'}),
 'visual_precision':({'expected'},{'predicted'}),
 'full_video_info':({'expected_fact_ids'},{'predicted_fact_ids'}),
 'agentic_live_analysis':(set(),{'events'}),
 'answer_formatting':({'option_count'},{'answer'}),
 'abstention':(set(),{'rows'}),
}

def score(cases,predictions):
    if len({c['id'] for c in cases})!=len(cases):raise ValueError('Duplicate case IDs')
    if len({p['id'] for p in predictions})!=len(predictions):raise ValueError('Duplicate prediction IDs')
    by_id={p['id']:p for p in predictions};rows=[]
    for case in cases:
        name=case['capability'];gold_fields,pred_fields=FIELDS[name]
        prediction=by_id.get(case['id'])
        if prediction is None:
            rows.append({'id':case['id'],'capability':name,'status':'missing_prediction'});continue
        gold=case.get('reference',{});actual=prediction['prediction']
        if set(gold)-gold_fields or set(actual)-pred_fields:raise ValueError('Unexpected fields or reference injection')
        module=import_module('.'+name,package=__package__)
        result=module.evaluate(**gold,**actual)
        rows.append({'id':case['id'],'capability':name,'result':result})
    return {'schema_version':1,'measurement':'annotated_capability_evaluation','rows':rows,
            'limitation':'Reference fact/event IDs must be independently mapped to grounded outputs; no self-scoring.'}
