import { numEn, plural } from '../helpers';
import type { Dict } from '../id';

export const artifacts: Dict['artifacts'] = {
  knowledgeType: {
    landscape: 'Landscape',
    system: 'System',
    integration: 'Integration',
    standard: 'Standard',
    principle: 'Principle',
    nfr: 'NFR / security',
    process: 'Process',
    document: 'Document structure',
    decision: 'Decision (ADR)',
    glossary: 'Glossary',
    reference: 'Reference',
  },

  groups: {
    archimate: 'ArchiMate',
    sequence: 'Sequence diagram',
    tsd: 'Technical Specification',
    other: 'Other',
  },
  groupFallback: 'Artifacts',

  downloadAll: 'Download all (ZIP)',
  offline: 'The server cannot be reached. Try again.',

  row: {
    preview: (name: string) => `Preview ${name}`,
    info: (name: string) => `About ${name}`,
    notViewable: 'Cannot be previewed in the browser',
    download: (name: string) => `Download ${name}`,
    saveToKnowledge: (name: string) => `Save ${name} to the knowledge base`,
  },

  word: {
    download: 'Download Word (.docx)',
    downloadTitle: (name: string) => `Download ${name}, the Word document for the client`,
    create: 'Create Word (.docx)',
    creating: 'Creating Word…',
    createTitle: 'Create a Word document from this specification',
    failed: (reason: string) => `The Word document could not be created: ${reason}`,
    errors: {
      offline: 'the server cannot be reached. Try again.',
      invalid: 'this specification is not valid.',
      notFound: 'the artifact was not found (it may have been deleted).',
      server: 'the server could not create the Word document. Try again later.',
    },
    createdWithNotes: (n: number) => `Word document created with ${numEn(n)} ${plural(n, 'note')}.`,
    ready: 'The Word document is ready to download.',
    noPreview:
      'This Word document cannot be previewed in the browser. Download it and open it in Microsoft Word, LibreOffice Writer or Google Docs.',
    previewHtml: 'Preview the HTML version',
    htmlHint: 'The HTML version has the same content, without the Word page layout (cover, page numbers).',
  },

  preview: {
    noPreview: 'This file cannot be previewed in the browser. Download it to open it.',
  },

  saveToKnowledge: {
    title: 'Save to the knowledge base',
    intro: (name: string) =>
      `${name} is copied into the knowledge base as a Markdown file. The agent gives its content priority over the built-in rules, so only save documents you have reviewed.`,
    idLabel: 'ID (name in diagrams and documents)',
    titlePlaceholder: 'Leave empty to use the document title',
    aliasesLabel: 'Aliases (comma-separated, optional)',
    aliasesPlaceholder: 'e.g. AD1 Gateway, ADI Gate',
    overwrite: 'Replace the existing file',
    savedAs: 'Saved as {path}.',
    savedForAgent: (where: string) => `The agent reads it from the next task on; manage it in ${where}.`,
    savedGuidance: (where: string) =>
      `Files in folders starting with "_" and README.md are guidance for people and are not read by the agent; manage them in ${where}.`,
  },
};
