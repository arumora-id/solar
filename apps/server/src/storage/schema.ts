/**
 * The complete Postgres schema of SOLAR (Neon or any Postgres 13+), as an ordered list of idempotent statements.
 *
 * PostgresRepository.init() runs them in this order at every start, in one transaction under an advisory lock (two
 * servers starting at once do not race each other). Every statement is safe on an empty database and again on a
 * populated one: `CREATE ... IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, an upsert of the roles, and a DO block that
 * adds the users -> roles foreign key only when it is missing. `npm run db:schema` prints the same statements as one SQL
 * file (docs/schema.sql is a snapshot of it; a test keeps it up to date), so a database can also be prepared by hand.
 *
 * Rules for changes: only append statements or make existing ones idempotent-compatible; never drop or rename in place
 * (old servers may still run against the same database during an update).
 */
import { PERMISSIONS, ROLE_INFO, ROLE_PERMISSIONS, ROLES, type Role } from '@solar/shared';

/** Key of the advisory lock that serialises schema migrations across processes. */
export const SCHEMA_LOCK = 0x501a_0002;

/** A SQL string literal (standard_conforming_strings: only the quote is doubled). */
export function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** The roles of the code (ROLE_INFO + ROLE_PERMISSIONS) as the rows of solar_roles. */
export function roleRows(): Array<{ id: Role; nameId: string; nameEn: string; descriptionId: string; descriptionEn: string; permissions: string[]; sortOrder: number }> {
  return ROLES.map((id) => ({
    id,
    nameId: ROLE_INFO[id].name.id,
    nameEn: ROLE_INFO[id].name.en,
    descriptionId: ROLE_INFO[id].description.id,
    descriptionEn: ROLE_INFO[id].description.en,
    // in the canonical order of PERMISSIONS, so the stored array does not depend on how the table lists them
    permissions: PERMISSIONS.filter((p) => ROLE_PERMISSIONS[id].includes(p)),
    sortOrder: ROLE_INFO[id].sortOrder,
  }));
}

/** Upsert of the roles from the code; `updated_at` changes only when a row's content does. */
function rolesUpsert(): string {
  const values = roleRows()
    .map(
      (r) =>
        `  (${[r.id, r.nameId, r.nameEn, r.descriptionId, r.descriptionEn].map(sqlLiteral).join(', ')}, ${sqlLiteral(JSON.stringify(r.permissions))}::jsonb, ${r.sortOrder}, now())`,
    )
    .join(',\n');
  return `-- the roles of the code (packages/shared ROLE_INFO + ROLE_PERMISSIONS), refreshed at every start: the code stays
-- authoritative, the table is the reference for reports and for the foreign key of solar_users.role
INSERT INTO solar_roles (id, name_id, name_en, description_id, description_en, permissions, sort_order, updated_at) VALUES
${values}
ON CONFLICT (id) DO UPDATE SET
  name_id = EXCLUDED.name_id,
  name_en = EXCLUDED.name_en,
  description_id = EXCLUDED.description_id,
  description_en = EXCLUDED.description_en,
  permissions = EXCLUDED.permissions,
  sort_order = EXCLUDED.sort_order,
  updated_at = EXCLUDED.updated_at
WHERE (solar_roles.name_id, solar_roles.name_en, solar_roles.description_id, solar_roles.description_en, solar_roles.permissions, solar_roles.sort_order)
  IS DISTINCT FROM (EXCLUDED.name_id, EXCLUDED.name_en, EXCLUDED.description_id, EXCLUDED.description_en, EXCLUDED.permissions, EXCLUDED.sort_order)`;
}

/** Name of the foreign key solar_users.role -> solar_roles.id. */
export const USERS_ROLE_FK = 'solar_users_role_fkey';

/**
 * Adds the foreign key solar_users.role -> solar_roles(id) once (Postgres has no ADD CONSTRAINT IF NOT EXISTS). It runs
 * after the roles are upserted, so every account with a role the code knows is valid. It is added NOT VALID and then
 * validated: a database whose solar_users holds a role the code does not know (edited by hand) still starts - the
 * constraint guards every new and changed row, the old rows are reported with a WARNING, and it is validated by a
 * later start once they are fixed.
 */
const usersRoleForeignKey = `-- solar_users.role must name a role of solar_roles (added once; validated when every existing row is valid)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${USERS_ROLE_FK}' AND conrelid = 'solar_users'::regclass) THEN
    BEGIN
      ALTER TABLE solar_users ADD CONSTRAINT ${USERS_ROLE_FK} FOREIGN KEY (role) REFERENCES solar_roles (id) NOT VALID;
    EXCEPTION WHEN duplicate_object THEN
      NULL; -- added meanwhile by another server
    END;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${USERS_ROLE_FK}' AND conrelid = 'solar_users'::regclass AND NOT convalidated) THEN
    IF EXISTS (SELECT 1 FROM solar_users u WHERE NOT EXISTS (SELECT 1 FROM solar_roles r WHERE r.id = u.role)) THEN
      RAISE WARNING 'solar_users has accounts with a role that is not in solar_roles - ${USERS_ROLE_FK} stays NOT VALID until they are fixed';
    ELSE
      ALTER TABLE solar_users VALIDATE CONSTRAINT ${USERS_ROLE_FK};
    END IF;
  END IF;
END
$$`;

