from __future__ import annotations
import math
from harness.scoring import parse_option

def choice_result(answer, expected, options):
    predicted = parse_option(answer, len(options))
    return {'correct': predicted == expected, 'predicted': predicted,
            'valid_format': predicted is not None, 'abstained': predicted is None}

def ratio(a,b): return a/b if b else None

def wilson(correct,total):
    if not total:return None
    z=1.96;p=correct/total;d=1+z*z/total
    mid=(p+z*z/(2*total))/d
    width=z*math.sqrt(p*(1-p)/total+z*z/(4*total*total))/d
    return [max(0,mid-width),min(1,mid+width)]
