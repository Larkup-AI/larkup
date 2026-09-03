import type { RagConfig } from '../types';

export const AI_SDK_VERSION = '^7.0.54';

export const AI_SDK_PROVIDER_VERSIONS: Record<string, string> = {
  '@ai-sdk/cohere': '^4.0.22',
  '@ai-sdk/deepseek': '^3.0.23',
  '@ai-sdk/gateway': '^4.0.42',
  '@ai-sdk/google': '^4.0.35',
  '@ai-sdk/mistral': '^4.0.24',
  '@ai-sdk/openai': '^4.0.31',
  '@ai-sdk/openai-compatible': '^3.0.24',
};

function providerSource(provider: string, customBaseUrl = '') {
  switch (provider) {
    case 'google':
      return `import { createGoogleGenerativeAI } from "@ai-sdk/google";
const provider = createGoogleGenerativeAI({ apiKey: CHAT_API_KEY });
function createConfiguredModel(modelId) {
  return provider(modelNameFor(modelId));
}`;
    case 'cohere':
      return `import { createCohere } from "@ai-sdk/cohere";
const provider = createCohere({ apiKey: CHAT_API_KEY });
function createConfiguredModel(modelId) {
  return provider(modelNameFor(modelId));
}`;
    case 'mistral':
      return `import { createMistral } from "@ai-sdk/mistral";
const provider = createMistral({ apiKey: CHAT_API_KEY });
function createConfiguredModel(modelId) {
  return provider(modelNameFor(modelId));
}`;
    case 'deepseek':
      return `import { createDeepSeek } from "@ai-sdk/deepseek";
const provider = createDeepSeek({ apiKey: CHAT_API_KEY });
function createConfiguredModel(modelId) {
  return provider(modelNameFor(modelId));
}`;
    case 'vercel_ai_gateway':
      return `import { createGateway } from "@ai-sdk/gateway";
const provider = createGateway({ apiKey: CHAT_API_KEY });
function createConfiguredModel(modelId) {
  return provider(modelId);
}`;
    case 'custom':
      return `import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
const provider = createOpenAICompatible({
  name: "larkup-custom",
  baseURL: process.env.CHAT_BASE_URL || ${JSON.stringify(customBaseUrl)},
  apiKey: CHAT_API_KEY,
});
function createConfiguredModel(modelId) {
  return provider.chatModel(modelNameFor(modelId));
}`;
    default:
      return `import { createOpenAI } from "@ai-sdk/openai";
const provider = createOpenAI({ apiKey: CHAT_API_KEY });
function createConfiguredModel(modelId) {
  return provider(modelNameFor(modelId));
}`;
  }
}

export function resolveChatProvider(config: RagConfig): string {
  if (config.chatProvider) return config.chatProvider;
  if (config.chatModelId?.startsWith('custom:')) return 'custom';
  const prefix = config.chatModelId?.split('/', 1)[0];
  if (prefix && ['openai', 'google', 'cohere', 'mistral', 'deepseek'].includes(prefix)) {
    return prefix;
  }
  return config.embeddingProvider || 'openai';
}

export function resolveChatModel(
  config: RagConfig,
  provider = resolveChatProvider(config),
): string {
  if (config.chatModelId) return config.chatModelId;
  if (provider === 'custom' && config.customChatModels?.[0]) {
    return `custom:${config.customChatModels[0].modelName}`;
  }
  const defaults: Record<string, string> = {
    openai: 'openai/gpt-4o-mini',
    google: 'google/gemini-3.6-flash',
    cohere: 'cohere/command-r-plus',
    mistral: 'mistral/mistral-large-latest',
    deepseek: 'deepseek/deepseek-chat',
    vercel_ai_gateway: 'openai/gpt-4o-mini',
  };
  return defaults[provider] || defaults.openai;
}

