import * as p from "@clack/prompts";
import { log } from "./logger";

export const prompts = {
  intro: p.intro,
  outro: p.outro,
  text: async (opts: Parameters<typeof p.text>[0]) => {
    const result = await p.text(opts);
    if (p.isCancel(result)) {
      log.error("Cancelled.");
    }
    return result as string;
  },
  select: async <T>(opts: Parameters<typeof p.select>[0]) => {
    const result = await p.select(opts);
    if (p.isCancel(result)) {
      log.error("Cancelled.");
    }
    return result as T;
  },
  confirm: async (opts: Parameters<typeof p.confirm>[0]) => {
    const result = await p.confirm(opts);
    if (p.isCancel(result)) {
      log.error("Cancelled.");
    }
    return result as boolean;
  },
  spinner: p.spinner,
};
