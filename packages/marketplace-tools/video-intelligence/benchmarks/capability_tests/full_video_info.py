"""Coverage of annotated source facts, NOT proof of recovering every possible fact."""
from .common import ratio

def evaluate(expected_fact_ids,predicted_fact_ids):
    expected=set(expected_fact_ids);predicted=set(predicted_fact_ids)
    if not expected:return {'status':'unavailable','reason':'No independent source-fact inventory'}
    tp=len(expected&predicted);precision=ratio(tp,len(predicted));recall=tp/len(expected)
    return {'status':'measured','annotated_fact_recall':recall,'annotated_fact_precision':precision,
            'f1':2*precision*recall/(precision+recall) if precision is not None and precision+recall else 0,
            'missing_fact_ids':sorted(expected-predicted),'unmatched_fact_ids':sorted(predicted-expected),
            'limitation':'Unmatched facts require adjudication; they are not automatically hallucinations.'}

if __name__ == '__main__':
    from .single import main
    main('full_video_info')
