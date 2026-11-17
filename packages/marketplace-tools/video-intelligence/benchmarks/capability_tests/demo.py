"""A small runnable environment; media and existing indexes are never copied or rebuilt."""
import json,subprocess,sys
from pathlib import Path
from .runner import B

def main():
    selection=json.loads((Path(__file__).parent/'demo/selection.json').read_text())
    folder=B/'data/capability-tests/demo';manifest=folder/'manifest.json'
    if not manifest.exists():
        command=[sys.executable,'-m','capability_tests','prepare-demo','--run',selection['source_run'],
            '--variant-regex',selection['variant_regex'],'--out',str(manifest)]
        for case in selection['cases']:command+=['--case',case['category']+':'+case['question_id']]
        subprocess.run(command,cwd=B,check=True)
    command=[sys.executable,'-m','capability_tests','run','--manifest',str(manifest),
        '--out',str(folder/'results')]+sys.argv[1:]
    raise SystemExit(subprocess.call(command,cwd=B))
if __name__=='__main__':main()
