/**
 * Agent Runtime bundle generator (plan §8.1, §11.1).
 *
 * Produces the **second** deployable artifact in the product, alongside TASK
 * 01's Knowledge Server bundle: a portable container carrying one immutable
 * `AgentRelease` snapshot.
 *
 * The governing rule is §11.1 — *build once, target many*. There is no Cloud
 * Run generator and no VPS generator; there is one bundle, plus target-specific
 * deployment files that configure the same image. That is what makes ADR-007
 * portability real: the release that answered a question on a laptop is byte-
 * for-byte the release that answers it in production.
 *
 * What is deliberately **not** baked into the image:
 * - model API keys, knowledge-server retrieval keys, channel tokens — injected
 *   as environment variables by the deployment provider (plan §8.3);
 * - anything derived from the developer's machine — no local paths, no
 *   dashboard-only state (§1.3).
 */

import type { AgentRelease } from '@larkup/agent-contracts';
import type { GeneratedFile, GeneratedServer } from './generate-agent-server';
import { agentRuntimeServerSource } from './agent-runtime-server';

/** AI SDK versions the generated bundle pins. */
const AI_SDK = {
  ai: '^7.0.54',
  '@ai-sdk/openai': '^4.0.31',
  '@ai-sdk/anthropic': '^4.0.15',
  '@ai-sdk/google': '^4.0.35',
  '@ai-sdk/mistral': '^4.0.24',
} as const;

function lang(path: string): string {
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.mjs') || path.endsWith('.js')) return 'javascript';
  if (path.endsWith('.md')) return 'markdown';
  if (path.endsWith('Dockerfile')) return 'dockerfile';
  if (path.endsWith('.yml') || path.endsWith('.yaml')) return 'yaml';
  return 'text';
}

function envKeyFor(label: string): string {
  return `KS_KEY_${label.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

/**
 * Strip every credential out of the release before it is written into the image.
 *
 * The snapshot in the bundle is the behavioural contract — prompt, model, tools,
 * origins, channel *shape*. Secrets are replaced with an empty string and
 * supplied at run time, so a container image (which gets pushed to a registry
 * and pulled by anyone with access) never carries a usable key.
 */
function stripSecrets(release: AgentRelease): AgentRelease {
  const definition = release.definition;

  const channels: NonNullable<typeof definition.channels> = {};
  for (const [id, channel] of Object.entries(definition.channels ?? {})) {
    const settings: Record<string, string> = {};
    for (const [key, value] of Object.entries(channel.settings ?? {})) {
      settings[key] = /(token|secret|key|password|signature|credential)/i.test(key) ? '' : value;
    }
    channels[id] = { ...channel, settings };
  }

  return {
    ...release,
    definition: {
      ...definition,
      joinCode: definition.joinCode ? '' : undefined,
      knowledgeSources: (definition.knowledgeSources ?? []).map((source) => ({
        ...source,
        retrievalKey: '',
      })),
      ...(definition.channels ? { channels } : {}),
    },
  };
}

function dockerfile(): string {
  return `# Larkup Agent Runtime — portable OCI image (plan §11.1).
# One image, every target: Docker/VPS, Cloud Run, Container Apps, App Runner.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
# Bind to whatever the platform hands us; Cloud Run and App Runner set PORT.
ENV PORT=8080

COPY --from=deps /app/node_modules ./node_modules
COPY package.json server.mjs release.json ./
# Optional: present when the deployment serves its own widget.
COPY widget.js* ./

# Run unprivileged. The base image ships a \`node\` user for exactly this.
USER node

EXPOSE 8080

# Compose and Kubernetes read this; Cloud Run uses its own probe config.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \\
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
`;
}

function compose(projectName: string): string {
  return `# Docker Compose / VPS — the first supported target in plan §11.1.
services:
  agent:
    build: .
    image: ${projectName}:latest
    restart: unless-stopped
    ports:
      - "\${PORT:-8080}:8080"
    environment:
      # Never inline a secret here. Put it in .env, which is gitignored.
      OPENAI_API_KEY: \${OPENAI_API_KEY:-}
      ANTHROPIC_API_KEY: \${ANTHROPIC_API_KEY:-}
      GOOGLE_API_KEY: \${GOOGLE_API_KEY:-}
      MISTRAL_API_KEY: \${MISTRAL_API_KEY:-}
      AGENT_JOIN_CODE: \${AGENT_JOIN_CODE:-}
      LARKUP_EXEC_TARGET: docker
    env_file:
      - .env
    healthcheck:
      test:
        [
          "CMD",
          "node",
          "-e",
          "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
        ]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
`;
}

function cloudRun(projectName: string): string {
  return `# Google Cloud Run — target 2 in plan §11.1.
#
#   gcloud run deploy ${projectName} \\
#     --source . --region us-central1 --port 8080 \\
#     --set-secrets OPENAI_API_KEY=larkup-openai:latest
#
# The agent runtime is stateless: sessions are in memory and knowledge lives in
# the Knowledge Server, so scaling to zero is safe. A conversation started
# before a scale-down loses its history — bind sessions to the control plane
# before promising otherwise.
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: ${projectName}
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/minScale: '0'
        autoscaling.knative.dev/maxScale: '10'
    spec:
      containerConcurrency: 40
      timeoutSeconds: 300
      containers:
        - image: gcr.io/PROJECT_ID/${projectName}:latest
          ports:
            - containerPort: 8080
          env:
            - name: LARKUP_EXEC_TARGET
              value: cloud-run
          resources:
            limits:
              cpu: '1'
              memory: 1Gi
          startupProbe:
            httpGet:
              path: /readiness
              port: 8080
            failureThreshold: 10
            periodSeconds: 3
          livenessProbe:
            httpGet:
              path: /health
              port: 8080
            periodSeconds: 30
`;
}

function envExample(release: AgentRelease): string {
  const lines = [
    '# Larkup Agent Runtime — runtime configuration.',
    '# Every value here is a secret or an environment binding. Nothing in this',
    '# file is baked into the image; the release snapshot carries behaviour only.',
    '',
    "# --- Model credential (one, matching the release's provider) ---",
    `# This release uses: ${release.definition.chatProvider} / ${release.definition.chatModelId}`,
    'OPENAI_API_KEY=',
    '# ANTHROPIC_API_KEY=',
    '# GOOGLE_API_KEY=',
    '# MISTRAL_API_KEY=',
    '',
    '# --- Server ---',
    'PORT=8080',
    `LARKUP_EXEC_TARGET=docker`,
  ];

  const sources = release.definition.knowledgeSources ?? [];
  if (sources.length) {
    lines.push('', '# --- Knowledge Server retrieval keys (scoped: retrieval only) ---');
    for (const source of sources) {
      lines.push(`# ${source.label} → ${source.baseUrl}`);
      lines.push(`${envKeyFor(source.label)}=`);
    }
  }

  if (release.definition.authMode === 'join-code') {
    lines.push('', '# --- Access ---', 'AGENT_JOIN_CODE=');
  }

  const channels = Object.entries(release.definition.channels ?? {}).filter(([, c]) => c.enabled);
  if (channels.length) {
    lines.push('', '# --- Channel credentials ---');
    for (const [id, channel] of channels) {
      for (const key of Object.keys(channel.settings ?? {})) {
        if (!/(token|secret|key|password|signature|credential)/i.test(key)) continue;
        lines.push(`CHANNEL_${id.toUpperCase()}_${key.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}=`);
      }
    }
  }

  return lines.join('\n') + '\n';
}

