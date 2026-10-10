import { numEn, plural } from '../helpers';
import type { Dict } from '../id';

export const settings: Dict['settings'] = {
  source: {
    builtin: 'Built-in',
    user: 'Custom',
  },

  system: {
    theme: 'Theme',
    themes: {
      system: 'Follow system',
      light: 'Light',
      dark: 'Dark',
    },
    compactMode: 'Compact mode (hide the quick buttons under the character)',

    app: {
      label: 'App',
      standalone: 'SOLAR is running as an installed app.',
      install: 'Install SOLAR as an app',
      installHint: 'Its own window and an icon in the Start menu / on the home screen; the interface still opens when the server cannot be reached.',
      iosHint: 'On iPhone/iPad: tap Share, then Add to Home Screen.',
      browserHint:
        'Install it from the browser menu (Chrome/Edge: Install SOLAR AI AGENT). Requires HTTPS, or localhost on the computer that runs the server.',
    },

    serverConfig: 'Server configuration',
    rows: {
      version: 'Version',
      primaryModel: 'Primary model',
      primaryModelValue: (provider: string, model: string, effort: string) => `${provider} · ${model} (reasoning effort ${effort})`,
      modelRoute: 'Model route',
      modelStatus: 'Model status',
      modelReady: 'Ready',
      modelMissingKey: 'NO API key yet (OPENAI_API_KEY or Settings → AI models)',
      knowledgeBase: 'Knowledge base',
      database: 'Database',
      databaseNeon: 'Neon Postgres (DATABASE_URL)',
      databaseLocal: 'Local files (data/)',
      artifactStorage: 'Artifact storage',
      storageS3: 'S3 object storage (Neon/S3)',
      storageLocal: 'Local files (data/artifacts)',
      github: 'GitHub',
      githubConnected: (repo: string, branch: string) => `Connected · default repo: ${repo} (${branch})`,
      githubMissing: 'Not yet (GITHUB_TOKEN)',
      plane: 'Plane',
      accessToken: 'Access token',
      tokenRequired: 'Required',
      tokenNotRequired: 'Not required (localhost only)',
    },
    credentialsHint:
      'LLM providers are set in the AI models tab; other credentials (Neon, S3, GitHub, Plane, Visual Paradigm) in the .env file - see the README.',
    tokenLabel: 'SOLAR access token (SOLAR_ACCESS_TOKEN)',
    saveToken: 'Save token',
  },

  models: {
    intro:
      'SOLAR can use several LLM providers at once: OpenAI, gateways such as OmniRoute/OpenRouter/LiteLLM, Claude, Gemini, or local models (Ollama). The **default route** sets the primary model and its fallbacks: when the primary model fails (connection, quota, rate limit, wrong key), the task automatically moves on to the next model.',
    kind: {
      'openai-chat': 'Chat Completions (OpenAI-compatible)',
      'openai-responses': 'OpenAI Responses API',
    },

    route: {
      title: 'Default route (primary → fallbacks)',
      primary: 'Primary',
      fallback: (n: number) => `Fallback ${numEn(n)}`,
      moveUp: 'Move up',
      moveDown: 'Move down',
      remove: 'Remove from route',
      entryPlaceholder: 'provider/model, e.g. omniroute/claude-sonnet',
      save: 'Save route',
      resetToEnv: 'Reset to the .env model',
      appliesHint: 'Takes effect from the next task, no restart needed.',
    },

    providers: 'Providers',
    addProvider: 'Add provider',
    newProvider: 'New provider',
    editProvider: (id: string) => `Edit provider: ${id}`,
    presetName: {
      ollama: 'Ollama (local)',
    },
    presetHint: {
      omniroute: 'Change the host/port to match your OmniRoute installation.',
      ollama: 'No API key needed. Add the models you have already pulled.',
    },
    fields: {
      id: 'ID (used in routes, e.g. omniroute) - empty = derived from the name',
      kind: 'API type',
      baseUrl: 'Base URL (including /v1)',
      apiKey: 'API key (or a reference to a .env variable, e.g. ${OMNIROUTE_API_KEY}; empty for local models)',
      models: 'Models (one per line). Options: max=16384; reasoning; effort=high; price=input/cached/output (USD per 1 million tokens)',
      advanced: 'Advanced',
      headers: 'Extra headers (KEY=value per line)',
      maxTokensParam: 'Output limit parameter',
      maxTokensAuto: 'Automatic (max_completion_tokens for api.openai.com, max_tokens otherwise)',
      vision: 'Model accepts images',
    },

    fromEnv: '.env',
    ready: 'Ready',
    missingKey: 'No API key yet',
    modelList: (models: string) => `Models: ${models}`,
    missingVars: (vars: string) => `Variables not set yet: ${vars}`,
    envHint: 'Set through OPENAI_API_KEY, OPENAI_BASE_URL and SOLAR_MODEL in .env.',
    testConnection: 'Test connection',
    testing: 'Testing…',
    testOk: (n: number) => `Connected · ${numEn(n)} ${plural(n, 'model')} available`,
    confirmDelete: (name: string) => `Delete provider "${name}"?`,
  },

  knowledge: {
    intro:
      'The knowledge base holds your rules and facts (systems, integrations, ArchiMate standards, PlantUML, APIs, principles). The agent reads the relevant files before designing, and their content overrides the built-in rules. Large registries (lists of systems/APIs) can simply be imported from Excel: one file per row, so the agent reads only what it needs.',
    newFile: 'New file',
    importMarkdown: 'Import .md',
    importFolder: 'Import folder',
    importTable: 'Import Excel/CSV',
    importDocument: 'Import document',

    template: {
      path: 'systems/NAME.md',
      content: `---
id: NAME
type: system
title: Full name
aliases: []
status: active
---

# Full name

Summary.
`,
    },

    noMarkdownPicked: 'No .md files were selected.',
    imported: (n: number) => `${numEn(n)} ${plural(n, 'file')} imported.`,
    importedWithFailures: (n: number, failures: string) => `${numEn(n)} ${plural(n, 'file')} imported; failed: ${failures}.`,
    noTable: 'The file contains no table.',

    table: {
      title: (file: string) => `Import table: ${file}`,
      sheet: 'Sheet',
      sheetOption: (name: string, rows: number, truncated: boolean) =>
        `${name} (${numEn(rows)} ${plural(rows, 'row')}${truncated ? ', truncated' : ''})`,
      truncatedRows:
        'This sheet could not be read in full (too many rows or too much text), so it cannot be imported. Split the file and import each part.',
      truncatedWorkbook:
        'This sheet was not read because the workbook text already reached the limit, so it cannot be imported. Save this sheet as a separate file and import that.',
      idColumn: 'ID / file name column (required)',
      titleColumn: 'Full name column',
      statusColumn: 'Status column (active / sunset / retired)',
      noColumn: '(none)',
      aliasColumns: 'Other name / alias columns (matched against the names in the BRD)',
      sampleRow: (cells: string) => `Sample row: ${cells}`,
      removeStale: 'Delete files from the previous import (same file & sheet) whose rows no longer exist',
      done: (written: number, folder: string, index: string, removed: number, notes: string) =>
        `${numEn(written)} ${plural(written, 'file')} written to ${folder}/ (index: ${index})${
          removed ? `, ${numEn(removed)} old ${plural(removed, 'file')} deleted` : ''
        }${notes ? `. Notes: ${notes}` : ''}.`,
      skippedRow: (row: number, reason: string) => `row ${numEn(row)}: ${reason}`,
    },

    document: {
      title: (file: string) => `Import document: ${file}`,
      split: 'Split the document',
      splitNone: 'No, save it as one file',
      splitChapters: 'By chapter (heading 1)',
      splitSections: 'By chapter and section (headings 1-2)',
      removeStale: 'Replace the previous import of the same document',
      done: (written: number, removed: number, warnings: string) =>
        `${numEn(written)} ${plural(written, 'file')} written${removed ? `, ${numEn(removed)} old ${plural(removed, 'file')} deleted` : ''}.${
          warnings ? ` Notes: ${warnings}` : ''
        }`,
    },

    targetFolder: 'Target folder',

    editor: {
      edit: (path: string) => `Edit: ${path}`,
      path: 'Path (folder/name.md)',
      builtinHint: 'Built-in file: saving creates your own copy (the built-in version comes back if the copy is deleted).',
      content: 'Content (Markdown with front matter)',
      saved: (path: string) => `${path} saved.`,
    },

    searchPlaceholder: 'Search path, name or alias…',
    allTypes: 'All types',
    readByAgent: (n: number) => `${numEn(n)} ${plural(n, 'file')} read by the agent`,
    matching: (n: number) => `${numEn(n)} ${plural(n, 'matches', 'match')} the filter`,
    guides: 'Guides & templates (not read by the agent)',
    groupHeading: (label: string, n: number) => `${label} (${numEn(n)})`,
    retired: (status: string) => `${status} (not used for new solutions)`,
    aliases: (aliases: string) => `aliases: ${aliases}`,
    viewOrOverride: 'View / override',
    confirmDelete: (path: string) => `Delete ${path}?`,
    deleted: (path: string) => `${path}: deleted.`,
    reverted: (path: string) => `${path}: built-in version restored.`,
    more: (n: number) => `${numEn(n)} more ${plural(n, 'file')} - narrow the list with a search.`,
  },

  plugins: {
    intro:
      'MCP plugins give SOLAR access to other systems. Values such as `${GITHUB_TOKEN}` are taken from the `.env` file, so secrets are not stored here. Visual Paradigm is set to **always confirm**.',
    policy: {
      never: 'No confirmation',
      writes: 'Confirm write operations',
      always: 'Always confirm every call',
    },
    state: {
      disabled: 'Disabled',
      unconfigured: 'Not configured',
      connecting: 'Connecting…',
      connected: 'Connected',
      error: 'Error',
    },
    add: 'Add MCP plugin',
    newPlugin: 'New plugin',
    editPlugin: (id: string) => `Edit plugin: ${id}`,
    fields: {
      id: 'ID (lowercase letters, digits, -)',
      idPlaceholder: 'derived from the name',
      transport: 'Transport',
      transportHttp: 'Streamable HTTP (remote)',
      transportSse: 'SSE (remote, legacy)',
      transportStdio: 'stdio (local process, e.g. npx)',
      policy: 'Confirmation policy',
      command: 'Command',
      args: 'Arguments (one per line)',
      env: 'Environment (KEY=VALUE per line, ${VAR} allowed)',
      url: 'MCP endpoint URL',
      headers: 'Headers (KEY=VALUE per line, ${VAR} allowed)',
      allowlist: 'Limit tools (optional, comma-separated)',
      allowlistPlaceholder: 'empty = all tools',
    },
    saveAndConnect: 'Save & connect',
    toolCount: (n: number) => `${numEn(n)} ${plural(n, 'tool')}`,
    reconnect: 'Reconnect',
    deleteLabel: (name: string) => `Delete ${name}`,
    confirmDelete: (name: string) => `Delete plugin "${name}"?`,
    toolList: (n: number) => `Tools (${numEn(n)})`,
  },

  skills: {
    intro:
      'Skills are “house style” instructions the agent loads when relevant (`SKILL.md` format: `name` and `description` front matter, then Markdown content). Built-in skills can be disabled or overridden.',
    add: 'Add skill',
    importFile: 'Import SKILL.md',
    newSkill: 'New skill',
    editSkill: (id: string) => `Edit skill: ${id}`,
    namePlaceholder: 'e.g. Cloud Cost Review',
    description: 'Description (when the skill is used)',
    content: 'Instructions (Markdown)',
    noDescription: 'No description',
    files: (files: string) => `files: ${files}`,
    confirmDelete: (name: string) => `Delete skill "${name}"? The built-in skill with the same id will be restored.`,
  },
};
