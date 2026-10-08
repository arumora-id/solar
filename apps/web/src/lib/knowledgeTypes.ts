import type { KnowledgeType } from '@solar/shared';

export const TYPE_LABEL: Record<KnowledgeType, string> = {
  landscape: 'Landscape',
  system: 'Sistem',
  integration: 'Integrasi',
  standard: 'Standar',
  principle: 'Prinsip',
  nfr: 'NFR / keamanan',
  process: 'Proses',
  document: 'Struktur dokumen',
  decision: 'Keputusan (ADR)',
  glossary: 'Glosarium',
  reference: 'Referensi',
};

export const TYPES = Object.keys(TYPE_LABEL) as KnowledgeType[];

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
