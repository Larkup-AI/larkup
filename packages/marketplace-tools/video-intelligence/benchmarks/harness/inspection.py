"""Read-only, paginated inspection of benchmark state; never accepts SQL or paths."""
from __future__ import annotations
import json
from pathlib import Path
from .common import DomainError, canonical, utc

TABLES = ('runs','sources','questions','variants','tasks','attempts','provider_scopes','usage_events',
          'usage_receipts','usage_reconciliations','artifacts','remote_handles','events','audits',
          'evaluations','config_revisions','settings','controls','schema_migrations')
LOGS = {'controller':'controller.log','runtime':'runtime.log','bootstrap':'bootstrap.log',
        'relay':'relay.log','dashboard':'dashboard.log','tunnel':'tunnel.log','operator':'operator.log'}


def sanitize(value, secrets):
    if isinstance(value, str):
        try:
            if value[:1] in {'{','['}:
                return sanitize(json.loads(value), secrets)
        except ValueError:
            pass
        return secrets.clean(value)
    if isinstance(value, list):
        return [sanitize(x, secrets) for x in value]
    if isinstance(value, dict):
        hidden = {'apikey','authorization','token','secret','password','cookie','relaycapability','controllertoken',
                  'privatekey','headers','gold','goldevidence','correctoption'}
        return {k:sanitize(v,secrets) for k,v in value.items() if ''.join(c for c in k.lower() if c.isalnum()) not in hidden}
    return value


def tables(store):
    existing = {x['name'] for x in store.rows("SELECT name FROM sqlite_master WHERE type='table'")}
    return [{'name':name,'rowCount':store.one('SELECT count(*) n FROM "'+name+'"')['n'],
             'columns':[c['name'] for c in store.rows('PRAGMA table_info("'+name+'")') if c['name'] != 'gold']}
            for name in TABLES if name in existing]


def database(store, secrets, table, query, *, export=False):
    metadata = next((x for x in tables(store) if x['name']==table), None)
    if metadata is None:
        raise DomainError('TABLE_NOT_AVAILABLE',status=404)
    try:
        limit = 100000 if export else min(200,max(1,int(query.get('limit',['50'])[0])))
        offset = 0 if export else max(0,int(query.get('cursor',['0'])[0]))
    except (TypeError,ValueError):
        raise DomainError('MALFORMED_INPUT',status=400) from None
    run = query.get('runId',[None])[0]
    where, args = '', []
    if run:
        if 'run_id' in metadata['columns']:
            where, args = ' WHERE run_id=?',[run]
        elif table=='runs':
            where,args=' WHERE id=?',[run]
        elif table in {'attempts','artifacts'}:
            where,args=' WHERE task_id IN (SELECT id FROM tasks WHERE run_id=?)',[run]
        elif table in {'remote_handles','evaluations'}:
            where,args=' WHERE attempt_id IN (SELECT a.id FROM attempts a JOIN tasks t ON t.id=a.task_id WHERE t.run_id=?)',[run]
    columns = ','.join('"'+c+'"' for c in metadata['columns'])
    rows = store.rows('SELECT '+columns+' FROM "'+table+'"'+where+' ORDER BY rowid LIMIT ? OFFSET ?',tuple(args+[limit+1,offset]))
    if export and len(rows)>limit:
        raise DomainError('EXPORT_TOO_LARGE_USE_PAGINATION',status=413)
    return dict(table=table,columns=metadata['columns'],items=sanitize(rows[:limit],secrets),
                nextCursor=str(offset+limit) if len(rows)>limit else None,hasMore=len(rows)>limit,
                readonly=True,redactions=['credentials','gold labels','signed URL parameters'],exportedAt=utc())


def logs(root: Path, secrets, service, query, *, log_directory=None):
    if service not in LOGS:
        raise DomainError('LOG_NOT_AVAILABLE',status=404)
    path = (log_directory or root/'deployment')/LOGS[service]
    try:
        cursor=max(0,int(query.get('cursor',['0'])[0]));limit=min(200,max(1,int(query.get('limit',['100'])[0])))
    except (TypeError,ValueError):
        raise DomainError('MALFORMED_INPUT',status=400) from None
    if not path.exists():
        return dict(service=service,lines=[],nextCursor='0',hasMore=False,reset=False,available=False)
    size=path.stat().st_size;reset=cursor>size
    if reset:cursor=0
    if query.get('follow')==['1'] and 'cursor' not in query:cursor=max(0,size-65536)
    lines=[]
    with path.open('rb') as source:
        source.seek(cursor)
        for _ in range(limit):
            start=source.tell();raw=source.readline(65536)
            if not raw:break
            text=secrets.clean(raw.decode('utf-8',errors='replace').rstrip('\r\n'))
            import re
            text=re.sub(r'(?i)bearer\s+[A-Za-z0-9._+/=-]+','Bearer [redacted]',text)
            lines.append({'id':str(start),'text':text})
        end=source.tell()
    return dict(service=service,lines=lines,nextCursor=str(end),hasMore=end<size,reset=reset,available=True)
