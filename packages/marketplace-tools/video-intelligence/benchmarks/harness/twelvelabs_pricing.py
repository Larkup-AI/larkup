"""User-supplied public list prices; free allowance never changes equivalent cost."""
from decimal import Decimal as D

PRICING_REVISION = 'user-supplied-2026-11-15'
RATES = {
    'storageGbMonth': '0.065', 'analyzeVideoHour': '1.75',
    'analyzeImageMillionTokens': '3', 'analyzeOutputMillionTokens': '7.50',
    'marengo35VideoMillionTokens': '0.26', 'marengo35AudioMillionTokens': '0.065',
    'marengo35ImageMillionTokens': '0.08', 'marengo35TextMillionTokens': '0.20',
    'marengo35DocumentMillionTokens': '0.162',
    'marengo30VideoHour': '2.50', 'marengo30AudioHour': '0.50',
    'marengo30ImageThousandRequests': '0.10', 'marengo30TextImageThousandRequests': '0.17',
    'marengo30TextThousandRequests': '0.07', 'searchThousandQueries': '4',
    'jockeyMillionTokens': '2',
}

def equivalent(**quantities):
    """Quantities use the rate's units. Only operations actually used belong here."""
    return str(sum((D(str(value)) * D(RATES[key]) for key,value in quantities.items()), D(0)))

def analyze_estimate(seconds, output_tokens):
    parts = {'analyzeVideoHour': D(str(seconds)) / D(3600)}
    if output_tokens is not None:
        parts['analyzeOutputMillionTokens'] = D(str(output_tokens)) / D(1_000_000)
    return equivalent(**parts)
