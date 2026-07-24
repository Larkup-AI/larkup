#!/usr/bin/env node

import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };
import { prompts } from "./ui/prompts";
import { log } from "./ui/logger";
import { checkUpdate } from "./updater";

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
import { marketplaceCommand } from "./commands/marketplace";
import { mediaCommand } from "./commands/media";
import { deployCommand } from "./commands/deploy";
import { testCommand } from "./commands/test";
import { updateCommand } from "./commands/update";
import { openCommand } from "./commands/open";
import { documentsCommand } from "./commands/documents";

const program = new Command();

program
  .name("larkup")
  .description("Build, index, and serve a RAG pipeline from the terminal.")
  .version(pkg.version);

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
  .command("documents [action] [idOrPath]")
  .alias("docs")
  .description("List, show, update, remove, or export corpus documents")
  .option("--title <title>", "Set a document title when updating")
  .option("--text <content>", "Set document content when updating")
  .option("--file <path>", "Read updated document content from a file")
  .option("--url <url>", "Set the source URL when updating")
  .option("--format <csv|jsonl>", "Corpus export format", "csv")
  .option("--out <path>", "Corpus export destination")
  .option("--server <id>", "Target a specific server instead of the active one")
  .action(async (action, idOrPath, options) => {
    await documentsCommand(action, idOrPath, options);
  });

program
  .command("index [sources...]")
  .description("Load files or folders, then chunk → embed → store the corpus")
  .option("--server <id>", "Target a specific server instead of the active one")
  .option("--no-run", "Load supplied sources without building the index")
  .option("--incremental", "Index only documents added since the last completed run")
  .action(async (sources, options) => {
    await indexCommand(sources ?? [], options);
  });

program
  .command("media [sources...]")
  .description("Add image, audio, or video files and stream processing progress")
  .option("--no-index", "Process media without rebuilding the index")
  .option("--server <id>", "Target a specific server instead of the active one")
  .action(async (sources, options) => {
    await mediaCommand(sources ?? [], options);
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

program
  .command("marketplace [action] [toolId]")
  .alias("market")
  .description("List, inspect, install, or uninstall Marketplace Hub tools")
  .action(async (action, toolId) => {
    await marketplaceCommand(action, toolId);
  });

program
  .command("deploy [target]")
  .description("Prepare a Docker, Vercel, local, or agent deployment")
  .option("--out <dir>", "Copy the generated deployment artifact to a directory")
  .option("--start", "Start the agent server when target is agent")
  .option("--server <id>", "Target a specific server instead of the active one")
  .action(async (target, options) => {
    await deployCommand(target, options);
  });

program
  .command("test")
  .description("Validate configuration, optionally test storage or a deployed endpoint")
  .option("--connection", "Test the configured vector store connection")
  .option("--endpoint <url>", "Check a deployed server's health endpoint")
  .option("--api-key <key>", "Bearer key for --endpoint")
  .option("--server <id>", "Target a specific server instead of the active one")
  .action(async (options) => {
    await testCommand(options);
  });

program
  .command("update")
  .description("Check for and install the latest CLI release")
  .option("--check", "Only check whether an update is available")
  .action(async (options) => {
    await updateCommand(options);
  });

program
  .command("open [target]")
  .description("Open the Web UI, API reference, or a URL in your browser")
  .option("--server <id>", "Target a specific server instead of the active one")
  .action(async (target, options) => {
    await openCommand(target, options);
  });

if (process.argv[2] !== "update") await checkUpdate();

try {
  await program.parseAsync(process.argv);
} catch (error) {
  log.error(error instanceof Error ? error.message : String(error));
}
