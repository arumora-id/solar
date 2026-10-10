import { z } from 'zod';
import type { Artifact } from '@solar/shared';
import type { AppConfig } from '../config.js';
import { buildArchimate, ArchimateModelSchema, ELEMENT_INFO, ELEMENT_TYPES, allowedRelationships } from '../generators/archimate/index.js';
import { buildSequence, SequenceDiagramSchema } from '../generators/sequence/index.js';
import { buildTechSpec, TechSpecSchema } from '../generators/techspec/index.js';
import { formatIssues, type ValidationIssue } from '../generators/validation.js';
import { t, taskLang, type Lang } from '../i18n.js';
import { GithubClient } from '../integrations/github.js';
import { PlaneClient } from '../integrations/plane.js';
import type { SkillStore } from '../skills/skillStore.js';
import type { ArtifactService } from '../tasks/artifactService.js';
import type { AttachmentService } from '../tasks/attachmentService.js';
import type { TaskRunContext } from '../tasks/taskManager.js';
import { resolveTaskDiagrams, tsdDocxArtifact, withTechSpecBundleLock } from '../tasks/techSpecDocx.js';
import { renderTechSpecDocxIsolated } from '../tasks/techSpecDocxIsolated.js';
import { newId, slugify } from '../util/ids.js';
import { createDocumentTools } from './documentTools.js';
import { json, zodTool } from './zodTool.js';
import type { AgentTool, ToolOutput } from './types.js';

export interface BuiltinToolDeps {
  config: AppConfig;
  skills: SkillStore;
  artifacts: ArtifactService;
  attachments: AttachmentService;
}


function failure(title: string, errors: ValidationIssue[], warnings: ValidationIssue[], lang: Lang): ToolOutput {
  return {
    isError: true,
    summary: t(lang, 'tool.validationErrors', { n: errors.length }),
    content: [
      formatIssues(`${title} - ${errors.length} error(s), nothing was saved`, errors),
      formatIssues('Warnings', warnings),
      'Fix every error above and call the tool again with the complete, corrected input.',
    ]
      .filter(Boolean)
      .join('\n\n'),
  };
}

const fileName = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/)
  .optional()
  .describe('Base file name without extension (letters, digits, "-", "_"); derived from the title when omitted');

const TEXT_KINDS = new Set<Artifact['kind']>([
  'archimate-exchange',
  'archimate-model',
  'sequence-mermaid',
  'sequence-plantuml',
  'sequence-model',
  'tsd-markdown',
  'tsd-model',
  'archimate-svg',
  'sequence-svg',
  'tsd-html',
  'other',
]);