export function generateChatModule(config: RagConfig): string {
  const isAgentServer = config.runtimeProfile === 'assistant';
  const provider = resolveChatProvider(config);
  const chatModel = resolveChatModel(config, provider);
  const customName = chatModel.startsWith('custom:')
    ? chatModel.slice('custom:'.length)
    : chatModel;
  const customBaseUrl = (config.customChatModels ?? []).find(
    (model) => model.modelName === customName,
  )?.baseUrl;
  const resolvedProviderSource = providerSource(provider, customBaseUrl);
  const enabledSkills = (config.skills ?? []).filter((skill) => skill.enabled !== false);
  const builtInToolCatalog = [
    {
      id: 'searchKnowledgeBase',
      name: 'Semantic Search',
      description: 'Search the RAG knowledge base for text.',
    },
    {
      id: 'queryTabularData',
      name: 'Tabular Data Query',
      description: 'Filter, group, and aggregate tabular data.',
    },
    {
      id: 'generateVisualization',
      name: 'Generate Charts',
      description: 'Create interactive charts from Assistant results.',
    },
    {
      id: 'executeAnalysis',
      name: 'Python Sandbox',
      description: 'Execute Python code for complex analysis.',
    },
    {
      id: 'getIndexedData',
      name: 'Indexed Data',
      description: 'List and filter source documents.',
    },
    {
      id: 'analyzeCorpusWithCode',
      name: 'Corpus Analysis',
      description: 'Run code against the full indexed corpus.',
    },
    {
      id: 'fillDocumentForm',
      name: 'Form Filler',
      description: 'Fill forms in the active document.',
    },
  ];
  const configuredBuiltInTools = builtInToolCatalog.filter(
    (tool) => (config.enabledTools ?? []).length === 0 || config.enabledTools?.includes(tool.id),
  );
  const skillInstructions = enabledSkills
    .map((skill) => {
      const source = skill.content?.slice(0, 12_000) ?? `Remote skill reference: ${skill.url}`;
      return `## ${skill.name}\n${skill.description}\n${source ?? ''}`;
    })
    .join('\n\n');
  const configuredSystemPrompt =
    config.systemPrompt || 'You are a helpful assistant grounded in the supplied knowledge base.';
  return `import { streamText${isAgentServer ? ', stepCountIs, tool' : ''} } from "ai";
${
  isAgentServer
    ? 'import { z } from "zod";\nimport { createMCPClient } from "@ai-sdk/mcp";\nimport { SandboxManager } from "@larkup/sandbox";\n'
    : ''
}import { embedQuery } from "./embed.mjs";
import { list as storeList, query as storeQuery } from "./store.mjs";

const CHAT_API_KEY = process.env.CHAT_API_KEY || process.env.OPENAI_API_KEY || "";
const CHAT_PROVIDER = ${JSON.stringify(provider)};
const CHAT_MODEL = process.env.CHAT_MODEL || ${JSON.stringify(chatModel)};
function modelNameFor(modelId) {
  return modelId.startsWith("custom:")
    ? modelId.slice("custom:".length)
    : modelId.includes("/")
      ? modelId.split("/").slice(1).join("/")
      : modelId;
}
const DEFAULT_LARKUP_PROMPT = \`You are an advanced AI Agent powered by Larkup.
Before answering any user query, you MUST aggressively utilize your available tools to gather the most accurate and up-to-date information. Do not rely solely on your pre-trained memory.
1. Use your knowledge base tools to query local indexed data.
2. Use your MCP (Model Context Protocol) tools to query connected external systems.
3. Use your Sandbox tools if you need to compute or analyze data.
4. Strictly follow any active Skill instructions provided below.

Your primary directive is: Check Knowledge > Check MCP/Plugins > Follow Skills > Answer User.\`;

const CONFIGURED_SYSTEM_PROMPT = process.env.CHAT_SYSTEM_PROMPT || ${JSON.stringify(
    configuredSystemPrompt,
  )};
const SYSTEM_PROMPT = DEFAULT_LARKUP_PROMPT + "\\n\\n--- USER CUSTOM INSTRUCTIONS ---\\n" + CONFIGURED_SYSTEM_PROMPT + ${JSON.stringify(
    skillInstructions ? `\n\n--- AVAILABLE AGENT SKILLS ---\n${skillInstructions}` : '',
  )};
const ENABLED_TOOLS = new Set(${JSON.stringify(config.enabledTools ?? [])});
const CONFIGURED_BUILT_IN_TOOLS = ${JSON.stringify(configuredBuiltInTools)};
const isToolEnabled = (id) => ENABLED_TOOLS.size === 0 || ENABLED_TOOLS.has(id);

${
  isAgentServer
    ? `function parseRuntimeJson(name, fallback) {
  try {
    const value = process.env[name];
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

const MCP_CONNECTIONS = parseRuntimeJson("LARKUP_MCP_CONNECTIONS", []);
const PLUGIN_MODULES = parseRuntimeJson("LARKUP_AGENT_PLUGIN_MODULES", []);
const SANDBOX_BACKEND = process.env.LARKUP_SANDBOX_BACKEND || "local";
const SANDBOX_CREDENTIALS = parseRuntimeJson("LARKUP_SANDBOX_CREDENTIALS", {});
`
    : ''
}

${resolvedProviderSource}
const model = createConfiguredModel(CHAT_MODEL);

function textFromMessage(message) {
  if (typeof message?.content === "string") return message.content.trim();
  if (Array.isArray(message?.content)) {
    return message.content
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\\n")
      .trim();
  }
  return "";
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendError(res, status, error) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify({ error }));
}

function normalizeMessages(body) {
  if (!Array.isArray(body.messages)) throw new Error("Body must include a messages array.");
  const messages = body.messages
    .filter((message) => ["user", "assistant", "system"].includes(message?.role))
    .map((message) => ({ role: message.role, content: textFromMessage(message) }))
    .filter((message) => message.content);
  if (![...messages].reverse().some((message) => message.role === "user")) {
    throw new Error("At least one user message is required.");
  }
  return messages;
}

function resolveRequestedChatModel(body) {
  const requestedProvider = typeof body.provider === "string" ? body.provider.trim() : "";
  const requestedModel = typeof body.modelId === "string"
    ? body.modelId.trim()
    : typeof body.model === "string"
      ? body.model.trim()
      : "";
  if (requestedProvider && requestedProvider !== CHAT_PROVIDER) {
    throw new Error("This runtime is configured for " + CHAT_PROVIDER + ". Set provider to that value or omit it.");
  }
  if (!requestedModel) return { id: CHAT_MODEL, model };
  if (CHAT_PROVIDER !== "vercel_ai_gateway") {
    const modelProvider = requestedModel.startsWith("custom:")
      ? "custom"
      : requestedModel.includes("/")
        ? requestedModel.split("/", 1)[0]
        : CHAT_PROVIDER;
    if (modelProvider !== CHAT_PROVIDER) {
      throw new Error("Model " + requestedModel + " is not available through the configured " + CHAT_PROVIDER + " provider.");
    }
  }
  return { id: requestedModel, model: createConfiguredModel(requestedModel) };
}

${
  isAgentServer
    ? `function mcpTransport(connection) {
  const headers = { ...(connection.headers || {}) };
  if (connection.connectionType === "proxy") {
    if (connection.proxyAuthToken) headers[connection.proxyAuthHeader || "Authorization"] = connection.proxyAuthToken;
    return { type: connection.transport || "http", url: connection.proxyUrl, headers };
  }
  return { type: connection.transport || "http", url: connection.url, headers };
}

function mcpToolPrefix(connection) {
  return "mcp_" + String(connection.id || "remote").replace(/[^a-zA-Z0-9_]/g, "_") + "_";
}

async function buildAgentTools() {
  const tools = {};
  const descriptions = [];
  const closers = [];
  if (isToolEnabled("searchKnowledgeBase")) {
    tools.searchKnowledgeBase = tool({
      description: "Search the Larkup knowledge base for relevant source material.",
      inputSchema: z.object({ query: z.string(), topK: z.number().int().min(1).max(20).optional() }),
      execute: async ({ query, topK }) => storeQuery(await embedQuery(query), topK || Number(process.env.TOP_K || 5)),
    });
    descriptions.push({ id: "searchKnowledgeBase", name: "Search Knowledge Base", description: "Search indexed Larkup knowledge-base content.", source: "built-in" });
  }
  if (isToolEnabled("getIndexedData")) {
    tools.getIndexedData = tool({
      description: "List indexed knowledge-base documents when a user asks what data is available.",
      inputSchema: z.object({ page: z.number().int().min(1).optional(), limit: z.number().int().min(1).max(100).optional() }),
      execute: ({ page, limit }) => storeList({ page: page || 1, limit: limit || 20 }),
    });
    descriptions.push({ id: "getIndexedData", name: "Get Indexed Data", description: "List indexed knowledge-base documents.", source: "built-in" });
  }
  if (isToolEnabled("executeAnalysis") || isToolEnabled("analyzeCorpusWithCode")) {
    tools.executeAnalysis = tool({
      description: "Run Python, JavaScript, or TypeScript in the configured isolated sandbox.",
      inputSchema: z.object({ code: z.string(), language: z.enum(["python", "javascript", "typescript"]).default("python") }),
      execute: async ({ code, language }) => {
        const result = await new SandboxManager({ backend: SANDBOX_BACKEND, credentials: SANDBOX_CREDENTIALS }).execute({ code, language, timeout: 30_000 });
        return { stdout: result.stdout.slice(0, 5000), stderr: result.stderr.slice(0, 2000), exitCode: result.exitCode, executionTimeMs: result.executionTimeMs, artifacts: result.artifacts.map((artifact) => ({ name: artifact.name, mimeType: artifact.mimeType })) };
      },
    });
    descriptions.push({ id: "executeAnalysis", name: "Execute Analysis", description: "Run code in the configured sandbox.", source: "sandbox" });
  }
  for (const connection of Array.isArray(MCP_CONNECTIONS) ? MCP_CONNECTIONS : []) {
    if (!connection || connection.enabled === false || !connection.url) continue;
    try {
      const client = await createMCPClient({ transport: mcpTransport(connection) });
      const remoteTools = await client.tools();
      const prefix = mcpToolPrefix(connection);
      for (const [name, remoteTool] of Object.entries(remoteTools)) {
        const id = prefix + name;
        tools[id] = remoteTool;
        descriptions.push({ id, name, description: "MCP tool from " + (connection.name || connection.url), source: "mcp", connectionId: connection.id, connectionName: connection.name || connection.url });
      }
      closers.push(() => client.close());
    } catch (error) {
      console.warn("[agent] MCP connection unavailable:", connection.name || connection.id, error instanceof Error ? error.message : String(error));
    }
  }
  for (const plugin of Array.isArray(PLUGIN_MODULES) ? PLUGIN_MODULES : []) {
    if (!plugin || !plugin.packageName) continue;
    try {
      const mod = await import(plugin.packageName);
      const factory = mod.default || mod.tool;
      const pluginTools = typeof factory === "function" ? await factory({ config: plugin.config || {}, sandbox: { backend: SANDBOX_BACKEND } }) : null;
      const pluginName = plugin.name || mod.TOOL_META?.name || plugin.id || plugin.packageName;
      if (!pluginTools || typeof pluginTools !== "object") {
        descriptions.push({ id: plugin.id || plugin.packageName, name: pluginName, description: "Configured Marketplace plugin without an Agent tool factory.", source: "plugin", pluginId: plugin.id, pluginName, availability: "configured" });
        continue;
      }
      for (const [name, pluginTool] of Object.entries(pluginTools)) {
        tools[name] = pluginTool;
        descriptions.push({ id: name, name, description: "Tool provided by plugin " + (plugin.id || plugin.packageName), source: "plugin", pluginId: plugin.id, pluginName });
      }
    } catch (error) {
      console.warn("[agent] Plugin unavailable:", plugin.id || plugin.packageName, error instanceof Error ? error.message : String(error));
    }
  }
  return { tools, descriptions, close: async () => Promise.allSettled(closers.map((close) => close())) };
}

export async function listAgentTools() {
  const agentTools = await buildAgentTools();
  try {
    return agentTools.descriptions;
  } finally {
    await agentTools.close();
  }
}

export async function listAgentCapabilities() {
  const agentTools = await buildAgentTools();
  try {
    const groups = new Map();
    for (const item of agentTools.descriptions) {
      const id = item.source === "mcp"
        ? "mcp:" + item.connectionId
        : item.source === "plugin"
          ? "plugin:" + item.pluginId
          : item.source || "built-in";
      const name = item.source === "mcp"
        ? "MCP · " + (item.connectionName || item.connectionId)
        : item.source === "plugin"
          ? "Plugin · " + (item.pluginName || item.pluginId)
          : item.source === "sandbox"
            ? "Sandbox"
            : "Built-in tools";
      const group = groups.get(id) || {
        id,
        name,
        source: item.source || "built-in",
        connectionId: item.connectionId,
        pluginId: item.pluginId,
        tools: [],
      };
      group.tools.push(item);
      groups.set(id, group);
    }
    const builtIns = groups.get("built-in") || { id: "built-in", name: "Built-in tools", source: "built-in", tools: [] };
    const knownBuiltIns = new Set(builtIns.tools.map((item) => item.id));
    for (const tool of CONFIGURED_BUILT_IN_TOOLS) {
      if (!knownBuiltIns.has(tool.id)) {
        builtIns.tools.push({ ...tool, source: "built-in", availability: "configured" });
      }
    }
    if (builtIns.tools.length) groups.set("built-in", builtIns);
    const configuredPluginIds = new Set(
      agentTools.descriptions.filter((item) => item.source === "plugin").map((item) => item.pluginId),
    );
    for (const plugin of Array.isArray(PLUGIN_MODULES) ? PLUGIN_MODULES : []) {
      if (!plugin?.packageName || configuredPluginIds.has(plugin.id)) continue;
      const pluginId = plugin.id || plugin.packageName;
      groups.set("plugin:" + pluginId, {
        id: "plugin:" + pluginId,
        name: "Plugin · " + (plugin.name || pluginId),
        source: "plugin",
        pluginId,
        tools: [{
          id: pluginId,
          name: plugin.name || pluginId,
          description: "Configured Marketplace plugin. Its executable tools could not be loaded by this runtime.",
          source: "plugin",
          pluginId,
          availability: "configured",
        }],
      });
    }
    const skills = ${JSON.stringify(
      enabledSkills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description || 'Agent skill instructions.',
        source: 'skill',
        availability: 'active',
        url: skill.url,
      })),
    )};
    if (skills.length) groups.set("skills", { id: "skills", name: "Skills", source: "skill", tools: skills });
    return [...groups.values()];
  } finally {
    await agentTools.close();
  }
}

