"""Order agreement for independently identified event instances; mentions are distinct events."""
from .common import ratio

def evaluate(expected_sequence,predicted_sequence):
    if not expected_sequence:return {'status':'unavailable','reason':'No event-order annotation'}
    if len(set(expected_sequence))!=len(expected_sequence):raise ValueError('Use unique event-instance IDs')
    if len(set(predicted_sequence))!=len(predicted_sequence):return {'status':'invalid','reason':'Duplicate predicted event IDs'}
    pos={x:i for i,x in enumerate(predicted_sequence)}
    pairs=[(a,b) for i,a in enumerate(expected_sequence) for b in expected_sequence[i+1:]]
    correct=sum(a in pos and b in pos and pos[a]<pos[b] for a,b in pairs)
    return {'status':'measured','exact_sequence':expected_sequence==predicted_sequence,
            'pairwise_order_accuracy':ratio(correct,len(pairs)),
            'event_recall':len(set(expected_sequence)&set(predicted_sequence))/len(expected_sequence),
            'extra_events':len(set(predicted_sequence)-set(expected_sequence))}

if __name__ == '__main__':
    from .single import main
    main('temporal_understanding')
