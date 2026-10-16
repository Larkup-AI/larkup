import type { ComponentProps, ReactNode } from 'react';
import { Input } from './input.js';
import { Textarea } from './textarea.js';
import { cn } from './utils.js';

export function TextSourceFields({
  title,
  content,
  onTitleChange,
  onContentChange,
  idPrefix = 'paste',
  titleName = 'name',
  contentName = 'content',
}: {
  title: string;
  content: string;
  onTitleChange: (value: string) => void;
  onContentChange: (value: string) => void;
  idPrefix?: string;
  titleName?: string;
  contentName?: string;
}) {
  return (
    <div className="w-full space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor={idPrefix + '-title'}>
          Title
        </label>
        <Input
          id={idPrefix + '-title'}
          name={titleName}
          placeholder="Demo Title"
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor={idPrefix + '-content'}>
          Content
        </label>
        <Textarea
          id={idPrefix + '-content'}
          name={contentName}
          placeholder="Paste any text, markdown, or notes here…"
          className="min-h-48 bg-card font-mono text-xs leading-relaxed placeholder:text-xs placeholder:text-muted-foreground/50"
          value={content}
          onChange={(event) => onContentChange(event.target.value)}
          required
        />
        <p className="text-xs tabular-nums text-muted-foreground">
          {content.length.toLocaleString()} characters
        </p>
      </div>
    </div>
  );
}

export function SourceUploadDropzone({
  icon,
  description = 'Text, JSON, CSV, Excel, PDF, and Word files',
  dragging = false,
  className,
  ...props
}: ComponentProps<'button'> & { icon?: ReactNode; description?: ReactNode; dragging?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        'flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-6 py-10 text-center transition-colors hover:bg-muted/70 focus-visible:outline-2 focus-visible:outline-ring',
        dragging && 'border-primary bg-accent',
        className,
      )}
      {...props}
    >
      {icon}
      <span className="text-sm font-medium">Drop files here or click to browse</span>
      <span className="text-xs text-muted-foreground">{description}</span>
    </button>
  );
}
