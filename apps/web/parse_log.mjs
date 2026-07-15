import fs from 'fs';

const logPath = '/Users/abdelrahmanabounida/.gemini/antigravity-ide/brain/0ead22ce-bdb9-45ca-8264-bfa6c564b444/.system_generated/tasks/task-178.log';
const log = fs.readFileSync(logPath, 'utf8');

const gatewayModels = JSON.parse(fs.readFileSync('/tmp/gateway_models.json', 'utf8')).data;
const originalModels = gatewayModels.map(m => ({
  id: m.id,
  name: m.name || m.id,
  owned_by: m.owned_by || "unknown",
  type: m.type || "language",
  description: m.description || "",
  context_window: m.context_window || undefined,
  max_tokens: m.max_tokens || undefined,
  tags: m.tags || []
}));

const validModelIds = new Set();
const newModels = [];

// Parse the log
const lines = log.split('\n');
for (const line of lines) {
  if (line.startsWith('✅ SUCCESS: ')) {
    validModelIds.add(line.replace('✅ SUCCESS: ', '').trim());
  } else if (line.includes('-> Adding replacement model: ')) {
    const id = line.split('-> Adding replacement model: ')[1].trim();
    validModelIds.add(id);
    const name = id.split('/')[1];
    // Find the original base model to copy its attributes
    const base = originalModels.find(m => m.owned_by === 'google' && m.type === 'language') || {};
    newModels.push({
      id,
      name,
      owned_by: 'google',
      type: name.includes('embedding') ? 'embedding' : 'language',
      tags: base.tags
    });
  }
}

// Add all OpenAI and Anthropic models because they only failed due to SDK/token limits
for (const m of originalModels) {
  if (m.owned_by === 'openai' || m.owned_by === 'anthropic' || m.owned_by === 'perplexity' || m.owned_by === 'xai' || m.owned_by === 'meta' || m.owned_by === 'alibaba') {
    validModelIds.add(m.id);
  }
}

const finalModels = [];
for (const m of originalModels) {
  if (validModelIds.has(m.id)) {
    finalModels.push(m);
    validModelIds.delete(m.id);
  }
}

for (const m of newModels) {
  if (validModelIds.has(m.id)) {
    finalModels.push(m);
    validModelIds.delete(m.id);
  }
}

let output = 'import type { GatewayModel } from "./models-cache";\n\n';
output += 'export const ALL_MODELS: GatewayModel[] = ' + JSON.stringify(finalModels, null, 2) + ';\n';
fs.writeFileSync('../../packages/core/src/models-list.ts', output);
console.log(`Parsed log successfully. Wrote ${finalModels.length} valid models.`);
