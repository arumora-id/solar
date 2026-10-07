import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

export const APP_NAME = 'SOLAR AI AGENT';
/** APP_NAME without spaces, for User-Agent headers and protocol client names. */
export const APP_SLUG = 'solar-ai-agent';
export const APP_VERSION = '1.0.0';

/** Walks up from `start` looking for the SOLAR monorepo root (package.json with name "solar"). */
function findProjectRoot(start: string): string | null {
  let dir = resolve(start);
  for (let i = 0; i < 6; i++) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        const parsed = JSON.parse(readFileSync(pkg, 'utf8')) as { name?: string };
        if (parsed.name === 'solar') return dir;
      } catch {
        // ignore malformed package.json and keep walking up
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? fallback : /^(1|true|yes|on)$/i.test(v.trim())));

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

const confirmPolicy = z
  .enum(['never', 'always'])
  .optional()
  .transform((v) => v ?? 'never');

/** Default OpenAI model: near-flagship quality for agentic tool use at a moderate price. */
export const DEFAULT_MODEL = 'gpt-6.1-sol';
export const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ReasoningEffortSetting = (typeof REASONING_EFFORTS)[number];

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8790),
  HOST: z.string().default('127.0.0.1'),
  SOLAR_ACCESS_TOKEN: optionalString,
  SOLAR_ROOT: optionalString,
  DATA_DIR: optionalString,
  SKILLS_DIR: optionalString,
  WEB_DIST_DIR: optionalString,
  PLUGINS_DEFAULT_FILE: optionalString,

  OPENAI_API_KEY: optionalString,
  OPENAI_BASE_URL: optionalString,
  OPENAI_ORG_ID: optionalString,
  OPENAI_PROJECT_ID: optionalString,
  SOLAR_MODEL: z.string().trim().min(1).default(DEFAULT_MODEL),
  SOLAR_EFFORT: z.enum(REASONING_EFFORTS).default('high'),
  SOLAR_MAX_TOKENS: z.coerce.number().int().min(1024).max(128000).default(64000),
  SOLAR_MAX_TURNS: z.coerce.number().int().min(1).max(200).default(40),
  SOLAR_PRICE_PER_MTOK: z
    .string()
    .regex(/^\s*\d+(\.\d+)?\s*,\s*\d+(\.\d+)?\s*,\s*\d+(\.\d+)?\s*$/, 'expected "input,cachedInput,output" in USD per 1M tokens, e.g. 2,0.1,10')
    .optional(),
  TASK_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  ATTACHMENT_MAX_MB: z.coerce.number().int().min(1).max(200).default(25),
  CONFIRMATION_TIMEOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(60),

  DATABASE_URL: optionalString,

  S3_ENDPOINT: optionalString,
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: optionalString,
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_FORCE_PATH_STYLE: bool(true),
  S3_PREFIX: z.string().default('solar/'),

  GITHUB_TOKEN: optionalString,
  GITHUB_DEFAULT_REPO: optionalString,
  GITHUB_DEFAULT_BRANCH: z.string().default('main'),
  GITHUB_PUBLISH_CONFIRM: confirmPolicy,

  PLANE_API_KEY: optionalString,
  PLANE_WORKSPACE_SLUG: optionalString,
  PLANE_API_HOST_URL: z.string().default('https://plane.mesthi.com'),
  PLANE_PROJECT_ID: optionalString,
  PLANE_CONFIRM: confirmPolicy,
});

export interface S3Config {
  endpoint: string | undefined;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  prefix: string;
}

export interface AppConfig {
  port: number;
  host: string;
  accessToken: string | undefined;
  rootDir: string;
  dataDir: string;
  builtinSkillsDir: string;
  userSkillsDir: string;
  webDistDir: string;
  defaultPluginsFile: string;
  openai: {
    apiKey: string | undefined;
    configured: boolean;
    baseUrl: string | undefined;
    organization: string | undefined;
    project: string | undefined;
    model: string;
    effort: ReasoningEffortSetting;
    maxTokens: number;
    maxTurns: number;
    /** USD per 1M tokens, overrides the built-in price table (cost estimates only). */
    price: { input: number; cachedInput: number; output: number } | undefined;
  };
  taskConcurrency: number;
  confirmationTimeoutMs: number;
  attachments: {
    maxFileBytes: number;
    maxPerTask: number;
  };
  databaseUrl: string | undefined;
  s3: S3Config | null;
  github: {
    token: string | undefined;
    defaultRepo: string | undefined;
    defaultBranch: string;
    publishConfirm: 'never' | 'always';
  };
  plane: {
    apiKey: string | undefined;
    workspaceSlug: string | undefined;
    hostUrl: string;
    projectId: string | undefined;
    confirm: 'never' | 'always';
  };
}

