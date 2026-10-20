# SOLAR v1.0.8 — Conversation diagram export

**Status:** implemented in published GitHub Release [v1.0.8](https://github.com/arumora-id/solar/releases/tag/v1.0.8), commit `1cc0e98093a68381a5df068b945edce2f7dc2936`. Originally developed in `feat/diagram-export-v1.0.8`. GitHub publication is **not proof of production VPS deployment** or successful live VP Online import.

## Conversation workflow

For new ArchiMate and Sequence results, SOLAR writes its existing formats plus two editable drawing downloads:

- **Download for draw.io:** .drawio; visit https://app.diagrams.net/ and choose File > Open From > Device.
- **Download for VP Online:** .vp-online.xml; sign in to VP Online, select the Diagram tool, then Open From Device.

The VP Online XML uses the draw.io XML format documented as importable by VP Online; it is not the Open Group ArchiMate Model Exchange Format. The two downloads contain equivalent native drawing elements but different file extensions. No confidential diagram is uploaded to an external service automatically.

New files appear in Conversation artifacts and task ZIPs, with separate download buttons. Existing artifacts stay readable.

## Representation and limits

- ArchiMate: one draw.io page per model view, using native editable boxes and connectors. Keep using the existing .archimate.xml Open Group Exchange artifact for **semantic model import into Visual Paradigm Desktop**, not VP Online.
- Sequence: lifelines, message arrows, notes, dividers and combined fragments as editable cells. Existing Mermaid/PlantUML artifacts remain.
- External editors may alter layout/style; imported draw.io native shapes are **not** guaranteed to retain all ArchiMate metamodel semantics or full activation nesting.
- Only new generated diagrams get these files. No automatic backfill for older v1.0.7 Conversation tasks.
- No database, access-control, Skills/Knowledge governance, multi-agent or deployment changes.
- Package manifests, lockfile and server version are `1.0.8` in the published release.

## QA gates

Run CI with npm ci, typecheck, tests, builds and browser/Windows checks. Automated draw.io tests cover multiple ArchiMate pages, editable native cells, sequence frames and XML escaping.

Manual/external-service QA (not covered by CI): generate both diagram types from Conversation; download/import/edit .drawio at draw.io and .vp-online.xml at VP Online (according to subscription); verify task ZIP, authorization and no unexpected external data transfer. Check ArchiMate Exchange import in supported desktop tooling separately. CI does not exercise the VP Online hosted importer.

References:
- https://knowhow.visual-paradigm.com/vp-online/import-diagrams-draw-io-vp-online/
- https://www.drawio.com/docs/manual/advanced/diagram-source-edit/
- https://www.visual-paradigm.com/support/documents/vpuserguide/4455/4409/86476_importexport.html
