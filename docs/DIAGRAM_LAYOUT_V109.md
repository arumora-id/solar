# SOLAR v1.0.9 (candidate) — Diagram Layout Optimisation

**Branch:** `feature/v1.0.9-diagram-layout-optimization` (Draft PR #22). **Baseline:** published v1.0.8. Not merged, released or deployed.

## Staged changes

- Phase A: obstacle-aware orthogonal ArchiMate SVG routing and relationship label placement, with geometric tests.
- Phase B: adaptive Sequence participant spacing, improved draw.io self-messages, activation duration, multiline labels, notes and combined fragments.
- **Phase C: unified export geometry.**
  - ArchiMate: calculate **one route per relationship per view** during validated model build, and reuse exactly those path points for SVG, editable draw.io (mxGeometry waypoints + anchors), and Open Group ArchiMate Exchange XML (`sourceAttachment`, `bendpoint`, `targetAttachment`).
  - Relationship labels use the same wrapped text and rectangle positions in SVG and draw.io.
  - Sequence: calculate shared participant columns plus a **vertical timeline** for all messages, notes and combined-fragment boundaries. SVG and draw.io use the same per-step Y and message-arrow Y. The Mermaid and PlantUML source formats remain unchanged; third-party renderers control their own layout.
  - Draw.io and VP Online XML artifacts have the same drawing content, as before.
- Phase D: additional cross-export collision checks, actual editor import/edit, stress and visual QA.

## Important technical limits

- A dense graph can require unavoidable edge intersections; the router currently retains a visible fallback when no candidate route is available. Crossings are minimized, **not guaranteed to be zero**.
- Label placement is heuristic, including a fallback; test failure or render-time warnings are preferable to claiming every arbitrary input is collision-free.
- Importers may re-apply their own graph routing on later edits. XML waypoints are encoded in the supported schema, but true layout parity after re-editing is not guaranteed.
- The Open Group Exchange XML supports graphical connection attachment and bend-point elements; the model **still contains semantic ArchiMate elements and relationships**. Visual Paradigm Online drawing XML is not a semantic ArchiMate exchange file.
- Existing generated task artifacts are not modified in place.
- Production configuration, authorization, Skills/Knowledge approval workflow and database are unchanged.

## Validation

- Existing tests for ArchiMate metamodel, SVG, Exchange XML, draw.io, Sequence, governance and builds.
- `apps/server/test/archimate.exportLayout.test.ts` compares actual exported SVG path coordinates, draw.io native waypoints, and Exchange XML attachment/bendpoint locations **per view**.
- `apps/server/test/sequence.exportLayout.test.ts` verifies SVG/draw.io participant and message/note alignment, and stable Mermaid/PlantUML sources.
- The optional `ARCHIMATE_XSD_DIR` environment variable enables schema validation against official ArchiMate Diagram XSD (when files and `xmllint` are installed).
- Phase D still requires real import/edit in draw.io and the organization's Visual Paradigm Online edition; CI alone does not validate third-party rendering.

Reference XSD: https://www.opengroup.org/xsd/archimate/
