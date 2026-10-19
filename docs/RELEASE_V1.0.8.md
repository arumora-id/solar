# SOLAR AI AGENT v1.0.8 — Release Preparation

**Status:** candidate. The `v1.0.8` tag and GitHub Release must only be created after this change has been reviewed and merged, and CI succeeds on the final `main` SHA.

**Baseline:** v1.0.7 + merged PR #19 (Conversation ArchiMate / Sequence diagram exports) + version alignment in this PR.

## New feature: editable diagram export from Conversation

- ArchiMate and Sequence outputs now include provider-labeled download files: `.drawio` for draw.io and `.vp-online.xml` for the draw.io-compatible XML import workflow documented by Visual Paradigm Online.
- The editable diagrams use native diagram shapes, connectors and labels, rather than raster screenshots.
- An ArchiMate model with multiple views yields multiple pages in the drawing.
- Existing formats remain: Open Group ArchiMate Exchange XML for supported semantic import, plus SVG and model JSON; Sequence Mermaid and PlantUML remain.
- Export files appear with Conversation artifact bundles and in the task ZIP.
- No external editor API call or upload happens automatically.

## Important compatibility limits

- Exported native drawing shapes **do not guarantee a lossless semantic ArchiMate model round-trip** or pixel-identical rendering in external editors.
- Visual Paradigm Online hosted XML-import/edit behavior requires **manual end-to-end QA** before treating compatibility as verified. Visual Paradigm desktop semantic ArchiMate import is a different path.
- New exports are generated for **new tasks only**; existing v1.0.7 artifacts are not retroactively converted.
- No changes to permissions, Skill/Knowledge governance, database, multi-agent architecture or VPS deployment.

## Source version

Root/workspace package manifests, `package-lock.json` workspace records and local `@solar/shared` pins, and the server's `APP_VERSION` are aligned to `1.0.8`. Published version is not changed merely by creating this PR.

## Release procedure

1. Complete independent review and merge this release-preparation PR; confirm GitHub CI passes on the final main commit.
2. Verify manual editor-import QA and other release gates from `docs/VPS_DEPLOYMENT.md` if publishing to production.
3. Open GitHub Actions **Desktop installer (Windows)**, choose branch `main`, click **Run workflow** and enable `release=true`.
4. The existing workflow builds the Windows installer and self-hosted server ZIP, then **creates the `v1.0.8` tag and GitHub Release automatically** if the build jobs succeed. **Do not separately push/create the same tag.**
5. Verify the release tag points to the approved release commit and both build assets are present.
6. VPS Docker deployment is a separate operator-managed cutover requiring environment-specific checks, consistent backups, staging validation, and rollback readiness; publishing the GitHub release does not update production.

GitHub workflow: `.github/workflows/desktop-windows.yml`. Feature scope / manual QA: `docs/DIAGRAM_EXPORT_V108.md`.
