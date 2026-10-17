# SOLAR AI AGENT v1.0.7 — Release Notes

**Status:** release candidate until `v1.0.7` tag and GitHub Release have been published by the existing Windows/Desktop workflow.

**Source baseline:** v1.0.6 plus merged PR #17 (Conversation-assisted Skill/Knowledge proposals), and this version alignment change.

## Added

- Conversation tools to create a **private Skill/Knowledge Draft** with content preview and user confirmation.
- Conversation tools to list, read and revise the requester's own proposals.
- Conversation tool to Submit the requester's own Draft, gated by explicit confirmation.
- Document-assisted draft preparation using existing attachment reader tools; text extraction does not validate document facts or execute spreadsheet formulas.
- Tests for draft privacy, role isolation, confirmation and existing reviewer governance.
- Opt-in operator deployment and image-only rollback scripts, with preflight verification and checkpoints.

## Governance preserved

- Solar Staff cannot read/write live administrator Skills or Knowledge, approve proposals, publish, use admin MCP integrations, or obtain image privileges.
- Submitted content still requires **both** Superadmin and Head of IT SOLAR approval.
- Publication remains an explicit separate reviewer action; newly published Skills are disabled by default.
- No multi-agent behavior, project workspace, or new microservice is part of v1.0.7.

## Version consistency

The root and four workspace package manifests, lockfile workspace records, internal `@solar/shared` dependency pins, and backend `APP_VERSION` all use `1.0.7`.

## Release gate

1. Review version bump changes and ensure CI passes on the release commit.
2. Merge the release preparation PR; verify CI on the final `main` SHA.
3. From GitHub Actions, run **Desktop installer (Windows)** on `main` with `release=true`. The existing workflow builds both artifacts and publishes the tag and Release **only if jobs succeed**.
4. Verify `v1.0.7` points to the released commit and confirm the release contains a Windows installer and self-hosted server ZIP.
5. Treat VPS rollout as **separate**: verify staging/production-specific configuration, consistent backups and operator approval before running the deployment script.

The presence of a release tag, CI success, or healthy HTTP endpoint alone does **not** demonstrate production deployment or validate real-world LLM extraction of business spreadsheets.
