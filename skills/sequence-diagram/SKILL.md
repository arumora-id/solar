---
name: UML Sequence Diagrams
description: How to model clear, correct sequence diagrams with create_sequence_diagram (participants, message styles, activations, alt/opt/loop/par fragments, error paths) consistent with the ArchiMate model.
---

# UML Sequence Diagrams

## Scenario selection
Produce one diagram per scenario. For a typical feature: the main happy path, the most important
failure path (validation error, timeout, payment declined...) and any asynchronous/event flow.
Prefer 6-25 messages per diagram; split bigger flows.

## Participants
- Use the same names as the ArchiMate application components, nodes and external systems.
- Kinds: `actor` for people, `boundary` for UI / API gateway, `control` for orchestrating services,
  `entity` for domain services that own data, `database` for data stores, `queue` for brokers/topics,
  `external` for third-party systems, `participant` otherwise.
- Ids: CamelCase letters/digits/underscore, starting with a letter (e.g. `OrderSvc`). Never use
  reserved words such as `end`, `note`, `loop`, `alt`, `par`, `opt`, `group`, `box`, `title`.

## Messages
- `sync` for request/response calls (REST, gRPC, SQL), `async` for events/queues/fire-and-forget,
  `reply` for responses (dashed). Text = operation + key data, e.g. `POST /orders {items}`,
  `201 Created {orderId}`, `publish OrderPlaced`.
- Activations: set `activate: true` on the call into a component, and `deactivate: true` on the
  reply that component sends back. Every activation must be closed by a reply from the same
  participant (the validator checks the balance).

## Fragments (flat list)
```
{ "type": "fragment_start", "kind": "alt", "label": "payment approved" }
  ... messages ...
{ "type": "fragment_else", "label": "payment declined" }
  ... messages ...
{ "type": "fragment_end" }
```
- `alt` (if/else), `opt` (optional), `loop` (repetition, label = condition), `par` (parallel
  branches, separated with fragment_else), `critical` (atomic region), `break` (abort the flow),
  `group` (labelled box). `fragment_else` is only valid in alt / par / critical.
- Every branch must contain at least one message or note. Dividers (`divider`) are only allowed
  outside fragments - use them to separate phases ("Authentication", "Checkout").

## Notes
Use `note` for SLAs, idempotency keys, retries, security remarks (`over` 1 or 2 participants).

## Checklist
- Each external call shows its reply (or is explicitly async).
- Error paths end with a clear response to the caller.
- Security steps (authN/authZ, token validation) appear where relevant.
- Names match the ArchiMate model and the TSD integration list.
