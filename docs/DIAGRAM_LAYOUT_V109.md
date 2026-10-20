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
- **Phase D (automated):** geometry diagnostics and non-blocking warnings, deterministic stress tests, and Chromium SVG visual inspection with archived editable XML + PNG screenshot fixtures. **Manual external-editor QA remains open.**

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
- Phase D automated CI covers native layout diagnostics, dense graph routing, Sequence stress and Chromium SVG screenshots. It **does not** validate external editor import/edit. Follow the manual gate below.

Reference XSD: https://www.opengroup.org/xsd/archimate/

## Phase D — QA status and operational handoff

**Automated QA completed** at commit `26ef21e55fd53e637f57a240ca76d8c6667e4ee0`:
- GitHub Actions [CI run 39419696446](https://github.com/arumora-id/solar/actions/runs/39419696446): **SUCCESS** (typecheck, unit/integration, build, browser governance/responsive, diagram Chromium, Windows installer).
- `apps/server/src/generators/archimate/quality.ts`: deterministic audit detects node overlaps, connectors crossing non-endpoint node boxes, nonorthogonal/fallback paths, node/label and label/label overlaps, and out-of-canvas geometry. Non-blocking view-specific warnings tell users when to review or simplify a model; these diagnostics do **not** imply zero crossings in all graphs.
- `apps/server/test/diagram.quality.test.ts`: intentional bad-geometry fixture verifies each diagnostic; clear three-node obstacle route; 20-grid-node/7-relationship deterministic routing stress; multi-view XML/draw.io/SVG completeness; 8-participant/33-message Sequence with nested fragments, notes and long labels.
- `scripts/diagram-visual-qa.mjs`: Chromium opens rendered fixture SVGs, checks a finite viewBox and readable text, captures PNG screenshots, saves ArchiMate/Sequence `.svg` / `.drawio` / `.vp-online.xml`, ArchiMate Exchange XML, and a JSON QA report.
- Download these samples from the **`solar-diagram-visual-qa`** artifact in the linked Actions run. Artifact expiry follows GitHub retention settings.

**Manual gates not completed by CI — do not mark them passed without actual verification:**

1. Download the CI artifact. Open `archimate-sample.drawio` in [draw.io](https://app.diagrams.net/) using **File → Open From → Device**; check all views, text readability, relationship arrowheads, label collisions and bendpoints. Move an element, save, close, and reopen.
2. Import `sequence-sample.drawio` in draw.io. Verify message arrows, nested fragment boundaries, self messages, notes, activation bar start/end, participant footer, and editability after save/reopen.
3. Import `*.vp-online.xml` in the organization's [Visual Paradigm Online](https://online.visual-paradigm.com/) editor following its documented **draw.io XML** import workflow; confirm the subscription/edition supports it. Compare first-open layout with the PNG screenshots, edit an element, save and reopen.
4. If semantic ArchiMate import is required, separately test `archimate-sample.exchange.xml` in an **Open Group Exchange-compatible modeling tool** (e.g., supported Visual Paradigm Desktop edition). The VP Online drawing import **does not** guarantee native ArchiMate model semantics.
5. Record pass/fail and editor build/edition; attach failure screenshots if any. Remediate regressions **on this feature branch**, then rerun CI before requesting approval.

**Release decision:** automated regression suite passed, but **external draw.io/VP Online import/edit QA and independent PR review are still pending**. This feature branch must remain a Draft PR and must not be tagged or deployed until those gates are accepted.