function readme(release: AgentRelease, projectName: string): string {
  const agent = release.definition;
  const sources = agent.knowledgeSources ?? [];

  return `# ${agent.name} — Agent Runtime bundle

Generated by Larkup from release **v${release.version}** (\`${release.releaseId}\`).

This is a portable container carrying one immutable Agent Release. The same
image runs on Docker/VPS, Cloud Run, Azure Container Apps, and AWS App
Runner/ECS — only the environment bindings differ.

## What is inside

| File | Purpose |
| --- | --- |
| \`release.json\` | The immutable release snapshot: prompt, model, tools, origins. **Secrets stripped.** |
| \`server.mjs\` | The runtime. No Larkup packages required at run time. |
| \`Dockerfile\` | The portable image. |
| \`docker-compose.yml\` | Docker/VPS target. |
| \`service.cloudrun.yaml\` | Cloud Run target. |
| \`widget.js\` | The embeddable chat widget, served at \`/widget.js\` (when included). |

## Run it

\`\`\`bash
cp .env.example .env      # fill in the model key
docker compose up --build
curl localhost:8080/health
curl localhost:8080/readiness
\`\`\`

\`/readiness\` returns 503 until a model credential is present — that is the
check to wire into your load balancer, not \`/health\`.

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| GET | \`/health\` | Liveness. Never gated. |
| GET | \`/readiness\` | Can it actually answer? |
| GET | \`/agent\` | Redacted public config for the widget. |
| POST | \`/chat\` | Streaming answer (AI SDK UI Message Stream). |
| GET | \`/widget.js\` | The embeddable widget bundle. |
| POST | \`/channels/:id\` | Channel inbound, verified per adapter. |

## Embedding

\`\`\`html
<script async src="https://your-deployment/widget.js" data-agent="${agent.id}"></script>
\`\`\`

Allowed origins for this release: ${
    agent.allowedOrigins?.length
      ? agent.allowedOrigins.map((o) => `\`${o}\``).join(', ')
      : '**none — every embed will be rejected**'
  }

