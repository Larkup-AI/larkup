"""User-selected prospective model matrix; historical variants remain immutable."""
from __future__ import annotations
from copy import deepcopy

FRAME_MODELS=(
 ('qwen38-max-frames-v2','qwen38-max-gateway','qwen','alibaba/qwen3.8-max','2','6'),
 ('muse-spark13-frames-v2','muse-spark13-gateway','muse','meta/muse-spark-1.3','1.25','4.25'),
 ('minimax-m3-frames-v2','minimax-m3-gateway','minimax','minimax/minimax-m3','0.3','1.2'),
)
MANIFEST_ID='pilot-requested-models-v5'
REVISION='accuracy-first-requested-models-v5'


def requested_models_profile(base):
    doc=deepcopy(base)
    template=doc['variants']['qwen-frames']
    route_template=doc['routes']['qwen-gateway']
    for vid,rid,adapter,model,input_price,output_price in FRAME_MODELS:
        route=deepcopy(route_template)
        route.update(model=model,logicalModel=model.split('/')[-1],scopeId='gateway-'+model.replace('/','-'),inputPerMillion=input_price,outputPerMillion=output_price)
        doc['routes'][rid]=route
        variant=deepcopy(template)
        variant['inputProtocol']['optionFormat']='letter-labelled-v1'
        variant.update(adapter=adapter,logicalModel=route['logicalModel'],routes=[rid],maxOutputTokens=8192)
        doc['variants'][vid]=variant
    selected=['gemini-native-gateway-v1',*[m[0] for m in FRAME_MODELS],'twelvelabs-native','larkup-gateway-brain-v2','same-backbone-retrieval-gateway-brain-v2']
    doc['protocol'].update(revision=REVISION,manifestId=MANIFEST_ID,variantIds=selected,
                           modelSelection='User-requested prospective matrix, 2026-11-15. Gateway catalog confirms image inputs for Qwen Max, Muse Spark 1.3 and MiniMax M3; timestamped frame protocol is explicit. Gemini 3.8 Flash native and TwelveLabs Pegasus 1.5 native. Larkup roles and answer backbone unchanged.')
    return doc


def requested_models_manifest(original,profile):
    doc=deepcopy(original);doc['id']=MANIFEST_ID
    selected=profile['protocol']['variantIds']
    doc['protocol'].update(revision=REVISION,
        arms=[{'id':v,'adapter':profile['variants'][v]['adapter']} for v in selected],
        coreVariantIds=[v for v in selected if profile['variants'][v]['adapter']!='retrieval'],
        disclosure='Qwen 3.8 Max, Muse Spark 1.3 and MiniMax M3 through Gateway receive the same timestamped 128-frame protocol, official subtitles or separately declared canonical ASR; no native audio input. Gemini Gateway and TwelveLabs retain full native video/audio. Larkup and same-backbone retrieval profiles unchanged.',
        modelSelectionAmendment='New variants requested by the user before new answers. Same frozen development sources/questions and prospective continue/stop/inconclusive rule; prior results remain separate. No publication expansion.')
    return doc
