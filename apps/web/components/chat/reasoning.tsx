'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Brain, ChevronDown, Cpu } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Context                                                              */
/* ------------------------------------------------------------------ */

interface ReasoningContextValue {
  isStreaming: boolean;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  duration: number | undefined;
}

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

export function useReasoning() {
  const ctx = useContext(ReasoningContext);
  if (!ctx) throw new Error('useReasoning must be used within <Reasoning>');
  return ctx;
}

/* ------------------------------------------------------------------ */
/* <Reasoning>                                                          */
/* ------------------------------------------------------------------ */

interface ReasoningProps {
  isStreaming?: boolean;
  children: ReactNode;
  className?: string;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  duration?: number;
}

export function Reasoning({
  isStreaming = false,
  children,
  className,
  open: controlledOpen,
  defaultOpen = true,
  onOpenChange,
  duration: controlledDuration,
}: ReasoningProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = controlledOpen ?? internalOpen;
  const setIsOpen = onOpenChange ?? setInternalOpen;

  /* Auto-open when streaming starts, auto-close when streaming ends */
  const wasStreamingRef = useRef(false);
  useEffect(() => {
    if (isStreaming && !wasStreamingRef.current) {
      setIsOpen(true);
    }
    if (!isStreaming && wasStreamingRef.current) {
      setIsOpen(false);
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming, setIsOpen]);

  /* Duration timer */
  const [elapsed, setElapsed] = useState<number | undefined>(undefined);
  const startRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isStreaming) {
      if (startRef.current === null) startRef.current = Date.now();
      intervalRef.current = setInterval(() => {
        if (startRef.current !== null) {
          setElapsed(Math.round((Date.now() - startRef.current) / 1000));
        }
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      // Freeze elapsed at final value
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isStreaming]);

  const duration = controlledDuration ?? elapsed;

  return (
    <ReasoningContext.Provider value={{ isStreaming, isOpen, setIsOpen, duration }}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen} className={cn('mb-2 w-full', className)}>
        {children}
      </Collapsible>
    </ReasoningContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/* <ReasoningTrigger>                                                   */
/* ------------------------------------------------------------------ */

interface ReasoningTriggerProps {
  className?: string;
  getThinkingMessage?: (isStreaming: boolean, duration?: number) => ReactNode;
}

function formatDuration(seconds?: number): string {
  if (seconds === undefined || seconds === 0) return '';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

export function ReasoningTrigger({ className, getThinkingMessage }: ReasoningTriggerProps) {
  const { isStreaming, isOpen, duration } = useReasoning();

  const defaultMessage = isStreaming
    ? 'Thinking…'
    : duration && duration > 0
    ? `Thought for ${formatDuration(duration)}`
    : 'Thought for a moment';

  const message = getThinkingMessage ? getThinkingMessage(isStreaming, duration) : defaultMessage;

  return (
    <CollapsibleTrigger
      className={cn(
        'flex w-fit items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground',
        className,
      )}
    >
      <Cpu
        className={cn(
          'size-4 shrink-0 text-[#f3c756]',
          isStreaming && 'animate-pulse text-primary/70',
        )}
      />
      <span className={cn(isStreaming && 'animate-pulse')}>{message}</span>
      <ChevronDown
        className={cn(
          'size-3.5 shrink-0 transition-transform duration-200 ml-auto',
          isOpen && 'rotate-180',
        )}
      />
    </CollapsibleTrigger>
  );
}

/* ------------------------------------------------------------------ */
/* <ReasoningContent>                                                   */
/* ------------------------------------------------------------------ */

interface ReasoningContentProps {
  children: string;
  className?: string;
}

export function ReasoningContent({ children, className }: ReasoningContentProps) {
  const { isStreaming } = useReasoning();
  const contentRef = useRef<HTMLDivElement>(null);

  /* Auto-scroll to bottom while streaming */
  useEffect(() => {
    if (isStreaming && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [isStreaming, children]);

  if (!children) return null;

  return (
    <CollapsibleContent
      className={cn(
        'overflow-hidden',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        'data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2',
        className,
      )}
    >
      <div
        ref={contentRef}
        className={cn(
          'mt-2 max-h-60 overflow-y-auto rounded-lg  px-4 py-3',
          'text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap',
          isStreaming && 'border-primary/20',
        )}
      >
        {children}
      </div>
    </CollapsibleContent>
  );
}
