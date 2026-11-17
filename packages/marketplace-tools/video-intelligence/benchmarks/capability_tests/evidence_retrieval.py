"""Recall@k and reciprocal rank against independently annotated evidence IDs."""
from .common import ratio

def evaluate(expected_ids, retrieved_ids, k=10):
    expected=set(expected_ids);ranked=list(dict.fromkeys(retrieved_ids))[:k]
    if not expected:return {'status':'unavailable','reason':'No independent evidence relevance annotation'}
    matches=expected.intersection(ranked)
    return {'status':'measured','recall_at_k':len(matches)/len(expected),
            'precision_at_k':ratio(len(matches),len(ranked)),
            'reciprocal_rank':next((1/(i+1) for i,x in enumerate(ranked) if x in expected),0),
            'k':k,'reference_count':len(expected)}

if __name__ == '__main__':
    from .single import main
    main('evidence_retrieval')
