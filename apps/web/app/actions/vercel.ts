"use server";

import { Vercel } from "@vercel/sdk";

export async function deployToVercel(token: string, projectIdOrName: string) {
  if (!token || !projectIdOrName) {
    return { success: false, error: "Vercel token and project ID are required." };
  }

  try {
    const vercel = new Vercel({ bearerToken: token });

    // 1. Get latest deployment
    const res = await vercel.deployments.getDeployments({
      projectId: projectIdOrName,
      limit: 1,
    });

    if (!res || !res.deployments || res.deployments.length === 0) {
      return { 
        success: false, 
        error: "No existing deployments found for this project. Please deploy manually to Vercel first, then use this button to redeploy." 
      };
    }

    const latest = res.deployments[0];

    // 2. Trigger redeploy
    const deployRes = await vercel.deployments.createDeployment({
      requestBody: {
        name: latest.name,
        deploymentId: latest.uid,
        target: "production",
      }
    });

    // Extract the URL
    // The Vercel SDK creates a new deployment and returns the URL.
    const url = deployRes?.url 
      ? `https://${deployRes.url}` 
      : deployRes?.alias?.[0] 
        ? `https://${deployRes.alias[0]}` 
        : null;

    return { 
      success: true, 
      url: url,
      deploymentId: deployRes?.id
    };
  } catch (error: any) {
    console.error("Vercel Deploy Error:", error);
    return { success: false, error: error.message || "Failed to trigger deployment on Vercel." };
  }
}
