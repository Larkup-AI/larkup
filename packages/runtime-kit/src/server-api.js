/**
 * Shared public Agent Server contract.
 *
 * Hosts are responsible for authentication, tenancy, and implementing these
 * operations; this module deliberately contains no credentials or storage
 * implementation.
 */
export function serverOpenApiDocument(profile = 'agent') {
  const isAgent = profile === 'agent';
  const bearer = [{ bearerAuth: [] }];
  const operation = (summary, tags, extra = {}) => ({
    summary,
    tags,
    security: bearer,
    responses: { 200: { description: 'Successful response' } },
    ...extra,
  });
  const knowledge = ['Knowledge'];
  const agent = ['Agent'];
  return {
    openapi: '3.1.0',
    info: {
      title: isAgent ? 'Larkup Agent Server' : 'Larkup Knowledge Server',
      version: '1.0.0',
      description: isAgent
        ? 'Knowledge-base operations plus an AI SDK-compatible Agent API.'
        : 'Knowledge-base retrieval and content-management API.',
    },
    security: bearer,
    tags: [
      { name: 'Knowledge', description: 'Knowledge base retrieval and management.' },
      ...(isAgent
        ? [{ name: 'Agent', description: 'Agent chat streaming and loaded tools.' }]
        : []),
    ],
    paths: {
      '/query': { post: operation('Query the RAG knowledge base', knowledge) },
      '/chat': {
        post: operation(
          isAgent ? 'Stream an Agent chat response' : 'Stream a retrieval-grounded chat response',
          isAgent ? agent : knowledge,
        ),
      },
      '/documents': {
        get: operation('List documents (paginated)', knowledge),
        post: operation('Add a new document', knowledge),
      },
      '/documents/{id}': {
        get: operation('Get a single document by ID', knowledge),
        put: operation('Update a document', knowledge),
        delete: operation('Delete a document', knowledge),
      },
      '/scrape': { post: operation('Scrape a URL and ingest into the corpus', knowledge) },
      '/health': {
        get: {
          summary: 'Health check',
          tags: knowledge,
          responses: { 200: { description: 'OK' } },
        },
      },
      '/models': {
        get: operation('List chat providers and models available to this runtime', knowledge),
      },
      '/readiness': {
        get: {
          summary: 'Check knowledge-store readiness',
          tags: knowledge,
          responses: {
            200: { description: 'Knowledge store is connected' },
            503: { description: 'Knowledge store is unavailable' },
          },
        },
      },
      '/corpus/summary': { get: operation('Get corpus summary statistics', knowledge) },
      '/corpus': { post: operation('Get corpus documents with optional filtering', knowledge) },
      '/corpus/export': { post: operation('Export full corpus as CSV or JSONL', knowledge) },
      ...(isAgent
        ? {
            '/agent': { get: operation('Get Agent Runtime information', agent) },
            '/agent/tools': { get: operation('List tools loaded by the Agent', agent) },
            '/agent/capabilities': { get: operation('List grouped Agent capabilities', agent) },
            '/agent/configuration': { get: operation('Get saved Agent prompt and skills', agent) },
            '/agent/sandbox': {
              get: operation('Check the configured Agent sandbox environment', agent),
            },
            '/agent/chat': {
              post: operation(
                'Stream an Agent response using the AI SDK UI message protocol',
                agent,
              ),
            },
            '/v1/chat/completions': {
              post: operation('OpenAI-compatible Agent chat completions', agent),
            },
          }
        : {}),
    },
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
  };
}

export function scalarReferenceHtml() {
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Larkup Server API</title><style>:root{--scalar-color-1:#000;--scalar-color-2:#333;--scalar-color-3:#666;--scalar-color-accent:#000;--scalar-background-1:#fff;--scalar-background-2:#fafafa;--scalar-background-3:#f5f5f5;--scalar-background-accent:#f0f0f0}</style></head><body><script id="api-reference" data-url="/openapi.json"></script><script>document.getElementById("api-reference").dataset.configuration=JSON.stringify({theme:"default",hideClientButton:false,showSidebar:true,showDeveloperTools:"localhost",showToolbar:"localhost",operationTitleSource:"summary",persistAuth:true,telemetry:true,externalUrls:{dashboardUrl:"https://dashboard.scalar.com",registryUrl:"https://registry.scalar.com",proxyUrl:"https://proxy.scalar.com",apiBaseUrl:"https://api.scalar.com"},layout:"modern",isEditable:false,isLoading:false,hideModels:false,documentDownloadType:"both",hideTestRequestButton:false,hideSearch:false,showOperationId:false,hideDarkModeToggle:false,withDefaultFonts:true,defaultOpenFirstTag:true,defaultOpenAllTags:false,expandAllModelSections:false,expandAllResponses:false,orderSchemaPropertiesBy:"alpha",orderRequiredPropertiesFirst:true,modelsSectionLabel:"Models",authentication:{preferredSecurityScheme:"bearerAuth",http:{basic:{username:"",password:""},bearer:{token:""}}}})</script><script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script></body></html>';
}