export function createBuiltinTools(deps: BuiltinToolDeps): AgentTool[] {
  const { config, skills, artifacts } = deps;
  const tools: AgentTool[] = [];

  tools.push(
    zodTool({
      name: 'update_progress',
      displayName: { id: 'Perbarui progres', en: 'Updating progress' },
      description:
        'Report progress of the whole request to the monitoring dashboard. Call it when you start, after each major deliverable and before the final answer.',
      schema: z.object({
        percent: z.number().min(0).max(100).describe('Overall completion 0-100'),
        step: z.string().min(1).max(160).describe('Short description of the current step'),
        detail: z.string().max(1000).optional(),
      }),
      async execute(input, ctx) {
        await ctx.progress(input.percent, input.step, input.detail);
        return { content: 'Progress recorded.', summary: `${Math.round(input.percent)}% - ${input.step}` };
      },
    }),
  );

  tools.push(
    zodTool({
      name: 'load_skill',
      displayName: { id: 'Muat skill', en: 'Loading skill' },
      description: 'Load the full instructions of an enabled skill (listed in the system prompt). Follow the loaded instructions.',
      schema: z.object({ skill_id: z.string().min(1).max(80) }),
      async execute(input, ctx) {
        const skill = await skills.get(input.skill_id);
        if (!skill || !skill.enabled) {
          return { isError: true, content: `Skill "${input.skill_id}" does not exist or is disabled.`, summary: t(taskLang(ctx), 'tool.skillNotFound') };
        }
        const files = skill.files.length ? `\n\nReference files (read with read_skill_file): ${skill.files.join(', ')}` : '';
        return { content: `# Skill: ${skill.name}\n\n${skill.content}${files}`, summary: skill.name };
      },
    }),
  );

  tools.push(
    zodTool({
      name: 'read_skill_file',
      displayName: { id: 'Baca file skill', en: 'Reading skill file' },
      description: 'Read a reference file (template, checklist, example) bundled with a skill.',
      schema: z.object({ skill_id: z.string().min(1).max(80), path: z.string().min(1).max(200) }),
      async execute(input, ctx) {
        try {
          const content = await skills.readFile(input.skill_id, input.path);
          return { content, summary: `${input.skill_id}/${input.path}` };
        } catch (err) {
          return { isError: true, content: err instanceof Error ? err.message : String(err), summary: t(taskLang(ctx), 'tool.fileNotFound') };
        }
      },
    }),
  );

  tools.push(
    zodTool({
      name: 'archimate_relationship_rules',
      displayName: { id: 'Cek aturan relasi ArchiMate', en: 'Checking ArchiMate relationship rules' },
      description:
        'Look up which ArchiMate 3.2 relationships are allowed between element types (official relationship table). Use it before modelling relationships you are not sure about.',
      schema: z.object({
        pairs: z
          .array(z.object({ source: z.enum(ELEMENT_TYPES), target: z.enum(ELEMENT_TYPES) }))
          .min(1)
          .max(60),
      }),
      async execute(input, ctx) {
        const rows = input.pairs.map((p) => ({
          source: p.source,
          target: p.target,
          allowed: allowedRelationships(p.source, p.target),
        }));
        return { content: json(rows), summary: t(taskLang(ctx), 'tool.pairs', { n: rows.length }) };
      },
    }),
  );

  tools.push(
    zodTool({
      name: 'create_archimate_model',
      displayName: { id: 'Membuat model ArchiMate', en: 'Creating ArchiMate model' },
      description: [
        'Create an ArchiMate 3.2 model with one or more views. The input is validated against the official ArchiMate relationship table,',
        'referential integrity, junction rules and view consistency; on errors nothing is saved and every error is listed so you can fix it.',
        'On success it stores: an Open Group Exchange Format XML (importable in Archi, Visual Paradigm, BiZZdesign, Sparx EA),',
        'one SVG per view (layered auto-layout) and the model JSON. Element types use exchange-format names, e.g.',
        'BusinessActor, ApplicationComponent, ApplicationService, DataObject, Node, SystemSoftware, TechnologyService, Requirement, WorkPackage.',
      ].join(' '),
      schema: ArchimateModelSchema.extend({ fileName }),
      async execute(input, ctx) {
        const lang = taskLang(ctx);
        const { fileName: base, ...model } = input;
        const result = buildArchimate(model);
        if (!result.ok) return failure('ArchiMate model rejected', result.errors, result.warnings, lang);
        const out = result.output;
        const counts = { elements: out.model.elements.length, relationships: out.model.relationships.length, views: out.views.length };
        const stem = base ?? slugify(model.name, 'archimate-model');
        const bundle = newId('bundle');
        const xml = await ctx.createArtifact({
          name: `${stem}.archimate.xml`,
          title: `${model.name} (ArchiMate Exchange Format)`,
          kind: 'archimate-exchange',
          mimeType: 'application/xml',
          bundle,
          description: t(lang, 'artifact.archimate.summary', counts),
          content: out.exchangeXml,
        });
        const views: Array<{ view: string; svgArtifactId: string; file: string; elements: number; relationships: number }> = [];
        for (const v of out.views) {
          const svg = await ctx.createArtifact({
            name: `${stem}-${slugify(v.name, 'view')}.svg`,
            title: t(lang, 'artifact.archimate.view', { name: v.name }),
            kind: 'archimate-svg',
            mimeType: 'image/svg+xml',
            bundle,
            description: t(lang, 'artifact.archimate.viewSummary', { elements: v.elementCount, relationships: v.relationshipCount }),
            content: v.svg,
          });
          views.push({ view: v.name, svgArtifactId: svg.id, file: svg.name, elements: v.elementCount, relationships: v.relationshipCount });
        }
        const modelJson = await ctx.createArtifact({
          name: `${stem}.archimate.json`,
          title: t(lang, 'artifact.archimate.source', { name: model.name }),
          kind: 'archimate-model',
          mimeType: 'application/json',
          bundle,
          content: json(out.model),
        });
        return {
          summary: t(lang, 'artifact.archimate.summary', counts),
          content: json({
            status: 'saved',
            bundle,
            exchangeXml: { artifactId: xml.id, file: xml.name },
            modelJson: { artifactId: modelJson.id, file: modelJson.name },
            views,
            warnings: out.warnings.map((w) => `[${w.path}] ${w.message}`),
            note: 'Use the svgArtifactId values when referencing these views in the technical specification.',
          }),
        };
      },
    }),
  );

  tools.push(
    zodTool({
      name: 'create_sequence_diagram',
      displayName: { id: 'Membuat sequence diagram', en: 'Creating sequence diagram' },
      description: [
        'Create a UML sequence diagram. Steps are a flat ordered list: messages (sync/async/reply with optional activation),',
        'notes, dividers and combined fragments opened with fragment_start (alt/opt/loop/par/critical/break/group),',
        'separated with fragment_else (alt/par/critical only) and closed with fragment_end. Input is validated (participants, activation balance,',
        'fragment nesting, Mermaid/PlantUML reserved words); on success it stores an SVG, Mermaid source (renders on GitHub), PlantUML source and the JSON.',
      ].join(' '),
      schema: SequenceDiagramSchema.extend({ fileName }),
      async execute(input, ctx) {
        const lang = taskLang(ctx);
        const { fileName: base, ...diagram } = input;
        const result = buildSequence(diagram);
        if (!result.ok) return failure('Sequence diagram rejected', result.errors, result.warnings, lang);
        const out = result.output;
        const counts = { participants: diagram.participants.length, messages: diagram.steps.filter((s) => s.type === 'message').length };
        const stem = base ?? slugify(diagram.title, 'sequence');
        const bundle = newId('bundle');
        const svg = await ctx.createArtifact({
          name: `${stem}.sequence.svg`,
          title: `${diagram.title} (sequence diagram)`,
          kind: 'sequence-svg',
          mimeType: 'image/svg+xml',
          bundle,
          description: t(lang, 'artifact.sequence.summary', counts),
          content: out.svg,
        });
        const mmd = await ctx.createArtifact({
          name: `${stem}.mmd`,
          title: `${diagram.title} (Mermaid)`,
          kind: 'sequence-mermaid',
          mimeType: 'text/plain; charset=utf-8',
          bundle,
          content: out.mermaid,
        });
        const puml = await ctx.createArtifact({
          name: `${stem}.puml`,
          title: `${diagram.title} (PlantUML)`,
          kind: 'sequence-plantuml',
          mimeType: 'text/plain; charset=utf-8',
          bundle,
          content: out.plantuml,
        });
        await ctx.createArtifact({
          name: `${stem}.sequence.json`,
          title: t(lang, 'artifact.source', { name: diagram.title }),
          kind: 'sequence-model',
          mimeType: 'application/json',
          bundle,
          content: json(out.diagram),
        });
        return {
          summary: t(lang, 'artifact.sequence.summary', counts),
          content: json({
            status: 'saved',
            bundle,
            svgArtifactId: svg.id,
            files: [svg.name, mmd.name, puml.name],
            warnings: out.warnings.map((w) => `[${w.path}] ${w.message}`),
            note: 'Use svgArtifactId when referencing this diagram in the technical specification.',
          }),
        };
      },
    }),
  );

  tools.push(
    zodTool({
      name: 'create_technical_specification',
      displayName: { id: 'Menyusun Technical Specification', en: 'Writing the Technical Specification' },
      description: [
        'Create the Technical Specification Document (TSD) as Markdown (GitHub ready, diagrams linked as sibling SVG files and Mermaid sources),',
        'as a standalone print-ready HTML with embedded diagrams, and as a Word document (.docx) for delivery to the client: A4 with cover page,',
        'document control, revision history, approval sign-off table (when reviewers/approvers are given), table of contents, header/footer',
        'with page numbers and the diagrams embedded as figures. Reference diagrams by the SVG artifact ids returned by',
        'create_archimate_model / create_sequence_diagram in this task. Ids of requirements, decisions, risks and issues must be unique.',
      ].join(' '),
      // without a language the document is written in the task's interface language (the schema's own default is "id")
      schema: TechSpecSchema.extend({
        fileName,
        language: z
          .enum(['id', 'en'])
          .optional()
          .describe('Language of headings and labels: "id" (Bahasa Indonesia) or "en"; default: the interface language of the task'),
      }),
      async execute(input, ctx) {
        const lang = taskLang(ctx);
        const { fileName: base, ...rest } = input;
        const spec = { ...rest, language: rest.language ?? lang };
        const diagrams = await resolveTaskDiagrams(artifacts, await ctx.listArtifacts());
        const today = new Date().toISOString().slice(0, 10);
        const result = buildTechSpec(spec, diagrams, today);
        if (!result.ok) return failure('Technical specification rejected', result.errors, result.warnings, lang);
        const out = result.output;
        const requested = base ?? slugify(spec.title, 'technical-specification');
        const bundle = newId('bundle');
        const md = await ctx.createArtifact({
          name: `${requested}.md`,
          title: `${spec.title} (Markdown)`,
          kind: 'tsd-markdown',
          mimeType: 'text/markdown; charset=utf-8',
          bundle,
          description: t(lang, 'artifact.tsd.summary', {
            functional: out.spec.functionalRequirements.length,
            nonFunctional: out.spec.nonFunctionalRequirements.length,
          }),
          content: out.markdown,
        });
        // the other files take the name the .md was saved under ("x-2.md" when the task already has an "x.md")
        const stem = md.name.replace(/\.md$/i, '');
        const html = await ctx.createArtifact({
          name: `${stem}.html`,
          title: t(lang, 'artifact.html', { name: spec.title }),
          kind: 'tsd-html',
          mimeType: 'text/html; charset=utf-8',
          bundle,
          content: out.html,
        });
        const warnings = out.warnings.map((w) => `[${w.path}] ${w.message}`);
        // The Word file comes before the .tsd.json: the web UI offers "Buat Word" for a bundle with a model and no Word
        // file, and an export of this bundle waits for the lock, so the bundle never gets a second Word file.
        const docx = await withTechSpecBundleLock(md.taskId, bundle, async () => {
          // the Word file never fails the TSD: the other files are saved and it can be exported again later
          let docx: { artifactId: string; file: string } | null = null;
          let failure: string | null = null;
          try {
            const rendered = await renderTechSpecDocxIsolated(out.document);
            const saved = await ctx.createArtifact(tsdDocxArtifact({ stem, title: spec.title, bundle, document: out.document, buffer: rendered.buffer, lang }));
            docx = { artifactId: saved.id, file: saved.name };
            warnings.push(...rendered.warnings.map((w) => `[docx] ${w}`));
          } catch (err) {
            failure = err instanceof Error ? err.message : String(err);
          }
          const model = await ctx.createArtifact({
            name: `${stem}.tsd.json`,
            title: t(lang, 'artifact.source', { name: spec.title }),
            kind: 'tsd-model',
            mimeType: 'application/json',
            bundle,
            content: json(out.spec),
          });
          if (failure !== null) {
            warnings.push(
              `[docx] The Word file could not be created (${failure}). The Markdown, HTML and JSON files are saved; the Word file can be exported again later from ${model.name} (${model.id}).`,
            );
          }
          return docx;
        });
        return {
          summary: `${out.spec.functionalRequirements.length} FR, ${out.spec.nonFunctionalRequirements.length} NFR${docx ? ', .docx' : ''}`,
          content: json({
            status: 'saved',
            bundle,
            markdown: { artifactId: md.id, file: md.name },
            html: { artifactId: html.id, file: html.name },
            docx,
            warnings,
          }),
        };
      },
    }),
  );

  tools.push(
    zodTool({
      name: 'list_artifacts',
      displayName: { id: 'Daftar artefak', en: 'Listing artifacts' },
      description: 'List the artifacts (diagrams, documents, models) created so far in this task.',
      schema: z.object({}),
      async execute(_input, ctx) {
        const list = await ctx.listArtifacts();
        return {
          summary: t(taskLang(ctx), 'tool.artifacts', { n: list.length }),
          content: json(list.map((a) => ({ id: a.id, name: a.name, kind: a.kind, title: a.title, bundle: a.bundle, size: a.size }))),
        };
      },
    }),
  );

  tools.push(
    zodTool({
      name: 'read_artifact',
      displayName: { id: 'Membaca artefak', en: 'Reading artifact' },
      description:
        'Read the text content of an artifact by id (for review or reuse). Works for artifacts of this task and of previous tasks listed in the session context.',
      schema: z.object({ artifact_id: z.string().regex(/^art_[A-Za-z0-9]+$/) }),
      async execute(input, ctx) {
        const lang = taskLang(ctx);
        const artifact = await artifacts.get(input.artifact_id);
        if (!artifact) return { isError: true, content: `Artifact ${input.artifact_id} not found`, summary: t(lang, 'tool.notFound') };
        if (!TEXT_KINDS.has(artifact.kind)) {
          return {
            isError: true,
            content: `${artifact.name} is a binary file (${artifact.mimeType}); read the Markdown or JSON file of the same bundle instead.`,
            summary: t(lang, 'tool.binaryFile'),
          };
        }
        const text = await artifacts.readText(artifact);
        const limit = 200_000;
        return {
          summary: t(lang, 'tool.fileSize', { name: artifact.name, size: artifact.size }),
          content: text.length > limit ? `${text.slice(0, limit)}\n\n[SOLAR: content truncated at ${limit} characters]` : text,
        };
      },
    }),
  );

  tools.push(...createDocumentTools(deps.attachments));

  // ---- GitHub publishing ------------------------------------------------------
  if (config.github.token) {
    const github = new GithubClient(config.github.token);
    tools.push(
      zodTool({
        name: 'publish_artifacts_to_github',
        displayName: { id: 'Publish ke GitHub', en: 'Publishing to GitHub' },
        description: [
          'Commit artifacts (from this or previous tasks) to a GitHub repository folder in a single commit.',
          `Default repository: ${config.github.defaultRepo ?? '(none - ask the user or use the repository named in the request)'}; default branch: ${config.github.defaultBranch}.`,
          'A missing branch is created from the default branch. Only publish when the user asked for it.',
        ].join(' '),
        schema: z.object({
          repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).optional().describe('owner/name'),
          branch: z.string().min(1).max(200).optional(),
          path: z.string().max(300).describe('Folder inside the repository, e.g. "docs/architecture/order-platform"'),
          artifact_ids: z.array(z.string().regex(/^art_[A-Za-z0-9]+$/)).min(1).max(100),
          commit_message: z.string().min(1).max(500),
        }),
        confirmation: (input, lang) =>
          config.github.publishConfirm === 'always'
            ? t(lang, 'confirm.github', { n: input.artifact_ids.length, target: `${input.repository ?? config.github.defaultRepo}/${input.path}` })
            : null,
        async execute(input, ctx) {
          const lang = taskLang(ctx);
          const repo = input.repository ?? config.github.defaultRepo;
          if (!repo) {
            return { isError: true, content: 'No repository given and GITHUB_DEFAULT_REPO is not set.', summary: t(lang, 'tool.github.noRepository') };
          }
          const files = [];
          for (const id of input.artifact_ids) {
            const a = await artifacts.get(id);
            if (!a) return { isError: true, content: `Artifact ${id} not found`, summary: t(lang, 'tool.github.artifactNotFound') };
            files.push({ path: a.name, content: await artifacts.read(a) });
          }
          const dup = files.map((f) => f.path).find((p, i, arr) => arr.indexOf(p) !== i);
          if (dup) {
            return {
              isError: true,
              content: `Two artifacts share the file name "${dup}"; publish them to different folders.`,
              summary: t(lang, 'tool.github.duplicateName'),
            };
          }
          const result = await github.publish(repo, input.branch ?? config.github.defaultBranch, input.path, files, input.commit_message, ctx.signal);
          return {
            content: json({ status: 'committed', repository: repo, ...result }),
            summary: t(lang, 'tool.github.committed', { n: files.length, target: `${repo}@${result.branch}` }),
          };
        },
      }),
    );
  }

  // ---- Plane backlog --------------------------------------------------------
  if (config.plane.apiKey && config.plane.workspaceSlug) {
    const plane = new PlaneClient({ apiKey: config.plane.apiKey, workspaceSlug: config.plane.workspaceSlug, hostUrl: config.plane.hostUrl });
    tools.push(
      zodTool({
        name: 'plane_list_projects',
        displayName: { id: 'Plane: daftar project', en: 'Plane: listing projects' },
        description: `List projects of the Plane workspace "${config.plane.workspaceSlug}" on ${config.plane.hostUrl}.`,
        schema: z.object({}),
        async execute(_input, ctx) {
          const projects = await plane.listProjects(ctx.signal);
          return { content: json(projects), summary: t(taskLang(ctx), 'tool.plane.projects', { n: projects.length }) };
        },
      }),
    );
    tools.push(
      zodTool({
        name: 'plane_create_backlog_items',
        displayName: { id: 'Plane: membuat backlog', en: 'Plane: creating backlog items' },
        description: [
          `Create backlog work items in a project on ${config.plane.hostUrl} (workspace "${config.plane.workspaceSlug}") in one call.`,
          `Default project id: ${config.plane.projectId ?? '(none - call plane_list_projects first)'}.`,
          'Items are created parents first (epics/features via parentRef), labels are created when missing, and with skip_existing',
          'an item whose name already exists is not duplicated. Descriptions are Markdown. Only create items when the user asked for it.',
        ].join(' '),
        schema: z.object({
          project_id: z.string().min(1).max(80).optional(),
          skip_existing: z.boolean().default(true),
          items: z
            .array(
              z.object({
                ref: z.string().min(1).max(40).describe('Your local reference, e.g. "EPIC-1" or "FR-01"'),
                name: z.string().min(1).max(255),
                description: z.string().max(20000).optional().describe('Markdown: context, acceptance criteria, links to artifacts'),
                priority: z.enum(['urgent', 'high', 'medium', 'low', 'none']).default('none'),
                labels: z.array(z.string().min(1).max(60)).max(10).default([]),
                parentRef: z.string().max(40).optional().describe('ref of the parent item (must be in the same call)'),
              }),
            )
            .min(1)
            .max(200),
        }),
        confirmation: (input, lang) =>
          config.plane.confirm === 'always'
            ? t(lang, 'confirm.plane', { n: input.items.length, project: input.project_id ?? config.plane.projectId ?? '' })
            : null,
        async execute(input, ctx) {
          const lang = taskLang(ctx);
          const projectId = input.project_id ?? config.plane.projectId;
          if (!projectId) {
            return {
              isError: true,
              content: 'No project_id given and PLANE_PROJECT_ID is not set. Call plane_list_projects.',
              summary: t(lang, 'tool.plane.noProject'),
            };
          }
          const result = await plane.createBacklog(projectId, input.items, { skipExisting: input.skip_existing, signal: ctx.signal });
          const created = result.created.filter((c) => !c.skipped).length;
          if (result.error) {
            const remaining = input.items.filter((i) => !result.created.some((c) => c.ref === i.ref)).map((i) => i.ref);
            return {
              isError: true,
              content: json({
                status: 'partial',
                error: result.error,
                project: result.project,
                items: result.created,
                not_created_refs: remaining,
                hint: 'The items listed were created. Call again with the same items and skip_existing=true to create the rest without duplicates.',
              }),
              summary: t(lang, 'tool.plane.partial', { created, remaining: remaining.length, error: result.error.slice(0, 80) }),
            };
          }
          return {
            content: json({ status: 'done', project: result.project, items: result.created }),
            summary: t(lang, 'tool.plane.done', { created, skipped: result.created.length - created, project: result.project.identifier }),
          };
        },
      }),
    );
  }

  return tools;
}

export function describeElementTypes(): string {
  return ELEMENT_TYPES.map((t) => `${t} (${ELEMENT_INFO[t].layer})`).join(', ');
}
