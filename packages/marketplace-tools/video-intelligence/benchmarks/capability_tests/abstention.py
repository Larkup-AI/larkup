"""Report answerability and selective risk separately from overall accuracy."""
from .common import ratio

def evaluate(rows):
    scored=[r for r in rows if r.get('state')=='completed']
    answered=[r for r in scored if r.get('predicted') is not None]
    abstained=[r for r in scored if r.get('explicit_abstention') is True]
    return {'status':'measured' if scored else 'unavailable','completed':len(scored),
            'infrastructure_excluded':len(rows)-len(scored),
            'answer_coverage':ratio(len(answered),len(scored)),
            'selective_accuracy':ratio(sum(r['correct'] for r in answered),len(answered)),
            'invalid_output_count':sum(r.get('invalid_output') is True for r in scored),
            'unknown_no_choice_count':sum(r.get('predicted') is None and r.get('explicit_abstention') is not True and r.get('invalid_output') is not True for r in scored),
            'false_abstentions':sum(r.get('answerable') is True for r in abstained),
            'answerability_annotation_missing':sum(r.get('answerable') is None for r in scored)}

if __name__ == '__main__':
    from .single import main
    main('abstention')
