'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { ParsedDocument, DocumentField, FieldEdit } from '@larkup/tool-doc-editor/types';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface DocEditorState {
  /** Whether the canvas split-view is open */
  isCanvasOpen: boolean;
  /** Active editor session ID */
  sessionId: string | null;
  /** Parsed document data */
  parsedDocument: ParsedDocument | null;
  /** File being processed */
  activeFileName: string | null;
  /** File type */
  activeFileType: string | null;
  /** Base64 file data for live preview */
  fileBase64: string | null;
  /** MIME type */
  fileMimeType: string | null;
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: string | null;
  /** Fields currently being filled by AI (for animation) */
  fillingFields: Set<string>;
  /** Recently updated fields (for highlight animation) */
  updatedFields: Set<string>;
  /** Monotonically increasing version counter to force `<object>` remounting */
  updateVersion: number;
}

interface DocEditorActions {
  /** Open the canvas with a file */
  openCanvas: (file: File, options?: { background?: boolean }) => Promise<void>;
  /** Close the canvas */
  closeCanvas: () => void;
  /** Toggle the canvas */
  toggleCanvas: () => void;
  /** Apply field edits */
  applyEdits: (edits: FieldEdit[]) => Promise<void>;
  /** Mark fields as being filled (for animation) */
  setFillingFields: (fieldIds: string[]) => void;
  /** Clear filling state */
  clearFillingFields: () => void;
  /** Export the current document */
  exportFile: () => void;
  /** Update parsed document from external source (e.g., chat tool result) */
  updateFromToolResult: (result: {
    sessionId: string;
    fields: DocumentField[];
    updatedFields: string[];
    fileBase64?: string;
    pages?: any[];
    totalPages?: number;
  }) => void;
}

type DocEditorContext = DocEditorState & DocEditorActions;

/* ------------------------------------------------------------------ */
/* Context                                                             */
/* ------------------------------------------------------------------ */

const DocEditorCtx = createContext<DocEditorContext | null>(null);

export function useDocEditor(): DocEditorContext {
  const ctx = useContext(DocEditorCtx);
  if (!ctx) {
    throw new Error('useDocEditor must be used within a DocEditorProvider');
  }
  return ctx;
}

/* ------------------------------------------------------------------ */
/* Provider                                                            */
/* ------------------------------------------------------------------ */

