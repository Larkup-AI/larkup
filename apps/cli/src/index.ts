#!/usr/bin/env node

import { Command } from "commander";
import { prompts } from "./ui/prompts";
import { log } from "./ui/logger";

// Commands
import { initCommand } from "./commands/init";
import { listServersCommand, useServerCommand } from "./commands/servers";
import { configCommand } from "./commands/config";
import { addDocCommand } from "./commands/add-doc";
import { indexCommand } from "./commands/index-cmd";
import { generateCommand } from "./commands/generate";
import { serveCommand } from "./commands/serve";
import { queryCommand } from "./commands/query";
import { chatCommand } from "./commands/chat";
import { settingsCommand } from "./commands/settings";

const program = new Command();

program
  .name("larkup")
  .description("Build, index, and serve a RAG pipeline from the terminal.")
  .version("0.1.3");

program
  .command("init [name]")
  .description("Create a new RAG server (workspace project)")
  .action(async (name) => {
    prompts.intro(log.fmt.bold("larkup init"));
    await initCommand(name);
    prompts.outro("Done!");
  });

program
  .command("servers")
  .alias("list")
  .description("List all servers (● = active)")
  .action(async () => {
    await listServersCommand();
  });

program
  .command("use <serverId>")
  .description("Switch the active server")
  .action(async (serverId) => {
    await useServerCommand(serverId);
  });

program
  .command("config")
  .description("Show the active server's configuration + status")
  .option("--server <id>", "Target a specific server instead of the active one")
  .action(async (options) => {
    await configCommand(options);
  });

program
  .command("add-doc")
  .description("Add a document to the corpus")
  .option("--file <path>", "Add a document from a file")
  .option("--text <string>", "Add a document from inline text")
  .option("--title <string>", "Document title")
  .option("--url <string>", "Document URL")
  .option("--server <id>", "Target a specific server instead of the active one")
  .action(async (options) => {
    await addDocCommand(options);
  });

program
  .command("index")
  .description("Chunk → embed → store the corpus")
  .option("--server <id>", "Target a specific server instead of the active one")
  .action(async (options) => {
    await indexCommand(options);
  });

program
  .command("generate")
  .description("Emit the deployable RAG server to disk")
  .option("--out <dir>", "Output directory")
  .option("--server <id>", "Target a specific server instead of the active one")
  .action(async (options) => {
    await generateCommand(options);
  });

program
  .command("serve")
  .description("Run the generated server locally (foreground)")
  .option("--server <id>", "Target a specific server instead of the active one")
  .action(async (options) => {
    await serveCommand(options);
  });

program
  .command("query <question>")
  .description("Retrieve top-k chunks")
  .option("--topK <number>", "Number of results to return")
  .option("--server <id>", "Target a specific server instead of the active one")
  .action(async (question, options) => {
    await queryCommand(question, options);
  });

program
  .command("chat")
  .description("Chat with your knowledge base in the terminal")
  .option("--model <string>", "Specify the chat model ID")
  .option("--server <id>", "Target a specific server instead of the active one")
  .action(async (options) => {
    await chatCommand(options);
  });

program
  .command("settings")
  .description("Configure CLI settings (e.g., chat models)")
  .option("--server <id>", "Target a specific server instead of the active one")
  .action(async (options) => {
    await settingsCommand(options);
  });

program.parseAsync(process.argv).catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
});
