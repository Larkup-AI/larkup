/**
 * JSON Schemas for tool.manifest.json files, served at
 * https://hub.larkup.de/schemas/tool-manifest.v{1,2}.json — the exact URLs
 * referenced by each tool's `$schema` field. Defined as TS objects (rather
 * than reading the `public/` copies) because the Hub's Hono app owns every
 * request path once deployed, so serving them from an explicit route is what
 * actually resolves regardless of static-file/rewrite ordering.
 */

const configSchemaEntryV1 = {
  type: 'object',
  required: ['key', 'label', 'type'],
  properties: {
    key: { type: 'string' },
    label: { type: 'string' },
    type: { enum: ['text', 'password', 'select', 'toggle'] },
    defaultValue: { type: 'string' },
    help: { type: 'string' },
    required: { type: 'boolean' },
    providerField: { type: 'string' },
    defaultValueByProvider: {
      type: 'object',
      additionalProperties: { type: 'string' },
    },
    globalConfigKey: { enum: ['visionProvider', 'chatProvider'] },
    defaultFromGlobalConfigKey: { enum: ['visionProvider', 'chatProvider'] },
    options: {
      type: 'array',
      items: {
        type: 'object',
        required: ['label', 'value'],
        properties: {
          label: { type: 'string' },
          value: { type: 'string' },
        },
      },
    },
  },
};

export const toolManifestV1Schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://hub.larkup.de/schemas/tool-manifest.v1.json',
  title: 'Larkup Tool Manifest',
  type: 'object',
  required: [
    'id',
    'name',
    'description',
    'category',
    'version',
    'pricing',
    'icon',
    'packageName',
    'installSize',
    'author',
    'capabilities',
  ],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    longDescription: { type: 'string' },
    category: { type: 'string' },
    version: { type: 'string' },
    pricing: { type: 'string' },
    distribution: {
      enum: ['public', 'private'],
      default: 'public',
      description: 'Whether the Hub lists the tool publicly or only for granted workspaces.',
    },
    emoji: { type: 'string' },
    iconUrl: { type: 'string' },
    icon: { type: 'string' },
    packageName: { type: 'string' },
    installSize: { type: 'string' },
    systemDeps: { type: 'array', items: { type: 'string' } },
    requiresSandbox: {
      type: 'boolean',
      default: true,
      description:
        'Whether the tool must execute in an isolated sandbox. Defaults to true; set false only for host-safe tools.',
    },
    author: { type: 'string' },
    capabilities: { type: 'array', items: { type: 'string' } },
    tags: { type: 'array', items: { type: 'string' } },
    downloads: { type: 'integer' },
    repositoryUrl: { type: 'string' },
    license: { type: 'string' },
    changelog: { type: 'string' },
    minLarkupVersion: { type: 'string' },
    updatedAt: { type: 'string' },
    comingSoon: { type: 'boolean' },
    configSchema: { type: 'array', items: configSchemaEntryV1 },
  },
};

const configSchemaEntryV2 = {
  ...configSchemaEntryV1,
  properties: {
    ...configSchemaEntryV1.properties,
    group: { type: 'string', description: 'Settings-page grouping label for this field.' },
    layout: { enum: ['full', 'half'], description: 'Column width hint on the settings page.' },
    verification: {
      type: 'object',
      required: ['endpoint'],
      properties: {
        endpoint: { type: 'string' },
        method: { enum: ['POST', 'PUT'] },
        fields: { type: 'object', additionalProperties: { type: 'string' } },
      },
      description: 'Declarative verification request. Omit to hide Verify.',
    },
    visibleWhen: {
      type: 'object',
      required: ['field', 'equals'],
      properties: {
        field: { type: 'string' },
        equals: { anyOf: [{ type: 'string' }, { type: 'boolean' }, { type: 'array' }] },
      },
      description: 'Shows this setting only for matching values in another setting.',
    },
  },
};

export const toolManifestV2Schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://hub.larkup.de/schemas/tool-manifest.v2.json',
  title: 'Larkup Tool Manifest (v2)',
  description:
    'Adds manifestVersion/kind, a trustLevel, and a declared permissions block to the v1 manifest shape.',
  type: 'object',
  required: [...toolManifestV1Schema.required, 'manifestVersion', 'kind'],
  properties: {
    ...toolManifestV1Schema.properties,
    manifestVersion: { type: 'string', const: '2.0' },
    kind: { enum: ['tool'] },
    configSchema: { type: 'array', items: configSchemaEntryV2 },
    trustLevel: {
      enum: ['sandboxed', 'elevated'],
      description:
        'Declares whether the tool needs elevated host permissions beyond the sandbox default.',
    },
    permissions: {
      type: 'object',
      description: 'Capabilities the tool requires when trustLevel is "elevated".',
      properties: {
        fsRead: { type: 'boolean' },
        fsWrite: { type: 'boolean' },
        exec: { type: 'boolean' },
        httpAllow: {
          type: 'array',
          items: { type: 'string' },
          description: 'Allowlisted outbound hostnames.',
        },
      },
    },
  },
};

export const toolManifestV3Schema = {
  ...toolManifestV2Schema,
  $id: 'https://hub.larkup.de/schemas/tool-manifest.v3.json',
  title: 'Larkup Tool Manifest (v3)',
  description:
    'Adds portable runtime modes, lazy extension entrypoints, UI surfaces, and provider-neutral billing meters.',
  properties: {
    ...toolManifestV2Schema.properties,
    manifestVersion: { type: 'string', const: '3.0' },
    entrypoints: {
      type: 'object',
      required: ['server'],
      properties: {
        server: { type: 'string' },
        agent: { type: 'string' },
        ui: { type: 'string' },
      },
    },
    runtime: {
      type: 'object',
      required: ['protocolVersion', 'defaultMode', 'modes'],
      properties: {
        protocolVersion: { type: 'string' },
        defaultMode: {
          enum: ['local', 'local-docker', 'local-process', 'managed-cloud', 'custom-remote'],
        },
        healthPath: { type: 'string' },
        modes: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['id', 'label', 'description'],
            properties: {
              id: {
                enum: ['local', 'local-docker', 'local-process', 'managed-cloud', 'custom-remote'],
              },
              label: { type: 'string' },
              description: { type: 'string' },
              endpointConfigKey: { type: 'string' },
              credentialConfigKey: { type: 'string' },
              image: { type: 'string' },
              composeFile: { type: 'string' },
              requiresGpu: { type: 'boolean' },
            },
          },
        },
      },
    },
    billing: {
      type: 'object',
      required: ['model', 'meters', 'entitlementVersion'],
      properties: {
        model: { enum: ['free', 'subscription', 'usage', 'hybrid'] },
        entitlementVersion: { type: 'string' },
        meters: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'unit', 'description'],
            properties: {
              id: { type: 'string' },
              unit: { type: 'string' },
              description: { type: 'string' },
            },
          },
        },
      },
    },
    usage: {
      type: 'object',
      required: ['fields'],
      properties: {
        label: { type: 'string' },
        fields: {
          type: 'array',
          items: {
            type: 'object',
            required: ['key', 'label'],
            properties: {
              key: { type: 'string' },
              label: { type: 'string' },
              format: { enum: ['number', 'minutes'] },
            },
          },
        },
      },
    },
    ui: {
      type: 'object',
      required: ['isolation', 'surfaces'],
      properties: {
        isolation: { enum: ['sandboxed-iframe', 'host'] },
        surfaces: { type: 'array' },
      },
    },
  },
};
