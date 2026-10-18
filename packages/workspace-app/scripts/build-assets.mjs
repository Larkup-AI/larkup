import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
const root = new URL("../assets/", import.meta.url);
const assets = {};
async function visit(directory, prefix = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) await visit(new URL(entry.name + "/", directory), prefix + entry.name + "/");
    else assets[prefix + entry.name] = (await readFile(new URL(entry.name, directory))).toString("base64");
  }
}
await visit(root);
await writeFile(new URL("../src/asset-data.json", import.meta.url), JSON.stringify(assets));
