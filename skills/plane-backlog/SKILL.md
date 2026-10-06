---
name: Plane Backlog (plane.mesthi.com)
description: Turn a TSD / architecture package into a clean backlog on plane.mesthi.com with plane_create_backlog_items (epic -> story hierarchy, acceptance criteria, labels, priorities, no duplicates).
---

# Plane Backlog on plane.mesthi.com

Use only when the user asks for backlog items. Prefer the built-in `plane_create_backlog_items`
(one call, ordered, idempotent with `skip_existing`). Use the Plane MCP plugin tools for other
operations (states, cycles, modules, comments).

## Project
- Use `PLANE_PROJECT_ID` when configured; otherwise call `plane_list_projects` and pick the project
  the user named. If the user named none and several exist, ask (this is a real blocker).

## Structure
- **Epic** = one per capability / major component (ref `EPIC-n`), no parentRef.
- **Story** = one per functional requirement (ref = the FR id, e.g. `FR-03`), parentRef = its epic.
- **Enabler / technical task** = NFRs, integrations, infrastructure (ref = NFR/INT id), parentRef = epic.
- Name format: `[FR-03] Customer can cancel an unpaid order` - keep the requirement id in the name so
  the backlog traces back to the TSD.

## Description (Markdown)
```
**Source:** TSD-ORD-001 v1.0 - FR-03
**Context:** <1-3 sentences>
**Acceptance criteria**
- Given ... when ... then ...
**Architecture:** components <names from the ArchiMate model>; sequence "<diagram title>"
```

## Priority mapping
MoSCoW Must -> `high` (or `urgent` if the user says it is blocking), Should -> `medium`,
Could -> `low`, Won't -> do not create.

## Labels
`architecture`, `backend`, `frontend`, `integration`, `security`, `nfr`, `infra`, `data` -
at most 3 per item.

## After creating
Report the created keys (e.g. `ORD-12`) and how many were skipped as duplicates.