/** A .env from before the switch to OpenAI may still say SOLAR_MODEL=claude-…: fall back to the default model. */
function openaiModel(model: string): string {
  if (!/^claude-/i.test(model)) return model;
  console.warn(`[config] SOLAR_MODEL=${model} is an Anthropic model; SOLAR now uses OpenAI - using ${DEFAULT_MODEL}. Update SOLAR_MODEL in .env.`);
  return DEFAULT_MODEL;
}

function parsePrice(value: string | undefined): AppConfig['openai']['price'] {
  if (!value) return undefined;
  const [input, cachedInput, output] = value.split(',').map((v) => Number(v.trim()));
  return { input: input!, cachedInput: cachedInput!, output: output! };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const root = env.SOLAR_ROOT?.trim() || findProjectRoot(process.cwd()) || process.cwd();

  // .env next to the monorepo root (or an explicit SOLAR_ENV_FILE) - never overrides real env vars.
  const envFile = env.SOLAR_ENV_FILE?.trim() || join(root, '.env');
  if (existsSync(envFile)) loadDotenv({ path: envFile, quiet: true });

  // empty values in .env (e.g. `PORT=`) mean "use the default"
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ''));
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration in environment / .env:\n${issues}`);
  }
  const e = parsed.data;

  const s3Complete = Boolean(e.S3_BUCKET && e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY);
  const dataDir = resolve(root, e.DATA_DIR ?? 'data');

  return {
    port: e.PORT,
    host: e.HOST,
    accessToken: e.SOLAR_ACCESS_TOKEN,
    rootDir: root,
    dataDir,
    builtinSkillsDir: resolve(root, e.SKILLS_DIR ?? 'skills'),
    userSkillsDir: join(dataDir, 'skills'),
    webDistDir: resolve(root, e.WEB_DIST_DIR ?? 'apps/web/dist'),
    defaultPluginsFile: resolve(root, e.PLUGINS_DEFAULT_FILE ?? 'config/plugins.default.json'),
    openai: {
      apiKey: e.OPENAI_API_KEY,
      configured: Boolean(e.OPENAI_API_KEY),
      baseUrl: e.OPENAI_BASE_URL?.replace(/\/+$/, ''),
      organization: e.OPENAI_ORG_ID,
      project: e.OPENAI_PROJECT_ID,
      model: openaiModel(e.SOLAR_MODEL),
      effort: e.SOLAR_EFFORT,
      maxTokens: e.SOLAR_MAX_TOKENS,
      maxTurns: e.SOLAR_MAX_TURNS,
      price: parsePrice(e.SOLAR_PRICE_PER_MTOK),
    },
    taskConcurrency: e.TASK_CONCURRENCY,
    confirmationTimeoutMs: e.CONFIRMATION_TIMEOUT_MINUTES * 60_000,
    attachments: {
      maxFileBytes: e.ATTACHMENT_MAX_MB * 1024 * 1024,
      maxPerTask: 10,
    },
    databaseUrl: e.DATABASE_URL,
    s3: s3Complete
      ? {
          endpoint: e.S3_ENDPOINT,
          region: e.S3_REGION,
          bucket: e.S3_BUCKET!,
          accessKeyId: e.S3_ACCESS_KEY_ID!,
          secretAccessKey: e.S3_SECRET_ACCESS_KEY!,
          forcePathStyle: e.S3_FORCE_PATH_STYLE,
          prefix: e.S3_PREFIX,
        }
      : null,
    github: {
      token: e.GITHUB_TOKEN,
      defaultRepo: e.GITHUB_DEFAULT_REPO,
      defaultBranch: e.GITHUB_DEFAULT_BRANCH,
      publishConfirm: e.GITHUB_PUBLISH_CONFIRM,
    },
    plane: {
      apiKey: e.PLANE_API_KEY,
      workspaceSlug: e.PLANE_WORKSPACE_SLUG,
      hostUrl: e.PLANE_API_HOST_URL.replace(/\/+$/, ''),
      projectId: e.PLANE_PROJECT_ID,
      confirm: e.PLANE_CONFIRM,
    },
  };
}