export function getAgentRuntimeConfiguration() {
  return {
    systemPrompt: CONFIGURED_SYSTEM_PROMPT,
    enabledTools: CONFIGURED_BUILT_IN_TOOLS,
    sandbox: {
      provider: SANDBOX_BACKEND,
      configured: Object.keys(SANDBOX_CREDENTIALS).length > 0 || SANDBOX_BACKEND === "local" || SANDBOX_BACKEND === "docker",
      enabled: isToolEnabled("executeAnalysis") || isToolEnabled("analyzeCorpusWithCode"),
    },
    skills: ${JSON.stringify(
      enabledSkills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        url: skill.url,
      })),
    )},
  };
}

export async function getAgentSandboxStatus() {
  try {
    const health = await new SandboxManager({ backend: SANDBOX_BACKEND, credentials: SANDBOX_CREDENTIALS }).healthCheck();
    return {
      provider: SANDBOX_BACKEND,
      configured: getAgentRuntimeConfiguration().sandbox.configured,
      status: health.status,
      message: health.error,
    };
  } catch (error) {
    return { provider: SANDBOX_BACKEND, configured: getAgentRuntimeConfiguration().sandbox.configured, status: "unavailable", message: error instanceof Error ? error.message : "Sandbox health check failed." };
  }
}
`
    : ''
}
async function createChatResult(body, agentMode) {
  const messages = normalizeMessages(body);
  const latestUser = [...messages].reverse().find((message) => message.role === "user");
  const vector = await embedQuery(latestUser.content);
  const requestedTopK = Number(body.topK) || Number(process.env.TOP_K || 5);
  const hits = await storeQuery(vector, Math.min(50, Math.max(1, requestedTopK)));
  const context = hits
    .map((hit, index) => \`[\${index + 1}] \${hit.title || "Untitled"}\\n\${hit.text}\`)
    .join("\\n\\n");
  const requestedSystem = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\\n\\n");
  const system = [
    SYSTEM_PROMPT,
    requestedSystem,
    context
      ? \`Use the retrieved context below as the source of truth. Answer directly when it states the requested fact. Treat first- and second-person statements in a retrieved source as referring to the person asked about when the wording matches the user's question (for example, “you like mango and orange” answers “which fruit do I like?”). Do not describe the source as “the first document” or add uncertainty when the fact is stated plainly. Say the context does not answer only when no retrieved statement supports an answer.\\n\\n\${context}\`
      : "",
  ].filter(Boolean).join("\\n\\n");
  const modelMessages = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({ role: message.role, content: message.content }));
  const selected = resolveRequestedChatModel(body);
  const options = { model: selected.model, system, messages: modelMessages };
  const agentTools = agentMode ? await buildAgentTools() : null;
  const result = agentMode
    ? streamText({ ...options, tools: agentTools.tools, stopWhen: stepCountIs(5) })
    : streamText(options);
  return { result, hits, modelId: selected.id, close: agentTools ? agentTools.close : async () => {} };
}

export async function handleChat(req, res) {
  try {
    const { result, hits } = await createChatResult(await readBody(req), false);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    for await (const text of result.textStream) {
      res.write(\`event: message\\ndata: \${JSON.stringify({ type: "text-delta", text })}\\n\\n\`);
    }
    res.write(\`event: done\\ndata: \${JSON.stringify({ type: "done", hits })}\\n\\n\`);
    res.end();
  } catch (error) {
    sendError(res, 400, error instanceof Error ? error.message : String(error));
  }
}

${
  isAgentServer
    ? `export async function handleAgentChat(req, res) {
  try {
    const { result, close } = await createChatResult(await readBody(req), true);
    await result.pipeUIMessageStreamToResponse(res, {
      sendReasoning: true,
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization" },
    });
    await close();
  } catch (error) {
    sendError(res, 400, error instanceof Error ? error.message : String(error));
  }
}

