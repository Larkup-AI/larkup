"""Exact source-annotated attribute accuracy. No colour/identity inference in the evaluator."""
from .common import ratio

def evaluate(expected,predicted):
    if not expected:return {'status':'unavailable','reason':'No visual-attribute annotation'}
    correct=sum(predicted.get(k)==v for k,v in expected.items())
    return {'status':'measured','attribute_accuracy':correct/len(expected),'correct':correct,
            'reference_count':len(expected),'extra_attributes':len(set(predicted)-set(expected))}

if __name__ == '__main__':
    from .single import main
    main('visual_precision')
