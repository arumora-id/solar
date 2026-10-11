import { t, type Lang } from './i18n.js';
import type { ResolvedDiagram, TechSpec } from './model.js';

/** Format-neutral document blocks rendered to Markdown and HTML. */
export type Block =
  | { kind: 'heading'; level: 2 | 3 | 4; text: string; anchor: string; toc: boolean }
  | { kind: 'markdown'; text: string }
  | { kind: 'list'; items: string[]; ordered?: boolean }
  | { kind: 'table'; headers: string[]; rows: string[][] }
  | { kind: 'figure'; diagram: ResolvedDiagram; caption: string; number: number }
  | { kind: 'code'; language: string; text: string }
  | { kind: 'mermaid'; text: string; summary: string };

/** The document's control data as values (the Word cover page, sign-off table and file properties need them apart). */
export interface DocumentInfo {
  documentId: string | null;
  version: string;
  status: string;
  /** YYYY-MM-DD */
  date: string;
  authors: string[];
  reviewers: string[];
  approvers: string[];
  /** The executive summary (Markdown). */
  summary: string;
}

export interface BuiltDocument {
  title: string;
  lang: Lang;
  info: DocumentInfo;
  meta: Array<[string, string]>;
  revisionHeaders: string[];
  revisions: string[][];
  blocks: Block[];
}

