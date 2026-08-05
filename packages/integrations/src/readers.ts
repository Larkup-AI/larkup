import { getIntegration } from './catalog.js';
import type {
  IntegrationDocument,
  IntegrationId,
  IntegrationReader,
  IntegrationResource,
} from './types.js';

type Json = Record<string, any>;

async function atlassianCloudsWithScope(
  token: string,
  scope: string,
  product: 'Jira' | 'Confluence',
): Promise<Json[]> {
  const clouds = (await requestJson(
    'https://api.atlassian.com/oauth/token/accessible-resources',
    token,
  )) as unknown as Json[];
  const matchingClouds = clouds.filter(
    (cloud) => !Array.isArray(cloud.scopes) || cloud.scopes.includes(scope),
  );
  if (!matchingClouds.length)
    throw new Error(
      `No ${product} site with the required access is available. Ask a site admin for ${product} access, then reconnect.`,
    );
  return matchingClouds;
}

async function requestJson(url: string, token: string, init: RequestInit = {}): Promise<Json> {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...init.headers },
  });
  if (!response.ok)
    throw new Error(`Integration request failed (${response.status}): ${await response.text()}`);
  return response.json() as Promise<Json>;
}

const readers: Record<IntegrationId, IntegrationReader> = {
  notion: {
    async listResources(token) {
      const data = await requestJson('https://api.notion.com/v1/search', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
        body: JSON.stringify({ page_size: 100 }),
      });
      return (data.results ?? [])
        .filter((item: Json) => item.object === 'page')
        .map((page: Json) => ({
          id: page.id,
          title: notionTitle(page),
          url: page.url,
          updatedAt: page.last_edited_time,
          kind: 'page',
        }));
    },
    async getResource(token, resource) {
      const blocks = await requestJson(
        `https://api.notion.com/v1/blocks/${resource.id}/children?page_size=100`,
        token,
        { headers: { 'Notion-Version': '2022-06-28' } },
      );
      return {
        ...resource,
        content: (blocks.results ?? []).map(notionBlockText).filter(Boolean).join('\n'),
      };
    },
  },
  'google-analytics': {
    async listResources(token) {
      const data = await requestJson(
        'https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200',
        token,
      );
      return (data.accountSummaries ?? []).flatMap((account: Json) =>
        (account.propertySummaries ?? []).map((property: Json) => ({
          id: property.property,
          title: `${account.displayName ?? 'Google Analytics'} · ${
            property.displayName ?? property.property
          }`,
          kind: 'property',
          metadata: { propertyName: property.property },
        })),
      );
    },
    async getResource(token, resource) {
      const propertyName = resource.metadata?.propertyName ?? resource.id;
      const data = await requestJson(
        `https://analyticsdata.googleapis.com/v1beta/${propertyName}:runReport`,
        token,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
            dimensions: [{ name: 'pageTitle' }, { name: 'pagePath' }],
            metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }],
            limit: 100,
          }),
        },
      );
      const headers = [
        ...(data.dimensionHeaders ?? []).map((header: Json) => header.name),
        ...(data.metricHeaders ?? []).map((header: Json) => header.name),
      ];
      const rows = (data.rows ?? []).map((row: Json) => [
        ...(row.dimensionValues ?? []).map((value: Json) => value.value ?? ''),
        ...(row.metricValues ?? []).map((value: Json) => value.value ?? ''),
      ]);
      return { ...resource, content: toTable(headers, rows) };
    },
  },
  'google-calendar': {
    async listResources(token) {
      const params = new URLSearchParams({
        maxResults: '100',
        orderBy: 'startTime',
        singleEvents: 'true',
        timeMin: new Date().toISOString(),
      });
      const data = await requestJson(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
        token,
      );
      return (data.items ?? []).map((event: Json) => ({
        id: event.id,
        title: event.summary || 'Untitled event',
        url: event.htmlLink,
        updatedAt: event.updated,
        kind: 'event',
      }));
    },
    async getResource(token, resource) {
      const data = await requestJson(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(
          resource.id,
        )}`,
        token,
      );
      return {
        ...resource,
        content: [
          `Title: ${data.summary ?? resource.title}`,
          data.start?.dateTime || data.start?.date
            ? `Start: ${data.start.dateTime ?? data.start.date}`
            : '',
          data.end?.dateTime || data.end?.date ? `End: ${data.end.dateTime ?? data.end.date}` : '',
          data.location ? `Location: ${data.location}` : '',
          data.description ? `Description:\n${data.description}` : '',
          (data.attendees ?? []).length
            ? `Attendees: ${(data.attendees as Json[])
                .map((attendee) => attendee.email)
                .filter(Boolean)
                .join(', ')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
      };
    },
  },
  'google-docs': googleWorkspaceReader(
    "mimeType = 'application/vnd.google-apps.document'",
    'document',
    async (token, resource) => {
      const document = await requestJson(
        `https://docs.googleapis.com/v1/documents/${encodeURIComponent(resource.id)}`,
        token,
      );
      return documentText(document.body?.content ?? []);
    },
  ),
  'google-drive': {
    async listResources(token) {
      const data = await requestJson(
        'https://www.googleapis.com/drive/v3/files?pageSize=100&orderBy=modifiedTime%20desc&fields=files(id,name,mimeType,modifiedTime,webViewLink)',
        token,
      );
      return (data.files ?? [])
        .filter((file: Json) => file.mimeType !== 'application/vnd.google-apps.folder')
        .map((file: Json) => ({
          id: file.id,
          title: file.name,
          url: file.webViewLink,
          updatedAt: file.modifiedTime,
          kind: file.mimeType,
          metadata: { mimeType: file.mimeType },
        }));
    },
    async getResource(token, resource) {
      const mimeType = resource.metadata?.mimeType ?? '';
      if (mimeType === 'application/vnd.google-apps.document')
        return downloadGoogleExport(token, resource, 'text/plain');
      if (mimeType === 'application/vnd.google-apps.spreadsheet')
        return downloadGoogleExport(token, resource, 'text/csv');
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${resource.id}?alt=media`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!response.ok) throw new Error(`Google Drive download failed (${response.status})`);
      return { ...resource, content: await response.text() };
    },
  },
  'google-maps': googleWorkspaceReader(
    "mimeType = 'application/vnd.google-apps.map'",
    'map',
    async (token, resource) => {
      const map = await requestJson(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          resource.id,
        )}?fields=id,name,description,createdTime,modifiedTime,webViewLink`,
        token,
      );
      return [
        `Map: ${map.name ?? resource.title}`,
        map.description ? `Description: ${map.description}` : '',
        map.createdTime ? `Created: ${map.createdTime}` : '',
        map.modifiedTime ? `Updated: ${map.modifiedTime}` : '',
        map.webViewLink ? `Open in Google My Maps: ${map.webViewLink}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    },
  ),
  'google-meet': {
    async listResources(token) {
      const data = await requestJson(
        'https://meet.googleapis.com/v2/conferenceRecords?pageSize=100',
        token,
      );
      return (data.conferenceRecords ?? []).map((record: Json) => ({
        id: record.name,
        title: `Google Meet · ${record.startTime ?? record.name}`,
        updatedAt: record.endTime ?? record.startTime,
        kind: 'conference',
      }));
    },
    async getResource(token, resource) {
      const record = await requestJson(`https://meet.googleapis.com/v2/${resource.id}`, token);
      return {
        ...resource,
        content: [
          `Conference: ${record.name ?? resource.id}`,
          record.startTime ? `Started: ${record.startTime}` : '',
          record.endTime ? `Ended: ${record.endTime}` : '',
          record.space ? `Meeting space: ${record.space}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      };
    },
  },
  'google-sheets': googleWorkspaceReader(
    "mimeType = 'application/vnd.google-apps.spreadsheet'",
    'spreadsheet',
    async (token, resource) => {
      const spreadsheet = await requestJson(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
          resource.id,
        )}?includeGridData=true&fields=properties(title),sheets(properties(title),data(rowData(values(formattedValue))))`,
        token,
      );
      return (spreadsheet.sheets ?? [])
        .map((sheet: Json) => {
          const rows = (sheet.data ?? []).flatMap((grid: Json) =>
            (grid.rowData ?? []).map((row: Json) =>
              (row.values ?? []).map((value: Json) => value.formattedValue ?? ''),
            ),
          );
          return `# ${sheet.properties?.title ?? 'Sheet'}\n${toTable([], rows)}`;
        })
        .join('\n\n');
    },
  ),
  'google-slides': googleWorkspaceReader(
    "mimeType = 'application/vnd.google-apps.presentation'",
    'presentation',
    async (token, resource) => {
      const presentation = await requestJson(
        `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(resource.id)}`,
        token,
      );
      return (presentation.slides ?? [])
        .map((slide: Json, index: number) => {
          const text = (slide.pageElements ?? [])
            .flatMap((element: Json) => element.shape?.text?.textElements ?? [])
            .flatMap((element: Json) => element.textRun?.content ?? [])
            .join('')
            .trim();
          return `# Slide ${index + 1}\n${text}`;
        })
        .join('\n\n');
    },
  ),
  jira: {
    async listResources(token) {
      const clouds = await atlassianCloudsWithScope(token, 'read:jira-work', 'Jira');
      const resources = await Promise.all(
        clouds.map(async (cloud) => {
          try {
            const data = await requestJson(
              `https://api.atlassian.com/ex/jira/${
                cloud.id
              }/rest/api/3/search/jql?jql=${encodeURIComponent(
                'ORDER BY updated DESC',
              )}&maxResults=100&fields=summary,status,updated,project`,
              token,
            );
            return (data.issues ?? []).map((issue: Json) => ({
              id: `${cloud.id}:${issue.id}`,
              title: `${issue.key}: ${issue.fields?.summary ?? 'Untitled issue'}`,
              url: cloud.url ? `${cloud.url}/browse/${issue.key}` : undefined,
              updatedAt: issue.fields?.updated,
              kind: issue.fields?.status?.name ?? 'issue',
              metadata: { cloudId: cloud.id },
            }));
          } catch {
            return [];
          }
        }),
      );
      return resources.flat();
    },
    async getResource(token, resource) {
      const cloudId = resource.metadata?.cloudId ?? resource.id.split(':')[0];
      const issueId = resource.id.split(':').slice(1).join(':');
      const issue = await requestJson(
        `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${encodeURIComponent(
          issueId,
        )}?fields=summary,description,status,project,issuetype,updated,comment`,
        token,
      );
      const fields = issue.fields ?? {};
      const comments = (fields.comment?.comments ?? [])
        .map((comment: Json) => atlassianDocumentText(comment.body))
        .filter(Boolean)
        .join('\n\n');
      return {
        ...resource,
        content: [
          `Issue: ${issue.key ?? resource.title}`,
          fields.project?.name ? `Project: ${fields.project.name}` : '',
          fields.issuetype?.name ? `Type: ${fields.issuetype.name}` : '',
          fields.status?.name ? `Status: ${fields.status.name}` : '',
          fields.updated ? `Updated: ${fields.updated}` : '',
          atlassianDocumentText(fields.description),
          comments ? `Comments:\n${comments}` : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
      };
    },
  },
  linear: {
    async listResources(token) {
      const data = await linearQuery(
        token,
        '{ issues(first: 100) { nodes { id identifier title updatedAt url state { name } } } }',
      );
      return (data.issues?.nodes ?? []).map((issue: Json) => ({
        id: issue.id,
        title: `${issue.identifier ?? 'Issue'}: ${issue.title ?? 'Untitled issue'}`,
        url: issue.url,
        updatedAt: issue.updatedAt,
        kind: issue.state?.name ?? 'issue',
      }));
    },
    async getResource(token, resource) {
      const data = await linearQuery(
        token,
        `query { issue(id: ${JSON.stringify(
          resource.id,
        )}) { identifier title description updatedAt url state { name } project { name } comments(first: 50) { nodes { body user { name } } } } }`,
      );
      const issue = data.issue ?? {};
      const comments = (issue.comments?.nodes ?? [])
        .map((comment: Json) => `${comment.user?.name ?? 'Unknown'}: ${comment.body ?? ''}`)
        .filter(Boolean)
        .join('\n');
      return {
        ...resource,
        content: [
          `Issue: ${issue.identifier ?? resource.title}`,
          issue.project?.name ? `Project: ${issue.project.name}` : '',
          issue.state?.name ? `Status: ${issue.state.name}` : '',
          issue.updatedAt ? `Updated: ${issue.updatedAt}` : '',
          issue.description ?? '',
          comments ? `Comments:\n${comments}` : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
      };
    },
  },
  slack: {
    async listResources(token) {
      const data = await requestJson(
        'https://slack.com/api/conversations.list?types=public_channel,private_channel&exclude_archived=true&limit=100',
        token,
      );
      if (!data.ok) throw new Error(data.error ?? 'Slack request failed');
      return (data.channels ?? []).map((channel: Json) => ({
        id: channel.id,
        title: `#${channel.name}`,
        kind: 'channel',
        metadata: { channelName: channel.name },
      }));
    },
    async getResource(token, resource) {
      const data = await requestJson(
        `https://slack.com/api/conversations.history?channel=${encodeURIComponent(
          resource.id,
        )}&limit=100`,
        token,
      );
      if (!data.ok) throw new Error(data.error ?? 'Slack request failed');
      return {
        ...resource,
        content: (data.messages ?? [])
          .map((message: Json) => `${message.user ?? 'Unknown'}: ${message.text ?? ''}`)
          .join('\n'),
      };
    },
  },
  github: {
    async listResources(token) {
      const data = await requestJson(
        'https://api.github.com/user/repos?per_page=100&sort=updated',
        token,
        { headers: { 'X-GitHub-Api-Version': '2022-11-28' } },
      );
      return (data as unknown as Json[]).map((repo) => ({
        id: repo.full_name,
        title: repo.full_name,
        url: repo.html_url,
        updatedAt: repo.updated_at,
        kind: 'repository',
        metadata: { defaultBranch: repo.default_branch ?? 'HEAD' },
      }));
    },
    async getResource(token, resource) {
      const response = await fetch(`https://api.github.com/repos/${resource.id}/readme`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.raw+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      if (!response.ok) throw new Error(`GitHub README request failed (${response.status})`);
      return { ...resource, content: await response.text() };
    },
  },
  confluence: {
    async listResources(token) {
      const [cloud] = await atlassianCloudsWithScope(
        token,
        'read:confluence-content.all',
        'Confluence',
      );
      const cloudId = cloud.id;
      const data = await requestJson(
        `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/rest/api/content?type=page&limit=100&expand=version,space`,
        token,
      );
      return (data.results ?? []).map((page: Json) => ({
        id: `${cloudId}:${page.id}`,
        title: page.title,
        url: page._links?.base ? `${page._links.base}${page._links.webui}` : undefined,
        updatedAt: page.version?.when,
        kind: 'page',
      }));
    },
    async getResource(token, resource) {
      const [cloudId, pageId] = resource.id.split(':');
      const data = await requestJson(
        `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/rest/api/content/${pageId}?expand=body.storage`,
        token,
      );
      return { ...resource, content: stripHtml(data.body?.storage?.value ?? '') };
    },
  },
};

function googleWorkspaceReader(
  query: string,
  kind: string,
  readContent: (token: string, resource: IntegrationResource) => Promise<string>,
): IntegrationReader {
  return {
    async listResources(token) {
      const params = new URLSearchParams({
        q: query,
        pageSize: '100',
        orderBy: 'modifiedTime desc',
        fields: 'files(id,name,modifiedTime,webViewLink)',
      });
      const data = await requestJson(
        `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
        token,
      );
      return (data.files ?? []).map((file: Json) => ({
        id: file.id,
        title: file.name,
        url: file.webViewLink,
        updatedAt: file.modifiedTime,
        kind,
      }));
    },
    async getResource(token, resource) {
      return { ...resource, content: await readContent(token, resource) };
    },
  };
}

function toTable(headers: string[], rows: string[][]): string {
  const lines = headers.length ? [headers.join('\t')] : [];
  return lines.concat(rows.map((row) => row.join('\t'))).join('\n');
}

function documentText(content: Json[]): string {
  return content
    .flatMap((element) => {
      const paragraph = (element.paragraph?.elements ?? [])
        .map((item: Json) => item.textRun?.content ?? '')
        .join('');
      const table = (element.table?.tableRows ?? []).flatMap((row: Json) =>
        (row.tableCells ?? []).map((cell: Json) => documentText(cell.content ?? [])),
      );
      return [paragraph, table.length ? table.join('\t') : ''];
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function atlassianDocumentText(value: Json | undefined): string {
  if (!value) return '';
  const ownText = typeof value.text === 'string' ? value.text : '';
  const children = Array.isArray(value.content)
    ? value.content
        .map((child: Json) => atlassianDocumentText(child))
        .filter(Boolean)
        .join('\n')
    : '';
  return [ownText, children].filter(Boolean).join(ownText && children ? '\n' : '');
}

async function linearQuery(token: string, query: string): Promise<Json> {
  const response = await requestJson('https://api.linear.app/graphql', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (response.errors?.length) {
    throw new Error(`Linear request failed: ${response.errors[0]?.message ?? 'unknown error'}`);
  }
  return response.data ?? {};
}

export function getIntegrationReader(id: string): IntegrationReader | undefined {
  return getIntegration(id) ? readers[id as IntegrationId] : undefined;
}

function notionTitle(page: Json): string {
  for (const property of Object.values(page.properties ?? {}) as Json[])
    if (property.type === 'title')
      return (
        (property.title ?? []).map((part: Json) => part.plain_text ?? '').join('') || 'Untitled'
      );
  return 'Untitled';
}

function notionBlockText(block: Json): string {
  const content = block[block.type]?.rich_text ?? [];
  const text = content.map((part: Json) => part.plain_text ?? '').join('');
  if (block.type?.startsWith('heading_'))
    return `${'#'.repeat(Number(block.type.at(-1)) || 1)} ${text}`;
  return text;
}

async function downloadGoogleExport(
  token: string,
  resource: IntegrationResource,
  mimeType: string,
): Promise<IntegrationDocument> {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${resource.id}/export?mimeType=${encodeURIComponent(
      mimeType,
    )}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) throw new Error(`Google Drive export failed (${response.status})`);
  return { ...resource, content: await response.text() };
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
