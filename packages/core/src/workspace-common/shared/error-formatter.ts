export function formatErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (
    normalized.includes('authentication failed') ||
    normalized.includes('invalid api key') ||
    normalized.includes('invalid api_key') ||
    normalized.includes('invalid token') ||
    normalized.includes('unauthorized') ||
    normalized.includes('status code 401')
  ) {
    return 'Authentication failed. Check the API key for the selected provider.';
  }

  if (message.includes('Is the docker daemon running?')) {
    return 'Docker is not running. Please make sure the Docker daemon is started.';
  }

  if (message.includes('fetch failed') || message.includes('Failed to fetch')) {
    return 'Network error. Please check your connection and try again.';
  }

  return message;
}