/** GitHub compatible heading anchor. */
export function slugAnchor(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

export function buildDocument(spec: TechSpec, diagrams: Map<string, ResolvedDiagram>, today: string): BuiltDocument {
  const lang = spec.language;
  const L = (k: Parameters<typeof t>[1]) => t(lang, k);
  const blocks: Block[] = [];
  let section = 0;
  let sub = 0;
  let figure = 0;

  const h2 = (key: Parameters<typeof t>[1] | string, raw = false) => {
    section += 1;
    sub = 0;
    const text = `${section}. ${raw ? key : L(key as Parameters<typeof t>[1])}`;
    blocks.push({ kind: 'heading', level: 2, text, anchor: slugAnchor(text), toc: true });
  };
  const h3 = (label: string) => {
    sub += 1;
    const text = `${section}.${sub} ${label}`;
    blocks.push({ kind: 'heading', level: 3, text, anchor: slugAnchor(text), toc: false });
  };
  const md = (text: string | undefined) => {
    if (text && text.trim()) blocks.push({ kind: 'markdown', text: text.trim() });
  };
  const list = (items: string[], ordered = false) => {
    if (items.length) blocks.push({ kind: 'list', items, ordered });
  };
  const table = (headers: string[], rows: string[][]) => {
    if (rows.length) blocks.push({ kind: 'table', headers, rows });
  };
  const fig = (artifactId: string, caption: string) => {
    const diagram = diagrams.get(artifactId);
    if (!diagram) return;
    figure += 1;
    blocks.push({ kind: 'figure', diagram, caption, number: figure });
  };

  // 1. Executive summary
  h2('executiveSummary');
  md(spec.executiveSummary);

  // 2. Background & objectives
  h2('backgroundObjectives');
  if (spec.background) {
    h3(L('background'));
    md(spec.background);
  }
  h3(L('objectives'));
  list(spec.objectives, true);

  // 3. Scope
  h2('scope');
  h3(L('inScope'));
  list(spec.scope.inScope);
  if (spec.scope.outOfScope.length) {
    h3(L('outOfScope'));
    list(spec.scope.outOfScope);
  }

  // 4. Stakeholders
  if (spec.stakeholders.length) {
    h2('stakeholders');
    table(
      [L('name'), L('role'), L('responsibility')],
      spec.stakeholders.map((s) => [s.name, s.role, s.responsibility ?? '-']),
    );
  }

  // 5. Assumptions, constraints, dependencies
  if (spec.assumptions.length || spec.constraints.length || spec.dependencies.length) {
    h2('assumptionsConstraints');
    if (spec.assumptions.length) {
      h3(L('assumptions'));
      list(spec.assumptions);
    }
    if (spec.constraints.length) {
      h3(L('constraints'));
      list(spec.constraints);
    }
    if (spec.dependencies.length) {
      h3(L('dependencies'));
      list(spec.dependencies);
    }
  }

  // 6. Architecture overview
  h2('architecture');
  md(spec.architecture.overview);
  if (spec.architecture.principles.length) {
    h3(L('principles'));
    list(spec.architecture.principles);
  }
  if (spec.architecture.diagrams.length) {
    h3(L('diagrams'));
    for (const d of spec.architecture.diagrams) fig(d.artifactId, d.caption);
  }

  // 7. Decisions
  if (spec.decisions.length) {
    h2('decisions');
    for (const d of spec.decisions) {
      h3(`${d.id} — ${d.title} (${d.status})`);
      md(`**${L('decision')}:** ${d.decision}`);
      md(`**${L('rationale')}:** ${d.rationale}`);
      if (d.alternatives) md(`**${L('alternatives')}:** ${d.alternatives}`);
    }
  }

  // 8. Components
  if (spec.components.length) {
    h2('components');
    table(
      [L('component'), L('type'), L('responsibility'), L('technology'), L('owner')],
      spec.components.map((c) => [c.name, c.type ?? '-', c.responsibility, c.technology ?? '-', c.owner ?? '-']),
    );
  }

  // 9. Functional requirements
  h2('functional');
  table(
    ['ID', L('title'), L('priority')],
    spec.functionalRequirements.map((r) => [r.id, r.title, r.priority]),
  );
  for (const r of spec.functionalRequirements) {
    h3(`${r.id} — ${r.title}`);
    md(r.description);
    if (r.acceptanceCriteria.length) {
      md(`**${L('acceptance')}:**`);
      list(r.acceptanceCriteria);
    }
  }

  // 10. Non-functional requirements
  h2('nonFunctional');
  table(
    ['ID', L('category'), L('requirement'), L('metric')],
    spec.nonFunctionalRequirements.map((r) => [r.id, r.category, r.requirement, r.metric ?? '-']),
  );

  // 11. Integrations
  if (spec.integrations.length) {
    h2('integrations');
    table(
      ['ID', L('interface'), L('source'), L('target'), L('protocol'), L('pattern'), L('dataFormat'), L('frequency'), L('security')],
      spec.integrations.map((i, n) => [
        i.id ?? `INT-${String(n + 1).padStart(2, '0')}`,
        i.description ? `${i.name} — ${i.description}` : i.name,
        i.source,
        i.target,
        i.protocol,
        i.pattern ?? '-',
        i.dataFormat ?? '-',
        i.frequency ?? '-',
        i.security ?? '-',
      ]),
    );
  }

  // 12. APIs
  if (spec.apis.length) {
    h2('apis');
    for (const api of spec.apis) {
      h3(`${api.method} ${api.path} — ${api.name}`);
      md(api.description);
      if (api.auth) md(`**${L('auth')}:** ${api.auth}`);
      if (api.request) {
        md(`**${L('request')}:**`);
        blocks.push({ kind: 'code', language: looksLikeJson(api.request) ? 'json' : 'text', text: api.request });
      }
      if (api.response) {
        md(`**${L('response')}:**`);
        blocks.push({ kind: 'code', language: looksLikeJson(api.response) ? 'json' : 'text', text: api.response });
      }
      if (api.errors.length) {
        md(`**${L('errors')}:**`);
        list(api.errors);
      }
    }
  }

  // 13. Data model
  if (spec.dataModel.length) {
    h2('dataModel');
    for (const e of spec.dataModel) {
      h3(e.entity);
      md(e.description);
      table(
        [L('attribute'), L('type'), L('required'), L('description')],
        e.attributes.map((a) => [a.name, a.type, a.required ? L('yes') : L('no'), a.description ?? '-']),
      );
    }
  }

  // 14. Process flows
  if (spec.processFlows.length) {
    h2('processFlows');
    for (const flow of spec.processFlows) {
      h3(flow.title);
      md(flow.description);
      if (flow.diagram) {
        fig(flow.diagram.artifactId, flow.diagram.caption);
        const resolved = diagrams.get(flow.diagram.artifactId);
        if (resolved?.mermaid) blocks.push({ kind: 'mermaid', text: resolved.mermaid, summary: L('mermaidSource') });
      }
    }
  }

  // 15-19. Free text sections
  const free: Array<[Parameters<typeof t>[1], string | undefined]> = [
    ['security', spec.security],
    ['deployment', spec.deployment],
    ['observability', spec.observability],
    ['migration', spec.migration],
    ['testing', spec.testing],
  ];
  for (const [key, value] of free) {
    if (value && value.trim()) {
      h2(key);
      md(value);
    }
  }

  for (const extra of spec.additionalSections) {
    h2(extra.title, true);
    md(extra.content);
  }

  if (spec.risks.length) {
    h2('risks');
    table(
      ['ID', L('description'), L('impact'), L('likelihood'), L('mitigation'), L('owner')],
      spec.risks.map((r) => [r.id, r.description, r.impact, r.likelihood, r.mitigation, r.owner ?? '-']),
    );
  }
  if (spec.openIssues.length) {
    h2('openIssues');
    table(
      ['ID', L('description'), L('owner'), L('dueDate')],
      spec.openIssues.map((i) => [i.id, i.description, i.owner ?? '-', i.dueDate ?? '-']),
    );
  }
  if (spec.glossary.length) {
    h2('glossary');
    table([L('term'), L('definition')], spec.glossary.map((g) => [g.term, g.definition]));
  }
  if (spec.references.length) {
    h2('references');
    list(spec.references, true);
  }

  const date = spec.date ?? today;
  const meta: Array<[string, string]> = [
    [L('documentId'), spec.documentId ?? '-'],
    [L('version'), spec.version],
    [L('status'), spec.status],
    [L('date'), date],
    [L('authors'), spec.authors.join(', ')],
  ];
  if (spec.reviewers.length) meta.push([L('reviewers'), spec.reviewers.join(', ')]);
  if (spec.approvers.length) meta.push([L('approvers'), spec.approvers.join(', ')]);

  const revisions = spec.revisionHistory.length
    ? spec.revisionHistory.map((r) => [r.version, r.date, r.author, r.changes])
    : [[spec.version, date, spec.authors.join(', '), L('initialVersion')]];

  return {
    title: spec.title,
    lang,
    info: {
      documentId: spec.documentId ?? null,
      version: spec.version,
      status: spec.status,
      date,
      authors: spec.authors,
      reviewers: spec.reviewers,
      approvers: spec.approvers,
      summary: spec.executiveSummary,
    },
    meta,
    revisionHeaders: [L('version'), L('date'), L('author'), L('changes')],
    revisions,
    blocks,
  };
}

function looksLikeJson(value: string): boolean {
  const v = value.trim();
  if (!(v.startsWith('{') || v.startsWith('['))) return false;
  try {
    JSON.parse(v);
    return true;
  } catch {
    return false;
  }
}
