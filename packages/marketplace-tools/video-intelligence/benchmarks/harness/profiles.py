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


def funded_deepseek_matrix(base, *, gemini_aliases=()):
    """Fresh, question-blind cells with a text-only brain and declared exact-model funding routes."""
    doc=deepcopy(base);template=deepcopy(next(v for v in doc['variants'].values() if v['adapter']=='larkup'))
    answer_routes=[]
    for alias in dict.fromkeys(gemini_aliases):
        rid='gemini-openai-'+alias.lower()
        route=deepcopy(doc['routes'][template['routes'][0]])
        route.update(provider='gemini_openai',model='gemini-3.8-flash',logicalModel='gemini-3.8-flash',
                     endpoint='https://generativelanguage.googleapis.com/v1beta/openai',secretAlias=alias,
                     scopeId='gemini-answer-'+alias.lower(),verifiedEquivalent=True)
        doc['routes'][rid]=route;answer_routes.append(rid)
    if not answer_routes:raise ValueError('At least one funded Gemini answer account is required')
    gateway_answer=deepcopy(doc['routes']['gemini-gateway']);gateway_answer['verifiedEquivalent']=True
    doc['routes']['gemini-gateway']=gateway_answer
    readers=(('gemini','vercel_ai_gateway','google/gemini-3.8-flash','VERCEL_GATEWAY_API_KEY'),
             ('qwen','vercel_ai_gateway','alibaba/qwen3.8-max','VERCEL_GATEWAY_API_KEY'),
             ('muse','vercel_ai_gateway','meta/muse-spark-1.3','VERCEL_GATEWAY_API_KEY'),
             ('minimax','vercel_ai_gateway','minimax/minimax-m3','VERCEL_GATEWAY_API_KEY'),
             ('deepseekvision','deepinfra','deepseek-ai/DeepSeek-V4.1-Flash-1017','DEEPINFRA_APIKEY'))
    fallbacks={'gemini':[dict(provider='gemini_openai',model='gemini-3.8-flash',secretAlias=a,verifiedEquivalent=True) for a in gemini_aliases],
               'qwen':[dict(provider='deepinfra',model='Qwen/Qwen3.8-Max',secretAlias='DEEPINFRA_APIKEY',verifiedEquivalent=True)],
               'minimax':[dict(provider='deepinfra',model='MiniMaxAI/MiniMax-M3',secretAlias='DEEPINFRA_APIKEY',verifiedEquivalent=True)]}
    cells=[]
    for key,provider,model,alias in readers:
        vid='larkup-v7-vb-'+key+'-deepseek';variant=deepcopy(template)
        variant['roles']['brain']=dict(provider='deepinfra',model='deepseek-ai/DeepSeek-V4-Pro',secretAlias='DEEPINFRA_APIKEY')
        variant['roles']['vision']=dict(provider=provider,model=model,secretAlias=alias)
        variant['routes']=['gemini-gateway']+answer_routes
        variant['maxOutputTokens']=8192
        variant['extraction']={**variant['extraction'],'mode':'balanced'}
        variant['inputProtocol']={**variant['inputProtocol'],
            'roleInputModalities':{'brain':['text'],'vision':['text','image']},
            'roleFallbacks':{'vision':fallbacks.get(key,[])},
            'planningPolicy':'Text-only reasoning over timestamped scout/OCR/transcript signals; raw images remain with the vision role.',
            'indexingPolicy':'Same question-blind comprehensive evidence brief for every source and reader; no gold labels or question-specific index hints.'}
        doc['variants'][vid]=variant;cells.append(vid)
    doc['protocol']={**doc['protocol'],'variantIds':cells,'revision':'larkup-funded-deepseek-v7',
                     'stopOnInfrastructureFailure':True,
                     'larkupMatrix':{'brains':[dict(key='deepseek',provider='deepinfra',model='deepseek-ai/DeepSeek-V4-Pro')],
                                    'visionModels':[dict(key=k,provider=p,model=m) for k,p,m,_ in readers],
                                    'cells':cells,'note':'Fixed Gemini 3.8 Flash answer backbone via supplied Gemini accounts; Gateway readers first, predeclared exact-model credit fallback only.'},
                     'fundingPlan':{'gatewayUsd':10,'deepinfraUsd':10,'automaticTopup':False,
                                    'nativeDeepSeekBaseline':'Unavailable in the existing provider run; report this vision cell as exploratory, without an uplift claim.'}}
    return doc
