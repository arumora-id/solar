# SOLAR AI AGENT v1.0.9 — Release Preparation

**Status:** prepared for release, **not published**. Merge this PR only after review and CI. As of this preparation, the `v1.0.9` GitHub tag and Release do not exist.

## Scope

- Diagram Layout & Export Quality Optimization from the merged feature PR [#22](https://github.com/arumora-id/solar/pull/22): obstacle-aware ArchiMate routing, shared editable draw.io / VP Online / SVG geometry, Sequence message/fragment/activation alignment, diagnostics and stress/visual QA.
- This PR itself changes **only version metadata**, internal `@solar/shared` pins and this release note; it does not alter diagram-generation algorithms, security policy, persistence or deployment.
- Root, four workspace manifests, `package-lock.json` SOLAR workspace records, and server `APP_VERSION` are aligned to `1.0.9`. Third-party dependency entries are preserved byte-for-byte by selective JSON field changes.

## Release gates

1. Review and merge this release-preparation PR; verify CI **SUCCESS** on the final `main` commit.
2. Verify required real-world QA and acceptance checks documented in [DIAGRAM_LAYOUT_V109.md](DIAGRAM_LAYOUT_V109.md), especially opening/editing/saving/reopening draw.io and the supported Visual Paradigm Online importer. Automated CI alone cannot prove external-editor import compatibility.
3. In GitHub Actions **Desktop installer (Windows)**, select `main`, click **Run workflow**, and check `release=true`. The workflow builds the Windows installer and self-hosted ZIP and **creates tag `v1.0.9` and its GitHub Release itself**. **Do not create the tag separately when using this method.**
4. Confirm the release is published with both the Windows `.exe` and server `.zip`, and the tag points to the approved `main` commit.
5. Only then follow the separate reviewed VPS Docker deployment procedure with verified backup and rollback. Publishing the GitHub Release does **not** deploy production.

**Baseline:** v1.0.8 remains untouched. Previous diagram artefacts are not retroactively altered.