export function DocEditorProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DocEditorState>({
    isCanvasOpen: false,
    sessionId: null,
    parsedDocument: null,
    activeFileName: null,
    activeFileType: null,
    fileBase64: null,
    fileMimeType: null,
    isLoading: false,
    error: null,
    fillingFields: new Set(),
    updatedFields: new Set(),
    updateVersion: 0,
  });

  /* ---- Open Canvas ---- */
  const openCanvas = useCallback(async (file: File, options?: { background?: boolean }) => {
    setState((s) => ({
      ...s,
      isLoading: true,
      error: null,
      activeFileName: file.name,
      isCanvasOpen: options?.background ? s.isCanvasOpen : true,
    }));

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/doc-editor/parse', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to parse file');
      }

      const data = await res.json();

      // Read the file as base64 for preview
      const fileBase64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          // Remove data URL prefix
          resolve(result.split(',')[1] || result);
        };
        reader.readAsDataURL(file);
      });

      setState((s) => ({
        ...s,
        isLoading: false,
        sessionId: data.sessionId,
        parsedDocument: {
          sessionId: data.sessionId,
          fileName: data.fileName,
          type: data.type,
          mimeType: data.mimeType,
          fileSize: data.fileSize,
          pages: data.pages,
          fields: data.fields,
          rawText: data.rawText,
          metadata: data.metadata,
          totalPages: data.totalPages,
        },
        activeFileType: data.type,
        fileMimeType: data.mimeType,
        fileBase64,
        updateVersion: s.updateVersion + 1,
      }));
    } catch (err: any) {
      setState((s) => ({
        ...s,
        isLoading: false,
        error: err.message || 'Failed to parse file',
      }));
    }
  }, []);

  /* ---- Close Canvas ---- */
  const closeCanvas = useCallback(() => {
    setState((s) => ({
      ...s,
      isCanvasOpen: false,
    }));
  }, []);

  /* ---- Toggle Canvas ---- */
  const toggleCanvas = useCallback(() => {
    setState((s) => ({
      ...s,
      isCanvasOpen: !s.isCanvasOpen,
    }));
  }, []);

  /* ---- Apply Edits ---- */
  const applyEdits = useCallback(
    async (edits: FieldEdit[]) => {
      if (!state.sessionId) return;

      // Mark fields as filling (for animation)
      setState((s) => ({
        ...s,
        fillingFields: new Set(edits.map((e) => e.fieldId)),
      }));

      try {
        const res = await fetch('/api/doc-editor/edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: state.sessionId,
            fieldEdits: edits,
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Edit failed');
        }

        const data = await res.json();

        setState((s) => ({
          ...s,
          fillingFields: new Set(),
          updatedFields: new Set(data.updatedFields || []),
          parsedDocument: s.parsedDocument
            ? {
                ...s.parsedDocument,
                fields: data.fields || s.parsedDocument.fields,
                pages: data.pages || s.parsedDocument.pages,
                totalPages: data.totalPages || s.parsedDocument.totalPages,
              }
            : null,
          fileBase64: data.fileBase64 || s.fileBase64,
          updateVersion: s.updateVersion + 1,
        }));

        // Clear the updated highlight after 2 seconds
        setTimeout(() => {
          setState((s) => ({ ...s, updatedFields: new Set() }));
        }, 2000);
      } catch (err: any) {
        setState((s) => ({
          ...s,
          fillingFields: new Set(),
          error: err.message || 'Edit failed',
        }));
      }
    },
    [state.sessionId],
  );

  /* ---- Set Filling Fields ---- */
  const setFillingFields = useCallback((fieldIds: string[]) => {
    setState((s) => ({ ...s, fillingFields: new Set(fieldIds) }));
  }, []);

  /* ---- Clear Filling Fields ---- */
  const clearFillingFields = useCallback(() => {
    setState((s) => ({ ...s, fillingFields: new Set() }));
  }, []);

  /* ---- Export File ---- */
  const exportFile = useCallback(() => {
    if (!state.sessionId) return;

    const url = `/api/doc-editor/export?sessionId=${encodeURIComponent(state.sessionId)}`;
    const link = document.createElement('a');
    link.href = url;
    link.download = state.activeFileName || 'document';
    link.click();
  }, [state.sessionId, state.activeFileName]);

  /* ---- Update from Tool Result ---- */
  const updateFromToolResult = useCallback(
    (result: {
      sessionId: string;
      fields: DocumentField[];
      updatedFields: string[];
      fileBase64?: string;
      pages?: any[];
      totalPages?: number;
    }) => {
      setState((s) => {
        // If the canvas is not open for this session, open it
        const shouldOpen = !s.isCanvasOpen || s.sessionId !== result.sessionId;

        return {
          ...s,
          sessionId: result.sessionId,
          isCanvasOpen: true,
          parsedDocument: s.parsedDocument
            ? {
                ...s.parsedDocument,
                fields: result.fields,
                pages: result.pages || s.parsedDocument.pages,
                totalPages: result.totalPages || s.parsedDocument.totalPages,
              }
            : {
                sessionId: result.sessionId,
                fileName: s.activeFileName || 'Document',
                type: 'pdf',
                mimeType: 'application/pdf',
                fileSize: 0,
                pages: result.pages || [],
                fields: result.fields || [],
                rawText: '',
                metadata: {},
                totalPages: result.totalPages || 1,
              },
          fileBase64: result.fileBase64 || s.fileBase64,
          updatedFields: new Set(result.updatedFields),
          fillingFields: new Set(),
          updateVersion: s.updateVersion + 1,
        };
      });

      // Restore on the backend just in case the server restarted and memory was cleared
      if (result.fileBase64 && result.sessionId) {
        fetch('/api/doc-editor/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: result.sessionId,
            fileBase64: result.fileBase64,
            // Pass minimal required fields for the backend session
            fileName: 'Document',
            mimeType: 'application/pdf',
            activeFileType: 'pdf',
          }),
        }).catch(console.error);
      }

      // Clear highlight after animation
      setTimeout(() => {
        setState((s) => ({ ...s, updatedFields: new Set() }));
      }, 2000);
    },
    [],
  );

  const value: DocEditorContext = {
    ...state,
    openCanvas,
    closeCanvas,
    toggleCanvas,
    applyEdits,
    setFillingFields,
    clearFillingFields,
    exportFile,
    updateFromToolResult,
  };

  return <DocEditorCtx.Provider value={value}>{children}</DocEditorCtx.Provider>;
}
