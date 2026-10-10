import type { Artifact } from '@solar/shared';
import { DOCX_MIME } from '../documents/kind.js';
import { buildTechSpec, type BuiltDocument, type ResolvedDiagram } from '../generators/techspec/index.js';
import { both, DEFAULT_LANG, LocalizedError, t, type Lang, type Localized } from '../i18n.js';
import { KeyedQueue } from '../util/fs.js';
import type { ArtifactService, NewArtifact } from './artifactService.js';
import { renderTechSpecDocxIsolated } from './techSpecDocxIsolated.js';

/**
 * The Word (.docx) file of a Technical Specification Document: shared by the create_technical_specification tool and by
 * the export of TSDs made before Word files existed (POST /api/artifacts/:id/docx).
 */

/** Every SVG diagram of a task by artifact id (with the Mermaid source of its bundle), as a TSD references them. */
export async function resolveTaskDiagrams(artifacts: ArtifactService, list: Artifact[]): Promise<Map<string, ResolvedDiagram>> {
  const diagrams = new Map<string, ResolvedDiagram>();
  for (const a of list) {
    if (a.kind !== 'archimate-svg' && a.kind !== 'sequence-svg') continue;
    const mermaid = list.find((m) => m.bundle === a.bundle && m.kind === 'sequence-mermaid');
    diagrams.set(a.id, {
      artifactId: a.id,
      fileName: a.name,
      svg: await artifacts.readText(a),
      mermaid: mermaid ? await artifacts.readText(mermaid) : undefined,
    });
  }
  return diagrams;
}

/**
 * The artifact record of a TSD's Word file (same file stem and bundle as its .md/.html/.tsd.json); its description is
 * in `lang`, the task's language (an export: the requester's).
 */
export function tsdDocxArtifact(input: {
  stem: string;
  title: string;
  bundle: string;
  document: BuiltDocument;
  buffer: Buffer;
  lang?: Lang;
}): Omit<NewArtifact, 'taskId'> {
  const figures = input.document.blocks.filter((b) => b.kind === 'figure').length;
  const sections = input.document.blocks.filter((b) => b.kind === 'heading' && b.toc).length;
  return {
    name: `${input.stem}.docx`,
    title: `${input.title} (Word)`,
    kind: 'tsd-docx',
    mimeType: DOCX_MIME,
    bundle: input.bundle,
    description: t(input.lang ?? DEFAULT_LANG, 'artifact.tsd.docx', { sections, figures }),
    content: input.buffer,
  };
}

/** Why a TSD has no Word export; the API answers in the request's language (`message` is English). */
export class TechSpecDocxError extends LocalizedError {
  constructor(
    readonly status: 400 | 404,
    text: Localized,
  ) {
    super(text, 'en');
  }
}

export interface TechSpecDocxExport {
  artifact: Artifact;
  /** false when the bundle already had a Word file, which is returned as it is */
  created: boolean;
  warnings: string[];
}

/** One Word file per bundle: the tool's and the exports of a bundle run one at a time, so two never save two files. */
const queue = new KeyedQueue();

/**
 * Runs `fn` while no other Word export of the same bundle runs. The create_technical_specification tool saves its .docx
 * (and then the .tsd.json, which is what lets the web UI offer an export) inside it, so an export that arrives meanwhile
 * waits and then finds the tool's file.
 */
export function withTechSpecBundleLock<T>(taskId: string, bundle: string, fn: () => Promise<T>): Promise<T> {
  return queue.run(`${taskId}/${bundle}`, fn);
}

/**
 * Creates the Word file of an existing TSD bundle from its tsd-model artifact (the validated JSON the .md and .html were
 * rendered from), resolving its diagrams among the task's SVG artifacts as the tool does, and saves it into the same task
 * and bundle through `save` (TaskManager.addArtifact, which also tells open web UIs).
 *
 * `artifactId` may be any artifact of the bundle. A bundle that already has a Word file returns it unchanged
 * (`created: false`): artifacts are never edited, so it was rendered from the same model.
 */
export async function exportTechSpecDocx(
  artifacts: ArtifactService,
  save: (taskId: string, input: Omit<NewArtifact, 'taskId'>) => Promise<Artifact>,
  artifactId: string,
  /** Language of the warnings and of the new artifact's description (the request's). */
  lang: Lang = DEFAULT_LANG,
): Promise<TechSpecDocxExport> {
  const artifact = await artifacts.get(artifactId);
  if (!artifact) throw new TechSpecDocxError(404, both('docx.artifactNotFound', { id: artifactId }));
  return withTechSpecBundleLock(artifact.taskId, artifact.bundle, async () => {
    const list = await artifacts.list(artifact.taskId);
    const bundle = list.filter((a) => a.bundle === artifact.bundle);
    const existing = bundle.find((a) => a.kind === 'tsd-docx');
    if (existing) return { artifact: existing, created: false, warnings: [] };
    const model = bundle.find((a) => a.kind === 'tsd-model');
    if (!model) throw new TechSpecDocxError(400, both('docx.notTsd', { name: artifact.name }));

    let input: unknown;
    try {
      input = JSON.parse(await artifacts.readText(model));
    } catch {
      throw new TechSpecDocxError(400, both('docx.invalidJson', { name: model.name }));
    }
    // the document date defaults to the day the TSD was made, as in its .md and .html
    const result = buildTechSpec(input, await resolveTaskDiagrams(artifacts, list), model.createdAt.slice(0, 10));
    if (!result.ok) {
      const errors = result.errors.map((e) => `[${e.path}] ${e.message}`).join('; ');
      throw new TechSpecDocxError(400, both('docx.invalidSpec', { name: model.name, errors }));
    }
    const { buffer, warnings } = await renderTechSpecDocxIsolated(result.output.document, { warningLanguage: lang });
    const stem = model.name.replace(/(\.tsd)?\.json$/i, '') || 'technical-specification';
    const saved = await save(
      artifact.taskId,
      tsdDocxArtifact({ stem, title: result.output.spec.title, bundle: artifact.bundle, document: result.output.document, buffer, lang }),
    );
    return { artifact: saved, created: true, warnings };
  });
}
