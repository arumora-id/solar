import type { KnowledgeType } from '@solar/shared';
import { t } from './i18n';

/** The knowledge types in the order the pickers list them. */
export const TYPES: KnowledgeType[] = [
  'landscape',
  'system',
  'integration',
  'standard',
  'principle',
  'nfr',
  'process',
  'document',
  'decision',
  'glossary',
  'reference',
];

/** Name of a knowledge type in the current interface language (i18n namespace `artifacts.knowledgeType`). */
export function typeLabel(type: KnowledgeType): string {
  return t().artifacts.knowledgeType[type];
}

/**
 * Type names as a lookup table (`TYPE_LABEL[type]`) for existing callers; every read follows the current language,
 * so read it while rendering. New code: typeLabel(type) or `useT().artifacts.knowledgeType[type]`.
 */
export const TYPE_LABEL: Readonly<Record<KnowledgeType, string>> = Object.defineProperties(
  {} as Record<KnowledgeType, string>,
  Object.fromEntries(TYPES.map((type) => [type, { get: () => typeLabel(type), enumerable: true }])),
);

/** Default folder per type (the same as the server's, see apps/server/src/knowledge/knowledgeWrite.ts). */
export const TYPE_FOLDERS: Record<KnowledgeType, string> = {
  system: 'systems',
  integration: 'integrations',
  standard: 'standards',
  principle: 'principles',
  nfr: 'nfr',
  process: 'process',
  document: 'documents',
  decision: 'decisions',
  glossary: 'glossary',
  landscape: 'landscape',
  reference: 'references',
};
