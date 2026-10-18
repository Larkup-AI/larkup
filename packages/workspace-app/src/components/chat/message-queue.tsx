'use client';

import { ChevronUp, ChevronDown, Trash2, Paperclip } from 'lucide-react';

export interface QueuedMessage {
  id: string;
  text: string;
  files?: File[];
}

interface MessageQueueProps {
  items: QueuedMessage[];
  onRemove: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onEdit: (id: string) => void;
}

export function MessageQueue({ items, onRemove, onMoveUp, onMoveDown, onEdit }: MessageQueueProps) {
  if (items.length === 0) return null;

  return (
    <div className="mx-auto mb-2 w-full max-w-3xl overflow-hidden rounded-2xl border border-border bg-card">
      <div className="border-b border-border/60 px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          {items.length} queued message{items.length > 1 ? 's' : ''}
        </span>
      </div>
      <ul className="max-h-40 overflow-y-auto scrollbar-none [&::-webkit-scrollbar]:hidden">
        {items.map((item, index) => (
          <li
            key={item.id}
            className="group flex items-start gap-2 border-border/40 px-3 py-2 text-sm transition-colors last:border-b-0 hover:bg-secondary"
          >
            <button
              type="button"
              onClick={() => onEdit(item.id)}
              className="min-w-0 flex-1 cursor-pointer text-left"
              title="Click to edit"
            >
              <p className="line-clamp-2 break-words text-foreground">
                {item.text || '(attachment only)'}
              </p>
              {item.files && item.files.length > 0 && (
                <div className="mt-1 flex items-center gap-1 text-muted-foreground">
                  <Paperclip className="size-3 shrink-0" />
                  <span className="truncate text-xs">
                    {item.files.map((f) => f.name).join(', ')}
                  </span>
                </div>
              )}
            </button>
            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                onClick={() => onMoveUp(item.id)}
                disabled={index === 0}
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition hover:bg-muted-foreground/10 hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                aria-label="Move up in queue"
              >
                <ChevronUp className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onMoveDown(item.id)}
                disabled={index === items.length - 1}
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition hover:bg-muted-foreground/10 hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                aria-label="Move down in queue"
              >
                <ChevronDown className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onRemove(item.id)}
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                aria-label="Remove from queue"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
