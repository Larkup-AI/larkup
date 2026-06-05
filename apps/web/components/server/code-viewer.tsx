"use client"

import { useMemo } from "react"
import CodeMirror, { EditorView, type Extension } from "@uiw/react-codemirror"
import { javascript } from "@codemirror/lang-javascript"
import { json } from "@codemirror/lang-json"
import { markdown } from "@codemirror/lang-markdown"
import { yaml } from "@codemirror/lang-yaml"
import { githubLight } from "@uiw/codemirror-theme-github"

/** Map a generated file's language hint to a CodeMirror language extension. */
function languageExtension(language: string): Extension[] {
  switch (language) {
    case "javascript":
      return [javascript({ jsx: true })]
    case "json":
      return [json()]
    case "markdown":
      return [markdown()]
    case "yaml":
      return [yaml()]
    default:
      return []
  }
}

/** Blend CodeMirror into the card surface instead of its own white sheet. */
const surfaceTheme = EditorView.theme({
  "&": {
    backgroundColor: "transparent",
    fontSize: "12px",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    border: "none",
    color: "var(--muted-foreground)",
  },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-activeLineGutter": { backgroundColor: "transparent" },
  ".cm-scroller": {
    fontFamily: "var(--font-mono), ui-monospace, monospace",
    lineHeight: "1.6",
  },
})

/**
 * Read-only, syntax-highlighted file viewer used by the Server stage. Replaces
 * the plain <pre> preview with proper tokenized highlighting.
 */
export function CodeViewer({
  value,
  language,
  height = "26rem",
}: {
  value: string
  language: string
  height?: string
}) {
  const extensions = useMemo(
    () => [...languageExtension(language), surfaceTheme, EditorView.lineWrapping],
    [language],
  )

  return (
    <CodeMirror
      value={value}
      height={height}
      readOnly
      editable={false}
      theme={githubLight}
      extensions={extensions}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        highlightSelectionMatches: false,
        searchKeymap: false,
      }}
    />
  )
}
