# syki::sok Knowledge Base & Scratchpad Domain

`syki::sok` is an instant, featherweight Markdown scratchpad and Zero-Inbox knowledge compilation environment acting as the low-friction membrane between human consciousness and plain-text streams. Raw daily captures (`Scrap`) are absorbed by an agent into structured permanent notes (`Wiki`) and cold storage (`Archive`), while the system itself is organized into three concentric rings so peripheral organs can be shed or replaced as computing shifts to local inference.

## Language

**Scrap**:
An unstructured, chronological capture file (`YYYY-MM-DD.md`) where raw thoughts, terminal pipes, voice transcriptions, and OCR extracts are written with zero organizational friction.
_Avoid_: Raw note, inbox file, daily log, draft

**Wiki**:
A permanent, topic-centric Markdown note synthesized and updated by the Knowledge Compiler from one or more Scraps.
_Avoid_: Article, zettel, permanent note, doc

**Archive**:
Cold storage holding already-absorbed Scrap files that are excluded from active search and semantic indexing to prevent duplicate hits.
_Avoid_: Trash, backup, history folder, old scraps

**Knowledge Index**:
A concise map (at most 150 lines) listing one-line summaries and relative links for every Wiki note so humans and agents can survey the knowledge base in a single read.
_Avoid_: Table of contents, sitemap, catalog

**Absorb**:
The compilation lifecycle step in which an agent reads uncompiled Scraps (including offline sync conflict copies), integrates lasting insights into Wiki notes and the Knowledge Index, moves historical Scraps to Archive, and clears today's active Scrap in-place.
_Avoid_: Compile, digest, sync, archive, process

**In-Place Clear**:
Overwriting today's active Scrap with an absorbed marker (rather than deleting or moving it) so multi-PC cloud sync clients propagate a write event and open editor tabs hot-reload cleanly without resurrecting deleted notes.
_Avoid_: Delete today's scrap, move today's scrap

**Stream Kernel (Ring 0)**:
The immutable core that receives, searches, transforms, and emits plain-text streams, manages Scrap and Wiki persistence, and dispatches Slot tasks without depending on any graphical window or peripheral capture device.
_Avoid_: Backend, server, app core

**Editor Canvas (Ring 1)**:
The human visual and keyboard membrane (tabs, plain-text editor, live preview, and print sheet) that interacts with the Stream Kernel as a standard client.
_Avoid_: Frontend, GUI wrapper, main window

**Receptor Organelle (Ring 2)**:
A detachable peripheral module (such as mobile relay polling, hot-folder watching, quick capture, semantic indexing, or cloud-specific model adapters) connected to the Stream Kernel through a narrow lifecycle and text-append seam so it can be disabled or removed without altering Ring 0 or Ring 1.
_Avoid_: Plugin, extension, helper service, background worker

**Local-First Inference Seam**:
The model communication contract that treats local inference endpoints (local OpenAI-compatible servers, Ollama, and on-device speech/OCR engines) as the primary, zero-key, zero-consent standard across text, vision, audio, and command judgment, while isolating cloud-proprietary protocols as optional adapters.
_Avoid_: Cloud API client, Gemini wrapper, LLM service
