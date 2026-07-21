const fs = require('fs');
let code = fs.readFileSync('packages/core/src/generator/generate-agent-server.ts', 'utf8');

const newSources = `
function authSource(config: any) {
  return \`import { parse } from "cookie";
import crypto from "node:crypto";

const AUTH_MODE = process.env.AGENT_AUTH_MODE || 'none';
const JOIN_CODE = process.env.AGENT_JOIN_CODE || '';
const SERVER_API_KEY = process.env.SERVER_API_KEY || '';
const SECRET = process.env.SERVER_API_KEY || process.env.AGENT_JOIN_CODE || 'larkup-secret';

function createToken() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 1000 * 60 * 60 * 24 * 7 })).toString('base64');
  const signature = crypto.createHmac('sha256', SECRET).update(payload).digest('base64');
  return \\\`\${payload}.\${signature}\\\`;
}

function verifyToken(token) {
  try {
    const [payload, signature] = token.split('.');
    const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64');
    if (signature !== expected) return false;
    const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    return decoded.exp > Date.now();
  } catch {
    return false;
  }
}

export function checkAuth(req) {
  if (AUTH_MODE === 'none') return true;
  
  if (AUTH_MODE === 'api-key') {
    const auth = req.headers.authorization;
    if (!auth) return false;
    const token = auth.replace(/^Bearer\\\\s+/i, "").trim();
    return token === SERVER_API_KEY;
  }
  
  if (AUTH_MODE === 'join-code') {
    const cookies = parse(req.headers.cookie || '');
    return verifyToken(cookies.agent_session);
  }
  
  return false;
}

export function handleVerify(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk.toString());
  req.on('end', () => {
    try {
      const { code } = JSON.parse(body);
      if (code === JOIN_CODE) {
        const token = createToken();
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': \\\`agent_session=\${token}; HttpOnly; Path=/; Max-Age=\${60*60*24*7}; SameSite=Lax\\\`
        });
        res.end(JSON.stringify({ success: true }));
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid join code' }));
      }
    } catch {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Bad request' }));
    }
  });
}
\`;
}

function chatSource(config: any) {
  return \`import { streamText, convertToModelMessages } from "ai";
import { embedQuery } from "./embed.mjs";
import { query as storeQuery } from "./store.mjs";
import { createOpenAI } from "@ai-sdk/openai";

const CHAT_API_KEY = process.env.CHAT_API_KEY || process.env.OPENAI_API_KEY;
const CHAT_MODEL = process.env.CHAT_MODEL || "\${config.deployment?.chatModelId || 'gpt-4o-mini'}";
const SYSTEM_PROMPT = \${JSON.stringify(config.deployment?.systemPrompt || 'You are a helpful AI assistant.')};

const provider = createOpenAI({ apiKey: CHAT_API_KEY });
const model = provider(CHAT_MODEL);

export async function handleChat(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk.toString());
  req.on('end', async () => {
    try {
      const json = JSON.parse(body);
      const messages = json.messages || [];
      const lastMessage = messages[messages.length - 1];

      let contextStr = "";
      if (lastMessage && lastMessage.role === 'user') {
        const vector = await embedQuery(lastMessage.content);
        const topK = Number(process.env.TOP_K || 5);
        const hits = await storeQuery(vector, topK);
        if (hits.length > 0) {
          contextStr = "Relevant context from knowledge base:\\\\n" + hits.map(h => \\\`- \${h.title}: \${h.text}\\\`).join('\\\\n\\\\n');
        }
      }

      const systemMessage = { role: 'system', content: SYSTEM_PROMPT + (contextStr ? "\\\\n\\\\n" + contextStr : "") };
      const coreMessages = convertToModelMessages([systemMessage, ...messages]);

      const result = await streamText({
        model,
        messages: coreMessages,
      });

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      
      for await (const chunk of result.textStream) {
        res.write(\\\`data: \${JSON.stringify(chunk)}\\\\n\\\\n\\\`);
      }
      res.end();
    } catch (err) {
      console.error(err);
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}
\`;
}

function widgetSource(config: any) {
  return \`export const WIDGET_JS = \\\`
(function() {
  const container = document.createElement('div');
  container.innerHTML = '<div style="position:fixed;bottom:20px;right:20px;width:60px;height:60px;border-radius:50%;background:#000;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:9999;" onclick="document.getElementById(\\\\'larkup-chat-iframe\\\\').style.display = document.getElementById(\\\\'larkup-chat-iframe\\\\').style.display === \\\\'none\\\\' ? \\\\'block\\\\' : \\\\'none\\\\'">💬</div><iframe id="larkup-chat-iframe" src="' + document.currentScript.src.replace('/widget.js', '/chat-ui') + '" style="display:none;position:fixed;bottom:90px;right:20px;width:350px;height:500px;border:none;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:9999;"></iframe>';
  document.body.appendChild(container);
})();
\\\`;\`;
}

function chatUiSource(config: any) {
  return \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>\${config.projectName} Agent</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; padding: 20px; display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; }
    #chat-log { flex: 1; overflow-y: auto; margin-bottom: 20px; border: 1px solid #ccc; padding: 10px; border-radius: 8px; }
    .msg { margin-bottom: 10px; padding: 8px 12px; border-radius: 8px; max-width: 80%; }
    .user { background: #000; color: #fff; align-self: flex-end; margin-left: auto; }
    .ai { background: #f0f0f0; color: #000; }
    form { display: flex; gap: 10px; }
    input { flex: 1; padding: 10px; border: 1px solid #ccc; border-radius: 4px; }
    button { padding: 10px 20px; background: #000; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
  </style>
</head>
<body>
  <div id="chat-log"></div>
  <form id="chat-form">
    <input type="text" id="input" placeholder="\${config.deployment?.widgetStyle?.placeholder || 'Type a message...'}" required />
    <button type="submit">Send</button>
  </form>
  <script>
    const log = document.getElementById('chat-log');
    const form = document.getElementById('chat-form');
    const input = document.getElementById('input');
    const messages = [];
    
    function appendMsg(role, content) {
      const d = document.createElement('div');
      d.className = 'msg ' + role;
      d.textContent = content;
      log.appendChild(d);
      log.scrollTop = log.scrollHeight;
    }

    form.onsubmit = async (e) => {
      e.preventDefault();
      const text = input.value;
      input.value = '';
      appendMsg('user', text);
      messages.push({ role: 'user', content: text });
      
      const res = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages })
      });
      
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      
      const d = document.createElement('div');
      d.className = 'msg ai';
      log.appendChild(d);
      
      let aiText = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split('\\\\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              aiText += data;
              d.textContent = aiText;
              log.scrollTop = log.scrollHeight;
            } catch(e) {}
          }
        }
      }
      messages.push({ role: 'assistant', content: aiText });
    };
  </script>
</body>
</html>
\`;
}
`;

