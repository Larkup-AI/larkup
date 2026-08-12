/**
 * Renderer for the allow-listed output protocol.
 *
 * Plan §4.4 / ADR-005: a marketplace tool contributes *data*, never markup or
 * code. Everything a tool can put on a customer's page passes through this
 * switch, and an unrecognized block renders as nothing. That is the whole
 * security model for third-party UI in the widget — keep it that way.
 */

import type { WidgetBlock } from '../types';
import { AlertIcon, CheckIcon, FileIcon, LinkIcon, SpinnerIcon } from './icons';

function StatusBlock({ block }: { block: Extract<WidgetBlock, { type: 'status' }> }) {
  const Icon =
    block.state === 'done' ? CheckIcon : block.state === 'error' ? AlertIcon : SpinnerIcon;
  return (
    <div className="lk-block">
      <div className={`lk-block-status lk-block-status--${block.state}`}>
        <Icon className={block.state === 'running' ? 'lk-spin' : undefined} />
        <span>
          {block.label}
          {block.state === 'running' ? '…' : ''}
        </span>
      </div>
    </div>
  );
}

function CitationBlock({ block }: { block: Extract<WidgetBlock, { type: 'citation' }> }) {
  const content = (
    <>
      <LinkIcon />
      <span>{block.label}</span>
    </>
  );

  return (
    <div className="lk-block">
      {block.url ? (
        // `noopener noreferrer` is mandatory: the link opens on a page we do not
        // control, and `target=_blank` without it hands over `window.opener`.
        <a className="lk-citation" href={block.url} target="_blank" rel="noopener noreferrer">
          {content}
        </a>
      ) : (
        <div className="lk-citation">{content}</div>
      )}
    </div>
  );
}

function FileBlock({ block }: { block: Extract<WidgetBlock, { type: 'file' }> }) {
  const label = block.label ?? block.url.split('/').pop() ?? 'File';
  return (
    <div className="lk-block">
      <a className="lk-citation" href={block.url} target="_blank" rel="noopener noreferrer">
        <FileIcon />
        <span>{label}</span>
      </a>
    </div>
  );
}

function TableBlock({ block }: { block: Extract<WidgetBlock, { type: 'table' }> }) {
  // Long results are truncated rather than allowed to grow the panel without
  // bound; the widget is a chat bubble, not a data grid.
  const rows = block.rows.slice(0, 25);
  return (
    <div className="lk-block">
      <div className="lk-table-scroll">
        <table>
          <thead>
            <tr>
              {block.columns.map((column, i) => (
                <th key={`${column}-${i}`}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell === null ? '—' : String(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {block.rows.length > rows.length && (
        <div className="lk-block-label">+{block.rows.length - rows.length} more rows</div>
      )}
    </div>
  );
}

function DataBlock({ block }: { block: Extract<WidgetBlock, { type: 'data' }> }) {
  let json: string;
  try {
    json = JSON.stringify(block.json, null, 2) ?? String(block.json);
  } catch {
    json = '[unserializable]';
  }
  return (
    <div className="lk-block">
      <div className="lk-block-label">{block.label}</div>
      <pre>{json.slice(0, 2000)}</pre>
    </div>
  );
}

export function OutputBlock({ block }: { block: WidgetBlock }) {
  switch (block.type) {
    case 'status':
      return <StatusBlock block={block} />;
    case 'citation':
      return <CitationBlock block={block} />;
    case 'file':
      return <FileBlock block={block} />;
    case 'table':
      return <TableBlock block={block} />;
    case 'data':
      return <DataBlock block={block} />;
    default:
      return null;
  }
}
