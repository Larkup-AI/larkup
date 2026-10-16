import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ChatEmptyState,
  ChatUserBubble,
  TextSourceFields,
  WorkspaceLineTabs,
  WorkspaceSettingsLayout,
  SourceUploadDropzone,
  Table,
  TableBody,
  TableCell,
  TableRow,
} from '../src/index.js';

test('Cloud can omit Local-only navigation without forking the layout', () => {
  const Icon = () => <svg />;
  const html = renderToStaticMarkup(
    <WorkspaceSettingsLayout
      groups={[
        {
          label: 'Project',
          items: [
            { id: 'models', label: 'AI Models', icon: Icon },
            { id: 'marketplace', label: 'Marketplace', icon: Icon, hidden: true },
          ],
        },
      ]}
      activeId="models"
      onSelect={() => {}}
    >
      Encrypted Cloud credentials form
    </WorkspaceSettingsLayout>,
  );
  assert.match(html, /AI Models/);
  assert.doesNotMatch(html, /Marketplace/);
  assert.match(html, /Encrypted Cloud credentials form/);
});

test('source tabs expose the active item and preserve the host action slot', () => {
  const html = renderToStaticMarkup(
    <WorkspaceLineTabs
      items={[
        { id: 'text', label: 'Text' },
        { id: 'file', label: 'Files' },
      ]}
      activeId="text"
      onChange={() => {}}
      trailing={<button>Add text</button>}
    />,
  );
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
  assert.match(html, /Add text/);
});

test('shared text form keeps native form names, labels and escaped content', () => {
  const html = renderToStaticMarkup(
    <TextSourceFields
      title="Notes"
      content="<script>example</script>"
      onTitleChange={() => {}}
      onContentChange={() => {}}
    />,
  );
  assert.match(html, /name="name"/);
  assert.match(html, /name="content"/);
  assert.match(html, /for="paste-content"/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test('dropzone supports host capabilities and never submits its surrounding form', () => {
  const html = renderToStaticMarkup(
    <SourceUploadDropzone description="Cloud video upload" dragging />,
  );
  assert.match(html, /type="button"/);
  assert.match(html, /Cloud video upload/);
  assert.match(html, /border-primary/);
});

test('chat presentation is shared without runtime or provider dependencies', () => {
  const html = renderToStaticMarkup(
    <>
      <ChatEmptyState action={<a href="/add">Add data</a>} />
      <ChatUserBubble>Hello</ChatUserBubble>
    </>,
  );
  assert.match(html, /Chat with your knowledge base/);
  assert.match(html, /href="\/add"/);
  assert.match(html, /Hello/);
});

test('document tables keep semantic markup and host-provided actions', () => {
  const html = renderToStaticMarkup(
    <Table>
      <TableBody>
        <TableRow>
          <TableCell>Handbook</TableCell>
          <TableCell>
            <button>Inspect document</button>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>,
  );
  assert.match(html, /<table/);
  assert.match(html, /<tbody/);
  assert.match(html, /Inspect document/);
});