export async function handleOpenAIChatCompletions(req, res) {
  try {
    const body = await readBody(req);
    const { result, modelId, close } = await createChatResult(body, true);
    const id = \`chatcmpl_\${crypto.randomUUID().replaceAll("-", "")}\`;
    const created = Math.floor(Date.now() / 1000);
    const modelName = modelId;
    if (body.stream === false) {
      let content = "";
      for await (const text of result.textStream) content += text;
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      const response = res.end(JSON.stringify({
        id,
        object: "chat.completion",
        created,
        model: modelName,
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      }));
      await close();
      return response;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    for await (const text of result.textStream) {
      res.write(\`data: \${JSON.stringify({ id, object: "chat.completion.chunk", created, model: modelName, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\\n\\n\`);
    }
    res.write(\`data: \${JSON.stringify({ id, object: "chat.completion.chunk", created, model: modelName, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\\n\\n\`);
    res.end("data: [DONE]\\n\\n");
    await close();
  } catch (error) {
    sendError(res, 400, error instanceof Error ? error.message : String(error));
  }
}
`
    : ''
}`;
}

export function addChatProviderDependency(
  dependencies: Record<string, string>,
  provider: string | undefined,
) {
  const packageByProvider: Record<string, string> = {
    custom: '@ai-sdk/openai-compatible',
    google: '@ai-sdk/google',
    cohere: '@ai-sdk/cohere',
    mistral: '@ai-sdk/mistral',
    deepseek: '@ai-sdk/deepseek',
    vercel_ai_gateway: '@ai-sdk/gateway',
    openai: '@ai-sdk/openai',
  };
  const packageName = packageByProvider[provider || 'openai'] || '@ai-sdk/openai';
  dependencies[packageName] = AI_SDK_PROVIDER_VERSIONS[packageName];
}
