'use client';

import type { ReactNode } from 'react';
import { Check, Copy, RotateCcw, ThumbsDown, ThumbsUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { cn } from '@/lib/utils';

export function MessageActions({
  text,
  liked,
  disliked,
  onLike,
  onDislike,
  onRegenerate,
  regenerateLabel = 'Regenerate',
  className,
}: {
  text: string;
  liked?: boolean;
  disliked?: boolean;
  onLike?: () => void;
  onDislike?: () => void;
  onRegenerate?: () => void;
  regenerateLabel?: string;
  className?: string;
}) {
  const { copied, copy } = useCopyToClipboard();

  return (
    <TooltipProvider delay={200}>
      <div className={cn('flex items-center gap-0.5', className)}>
        <ActionButton label={copied ? 'Copied' : 'Copy'} onClick={() => copy(text)}>
          {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
        </ActionButton>
        {onLike && onDislike ? (
          <>
            <ActionButton label={liked ? 'Liked — cached for next time' : 'Like'} onClick={onLike}>
              <ThumbsUp className={cn('size-3.5', liked && 'fill-current text-emerald-500')} />
            </ActionButton>
            <ActionButton label={disliked ? 'Disliked' : 'Dislike'} onClick={onDislike}>
              <ThumbsDown className={cn('size-3.5', disliked && 'fill-current text-destructive')} />
            </ActionButton>
          </>
        ) : null}
        {onRegenerate ? (
          <ActionButton label={regenerateLabel} onClick={onRegenerate}>
            <RotateCcw className="size-3.5" />
          </ActionButton>
        ) : null}
      </div>
    </TooltipProvider>
  );
}

function ActionButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onClick}
            className="text-muted-foreground hover:text-foreground"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
