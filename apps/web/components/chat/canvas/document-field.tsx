'use client';

import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DocumentField as DocumentFieldType } from '@larkup/tool-doc-editor/types';

/* ------------------------------------------------------------------ */
/* DocumentField — individual editable field with animations           */
/* ------------------------------------------------------------------ */

interface DocumentFieldProps {
  field: DocumentFieldType;
  /** Whether this field is currently being filled by AI */
  isFilling: boolean;
  /** Whether this field was recently updated */
  isUpdated: boolean;
  /** Callback when user manually edits the field */
  onEdit: (value: string) => void;
}

export function DocumentField({ field, isFilling, isUpdated, onEdit }: DocumentFieldProps) {
  const [localValue, setLocalValue] = useState(field.value);
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync external value changes (from AI fills)
  useEffect(() => {
    setLocalValue(field.value);
  }, [field.value]);

  const handleBlur = () => {
    setIsEditing(false);
    if (localValue !== field.value) {
      onEdit(localValue);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      (e.target as HTMLElement).blur();
    }
  };

  return (
    <motion.div
      data-field-id={field.id}
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'group relative rounded-lg border px-3 py-2 transition-all duration-300',
        isFilling && 'border-primary/40 bg-primary/5',
        isUpdated && !isFilling && 'border-emerald-400/60 bg-emerald-50/50 dark:bg-emerald-900/10',
        !isFilling && !isUpdated && 'border-border/60 bg-card hover:border-border',
      )}
    >
      {/* Label */}
      <div className="flex items-center justify-between mb-1">
        <label className="text-[11px] font-medium text-muted-foreground">
          {field.name}
          {field.required && <span className="text-destructive ml-0.5">*</span>}
        </label>
        <div className="flex items-center gap-1">
          {isFilling && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="flex items-center gap-1"
            >
              <Loader2 className="size-3 animate-spin text-primary" />
              <span className="text-[9px] text-primary font-medium">Filling…</span>
            </motion.div>
          )}
          {isUpdated && !isFilling && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 500, damping: 25 }}
              className="flex items-center gap-1"
            >
              <div className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500">
                <Check className="size-2.5 text-white" />
              </div>
              <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-medium">
                Updated
              </span>
            </motion.div>
          )}
        </div>
      </div>

      {/* Field input */}
      {field.type === 'checkbox' ? (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={localValue === 'true'}
            onChange={(e) => {
              const val = e.target.checked ? 'true' : 'false';
              setLocalValue(val);
              onEdit(val);
            }}
            className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
          />
          <span className="text-xs text-foreground">{field.name}</span>
        </label>
      ) : field.type === 'select' && field.options ? (
        <select
          value={localValue}
          onChange={(e) => {
            setLocalValue(e.target.value);
            onEdit(e.target.value);
          }}
          className="w-full rounded-md border border-border/60 bg-transparent px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
        >
          <option value="">Select…</option>
          {field.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : field.type === 'textarea' ? (
        <textarea
          ref={inputRef as any}
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onFocus={() => setIsEditing(true)}
          onBlur={handleBlur}
          placeholder={field.placeholder || `Enter ${field.name.toLowerCase()}`}
          rows={2}
          className={cn(
            'w-full rounded-md border bg-transparent px-2 py-1 text-xs text-foreground outline-none resize-none transition',
            'border-border/60 focus:border-primary placeholder:text-muted-foreground/50',
            isFilling && 'animate-pulse',
          )}
        />
      ) : (
        <input
          ref={inputRef}
          type={field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'}
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onFocus={() => setIsEditing(true)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder={field.placeholder || `Enter ${field.name.toLowerCase()}`}
          className={cn(
            'w-full rounded-md border bg-transparent px-2 py-1 text-xs text-foreground outline-none transition',
            'border-border/60 focus:border-primary placeholder:text-muted-foreground/50',
            isFilling && 'animate-pulse',
          )}
        />
      )}

      {/* Filling shimmer overlay */}
      {isFilling && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 rounded-lg overflow-hidden pointer-events-none"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/5 to-transparent animate-shimmer" />
        </motion.div>
      )}
    </motion.div>
  );
}
