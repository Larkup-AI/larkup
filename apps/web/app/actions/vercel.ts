"use server";

const VERCEL_API = "https://api.vercel.com";

interface VercelProject {
  id: string;
  name: string;
  link?: {
    type: string;
    repo?: string;
    repoId?: number;
    org?: string;
    gitCredentialId?: string;
    productionBranch?: string;
  };
}

interface VercelDeployment {
  id: string;
  uid: string;
  name: string;
  url: string;
  readyState: string;
  target?: string;
}

async function vercelFetch(
  path: string,
  token: string,
  options: RequestInit = {}
) {
  const res = await fetch(`${VERCEL_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = { rawText: text };
  }

  if (!res.ok) {
    const msg =
      body?.error?.message ||
      body?.message ||
      `API error occurred: Status ${res.status} Content-Type "${res.headers.get("content-type")}". Body: ${text}`;
    throw new Error(msg);
  }

  return body;
}

/** Look up a project by name or ID. Returns null if not found. */
async function getProject(
  token: string,
  nameOrId: string
): Promise<VercelProject | null> {
  try {
    const data = await vercelFetch(`/v9/projects/${encodeURIComponent(nameOrId)}`, token);
    return data as VercelProject;
  } catch (e: any) {
    if (
      e.message?.toLowerCase().includes("not found") ||
      e.message?.toLowerCase().includes("project not found")
    ) {
      return null;
    }
    throw e;
  }
}

/** Create a new blank Vercel project. */
async function createProject(
  token: string,
  name: string
): Promise<VercelProject> {
  const data = await vercelFetch(`/v9/projects`, token, {
    method: "POST",
    body: JSON.stringify({ name, framework: null }),
  });
  return data as VercelProject;
}

/** Get the latest deployment for a project. Returns null if none exist. */
async function getLatestDeployment(
  token: string,
  projectId: string
): Promise<VercelDeployment | null> {
  const data = await vercelFetch(
    `/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=1&sort=createdAt`,
    token
  );
  const deployments: VercelDeployment[] = data?.deployments ?? [];
  return deployments.length > 0 ? deployments[0] : null;
}

/** Trigger a new deployment (redeploy latest, or create a blank one if none). */
async function triggerDeployment(
  token: string,
  project: VercelProject,
  latestDeployment: VercelDeployment | null
): Promise<VercelDeployment> {
  const body: Record<string, any> = {
    name: project.name,
    target: "production",
  };

  if (latestDeployment) {
    // Redeploy from existing deployment
    body.deploymentId = latestDeployment.uid || latestDeployment.id;
  } else {
    // No existing deployment — create a minimal empty one
    body.files = [];
  }

  const data = await vercelFetch(`/v13/deployments`, token, {
    method: "POST",
    body: JSON.stringify(body),
  });

  return data as VercelDeployment;
}

export async function deployToVercel(token: string, projectIdOrName: string) {
  if (!token || !projectIdOrName) {
    return {
      success: false,
      error: "Vercel token and project ID/name are required.",
    };
  }

  try {
    // 1. Find existing project or create one
    let project = await getProject(token, projectIdOrName);

    if (!project) {
      console.log(`Project "${projectIdOrName}" not found. Creating it...`);
      project = await createProject(token, projectIdOrName);
      console.log(`Created project: ${project.id} (${project.name})`);
    }

    // 2. Get latest deployment (may be null for brand-new projects)
    const latestDeployment = await getLatestDeployment(token, project.id);

    // 3. Trigger deployment
    const deployRes = await triggerDeployment(token, project, latestDeployment);

    // 4. Build the URL
    const url = deployRes?.url
      ? `https://${deployRes.url}`
      : `https://vercel.com/${project.name}`;

    return {
      success: true,
      url,
      deploymentId: deployRes?.id,
      projectCreated: !latestDeployment,
    };
  } catch (error: any) {
    console.error("Vercel Deploy Error:", error);
    return {
      success: false,
      error: error.message || "Failed to trigger deployment on Vercel.",
    };
  }
}
