from __future__ import annotations

import copy
import time
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .common import DomainError, Secrets, canonical, digest, identifier

PROVIDERS = {'gemini', 'gemini_openai', 'qwen', 'twelvelabs', 'gateway', 'deepseek', 'deepinfra', 'runtime'}


def check_binding(provider: str, alias: str):
    provider = {'google': 'gemini', 'gemini_openai': 'gemini', 'vercel_ai_gateway': 'gateway'}.get(provider, provider)
    if alias in {'RUNPOD_APIKEY', 'HUGGINGFACE_APIKEY', 'BENCHMARK_CONTROLLER_TOKEN'}:
        raise DomainError('SECRET_SCOPE_MISMATCH')
    patterns = [(r'GEMINI_APIKEY\d+', 'gemini'), (r'DEEPGRAM_APIKEY\d+', 'deepgram'),
                (r'TWELEVE_LABS_KEY\d+', 'twelvelabs'), (r'QWEN_APIKEY', 'qwen'),
                (r'VERCEL_GATEWAY_API_KEY', 'gateway'), (r'DEEPSEEK_APIKEY', 'deepseek'),
                (r'DEEPINFRA_APIKEY', 'deepinfra'),
                (r'BENCHMARK_RUNTIME_TOKEN', 'runtime')]
    for pattern, intended in patterns:
        if re.fullmatch(pattern, alias) and provider != intended:
            raise DomainError('SECRET_SCOPE_MISMATCH')
ENDPOINTS = {
    'gemini': {'https://generativelanguage.googleapis.com/v1beta'},
    'gemini_openai': {'https://generativelanguage.googleapis.com/v1beta/openai'},
    'qwen': {'https://dashscope.aliyuncs.com/compatible-mode/v1',
             'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
             'https://dashscope-us.aliyuncs.com/compatible-mode/v1'},
    'gateway': {'https://ai-gateway.vercel.sh/v1', 'https://ai-gateway.vercel.sh/v4/ai'},
    'deepseek': {'https://api.deepseek.com/v1'},
    'deepinfra': {'https://api.deepinfra.com/v1/openai'},
    'twelvelabs': {'https://api.twelvelabs.io/v1.3'},
    'runtime': {'http://127.0.0.1:8787'},
}


@dataclass(frozen=True)
class Snapshot:
    revision: str
    document: str
    secrets: Secrets

    @property
    def config(self) -> dict:
        return __import__('json').loads(self.document)


