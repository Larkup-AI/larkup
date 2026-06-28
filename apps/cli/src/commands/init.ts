import { createServer } from "@larkup-rag/core/workspace";
import { log } from "../ui/logger";

export async function initCommand(name?: string) {
  const projectName = name ?? "my-rag";
  const { server } = await createServer(projectName);
  
  log.success(`Created server ${log.fmt.bold(server.name)}`);
  log.dim(`  id   ${server.id}`);
  log.dim(`  port ${server.port}  (the generated server listens here)`);
  log.dim("  it is now the active server");
}
