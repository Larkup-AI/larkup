'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import {
  X,
  Download,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  FileText,
  Loader2,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDocEditor } from './doc-editor-provider';
import { DocumentField } from './document-field';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/* ------------------------------------------------------------------ */
/* Document Viewer — right-side preview panel                          */
/* ------------------------------------------------------------------ */

export function DocumentViewer() {
  const {
    parsedDocument,
    activeFileName,
    activeFileType,
    fileBase64,
    fileMimeType,
    isLoading,
    error,
    fillingFields,
    updatedFields,
    updateVersion,
    closeCanvas,
    exportFile,
    applyEdits,
  } = useDocEditor();

  const [currentPage, setCurrentPage] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const totalPages = parsedDocument?.totalPages ?? 0;
  const currentPageData = parsedDocument?.pages?.[currentPage];

  // Scroll to field being filled
  useEffect(() => {
    if (fillingFields.size > 0 && contentRef.current) {
      const firstFieldId = Array.from(fillingFields)[0];
      const fieldEl = contentRef.current.querySelector(`[data-field-id="${firstFieldId}"]`);
      if (fieldEl) {
        fieldEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [fillingFields]);

  /* ---- Render based on file type ---- */
  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Parsing document…</span>
          </div>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <FileText className="size-8 text-muted-foreground/40" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        </div>
      );
    }

    if (!parsedDocument) return null;

    switch (activeFileType) {
      case 'pdf':
        return renderPDFView();
      case 'docx':
        return renderDOCXView();
      case 'pptx':
        return renderPPTXView();
      case 'txt':
        return renderTXTView();
      default:
        return renderGenericView();
    }
  };

  /* ---- PDF View ---- */
  const renderPDFView = () => {
    if (!fileBase64 || !fileMimeType) return renderTextFallback();

    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* PDF embed */}
        <div className="flex-1 overflow-auto bg-muted/30 p-4">
          <div
            style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center' }}
            className="transition-transform duration-200"
          >
            <object
              key={`pdf-view-${updateVersion}`}
              data={`data:${fileMimeType};base64,${fileBase64}#page=${currentPage + 1}`}
              type="application/pdf"
              className="mx-auto w-full rounded-lg border border-border/40"
              style={{ height: '80vh', minHeight: '500px' }}
            >
              {/* Fallback to text rendering if PDF embed fails */}
              {renderTextFallback()}
            </object>
          </div>
        </div>

        {/* Form fields overlay (below the PDF) */}
        {parsedDocument?.fields && parsedDocument.fields.length > 0 && (
          <div className="border-t border-border/40 bg-card">
            <div className="px-4 py-2 text-xs font-medium text-muted-foreground flex items-center gap-2">
              <FileText className="size-3" />
              Form Fields ({parsedDocument.fields.length})
            </div>
            <div className="max-h-[200px] overflow-y-auto px-4 pb-3 space-y-2 [&::-webkit-scrollbar]:hidden">
              {parsedDocument.fields.map((field) => (
                <DocumentField
                  key={field.id}
                  field={field}
                  isFilling={fillingFields.has(field.id)}
                  isUpdated={updatedFields.has(field.id)}
                  onEdit={(value) => {
                    applyEdits([{ fieldId: field.id, value, type: 'fill' }]);
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  /* ---- DOCX View ---- */
  const renderDOCXView = () => {
    const html = currentPageData?.html;

    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <div
          ref={contentRef}
          className="flex-1 overflow-auto p-6 bg-white dark:bg-card"
          style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top left' }}
        >
          {html ? (
            <div
              className="docx-content prose prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
            />
          ) : (
            renderTextFallback()
          )}
        </div>

        {/* Fields */}
        {parsedDocument?.fields && parsedDocument.fields.length > 0 && (
          <div className="border-t border-border/40 bg-card">
            <div className="px-4 py-2 text-xs font-medium text-muted-foreground flex items-center gap-2">
              <FileText className="size-3" />
              Detected Fields ({parsedDocument.fields.length})
            </div>
            <div className="max-h-[200px] overflow-y-auto px-4 pb-3 space-y-2 [&::-webkit-scrollbar]:hidden">
              {parsedDocument.fields.map((field) => (
                <DocumentField
                  key={field.id}
                  field={field}
                  isFilling={fillingFields.has(field.id)}
                  isUpdated={updatedFields.has(field.id)}
                  onEdit={(value) => {
                    applyEdits([{ fieldId: field.id, value, type: 'fill' }]);
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  /* ---- PPTX View ---- */
  const renderPPTXView = () => {
    if (!parsedDocument?.pages?.length) return renderTextFallback();

    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Slide content */}
        <div className="flex-1 overflow-auto p-6 bg-muted/30">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentPage}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
              className="mx-auto max-w-2xl rounded-xl border border-border bg-white dark:bg-card p-8 shadow-sm"
              style={{
                aspectRatio: '16/9',
                transform: `scale(${zoom / 100})`,
                transformOrigin: 'top center',
              }}
            >
              <div className="text-sm text-muted-foreground mb-2">
                Slide {currentPage + 1} of {totalPages}
              </div>
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                {currentPageData?.text || 'Empty slide'}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Slide thumbnails */}
        {totalPages > 1 && (
          <div className="border-t border-border/40 bg-card px-4 py-2">
            <div className="flex gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden">
              {parsedDocument.pages.map((page, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setCurrentPage(i)}
                  className={cn(
                    'shrink-0 rounded-lg border px-3 py-1.5 text-[10px] transition',
                    i === currentPage
                      ? 'border-primary bg-primary/5 text-primary font-medium'
                      : 'border-border text-muted-foreground hover:bg-muted',
                  )}
                >
                  Slide {i + 1}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  /* ---- TXT View ---- */
  const renderTXTView = () => {
    const text = currentPageData?.text || parsedDocument?.rawText || '';

    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-auto p-4 bg-card">
          <pre
            className="whitespace-pre-wrap text-sm leading-relaxed text-foreground font-mono"
            style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top left' }}
          >
            {text}
          </pre>
        </div>

        {parsedDocument?.fields && parsedDocument.fields.length > 0 && (
          <div className="border-t border-border/40 bg-card">
            <div className="px-4 py-2 text-xs font-medium text-muted-foreground flex items-center gap-2">
              <FileText className="size-3" />
              Detected Fields ({parsedDocument.fields.length})
            </div>
            <div className="max-h-[200px] overflow-y-auto px-4 pb-3 space-y-2 [&::-webkit-scrollbar]:hidden">
              {parsedDocument.fields.map((field) => (
                <DocumentField
                  key={field.id}
                  field={field}
                  isFilling={fillingFields.has(field.id)}
                  isUpdated={updatedFields.has(field.id)}
                  onEdit={(value) => {
                    applyEdits([{ fieldId: field.id, value, type: 'fill' }]);
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  /* ---- Generic / Text Fallback ---- */
  const renderGenericView = () => renderTextFallback();

  const renderTextFallback = () => {
    const text = currentPageData?.text || parsedDocument?.rawText || 'No content to display';

    return (
      <div className="flex-1 overflow-auto p-6 bg-card">
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{text}</div>
      </div>
    );
  };

  /* ---- Main Render ---- */
  return (
    <motion.div
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: '100%', opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className={cn(
        'flex h-full flex-col border-l border-border bg-card overflow-hidden',
        isFullscreen && 'fixed inset-0 z-50 border-none',
      )}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border/40 px-3 py-2 bg-card">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-xs font-medium text-foreground">
            {activeFileName || 'Document'}
          </span>
          {parsedDocument?.fields && parsedDocument.fields.length > 0 && (
            <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
              {parsedDocument.fields.length} fields
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Page navigation */}
          {totalPages > 1 && (
            <>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                disabled={currentPage === 0}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted disabled:opacity-30"
              >
                <ChevronLeft className="size-3.5" />
              </button>
              <span className="text-[10px] tabular-nums text-muted-foreground px-1">
                {currentPage + 1}/{totalPages}
              </span>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={currentPage >= totalPages - 1}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted disabled:opacity-30"
              >
                <ChevronRight className="size-3.5" />
              </button>
              <div className="mx-1 h-4 w-px bg-border" />
            </>
          )}

          {/* Zoom */}
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(50, z - 10))}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted"
          >
            <ZoomOut className="size-3.5" />
          </button>
          <span className="text-[10px] tabular-nums text-muted-foreground w-8 text-center">
            {zoom}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(200, z + 10))}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted"
          >
            <ZoomIn className="size-3.5" />
          </button>

          <div className="mx-1 h-4 w-px bg-border" />

          {/* Fullscreen */}
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={() => setIsFullscreen((f) => !f)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted"
                >
                  {isFullscreen ? (
                    <Minimize2 className="size-3.5" />
                  ) : (
                    <Maximize2 className="size-3.5" />
                  )}
                </button>
              }
            />
            <TooltipContent>{isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}</TooltipContent>
          </Tooltip>

          {/* Download */}
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={exportFile}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted"
                >
                  <Download className="size-3.5" />
                </button>
              }
            />
            <TooltipContent>Download</TooltipContent>
          </Tooltip>

          {/* Close */}
          <button
            type="button"
            onClick={closeCanvas}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div ref={contentRef} className="flex flex-1 flex-col min-h-0 overflow-hidden">
        {renderContent()}
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Basic HTML sanitization for DOCX HTML output */
function sanitizeHtml(html: string): string {
  // mammoth produces clean HTML, but let's be safe
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/on\w+="[^"]*"/gi, '')
    .replace(/on\w+='[^']*'/gi, '');
}
