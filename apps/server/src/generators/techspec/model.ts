import { z } from 'zod';

const text = (max = 20000) => z.string().max(max);
const md = (max = 20000) => text(max).describe('Markdown');
const artifactRef = z.string().regex(/^art_[A-Za-z0-9]+$/, 'must be an artifact id such as "art_1a2b3c"');

export const DiagramRefSchema = z.object({
  artifactId: artifactRef.describe('Id of an SVG artifact created earlier in this task (ArchiMate view or sequence diagram)'),
  caption: text(300),
});

export const TechSpecSchema = z.object({
  language: z.enum(['id', 'en']).default('id').describe('Language of headings and labels: "id" (Bahasa Indonesia) or "en"'),
  title: text(200).min(1),
  documentId: text(60).optional().describe('e.g. "TSD-ORD-001"'),
  version: text(20).default('1.0'),
  status: text(40).default('Draft'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD, defaults to today'),
  authors: z.array(text(120)).min(1),
  reviewers: z.array(text(120)).default([]),
  approvers: z.array(text(120)).default([]),
  revisionHistory: z
    .array(z.object({ version: text(20), date: text(20), author: text(120), changes: text(500) }))
    .default([]),

  executiveSummary: md().min(1),
  background: md().optional(),
  objectives: z.array(text(500)).min(1),
  scope: z.object({
    inScope: z.array(text(500)).min(1),
    outOfScope: z.array(text(500)).default([]),
  }),
  stakeholders: z.array(z.object({ name: text(120), role: text(200), responsibility: text(500).optional() })).default([]),
  assumptions: z.array(text(500)).default([]),
  constraints: z.array(text(500)).default([]),
  dependencies: z.array(text(500)).default([]),

  architecture: z.object({
    overview: md().min(1),
    principles: z.array(text(500)).default([]),
    diagrams: z.array(DiagramRefSchema).default([]),
  }),
  decisions: z
    .array(
      z.object({
        id: text(30),
        title: text(200),
        decision: md(4000),
        rationale: md(4000),
        alternatives: md(4000).optional(),
        status: text(30).default('Accepted'),
      }),
    )
    .default([]),
  components: z
    .array(
      z.object({
        name: text(120),
        type: text(80).optional(),
        responsibility: text(1000),
        technology: text(300).optional(),
        owner: text(120).optional(),
      }),
    )
    .default([]),
  functionalRequirements: z
    .array(
      z.object({
        id: text(30),
        title: text(200),
        description: md(4000),
        priority: z.enum(['Must', 'Should', 'Could', "Won't"]),
        acceptanceCriteria: z.array(text(1000)).default([]),
      }),
    )
    .min(1),
  nonFunctionalRequirements: z
    .array(
      z.object({
        id: text(30),
        category: text(80).describe('e.g. Performance, Availability, Security, Scalability, Maintainability'),
        requirement: text(1000),
        metric: text(300).optional().describe('Measurable target, e.g. "p95 < 300 ms at 200 RPS"'),
      }),
    )
    .min(1),
  integrations: z
    .array(
      z.object({
        id: text(30).optional(),
        name: text(200),
        source: text(120),
        target: text(120),
        protocol: text(80),
        pattern: text(80).optional().describe('e.g. Request/Response, Event, Batch, File'),
        dataFormat: text(80).optional(),
        frequency: text(120).optional(),
        security: text(300).optional(),
        description: text(1000).optional(),
      }),
    )
    .default([]),
  apis: z
    .array(
      z.object({
        name: text(200),
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'EVENT', 'RPC']),
        path: text(300).describe('Path, topic or operation name'),
        description: text(1000),
        auth: text(200).optional(),
        request: text(8000).optional().describe('Example request body / parameters (JSON or text)'),
        response: text(8000).optional().describe('Example response body (JSON or text)'),
        errors: z.array(text(300)).default([]),
      }),
    )
    .default([]),
  dataModel: z
    .array(
      z.object({
        entity: text(120),
        description: text(1000).optional(),
        attributes: z
          .array(z.object({ name: text(120), type: text(80), required: z.boolean().default(false), description: text(500).optional() }))
          .min(1),
      }),
    )
    .default([]),
  processFlows: z
    .array(z.object({ title: text(200), description: md(4000).optional(), diagram: DiagramRefSchema.optional() }))
    .default([]),
  security: md().optional(),
  deployment: md().optional(),
  observability: md().optional(),
  migration: md().optional(),
  testing: md().optional(),
  risks: z
    .array(
      z.object({
        id: text(30),
        description: text(1000),
        impact: z.enum(['High', 'Medium', 'Low']),
        likelihood: z.enum(['High', 'Medium', 'Low']),
        mitigation: text(1000),
        owner: text(120).optional(),
      }),
    )
    .default([]),
  openIssues: z
    .array(z.object({ id: text(30), description: text(1000), owner: text(120).optional(), dueDate: text(20).optional() }))
    .default([]),
  glossary: z.array(z.object({ term: text(120), definition: text(1000) })).default([]),
  references: z.array(text(500)).default([]),
  additionalSections: z
    .array(z.object({ title: text(200), content: md() }))
    .default([])
    .describe('Extra sections appended before Risks'),
});

export type TechSpecInput = z.input<typeof TechSpecSchema>;
export type TechSpec = z.output<typeof TechSpecSchema>;

/** A diagram referenced by the document, resolved from task artifacts. */
export interface ResolvedDiagram {
  artifactId: string;
  fileName: string;
  svg: string;
  mermaid?: string;
}
