---
'@larkup/workspace-app': minor
---

Rework chat loading and surface styling.

- Replace every chat loading state (message submitted, pre-answer reasoning, and each running tool/skill) with one minimal, NotebookLM/ChatGPT-style `ThinkingIndicator`: a per-skill lucide glyph (search, chart, table, video, code, document, web, …; a neutral `Component` mark for plain reasoning) beside a status line that fades step by step through the real stages of that skill. The glyph and the text share the same shimmer sweep — no spinning logo, no emerald progress bar. Per-skill copy and icons live in `CHAT_TOOL_BEHAVIORS[*]`; genuine server-driven progress messages still take over when present.
- Remove drop shadows from all rendered and generated chat UI — sandbox/execution panels, metric blocks, mermaid diagrams, embedded figures, and the primary CTA now rely on borders and tone only. Documented as a flat, shadowless UI convention in the package README.
- Restyle the Python-sandbox stdout panel as a classy, collapsed "Thoughts" disclosure with a transparent background (a thin left rule instead of a boxed card), replacing the old "Calculation & Execution Details" card.
- Bump the assistant answer body to 16px for readability.
