"""Inspect request -> durable job -> completed result -> requery trace contract."""

def evaluate(events):
    pending={};completed=set();consumed=set();requests=0;unknown=0
    for e in events:
        kind=e.get('event');job=e.get('job_id')
        if kind=='inspection_submitted':
            requests+=1
            if not job:unknown+=1
            else:pending[job]=True
        elif kind=='inspection_completed' and job in pending:completed.add(job)
        elif kind=='evidence_requeried' and job in completed:consumed.add(job)
    if not requests:return {'status':'not_exercised','reason':'No live inspection attempted'}
    return {'status':'measured','submitted':requests,'completed':len(completed),'consumed':len(consumed),
            'unknown_submissions':unknown,'completion_rate':len(completed)/requests,
            'consumption_rate':len(consumed)/requests,
            'all_submitted_results_consumed':len(consumed)==requests and unknown==0}

if __name__ == '__main__':
    from .single import main
    main('agentic_live_analysis')
