"""Bounded local regression loop on source changes. Never edits code or gold."""
import argparse,json,subprocess,sys,time
from .runner import B,implementation

def main():
    p=argparse.ArgumentParser();p.add_argument('--mode',choices=['replay','integration','live'],default='integration')
    p.add_argument('--max-rounds',type=int,default=3);p.add_argument('--max-paid-calls',type=int,default=3)
    p.add_argument('--poll-seconds',type=float,default=2);p.add_argument('--timeout-seconds',type=float,default=600)
    args=p.parse_args()
    if min(args.max_rounds,args.poll_seconds,args.timeout_seconds)<=0 or args.max_paid_calls<0:p.error('Positive bounds required')
    deadline=time.monotonic()+args.timeout_seconds;last=None;rounds=0;paid=0
    while rounds<args.max_rounds and time.monotonic()<deadline:
        current=implementation()['source_tree_sha256']
        if current==last:time.sleep(args.poll_seconds);continue
        last=current;rounds+=1
        checks=subprocess.run([sys.executable,'-m','capability_tests.unit'],cwd=B)
        if checks.returncode:return checks.returncode
        command=[sys.executable,'-m','capability_tests.demo','--mode',args.mode,
                 '--max-paid-calls',str(args.max_paid_calls-paid)]
        result=subprocess.run(command,cwd=B)
        report=B/'data/capability-tests/demo/results/scores.json'
        if report.exists():paid+=json.loads(report.read_text()).get('paid_calls_this_run',0)
        print(json.dumps({'round':rounds,'paid_calls':paid,'returncode':result.returncode}),flush=True)
        if result.returncode:return result.returncode
        if args.mode=='live' and paid>=args.max_paid_calls:return 0
    return 0
if __name__=='__main__':raise SystemExit(main())
