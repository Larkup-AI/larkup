"""Run any one capability as a standalone JSON-to-JSON evaluation."""
import argparse,json
from pathlib import Path
from harness.common import atomic,canonical
from .score_annotations import score

def main(capability):
    p=argparse.ArgumentParser(description=capability)
    p.add_argument('--reference',required=True);p.add_argument('--prediction',required=True);p.add_argument('--out',required=True)
    args=p.parse_args()
    cases=[{'id':'case','capability':capability,'reference':json.loads(Path(args.reference).read_text())}]
    predictions=[{'id':'case','prediction':json.loads(Path(args.prediction).read_text())}]
    result=score(cases,predictions);atomic(Path(args.out),result);print(canonical(result))
