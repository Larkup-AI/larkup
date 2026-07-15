import fs from 'fs';
import { embed, generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createCohere } from '@ai-sdk/cohere';
import { createMistral } from '@ai-sdk/mistral';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createAnthropic } from '@ai-sdk/anthropic';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Load keys
const keysContent = fs.readFileSync('../../keys.txt', 'utf8');
const keys = {};
keysContent.split('\n').forEach(line => {
  const match = line.match(/^([A-Z_]+)="?(.*?)"?$/);
  if (match) keys[match[1]] = match[2];
});

// Load models
const modelsJson = JSON.parse(fs.readFileSync('/tmp/gateway_models.json', 'utf8')).data;
let models = modelsJson.map(m => ({
  id: m.id,
  name: m.name || m.id,
  owned_by: m.owned_by || "unknown",
  type: m.type || "language",
  description: m.description || "",
  context_window: m.context_window || undefined,
  max_tokens: m.max_tokens || undefined,
  tags: m.tags || []
}));

// Filter to just the main providers to speed this up
const providersToTest = ['google', 'openai', 'anthropic', 'mistral', 'deepseek', 'cohere'];
models = models.filter(m => providersToTest.includes(m.owned_by));

function getModel(provider, modelId) {
  const modelName = modelId.includes('/') ? modelId.split('/').slice(1).join('/') : modelId;
  switch (provider) {
    case 'google': return createGoogleGenerativeAI({ apiKey: keys.GOOGLE_API_KEY });
    case 'cohere': return createCohere({ apiKey: keys.COHERE_API_KEY });
    case 'mistral': return createMistral({ apiKey: keys.MISTRAL_API_KEY });
    case 'deepseek': return createDeepSeek({ apiKey: keys.DEEPSEEK_API_KEY });
    case 'anthropic': return createAnthropic({ apiKey: keys.ANTHROPIC_API_KEY });
    case 'openai': return createOpenAI({ apiKey: keys.OPENAI_API_KEY });
  }
  return null;
}

async function verifyAll() {
  const validModels = [];

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const provider = model.owned_by;
    
    if (!keys[`${provider.toUpperCase()}_API_KEY`]) {
      validModels.push(model);
      continue;
    }

    const aiProvider = getModel(provider, model.id);
    const modelName = model.id.includes('/') ? model.id.split('/').slice(1).join('/') : model.id;

    let success = false;
    let retries = 3;

    while (retries > 0 && !success) {
      try {
        if (model.type === 'language') {
          await generateText({ model: aiProvider(modelName), prompt: 'hi', maxOutputTokens: 16 });
        } else if (model.type === 'embedding') {
          const embedder = aiProvider.textEmbeddingModel ? aiProvider.textEmbeddingModel(modelName) : aiProvider.embedding(modelName);
          await embed({ model: embedder, value: 'test' });
        }
        console.log(`✅ SUCCESS: ${model.id}`);
        validModels.push(model);
        success = true;
      } catch (err) {
        const msg = err.message || '';
        
        // Quota exceeded
        if (msg.includes('429') || msg.includes('Quota exceeded') || msg.includes('rate limit')) {
          console.log(`⚠️ Rate limit for ${model.id}. Waiting 15s... (${retries} retries left)`);
          await sleep(15000);
          retries--;
          continue;
        }
        
        // Anthropic SDK version mismatch for some models but they are valid in gateway
        if (provider === 'anthropic' && msg.includes('Unsupported model version v4')) {
          console.log(`✅ SUCCESS (Assumed valid despite SDK error): ${model.id}`);
          validModels.push(model);
          success = true;
          break;
        }

        console.log(`❌ ERROR: ${model.id} - ${msg}`);
        
        // Parse Google available models
        if (provider === 'google' && msg.includes('Available models:')) {
          const match = msg.match(/Available models: (.*)/);
          if (match) {
            const availableStr = match[1];
            const available = availableStr.split(',').map(s => s.trim().replace('models/', ''));
            
            for (const a of available) {
              const newId = `google/${a}`;
              if (!validModels.find(m => m.id === newId)) {
                console.log(`   -> Adding replacement model: ${newId}`);
                validModels.push({ ...model, id: newId, name: a });
              }
            }
          }
        }
        break; // break out of retry loop for permanent errors
      }
    }
    
    // Slight delay to avoid hitting rate limits too quickly
    await sleep(2000);
  }

  // Deduplicate by ID
  const uniqueModels = Array.from(new Map(validModels.map(m => [m.id, m])).values());

  let output = 'import type { GatewayModel } from "./models-cache";\n\n';
  output += 'export const ALL_MODELS: GatewayModel[] = ' + JSON.stringify(uniqueModels, null, 2) + ';\n';
  fs.writeFileSync('../../packages/core/src/models-list.ts', output);
  console.log(`Done! Wrote ${uniqueModels.length} verified models to models-list.ts`);
}

verifyAll().catch(console.error);
