import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import JSZip from "jszip";
import { getActiveServer } from "@larkup/core/workspace";

function getFilesRecursively(dir: string, baseDir: string): any[] {
  let results: any[] = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    if (file === "node_modules" || file === ".git" || file === "server.log")
      continue;
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFilesRecursively(filePath, baseDir));
    } else {
      results.push({
        file: path.relative(baseDir, filePath).replace(/\\/g, "/"),
        fullPath: filePath,
      });
    }
  }
  return results;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const serverId = url.searchParams.get("serverId") || "default";
    
    let activeId = serverId;
    if (activeId === "default") {
      const server = await getActiveServer();
      if (server) activeId = server.id;
    }

    const cwd = process.cwd();
    let config: any = null;
    const configCandidates = [
      path.join(cwd, ".larkup", "servers", activeId, "config.json"),
      path.join(cwd, ".larkup", "config.json"),
    ];
    for (const cfgPath of configCandidates) {
      if (fs.existsSync(cfgPath)) {
        try {
          config = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
          break;
        } catch {}
      }
    }

    if (!config) {
      return NextResponse.json({ error: "Configuration not found." }, { status: 404 });
    }

    const { generateServer } = await import("@larkup/core/generator/generate-server");
    const generated = generateServer(config);
    
    const zip = new JSZip();

    // Add generated files
    for (const f of generated.files) {
      zip.file(f.path, f.contents);
    }

    // Add .env.example as .env
    const envExample = generated.files.find(f => f.path === ".env.example");
    if (envExample) {
      zip.file(".env", envExample.contents);
    }

    // Add LanceDB data if local
    const isLanceLocal = config.vectorStore === "lancedb" && config.storeConfig?.mode !== "cloud";
    if (isLanceLocal) {
      const lancedbDir = path.join(cwd, ".larkup", "servers", activeId, "lancedb");
      if (fs.existsSync(lancedbDir)) {
        const lancedbFiles = getFilesRecursively(
          lancedbDir,
          path.join(cwd, ".larkup", "servers", activeId)
        );
        for (const f of lancedbFiles) {
          zip.file(f.file, fs.readFileSync(f.fullPath));
        }
      }
    }

    // Add CI/CD templates based on provider if provided
    const provider = url.searchParams.get("provider");
    if (provider === "azure-container-apps") {
      zip.file("DEPLOY_GUIDE.md", "# Azure Container Apps Deployment Guide\n\n1. Install Azure CLI.\n2. Run `az containerapp up --source . --name my-rag-server`.");
    } else if (provider === "aws-app-runner") {
      zip.file("DEPLOY_GUIDE.md", "# AWS App Runner Deployment Guide\n\n1. Push this folder to a GitHub repository.\n2. Connect the repository in AWS App Runner.\n3. Provide the Build Command: `npm install` and Start Command: `npm start`.");
    } else if (provider === "gcp-cloud-run") {
      zip.file("DEPLOY_GUIDE.md", "# GCP Cloud Run Deployment Guide\n\n1. Install gcloud CLI.\n2. Run `gcloud run deploy my-rag-server --source .`.");
    }

    const buffer = await zip.generateAsync({ type: "nodebuffer" });

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${config.projectName || "rag-server"}.zip"`,
      },
    });

  } catch (error: any) {
    console.error("ZIP Generation Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
