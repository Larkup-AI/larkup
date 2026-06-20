export function formatErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("Is the docker daemon running?")) {
    return "Docker is not running. Please make sure the Docker daemon is started.";
  }

  if (message.includes("fetch failed") || message.includes("Failed to fetch")) {
    return "Network error. Please check your connection and try again.";
  }

  // Add more common error mappings here as needed

  return message;
}
