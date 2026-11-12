---
"@larkup/workspace-app": minor
---

Clean up assistant chat markdown rendering. Move the `.assistant-text-content` /
`msg-*` typography into the shared `source.css` so managed hosts render the same
clean, blog-like formatting (comfortable spacing, restrained heading scale) as
the canonical app instead of falling back to raw browser defaults. Add support
for blockquotes, horizontal rules, strikethrough, and `h4`, and give KaTeX
display math room with horizontal scroll. The markdown renderer is extracted
into a dedicated, unit-tested `render-markdown` module.
