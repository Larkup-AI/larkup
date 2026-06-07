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

/** Redeploy from an existing deployment. Only called when latestDeployment exists. */
async function triggerRedeployment(
  token: string,
  project: VercelProject,
  latestDeployment: VercelDeployment
): Promise<VercelDeployment> {
  const body: Record<string, any> = {
    name: project.name,
    target: "production",
    deploymentId: latestDeployment.uid || latestDeployment.id,
  };

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
    const wasNew = !project;

    if (!project) {
      console.log(`Project "${projectIdOrName}" not found. Creating it...`);
      project = await createProject(token, projectIdOrName);
      console.log(`Created project: ${project.id} (${project.name})`);
    }

    // 2. Get latest deployment (null for brand-new projects)
    const latestDeployment = await getLatestDeployment(token, project.id);

    // 3. For brand-new projects with no code yet, skip the empty deployment
    //    (deploying files:[] creates an empty build that returns 404).
    //    Instead, return the Vercel project dashboard so the user can
    //    connect their GitHub repo.
    if (!latestDeployment) {
      const dashboardUrl = `https://vercel.com/new/import?s=https://github.com&teamSlug=&project=${encodeURIComponent(project.name)}`;
      return {
        success: true,
        url: dashboardUrl,
        deploymentId: undefined,
        projectCreated: true,
      };
    }

    // 4. Redeploy from existing deployment
    const deployRes = await triggerRedeployment(token, project, latestDeployment);

    // 5. Build canonical production URL: <project-name>.vercel.app
    //    The raw deployRes.url is a per-deployment SHA URL (not the production alias).
    const url = `https://${project.name}.vercel.app`;

    return {
      success: true,
      url,
      deploymentId: deployRes?.id,
      projectCreated: wasNew,
    };
  } catch (error: any) {
    console.error("Vercel Deploy Error:", error);
    return {
      success: false,
      error: error.message || "Failed to trigger deployment on Vercel.",
    };
  }
}
