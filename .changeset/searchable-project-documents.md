---
"puzzlepkm": minor
---

Make the contents of documents in project and reference-material folders searchable.

- Every sync walks those folders recursively and extracts the text of the files it can read — PDFs, Word documents (`.docx`/`.docm` and legacy `.doc`), PowerPoint decks (`.pptx`/`.pptm`), Pages documents, Markdown, and plain text — into a full-text index. Extraction is keyed on size and modification time, so a file is parsed once per version and later syncs cost one `stat` per file. A `.pages` package directory is indexed as the single document it looks like.
- The Library search now matches file contents. A match appears as its own **Document** card, showing the file name, the project or reference material holding it, and a snippet around the hit; clicking opens the file in whatever application the system uses for it. "Documents" is a Library object-type filter, on by default.
- New CLI commands: `documents search`, `documents index [--force]`, `documents list`, and `documents status`.
- The MCP server gains `search_documents`, `get_document_text`, and `list_documents`, and `search_knowledge_base` now returns document hits alongside notes and objects.
- Extraction is written against Node built-ins only, keeping the CLI dependency-free: a ZIP reader for the Office XML formats, a Compound File Binary reader plus piece-table walk for `.doc` (fast-saved documents included), and a PDF reader that resolves object streams and maps character codes through each font's `/ToUnicode` CMap so subset-font exports from Word, Pages, and browsers read as text rather than glyph noise.
- Files that are understood but hold no text — scanned PDFs, image-only decks, and Pages 5+ documents saved without a preview — index as empty with the reason recorded, and `documents list` reports it per file.
