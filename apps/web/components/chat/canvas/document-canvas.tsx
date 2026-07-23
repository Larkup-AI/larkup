'use client';

import { useRef, useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useDocEditor } from './doc-editor-provider';
import { DocumentViewer } from './document-viewer';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* DocumentCanvas    */
/* ------------------------------------------------------------------ */

interface DocumentCanvasProps {
  /** The chat content to render on the left side */
  children: React.ReactNode;
}

export function DocumentCanvas({ children }: DocumentCanvasProps) {
  const { isCanvasOpen, parsedDocument } = useDocEditor();
  const [splitRatio, setSplitRatio] = useState(50); // percentage for left panel
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  /* ---- Resize handle drag ---- */
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const pct = Math.max(25, Math.min(75, (x / rect.width) * 100));
      setSplitRatio(pct);
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, []);

  /* ---- Split-view layout ---- */
  return (
    <div ref={containerRef} className="flex h-full w-full overflow-hidden">
      {/* Left panel — Chat */}
      <motion.div
        initial={{ width: '100%' }}
        animate={{ width: isCanvasOpen ? `${splitRatio}%` : '100%' }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="flex h-full min-w-0 flex-col overflow-hidden"
      >
        {children}
      </motion.div>

      {/* Resize handle */}
      {isCanvasOpen && (
        <div
          role="separator"
          aria-orientation="vertical"
          onMouseDown={handleMouseDown}
          className={cn(
            'relative z-10 flex w-[3px] shrink-0 cursor-col-resize items-center justify-center',
            'bg-border/40 transition-colors hover:bg-primary/30 active:bg-primary/50',
            'group',
          )}
        >
          {/* Visual handle indicator */}
          <div className="absolute h-8 w-1 rounded-full bg-border group-hover:bg-primary/40 transition-colors" />
        </div>
      )}

      {/* Right panel — Document Viewer */}
      <AnimatePresence mode="wait">
        {isCanvasOpen && (
          <motion.div
            key="canvas-panel"
            initial={{ width: 0, opacity: 0, scale: 0.95 }}
            animate={{
              width: `${100 - splitRatio}%`,
              opacity: 1,
              scale: 1,
            }}
            exit={{ width: 0, opacity: 0, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="flex h-full min-w-0 flex-col overflow-hidden origin-top-left"
          >
            <DocumentViewer />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
