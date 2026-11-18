"""Replay a frozen evidence-only prompt; never reads gold labels or scores itself."""
import argparse, hashlib, json, subprocess, sys, time
from pathlib import Path
D=Path(__file__).resolve().parent;B=D.parents[4];sys.path.insert(0,str(B))
from harness.common import Secrets
p=argparse.ArgumentParser();p.add_argument('--prompt',type=Path,required=True);p.add_argument('--model',required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--dry-run',action='store_true');a=p.parse_args()
prompt=a.prompt.read_text();receipt={'state':'submitted','model':a.model,'reasoning':'none','temperature':0,'promptSha256':hashlib.sha256(prompt.encode()).hexdigest(),'expectedAnswerSent':False,'newVisionCalls':0}
if a.dry_run:print(json.dumps({**receipt,'state':'dry-run'}));raise SystemExit(0)
# Exclusive creation fences retries even after process interruption or provider timeout.
with a.output.open('x') as f:json.dump(receipt,f)
s=Secrets(B/'benchmark.env');start=time.monotonic()
try:
 r=subprocess.run(['node','--import','tsx',str(D/'replay-answer.mjs')],cwd=B.parents[2]/'core',input=json.dumps({'model':a.model,'apiKey':s.get('VERCEL_GATEWAY_API_KEY'),'prompt':prompt}),text=True,capture_output=True,timeout=110)
 if r.returncode:raise RuntimeError('Incomplete API request')
 d=json.loads(r.stdout)
except Exception:
 raise SystemExit('Provider outcome may be unknown. Submitted receipt retained; no automatic retry.') from None
receipt.update(state='completed',latencySecs=round(time.monotonic()-start,2),**d);a.output.write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'state':'completed','output':str(a.output)}))
