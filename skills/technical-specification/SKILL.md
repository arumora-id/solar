---
name: Technical Specification Document
description: How to write a complete, reviewable Technical Specification Document (TSD) with create_technical_specification - section intent, requirement writing rules, NFR catalogue, integration/API detail and quality checklist.
---

# Technical Specification Document (TSD)

`create_technical_specification` renders Markdown (GitHub-ready) and print-ready HTML. Your job is
the content. Read `nfr-catalog.md` (via `read_skill_file`) when writing non-functional requirements.

## Document control
- `documentId`: `TSD-<SYSTEM>-<NNN>` (e.g. `TSD-ORD-001`), `version` "1.0", `status` "Draft".
- `authors`: use the name the user gave; otherwise "Solution Architect". Never invent people.
- `language`: "id" (default) or "en" if the user writes/asks in English.

## Section intent
- **executiveSummary**: 1-2 paragraphs - problem, proposed solution, key decisions, main risks.
- **background / objectives**: business context and measurable objectives.
- **scope**: explicit in-scope and out-of-scope lists (out-of-scope prevents scope creep).
- **stakeholders**: roles from the request (Product Owner, Security, Operations, ...).
- **assumptions / constraints / dependencies**: prefix assumptions with `ASM-nn`.
- **architecture.overview**: how the solution works end-to-end, referencing the diagrams;
  `architecture.diagrams`: the ArchiMate view SVG artifact ids with captions.
- **decisions**: ADR style - `AD-nn`, decision, rationale, alternatives considered.
- **components**: one row per ArchiMate application component / key technology node.
- **functionalRequirements**: `FR-nn`, MoSCoW priority, testable acceptance criteria
  (Given/When/Then is welcome).
- **nonFunctionalRequirements**: `NFR-nn` with category and a measurable metric.
- **integrations**: `INT-nn` source -> target, protocol, pattern, data format, frequency, security.
- **apis**: method, path, auth, realistic JSON examples, error codes (e.g. `400 VALIDATION_ERROR`).
- **dataModel**: entities with attribute name, type, required, description.
- **processFlows**: one entry per sequence diagram (diagram.artifactId = its SVG artifact id).
- **security, deployment, observability, migration, testing**: concise Markdown.
- **risks**: `RSK-nn` with impact, likelihood, mitigation; **openIssues**: `OI-nn`.
- **glossary**: domain terms and acronyms used in the document.
- **references**: every attached source document used (file name, version/date if stated, what it
  contributed), plus external standards cited.

## Requirement writing rules
- One requirement = one testable statement ("The system shall ..." / "Sistem harus ...").
- No vague words without a metric ("fast", "secure", "user friendly", "scalable").
- Ids are unique across FR, NFR, AD, INT, RSK and OI (the tool rejects duplicates).

## Consistency checklist
- Components, integrations and process flows use exactly the names in the diagrams.
- Every FR is covered by at least one component/API; every integration has a security control.
- Every diagram created in this task is referenced (architecture.diagrams or processFlows).
- Assumptions and open issues are honest - nothing invented to look complete.
- When documents were attached: requirements, integrations and NFRs reflect them (keep their IDs/names),
  each is traceable to its source (`file, page/slide/sheet` in `description` for functional requirements and
  integrations; NFRs have no description field, so append the source to the `requirement` text), and conflicts
  between sources are open issues.
