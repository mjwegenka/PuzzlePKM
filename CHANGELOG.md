# puzzlepkm

## 1.5.0

### Minor Changes

- Group scripture references by chapter and rebuild the graph around them.

  - Chapters are a first-class object type. A reference now records the chapters it spans and the verse span within each, so every note citing anywhere in Mark 10 rolls up to one chapter instead of scattering across nine verse-level records.
  - The graph draws scripture as chapters, sized by citing notes and coloured by canonical section. Nodes with no edges are hidden behind a "Show unlinked" toggle, and searching shows a match plus its direct neighbours.
  - A chapter view lists every citation grouped by verse span, with the notes that used each reference and links to the adjacent chapters.
  - Scripture detection no longer reads prose as citations ("Feeding of the 5,000" had become Thessalonians 5,000), rejects volume-less numbered books, understands Douay-Rheims 3/4 Kings, handles single-chapter books such as Jude, and stops a verse list from swallowing the volume of the citation after it.