code = code.replace(
  'function serverSource(config: RagConfig): string {',
  newSources + '\nfunction serverSource(config: RagConfig): string {',
);

let newServerSource = `function serverSource(config: RagConfig): string {
  return \`import { createServer } from "node:http"
import fs from "node:fs"
import path from "node:path"
import { checkAuth, handleVerify } from "./auth.mjs"
import { handleChat } from "./chat.mjs"
import { WIDGET_JS } from "./widget.js"

const PORT = process.env.PORT || 8080

function send(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  })
  res.end(JSON.stringify(body))
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {})
  const url = new URL(req.url, \\\`http://\${req.headers.host}\\\`)

  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, { ok: true, service: "\${config.projectName}-agent" })
  }
  
  if (req.method === "GET" && url.pathname === "/widget.js") {
    res.writeHead(200, { "Content-Type": "application/javascript" })
    return res.end(WIDGET_JS)
  }
  
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/chat-ui")) {
    res.writeHead(200, { "Content-Type": "text/html" })
    return res.end(fs.readFileSync(path.join(process.cwd(), "chat-ui.html")))
  }
  
  if (req.method === "POST" && url.pathname === "/auth/verify") {
    return handleVerify(req, res);
  }

  // Auth gate
  if (!checkAuth(req)) {
    return send(res, 401, { error: "Unauthorized" });
  }

  if (req.method === "POST" && url.pathname === "/chat") {
    return handleChat(req, res);
  }

  return send(res, 404, { error: "Not found" })
})

server.listen(PORT, () => {
  console.log(\\\`[\${config.projectName}] Agent server listening on :\\\${PORT}\\\`)
})
\`;
}`;

code = code.replace(
  /function serverSource\(config: RagConfig\): string \{[\s\S]*?\n\nfunction demoSource/m,
  newServerSource + '\n\nfunction demoSource',
);

fs.writeFileSync('packages/core/src/generator/generate-agent-server.ts', code);
