---
name: ArchiMate 3.2 Modeling
description: How to build correct, readable ArchiMate 3.2 models and views with create_archimate_model (element choice per layer, allowed relationship patterns, viewpoint recipes, naming and review checklist).
---

# ArchiMate 3.2 Modeling

`create_archimate_model` validates every relationship against the official ArchiMate 3.2
relationship table. Model it right the first time with the patterns below; when unsure about a
pair, call `archimate_relationship_rules` first.

**User rules first.** If the knowledge base has ArchiMate rules (e.g. `standards/ARCHIMATE.md` - find them with
`search_knowledge "archimate"`), read them before modelling: their mandatory viewpoints, allowed elements per layer,
naming and layout rules override this skill. Element names and types of existing systems come from their
`systems/*.md` files.

## Element choice
| Need to show | Use |
|---|---|
| Person / organisation unit | BusinessActor |
| Responsibility played by an actor | BusinessRole (actor -Assignment-> role) |
| End-to-end business activity | BusinessProcess (verb phrase) |
| Capability-like grouping of behaviour | BusinessFunction |
| Value offered to customers/consumers | BusinessService |
| Business information | BusinessObject |
| Deployable software unit (service, app, SaaS) | ApplicationComponent |
| API / UI exposed by a component | ApplicationInterface (component -Composition-> interface) |
| Functionality offered to others | ApplicationService |
| Internal processing | ApplicationFunction / ApplicationProcess |
| Data entity | DataObject |
| Server, cluster, cloud account, VM | Node |
| Physical / end-user hardware | Device |
| Runtime, DBMS, middleware, OS, broker | SystemSoftware |
| Platform capability (hosting, messaging, storage) | TechnologyService |
| Deployable package, schema, config file | Artifact |
| Network / VPC / internet link | CommunicationNetwork / Path |
| Why: goal, driver, requirement, principle | Goal, Driver, Requirement, Principle, Constraint |
| Roadmap | WorkPackage, Deliverable, Plateau, Gap |
| Strategic ability | Capability, Resource, ValueStream |

## Relationship patterns (all valid in ArchiMate 3.2)
- Actor -Assignment-> Role -Assignment-> BusinessProcess -Realization-> BusinessService -Serving-> Role
- BusinessProcess -Access(Read/Write)-> BusinessObject; DataObject -Realization-> BusinessObject
- ApplicationComponent -Assignment-> ApplicationFunction -Realization-> ApplicationService
  (shortcut also allowed: ApplicationComponent -Realization-> ApplicationService)
- ApplicationService -Serving-> BusinessProcess (or -> BusinessRole / ApplicationComponent)
- ApplicationComponent -Composition-> ApplicationInterface; ApplicationInterface -Serving-> BusinessRole
- ApplicationComponent -Flow-> ApplicationComponent (name the flow: "order event", "payment request")
- ApplicationComponent -Access(ReadWrite)-> DataObject (Read = reads, Write = writes/creates)
- Node -Composition-> SystemSoftware; Node -Realization-> TechnologyService
- TechnologyService -Serving-> ApplicationComponent
- Artifact -Realization-> ApplicationComponent / DataObject; Node -Assignment-> Artifact
- CommunicationNetwork -Association-> Node (nodes connected to a network)
- Requirement -Realization- by ApplicationComponent/Service (component -Realization-> requirement)
- Driver -Influence-> Goal; Goal -Realization- by Outcome; Principle/Requirement -Influence-> Goal
- WorkPackage -Realization-> Deliverable; Deliverable -Realization-> ApplicationComponent
- Grouping -Aggregation-> any element (use for "domain" or "bounded context" boundaries)

Common mistakes the validator will reject:
- DataObject -Serving-> anything (passive elements never serve; use Access from behaviour).
- Serving from an active structure element to a process when you meant Assignment.
- Flow/Triggering between passive elements.
- Realization from a process to a component (direction is component -> service / requirement).

## Views (viewpoints) - put them all in one call
- **Layered** (overview): business actors/roles -> business processes & services -> application
  services -> application components & interfaces -> technology services -> nodes.
- **Application Cooperation**: application components, interfaces, flows between them, key data objects.
- **Technology Usage / Infrastructure**: nodes, system software, technology services, networks,
  artifacts, and which components they serve.
- **Motivation** (if drivers/goals are given): stakeholders, drivers, goals, outcomes, requirements.
- **Implementation & Migration** (if a roadmap is requested): plateaus, gaps, work packages, deliverables.
Keep 7-40 elements per view. Give every view a `viewpoint` value.

## Naming
- Components/nodes: noun phrases in Title Case ("Order Service", "PostgreSQL 16 (Neon)").
- Processes/functions: verb + object ("Validate Order"). Services: value-oriented ("Order Management").
- Ids: short kebab-case, prefixed by layer, e.g. `ba-customer`, `bp-place-order`, `ac-order-svc`,
  `as-order-mgmt`, `do-order`, `tn-k8s`, `ts-hosting`.
- Same real-world thing = same element (reuse the id in several views).

## Review checklist (before calling the tool)
- Every element has at least one relationship; every view tells one story.
- Access relationships have accessType; association only when nothing more specific fits.
- Flows/serving directions read naturally ("A serves B", "A flows to B").
- Technology layer explains where every important component runs.
