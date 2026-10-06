---
name: Solution Architect Delivery Package
description: End-to-end, one-pass delivery of an architecture package (ArchiMate views + sequence diagrams + Technical Specification Document, optionally GitHub publish and Plane backlog). Use for any request that asks for more than one deliverable or for "a full design" of a system/feature.
---

# Solution Architect Delivery Package

Goal: turn one request into a complete, consistent, validated package **in a single run**, without
back-and-forth. The architect reviews the result afterwards.

## 1. Intake (do this silently, do not ask the user)
Extract from the request and from `<session_history>`:
- System / initiative name, business goal and drivers.
- Actors and consumers (people, channels, external systems).
- Existing systems that must be reused or integrated.
- Constraints: technology standards, cloud/on-prem, regulations, deadlines, budget.
- Non-functional expectations (volume, latency, availability, security, data residency).
- Which deliverables are wanted. If not stated, a "design" means: ArchiMate (Layered + Application
  Cooperation views), 2-4 sequence diagrams for the key scenarios, and a TSD.

Anything missing becomes an **explicit assumption** (prefix it with `ASM-nn`) or an **open issue**
(`OI-nn`). Never invent real names of people, URLs, IPs, credentials or vendor contracts.

## 2. Plan and progress
Call `update_progress` (≈5%) with the plan, e.g. "Plan: ArchiMate 2 views, 3 sequence diagrams, TSD".
Update progress after every deliverable (ArchiMate ≈35%, sequences ≈60%, TSD ≈85%, publish ≈95%).

## 3. Build in this order (each step reuses the previous one)
1. **ArchiMate model** - load skill `archimate-modeling`. One `create_archimate_model` call with all
   elements, relationships and views. The element names you choose here are the vocabulary for
   everything that follows.
2. **Sequence diagrams** - load skill `sequence-diagram`. Participants = application components /
   nodes / external systems from the model, with the same names. One call per scenario
   (happy path + the most important alternative/error paths).
3. **Technical Specification** - load skill `technical-specification`. Reference the SVG artifact ids
   returned in steps 1-2. Requirements, components, integrations and APIs must match the diagrams.
4. **Optional**: `publish_artifacts_to_github` (skill `github-publishing`) and
   `plane_create_backlog_items` (skill `plane-backlog`) - only when the user asked for it.

If a tool returns validation errors: read all of them, fix the input, call again with the complete
corrected input. Do not drop elements just to make an error disappear unless they were wrong.

## 4. Consistency check before the final answer
- Every application component in sequence diagrams exists in the ArchiMate model (same name).
- Every integration in the TSD appears as a relationship (flow/serving/triggering) in the model.
- Every functional requirement is realised by at least one component; every NFR has a metric.
- Assumptions and open issues are listed in the TSD and in the answer.
- Use `list_artifacts` to confirm all deliverables exist.

## 5. Final answer (Bahasa Indonesia unless the user wrote in English)
```
Ringkasan: <1 paragraf>

Deliverables:
- ArchiMate: <file .archimate.xml> (art_...), views: <view.svg> (art_...)
- Sequence: <judul> - <file.svg> (art_...)
- TSD: <file.md> (art_...), <file.html> (art_...)

Asumsi: ASM-01 ..., ASM-02 ...
Isu terbuka: OI-01 ...
Langkah berikutnya: <publish ke GitHub / buat backlog Plane / review dengan stakeholder>
```
