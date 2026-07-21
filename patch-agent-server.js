const fs = require('fs');
let code = fs.readFileSync('packages/core/src/generator/generate-agent-server.ts', 'utf8');

// 1. Add new files to generateAgentServer files array
code = code.replace(
  "    { path: 'server.mjs', contents: serverSource(config) },",
  `    { path: 'server.mjs', contents: serverSource(config) },
    { path: 'chat.mjs', contents: chatSource(config) },
    { path: 'auth.mjs', contents: authSource(config) },
    { path: 'widget.js', contents: widgetSource(config) },
    { path: 'chat-ui.html', contents: chatUiSource(config) },`,
);

// 2. Add dependencies for AI SDK
code = code.replace(
  "    ai: '^3.0.0',",
  `    ai: '^3.3.0',
    zod: '^3.23.0',`,
);

// 3. Add Agent env vars
code = code.replace(
  '    {',
  `    {
      key: 'AGENT_AUTH_MODE',
      required: false,
      help: 'Authentication mode for the agent (none, api-key, join-code)',
    },
    {
      key: 'AGENT_JOIN_CODE',
      required: false,
      help: 'Join code for join-code auth mode',
    },
    {
      key: 'CHAT_API_KEY',
      required: false,
      help: 'API key for chat LLM',
    },
    {`,
);

// 4. Update generatedEnv
code = code.replace(
  "      if (e.key === 'EMBEDDING_API_KEY') val = config.embeddingApiKey || '';",
  `      if (e.key === 'EMBEDDING_API_KEY') val = config.embeddingApiKey || '';
      if (e.key === 'AGENT_AUTH_MODE') val = config.deployment?.authMode || 'none';
      if (e.key === 'AGENT_JOIN_CODE') val = config.deployment?.joinCode || '';
      if (e.key === 'CHAT_API_KEY') val = config.deployment?.chatApiKey || config.chatApiKey || '';`,
);

fs.writeFileSync('packages/core/src/generator/generate-agent-server.ts', code);
