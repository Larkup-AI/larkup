'use client';

import { useRef, useCallback } from 'react';
import { Paperclip } from 'lucide-react';
import { useDocEditor } from './doc-editor-provider';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const ACCEPTED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
];

const ACCEPTED_EXTENSIONS = '.pdf,.docx,.pptx,.txt';

interface FileAttachmentButtonProps {
  /** Callback when a file is selected (for adding to chat message) */
  onFileSelected?: (file: File) => void;
  className?: string;
  id?: string;
}

export function FileAttachmentButton({ onFileSelected, className, id }: FileAttachmentButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { openCanvas, isLoading } = useDocEditor();

  const handleChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Validate type
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      const validExts = ['.pdf', '.docx', '.pptx', '.txt'];
      if (!ACCEPTED_TYPES.includes(file.type) && !validExts.includes(ext)) {
        return;
      }

      // Open the canvas with the file
      await openCanvas(file);

      // Notify parent (for chat input)
      onFileSelected?.(file);

      // Reset input
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    },
    [openCanvas, onFileSelected],
  );

  return (
    <>
      <input
        id={id}
        ref={inputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS}
        onChange={handleChange}
        className="hidden"
        aria-label="Attach document"
      />
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={isLoading}
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition',
                'hover:bg-secondary hover:text-foreground',
                'disabled:opacity-40 disabled:cursor-not-allowed',
                className,
              )}
            >
              <Paperclip className="h-[18px] w-[18px]" />
            </button>
          }
        />
        <TooltipContent>Attach document (PDF, Word, PPT, TXT)</TooltipContent>
      </Tooltip>
    </>
  );
}
