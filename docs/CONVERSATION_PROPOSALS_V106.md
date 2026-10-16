# Conversation-assisted Skill and Knowledge Proposals

**Baseline:** SOLAR v1.0.6. **Scope:** Skill/Knowledge proposal creation, review and publication. **Multi-agent:** out of scope.

## Existing authorization remains authoritative

- Staff has agent.use and content.propose, but not skills.read, skills.manage, knowledge.read, knowledge.write, content.review, settings.manage, or MCP tool access.
- Superadmin and Head of IT SOLAR must both approve a Submitted proposal; publication is a separate authorized reviewer action.
- Published Skills remain disabled until explicitly enabled by authorized administrators.
- Conversation tools enforce requester authorization and private ownership server-side; they do not read administrator Skills or Knowledge.

## Conversation flow

1. Staff uploads a supported document, for example PDF, DOCX, XLSX/XLSM, CSV, PPTX, TXT or Markdown, and asks the agent to draft a Skill or Knowledge proposal.
2. SOLAR uses the existing document reading tools and identifies uncertain details, warnings and source sections; provenance belongs in the draft Markdown.
3. create_content_proposal_draft presents full proposed content through the existing confirmation preview. Reject = no write. Approve = private Draft.
4. Staff may list, preview or revise their own drafts with list_my_content_proposals, read_my_content_proposal, update_content_proposal_draft (edits require confirmation).
5. Staff can request submit_content_proposal. Ownership and Draft status are checked before confirmation; rejection leaves Draft, acceptance sends Submitted for dual review.
6. Existing reviewer UI remains the only path to approve/reject/publish.

**Document limitation:** this increment keeps source references in the Markdown authored by the agent, not a machine-verified attachment registry. Excel extraction reads cached cell values; it does not calculate formulas or run macros. Never claim a workbook calculator has been independently verified.

## Automated validation

- apps/server/test/agent.contentProposalTools.test.ts
- apps/server/test/agent.contentProposalFlow.test.ts
- apps/server/test/agent.roleTools.test.ts
- Existing apps/server/test/auth.access.test.ts and apps/server/test/contentProposal.workflow.test.ts
- npm run typecheck; npm test; npm run build; governance UI smoke and Windows installer CI
- bash -n scripts/deploy-conversation-proposals-vps.sh scripts/rollback-conversation-proposals-vps.sh

## Release and deployment — operator only

No deploy or merge has occurred. Do not deploy a feature branch.

1. Review CI, code and security. Merge only after owner approval.
2. For a new released version, update every package version, package-lock, shared dependency version and APP_VERSION consistently; do not label a new binary as the old released v1.0.6 without a deliberate release decision.
3. Update the existing VPS solar-source checkout to the reviewed merged main commit using fast-forward only. Deployment script never fetches, resets or checks out Git.
4. Obtain external PostgreSQL / S3-compatible backups separately if those modes are configured. Local-data tar is best-effort while the app runs and is not a consistent database backup.
5. Verify the production compose.vps.yml and compose.source.yml, data/.env bind mounts and running solar-app container.
6. Run from source root with these environment variables: EXPECTED_SHA (the full reviewed 40-character commit SHA), EXPECTED_VERSION (release semver), DEPLOY_APPROVED=YES, BACKUP_CONFIRMED=YES. Command: bash scripts/deploy-conversation-proposals-vps.sh
7. Deployment checks git SHA and version, Compose build context, mounts and existing service; locks deployments, stores a checkpoint, builds, recreates only the application service and verifies the health version; on failure it attempts image rollback.
8. Manual rollback requires CHECKPOINT set to a verified path inside the production backup directory and ROLLBACK_APPROVED=YES. Command: bash scripts/rollback-conversation-proposals-vps.sh

**Caution:** /api/health reports product version, not commit SHA. If two binaries use the same version, health alone does not establish which commit runs. Prefer incrementing version for release and check the new Docker image ID.

## Manual QA before release

Use separate Staff, Superadmin and Head of IT accounts. Verify attachment-free and attached-document proposals; document references and extraction warnings; create confirmation and rejection; draft preview and revision; staff isolation; submit confirmation and refusal; dual review; reject with reason; explicit publish; disabled-by-default Skill. Repeat on mobile layout and supported Windows desktop when relevant.

## Out of scope and remaining gaps

- No multi-agent registry/orchestration or agent-specific Knowledge/Skills.
- No automatic publication, enablement, MCP access, or privileged admin reads by Staff.
- No Excel formula recalculation and no claim of source-fact accuracy from summarization alone.
- No separate machine-verifiable attachment provenance model in proposal persistence.
- No production data schema or migration change in this increment.
