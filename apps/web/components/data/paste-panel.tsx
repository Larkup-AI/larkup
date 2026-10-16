'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { formatErrorMessage } from '@/lib/shared/error-formatter';
import { Plus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TextSourceFields } from '@larkup/workspace-ui';
import type { DataPrimaryAction } from '@/components/data/data-primary-action';

export function PastePanel({
  onAdded,
  onActionChange,
  groupId,
}: {
  onAdded: () => void;
  onActionChange?: (action: DataPrimaryAction | null) => void;
  groupId?: string;
}) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const groupIdRef = useRef(groupId ?? 'default');
  groupIdRef.current = groupId ?? 'default';

  async function submit() {
    if (!content.trim()) {
      toast.error('Nothing to add — paste some text first.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim() || 'Pasted text',
          content: content,
          source: 'text',
          groupId: groupIdRef.current,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
      toast.success('Added to corpus');
      setTitle('');
      setContent('');
      onAdded();
    } catch (err) {
      toast.error(formatErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    onActionChange?.({
      label: 'Add text',
      onClick: submit,
      disabled: !content.trim(),
      loading: saving,
    });
    return () => onActionChange?.(null);
  }, [title, content, saving, groupId, onActionChange]);

  return (
    <div className="space-y-4 w-full">
      <TextSourceFields
        title={title}
        content={content}
        onTitleChange={setTitle}
        onContentChange={setContent}
      />
      {!onActionChange && (
        <Button onClick={submit} disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Add text
        </Button>
      )}
    </div>
  );
}
