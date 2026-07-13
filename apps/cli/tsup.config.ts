import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  noExternal: ["@larkup/core", "@larkup/vector-stores"],
  external: [
    "@lancedb/lancedb",
    "@pinecone-database/pinecone",
    "chromadb",
    "@ai-sdk/cohere",
    "@ai-sdk/deepseek",
    "@ai-sdk/gateway",
    "@ai-sdk/google",
    "@ai-sdk/mistral",
    "@ai-sdk/openai",
    "@ai-sdk/openai-compatible",
    "ai"
  ],
  clean: true,
});
