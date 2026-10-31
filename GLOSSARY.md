# syki::sok Knowledge Base & Scratchpad Domain

`syki::sok` is an instant, featherweight Markdown scratchpad and Zero-Inbox knowledge compilation environment where raw daily captures (`Scrap`) are absorbed by an agent into structured permanent notes (`Wiki`) and cold storage (`Archive`).

## Language

**Scrap**:
An unstructured, chronological capture file (`YYYY-MM-DD.md`) where raw thoughts, terminal pipes, voice transcriptions, and OCR extracts are written with zero organizational friction.
_Avoid_: Raw note, inbox file, daily log, draft

**Wiki**:
A permanent, topic-centric Markdown note (`wiki/YYYY-MM-DD-slug.md`) synthesized and updated by the Knowledge Compiler from one or more Scraps.
_Avoid_: Article, zettel, permanent note, doc

**Archive**:
Cold storage (`archive/YYYY-MM/`) holding already-absorbed Scrap files that are excluded from active search and semantic indexing to prevent duplicate hits.
_Avoid_: Trash, backup, history folder, old scraps

**Knowledge Index (`INDEX.md`)**:
A concise map (at most 150 lines) listing one-line summaries and relative links for every Wiki note so humans and agents can survey the knowledge base in a single read.
_Avoid_: Table of contents, sitemap, catalog

**Absorb**:
The compilation lifecycle step in which an agent reads uncompiled Scraps (including offline sync conflict copies), integrates lasting insights into Wiki notes and `INDEX.md`, moves historical Scraps to Archive, and clears today's active Scrap in-place.
_Avoid_: Compile, digest, sync, archive, process

**In-Place Clear**:
Overwriting today's active Scrap file with an absorbed marker (rather than deleting or moving the file) so multi-PC cloud sync clients propagate a file write event and open editor tabs hot-reload cleanly without resurrecting deleted files.
_Avoid_: Delete today's scrap, move today's scrap
