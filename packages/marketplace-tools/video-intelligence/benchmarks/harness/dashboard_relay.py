"""Authenticated PC BFF bridge, operator controls and readonly saved-result fallback."""
from __future__ import annotations
import hmac
import json
import os
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs
from .main import BENCHMARK
from .common import DomainError, canonical, identifier


def offline(path):
    from .store import Store
    from .config import Config
    from .api import Controller
    database = BENCHMARK / 'data/state/remote-backup.sqlite3'
    if not database.exists():raise DomainError('NO_OFFLINE_SNAPSHOT', status=503)
    store = Store(database, readonly=True)
    try:
        saved = store.rows("SELECT value FROM settings WHERE key='active_config'")
        config = Config(json.loads(saved[0]['value']) if saved else json.loads((BENCHMARK / 'data/configs/active.json').read_text()), BENCHMARK / 'benchmark.env')
        parsed = urlsplit(path)
        result = Controller(store, config, BENCHMARK / 'data', '', readonly=True).get(parsed.path[len('/api/v1'):], parse_qs(parsed.query))
        if parsed.path.endswith('/health'):
            from datetime import datetime, timezone
            result.update(mode='offline', lastSyncedAt=datetime.fromtimestamp(database.stat().st_mtime, timezone.utc).isoformat())
        return result
    finally:store.close()


def handler(operator,token):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def respond(self,status,value,*,content_type=None,extra=None):
            payload=value if isinstance(value,bytes) else canonical(operator.remote.private.clean(value)).encode()
            self.send_response(status)
            self.send_header('Content-Type',content_type or ('text/csv' if isinstance(value,bytes) else 'application/json'))
            self.send_header('Content-Length',str(len(payload)));self.send_header('Cache-Control','no-store')
            if urlsplit(self.path).path.endswith('.json') and not any(k.lower()=='content-disposition' for k in (extra or {})):
                self.send_header('Content-Disposition','attachment; filename="'+urlsplit(self.path).path.rsplit('/',1)[-1]+'"')
            for k,v in (extra or {}).items():self.send_header(k,v)
            self.end_headers();self.wfile.write(payload)
        def proxy(self):
            try:
                if self.headers.get('Host','').split(':')[0] not in {'127.0.0.1','localhost'}:raise DomainError('ORIGIN_REJECTED',status=403)
                if not hmac.compare_digest(self.headers.get('Authorization',''),'Bearer '+token):raise DomainError('UNAUTHORIZED',status=401)
                parsed=urlsplit(self.path)
                if not parsed.path.startswith('/api/v1/'):raise DomainError('NOT_FOUND',status=404)
                path=parsed.path[len('/api/v1'):];query=parse_qs(parsed.query)
                size=int(self.headers.get('Content-Length',0))
                if size<0 or size>1024*1024:raise DomainError('MALFORMED_INPUT',status=400)
                body=self.rfile.read(size) if self.command=='POST' else None
                if self.command=='POST':
                    if self.headers.get('Origin') not in {'http://127.0.0.1:3100','http://localhost:3100'}:raise DomainError('ORIGIN_REJECTED',status=403)
                    if operator.readonly:raise DomainError('OFFLINE_READONLY',status=409)
                    if self.headers.get('Content-Type','').split(';')[0]!='application/json':raise DomainError('CONTENT_TYPE_INVALID',status=400)
                    if not self.headers.get('Idempotency-Key'):raise DomainError('IDEMPOTENCY_KEY_REQUIRED',status=400)
                if path=='/system' and self.command=='GET':return self.respond(200,operator.status())
                if path=='/logs' and self.command=='GET':return self.respond(200,operator.log_page(query))
                if path.startswith('/system/') and self.command=='POST':
                    result=operator.submit(path.rsplit('/',1)[-1],json.loads(body or b'{}'),self.headers.get('Idempotency-Key',''))
                    return self.respond(202,result)
                if operator.readonly and self.command=='GET':return self.respond(200,offline(self.path),extra={'X-Benchmark-Availability':'offline'})
                headers={k:v for k,v in self.headers.items() if k.lower() in {'authorization','content-type','idempotency-key','if-match'}}
                if self.command=='POST':headers['Origin']='http://127.0.0.1:3100'
                request=urllib.request.Request('http://127.0.0.1:28890'+self.path,headers=headers,data=body,method=self.command)
                from contextlib import nullcontext
                from .operations import control_lock,intent
                with (control_lock(operator.remote.deployment) if self.command=='POST' else nullcontext()):
                    if self.command=='POST' and intent(operator.remote.deployment)['mode'] in {'starting','stopping','stopped'}:
                        raise DomainError('SUPERVISOR_TRANSITION_USE_OPERATOR_CONTROLS',status=409)
                    try:response=urllib.request.urlopen(request,timeout=10)
                    except urllib.error.HTTPError as error:response=error
                    except OSError:
                        if self.command!='GET':raise DomainError('OFFLINE_READONLY',status=409)
                        return self.respond(200,offline(self.path),extra={'X-Benchmark-Availability':'offline'})
                    with response:
                        self.respond(response.status,response.read(),content_type=response.headers.get('Content-Type','application/json'),
                                     extra={k:v for k,v in response.headers.items() if k.lower() in {'content-disposition','etag'}})
            except DomainError as error:self.respond(error.status,{'error':{**error.issue(),'requestId':identifier('req')}})
            except (ValueError,TypeError):self.respond(400,{'error':{**DomainError('MALFORMED_INPUT').issue(),'requestId':identifier('req')}})
            except Exception:self.respond(503,{'error':{**DomainError('OPERATOR_UNAVAILABLE').issue(),'requestId':identifier('req')}})
        do_GET=do_POST=proxy
    return Handler


def main():
    from .operations import Operator
    from .remote import Remote
    token=json.loads((BENCHMARK/'data/deployment/relay.json').read_text())['controllerToken']
    operator=Operator(Remote(),readonly=os.environ.get('BENCHMARK_VIEW_ONLY')=='1')
    ThreadingHTTPServer(('127.0.0.1',28891),handler(operator,token)).serve_forever()


if __name__=='__main__':main()