/** The ordered, idempotent statements of the schema (one SQL statement each; a statement may start with comments). */
export const POSTGRES_SCHEMA: readonly string[] = [
  // ---- tasks and their timeline ----------------------------------------------------------------------------------
  `-- tasks: one request to the agent
CREATE TABLE IF NOT EXISTS solar_tasks (
  id            text PRIMARY KEY,
  session_id    text NOT NULL,
  title         text NOT NULL,
  prompt        text NOT NULL,
  status        text NOT NULL,
  progress      integer NOT NULL DEFAULT 0,
  current_step  text,
  model         text NOT NULL,
  created_at    timestamptz NOT NULL,
  started_at    timestamptz,
  finished_at   timestamptz,
  result        text,
  error         text,
  usage         jsonb NOT NULL DEFAULT '{}'::jsonb
)`,
  'CREATE INDEX IF NOT EXISTS solar_tasks_created_idx ON solar_tasks (created_at DESC)',
  'CREATE INDEX IF NOT EXISTS solar_tasks_session_idx ON solar_tasks (session_id, created_at DESC)',
  `-- the timeline of a task (status, progress, tool calls, results...)
CREATE TABLE IF NOT EXISTS solar_task_events (
  id       text PRIMARY KEY,
  task_id  text NOT NULL REFERENCES solar_tasks(id) ON DELETE CASCADE,
  seq      integer NOT NULL,
  type     text NOT NULL,
  at       timestamptz NOT NULL,
  payload  jsonb NOT NULL
)`,
  'CREATE INDEX IF NOT EXISTS solar_task_events_task_idx ON solar_task_events (task_id, seq)',
  `-- metadata of generated files (the files themselves are in the object store)
CREATE TABLE IF NOT EXISTS solar_artifacts (
  id           text PRIMARY KEY,
  task_id      text NOT NULL REFERENCES solar_tasks(id) ON DELETE CASCADE,
  name         text NOT NULL,
  title        text NOT NULL,
  kind         text NOT NULL,
  mime_type    text NOT NULL,
  size         integer NOT NULL,
  storage_key  text NOT NULL,
  bundle       text NOT NULL,
  description  text,
  created_at   timestamptz NOT NULL
)`,
  'CREATE INDEX IF NOT EXISTS solar_artifacts_task_idx ON solar_artifacts (task_id, created_at)',
  `-- approvals the agent asked for (human in the loop)
CREATE TABLE IF NOT EXISTS solar_confirmations (
  id            text PRIMARY KEY,
  task_id       text NOT NULL REFERENCES solar_tasks(id) ON DELETE CASCADE,
  tool_use_id   text NOT NULL,
  tool          text NOT NULL,
  display_name  text NOT NULL,
  plugin_id     text,
  plugin_name   text,
  reason        text NOT NULL,
  input         jsonb,
  status        text NOT NULL,
  created_at    timestamptz NOT NULL,
  resolved_at   timestamptz,
  note          text
)`,
  'CREATE INDEX IF NOT EXISTS solar_confirmations_status_idx ON solar_confirmations (status, created_at)',
  "ALTER TABLE solar_tasks ADD COLUMN IF NOT EXISTS attachment_ids jsonb NOT NULL DEFAULT '[]'::jsonb",
  `-- interface language of the client that created the task; tasks from before languages existed are Indonesian
ALTER TABLE solar_tasks ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'id'`,

  // ---- attachments (project documents) -----------------------------------------------------------------------------
  `-- metadata of uploaded project documents (the files and their extracted text are in the object store)
CREATE TABLE IF NOT EXISTS solar_attachments (
  id           text PRIMARY KEY,
  session_id   text NOT NULL,
  name         text NOT NULL,
  kind         text NOT NULL,
  mime_type    text NOT NULL,
  size         integer NOT NULL,
  parts        integer,
  chars        integer NOT NULL,
  outline      jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings     jsonb NOT NULL DEFAULT '[]'::jsonb,
  storage_key  text NOT NULL,
  text_key     text NOT NULL,
  created_at   timestamptz NOT NULL
)`,
  'CREATE INDEX IF NOT EXISTS solar_attachments_session_idx ON solar_attachments (session_id, created_at)',

  // ---- user accounts and login sessions ------------------------------------------------------------------------------
  `-- owner of tasks and attachments: a user id or 'system:access-token' (null on rows from before accounts existed);
-- no foreign key: a deleted account's tasks keep their owner id
ALTER TABLE solar_tasks ADD COLUMN IF NOT EXISTS owner_id text`,
  'CREATE INDEX IF NOT EXISTS solar_tasks_owner_idx ON solar_tasks (owner_id, created_at DESC)',
  'ALTER TABLE solar_attachments ADD COLUMN IF NOT EXISTS owner_id text',
  `-- user accounts (password_hash = scrypt$N$r$p$salt$hash; never returned by the API)
CREATE TABLE IF NOT EXISTS solar_users (
  id             text PRIMARY KEY,
  username       text NOT NULL,
  email          text NOT NULL,
  name           text NOT NULL,
  role           text NOT NULL,
  status         text NOT NULL,
  password_hash  text NOT NULL,
  created_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL,
  last_login_at  timestamptz,
  approved_at    timestamptz,
  approved_by    text
)`,
  'CREATE UNIQUE INDEX IF NOT EXISTS solar_users_username_key ON solar_users (lower(username))',
  'CREATE UNIQUE INDEX IF NOT EXISTS solar_users_email_key ON solar_users (lower(email))',
  'CREATE INDEX IF NOT EXISTS solar_users_status_idx ON solar_users (status, created_at)',
  `-- login sessions: only the SHA-256 of the cookie's token is stored
CREATE TABLE IF NOT EXISTS solar_sessions (
  token_hash    text PRIMARY KEY,
  user_id       text NOT NULL REFERENCES solar_users(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL,
  last_seen_at  timestamptz NOT NULL,
  expires_at    timestamptz NOT NULL,
  user_agent    text,
  ip            text
)`,
  'CREATE INDEX IF NOT EXISTS solar_sessions_user_idx ON solar_sessions (user_id)',
  'CREATE INDEX IF NOT EXISTS solar_sessions_expires_idx ON solar_sessions (expires_at)',

  // ---- roles ----------------------------------------------------------------------------------------------------------
  `-- roles and their permissions (a copy of the code's definition, see the upsert below)
CREATE TABLE IF NOT EXISTS solar_roles (
  id              text PRIMARY KEY,
  name_id         text NOT NULL,
  name_en         text NOT NULL,
  description_id  text NOT NULL,
  description_en  text NOT NULL,
  permissions     jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order      integer NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now()
)`,
  rolesUpsert(),
  usersRoleForeignKey,

  // ---- activity log (audit trail) -------------------------------------------------------------------------------------
  `-- who did what and when: a snapshot of the actor's name and role at that moment; never passwords, tokens, hashes,
-- setup codes or file contents. Kept ACTIVITY_RETENTION_DAYS (default 365; 0 = forever), cleaned up daily.
-- No foreign key to solar_users: the log outlives deleted accounts.
CREATE TABLE IF NOT EXISTS solar_activity (
  id            text PRIMARY KEY,
  at            timestamptz NOT NULL,
  actor_id      text,
  actor_name    text,
  actor_role    text,
  actor_kind    text NOT NULL CHECK (actor_kind IN ('user', 'token', 'anonymous', 'system')),
  action        text NOT NULL,
  target_type   text,
  target_id     text,
  target_label  text,
  outcome       text NOT NULL DEFAULT 'success' CHECK (outcome IN ('success', 'failure')),
  ip            text,
  user_agent    text,
  details       jsonb
)`,
  'CREATE INDEX IF NOT EXISTS solar_activity_at_idx ON solar_activity (at DESC, id DESC)',
  'CREATE INDEX IF NOT EXISTS solar_activity_actor_idx ON solar_activity (actor_id, at DESC, id DESC)',
  'CREATE INDEX IF NOT EXISTS solar_activity_action_idx ON solar_activity (action, at DESC, id DESC)',
];

/** Every table the schema creates (the tests check that each is covered). */
export const SCHEMA_TABLES = [
  'solar_tasks',
  'solar_task_events',
  'solar_artifacts',
  'solar_confirmations',
  'solar_attachments',
  'solar_users',
  'solar_sessions',
  'solar_roles',
  'solar_activity',
] as const;

/**
 * The schema as one SQL file: a header, then every statement followed by `;` and a blank line (split on `;\n\n` to get
 * the statements back; a DO block keeps its inner semicolons). Runs as a whole in psql or the Neon SQL editor.
 */
export function renderSchemaSql(): string {
  const header = [
    '-- SOLAR AI AGENT - Postgres schema (Neon or any Postgres 13+)',
    '-- Generated by `npm run db:schema` from apps/server/src/storage/schema.ts - do not edit by hand.',
    '-- Idempotent: safe on an empty database and on one that is already in use; the server runs the same statements',
    '-- at every start. Apply by hand e.g. with: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f docs/schema.sql',
    '',
  ].join('\n');
  return `${header}\n${POSTGRES_SCHEMA.map((s) => `${s};`).join('\n\n')}\n`;
}
