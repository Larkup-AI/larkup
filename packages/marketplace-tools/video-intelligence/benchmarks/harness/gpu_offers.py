"""Non-reserving GPU quotes and explicit, expiring rental consent."""
import json,time
from .common import atomic, identifier, DomainError, utc

def choose(remote, offers, check, report):
    path=remote.deployment/'gpu-offers.json'
    document={'id':identifier('offers'),'createdAt':utc(),'expiresAt':time.time()+120,
              'state':'pending','offers':offers}
    atomic(path,document)
    while time.time()<document['expiresAt']:
        check()
        current=json.loads(path.read_text())
        if current.get('state')=='accepted':
            selected=current['offers'][current['selected']]
            report('starting_gpu',stage='Price accepted. Reserving '+selected['gpuTypeId']+' at up to USD '+str(selected['quotedHourlyUsd'])+'/hour; preparing startup automatically.')
            return selected
        if current.get('state')=='wait':return None
        report('waiting_capacity',stage='Choose a GPU and confirm its hourly price, or wait for a cheaper offer. Availability is confirmed only when RunPod accepts the reservation.')
        time.sleep(1)
    return None

def decide(remote, offer_id, selection):
    path=remote.deployment/'gpu-offers.json'
    if not path.exists():raise DomainError('GPU_OFFER_EXPIRED',status=409)
    document=json.loads(path.read_text())
    if document['id']==offer_id and ((document['state']=='wait' and selection=='wait') or (document['state']=='accepted' and str(document.get('selected'))==str(selection))):
        return {'id':document['id'],'action':'gpu-choice','state':'completed'}
    if document['id']!=offer_id or document['expiresAt']<=time.time() or document['state']!='pending':
        raise DomainError('GPU_OFFER_EXPIRED',status=409)
    if selection=='wait':document['state']='wait'
    else:
        try:index=int(selection)
        except (ValueError,TypeError):raise DomainError('GPU_SELECTION_INVALID',status=400)
        if not 0<=index<len(document['offers']):raise DomainError('GPU_SELECTION_INVALID',status=400)
        document.update(state='accepted',selected=index)
    atomic(path,document)
    return {'id':document['id'],'action':'gpu-choice','state':'completed'}