class Config:
    def __init__(self, document: dict, secret_path: Path):
        self.secret_path = secret_path
        self.candidates: dict[str, tuple[float, str, Snapshot]] = {}
        self.active = self._snapshot(document, Secrets(secret_path))

    def _snapshot(self, doc: dict, secret_values: Secrets) -> Snapshot:
        doc = copy.deepcopy(doc)
        if secret_values.clean(doc) != doc:
            raise DomainError('CONFIG_MUST_USE_SECRET_ALIASES')
        if set(doc) - {'routes', 'variants', 'limits', 'runtime', 'protocol'}:
            raise DomainError('CONFIG_INVALID')
        if not doc.get('routes') or not doc.get('variants'):
            raise DomainError('CONFIG_INVALID')
        for rid, route in doc['routes'].items():
            if set(route) - {'provider', 'model', 'logicalModel', 'endpoint', 'secretAlias',
                             'scopeId', 'tier', 'verifiedEquivalent', 'capabilities',
                             'concurrency', 'rpm', 'tokensPerMinute', 'secondsPerDay',
                             'balance', 'inputPerMillion', 'outputPerMillion', 'enabled'}:
                raise DomainError('CONFIG_INVALID')
            provider = route.get('provider')
            if provider not in PROVIDERS or route.get('endpoint') not in ENDPOINTS[provider]:
                raise DomainError('CONFIG_INVALID')
            for field in ('model', 'logicalModel', 'scopeId', 'secretAlias', 'tier'):
                if not isinstance(route.get(field), str) or not route[field]:
                    raise DomainError('CONFIG_INVALID')
            secret_values.get(route['secretAlias'])
            check_binding(provider, route['secretAlias'])
            if not 1 <= route.get('concurrency', 1) <= 16 or not 1 <= route.get('rpm', 1) <= 10000:
                raise DomainError('CONFIG_INVALID')
            for field in ('balance', 'inputPerMillion', 'outputPerMillion'):
                if route.get(field) is not None:
                    from decimal import Decimal, InvalidOperation
                    try:
                        number = Decimal(str(route[field]))
                        if not number.is_finite() or number < 0:
                            raise ValueError()
                    except (InvalidOperation, ValueError):
                        raise DomainError('CONFIG_INVALID') from None
        for vid, variant in doc['variants'].items():
            if set(variant) - {'adapter', 'logicalModel', 'routes', 'roles', 'inputProtocol',
                               'maxSteps', 'maxOutputTokens', 'temperature', 'extraction',
                               'canonicalRevision', 'ablationOf'}:
                raise DomainError('CONFIG_INVALID')
            if variant.get('adapter') not in {'gemini', 'qwen', 'twelvelabs', 'larkup', 'retrieval', 'muse', 'minimax'}:
                raise DomainError('CONFIG_INVALID')
            if not variant.get('routes') or not 1 <= variant.get('maxSteps', 4) <= 12:
                raise DomainError('CONFIG_INVALID')
            for rid in variant['routes']:
                route = doc['routes'].get(rid)
                if not route or route['logicalModel'] != variant.get('logicalModel'):
                    raise DomainError('MODEL_VARIANT_MISMATCH')
                if rid != variant['routes'][0] and not route.get('verifiedEquivalent'):
                    raise DomainError('ROUTE_EQUIVALENCE_UNVERIFIED')
            for role in variant.get('roles', {}).values():
                if set(role) != {'provider', 'model', 'secretAlias'}:
                    raise DomainError('CONFIG_INVALID')
                secret_values.get(role['secretAlias'])
                check_binding(role['provider'], role['secretAlias'])
            protocol=variant.get('inputProtocol',{})
            for name,modalities in protocol.get('roleInputModalities',{}).items():
                if name not in variant.get('roles',{}) or not isinstance(modalities,list) or not modalities or set(modalities)-{'text','image'}:
                    raise DomainError('CONFIG_INVALID')
            for name,fallbacks in protocol.get('roleFallbacks',{}).items():
                if name not in variant.get('roles',{}) or not isinstance(fallbacks,list) or len(fallbacks)>8:
                    raise DomainError('CONFIG_INVALID')
                for fallback in fallbacks:
                    if set(fallback)!={'provider','model','secretAlias','verifiedEquivalent'} or fallback['verifiedEquivalent'] is not True:
                        raise DomainError('ROUTE_EQUIVALENCE_UNVERIFIED')
                    secret_values.get(fallback['secretAlias']);check_binding(fallback['provider'],fallback['secretAlias'])
        limits = doc.setdefault('limits', {})
        for key, default, maximum in [('global', 4, 32), ('gpu', 1, 1), ('cpu', 2, 8),
                                       ('upload', 2, 8), ('qa', 3, 16), ('judge', 1, 4),
                                       ('attempts', 3, 5), ('deadlineSeconds', 3600, 14400)]:
            value = limits.setdefault(key, default)
            if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= maximum:
                raise DomainError('CONFIG_INVALID')
        serialized = canonical(doc)
        return Snapshot('config-' + digest(doc)[:20], serialized, secret_values)

    def validate(self, doc: dict, base: str) -> dict:
        if base != self.active.revision:
            raise DomainError('REVISION_CONFLICT', status=409)
        candidate = self._snapshot(doc, Secrets(self.secret_path))
        cid = identifier('candidate')
        self.candidates[cid] = (time.time() + 600, base, candidate)
        changed = [key for key in doc if doc[key] != self.active.config.get(key)]
        return dict(candidateId=cid, baseRevision=base, requiresDrain='runtime' in changed,
                    issues=[], diff={'changedFields': changed, 'newRevision': candidate.revision})

    def activate(self, candidate: str, base: str, inflight: int = 0) -> Snapshot:
        item = self.candidates.get(candidate)
        if not item or item[0] < time.time() or item[1] != base or base != self.active.revision:
            raise DomainError('REVISION_CONFLICT', status=409)
        new = item[2]
        if new.config.get('runtime') != self.active.config.get('runtime'):
            # Changing a cached runtime setting requires an explicit process restart.
            raise DomainError('RUNTIME_DRAIN_RESTART_REQUIRED', status=409)
        old_variants = self.active.config['variants']
        for rid, route in new.config['routes'].items():
            old = self.active.config['routes'].get(rid)
            if old and any(old.get(k) != route.get(k) for k in ('model', 'logicalModel', 'provider', 'capabilities')):
                raise DomainError('NEW_ROUTE_AND_VARIANT_REQUIRED', status=409)
        for vid, variant in new.config['variants'].items():
            if vid in old_variants and variant != old_variants[vid]:
                raise DomainError('NEW_VARIANT_REQUIRED', status=409)
        self.active = new
        self.candidates.pop(candidate)
        return new

    def public(self) -> dict:
        profiles = []
        for vid, variant in self.active.config['variants'].items():
            rid = variant['routes'][0]
            route = self.active.config['routes'][rid]
            roles = {'answer': dict(logicalModel=variant['logicalModel'], resolvedModel=route['model'], routeId=rid)}
            for role, spec in variant.get('roles', {}).items():
                roles['index_vision' if role == 'vision' else role] = dict(logicalModel=spec['model'], resolvedModel=spec['model'], routeId='job-scoped')
            profiles.append(dict(revision=vid, active=True, routingPolicy='predeclared-exact-model-only', roles=roles))
        return dict(revision=self.active.revision, profiles=profiles, config=self.active.secrets.clean(self.active.config))