${
  agent.allowedOrigins?.includes('*')
    ? '> **Warning:** `*` lets any website on the internet use this agent and spend your model budget. Narrow it before launch.\n'
    : ''
}
## Secrets

Nothing secret is in this bundle. Supply at run time:

${
  sources.length
    ? sources
        .map((s) => `- \`${envKeyFor(s.label)}\` — retrieval key for **${s.label}** (${s.baseUrl})`)
        .join('\n')
    : '- _No knowledge sources configured._'
}

## Rollback

A release is immutable. To roll back, generate the bundle for the previous
release and deploy that image — there is no in-place mutation to undo.

## Observability

The runtime writes one JSON object per event to stdout, with correlation ids
(\`agentId\`, \`releaseId\`, \`runId\`, \`sessionId\`, \`channelId\`). Credentials are
scrubbed before an event is written. Collect stdout with your platform's log
agent, or point an OTLP collector at it.

\`\`\`bash
docker compose logs -f agent | jq 'select(.name == "run.completed")'
\`\`\`

---
Project: \`${projectName}\` · Runtime: Larkup Agent Runtime · Release: \`${release.releaseId}\`
`;
}

export interface AgentRuntimeBundleOptions {
  /** The embeddable widget bundle, served at `/widget.js` when supplied. */
  widgetBundle?: string;
}

/**
 * Generate the deployable Agent Runtime bundle for a release.
 *
 * Pure: takes a release, returns files. Nothing touches the filesystem, so the
 * same function backs the dashboard preview, the download, and the CLI.
 */
export function generateAgentRuntime(
  release: AgentRelease,
  options: AgentRuntimeBundleOptions = {},
): GeneratedServer {
  const agent = release.definition;
  const projectName = agent.id.replace(/[^a-z0-9-]/gi, '-').toLowerCase() || 'larkup-agent';

  const dependencies: Record<string, string> = {
    ai: AI_SDK.ai,
    '@ai-sdk/openai': AI_SDK['@ai-sdk/openai'],
    '@ai-sdk/anthropic': AI_SDK['@ai-sdk/anthropic'],
    '@ai-sdk/google': AI_SDK['@ai-sdk/google'],
    '@ai-sdk/mistral': AI_SDK['@ai-sdk/mistral'],
  };

  const packageJson = {
    name: projectName,
    version: release.version,
    private: true,
    type: 'module',
    engines: { node: '>=20' },
    scripts: { start: 'node server.mjs' },
    dependencies,
  };

  const files: Array<Pick<GeneratedFile, 'path' | 'contents'>> = [
    { path: 'package.json', contents: JSON.stringify(packageJson, null, 2) + '\n' },
    // The portable artifact itself. Everything else is scaffolding around it.
    { path: 'release.json', contents: JSON.stringify(stripSecrets(release), null, 2) + '\n' },
    { path: 'server.mjs', contents: agentRuntimeServerSource() },
    { path: 'Dockerfile', contents: dockerfile() },
    { path: '.dockerignore', contents: 'node_modules\n.env\n.git\n*.log\n' },
    { path: 'docker-compose.yml', contents: compose(projectName) },
    { path: 'service.cloudrun.yaml', contents: cloudRun(projectName) },
    { path: '.env.example', contents: envExample(release) },
    { path: '.gitignore', contents: 'node_modules\n.env\n.DS_Store\n' },
    { path: 'README.md', contents: readme(release, projectName) },
  ];

  if (options.widgetBundle) {
    files.push({ path: 'widget.js', contents: options.widgetBundle });
  }

  const envVars = [
    {
      key: `${agent.chatProvider.toUpperCase().replace(/-/g, '_')}_API_KEY`,
      required: true,
      help: `Model credential for ${agent.chatProvider}/${agent.chatModelId}.`,
    },
    { key: 'PORT', required: false, help: 'Listen port. Cloud Run and App Runner set this.' },
    {
      key: 'LARKUP_EXEC_TARGET',
      required: false,
      help: 'Execution profile: docker, cloud-run, worker. Caps tool trust level.',
    },
    ...(agent.knowledgeSources ?? []).map((source) => ({
      key: envKeyFor(source.label),
      required: true,
      help: `Retrieval-scoped key for the "${source.label}" Knowledge Server.`,
    })),
    ...(agent.authMode === 'join-code'
      ? [{ key: 'AGENT_JOIN_CODE', required: true, help: 'Join code visitors must present.' }]
      : []),
  ];

  return {
    projectName,
    files: files.map((f) => ({ ...f, language: lang(f.path) })),
    dependencies,
    envVars,
  };
}
