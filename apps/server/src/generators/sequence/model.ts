import { z } from 'zod';

export const PARTICIPANT_KINDS = ['actor', 'participant', 'boundary', 'control', 'entity', 'database', 'queue', 'collections', 'external'] as const;
export const FRAGMENT_KINDS = ['alt', 'opt', 'loop', 'par', 'critical', 'break', 'group'] as const;

const participantId = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/, 'participant ids must start with a letter and contain only letters, digits or "_" (max 40)');

export const ParticipantSchema = z.object({
  id: participantId,
  label: z.string().min(1).max(80),
  kind: z.enum(PARTICIPANT_KINDS).default('participant'),
  description: z.string().max(500).optional(),
});

export const MessageStepSchema = z.object({
  type: z.literal('message'),
  from: participantId,
  to: participantId,
  text: z.string().min(1).max(300),
  style: z.enum(['sync', 'async', 'reply']).default('sync').describe('sync = solid + filled arrow, async = solid + open arrow, reply = dashed return'),
  activate: z.boolean().optional().describe('Start an activation bar on the receiver ("to")'),
  deactivate: z.boolean().optional().describe('End the current activation bar of the sender ("from")'),
});

export const NoteStepSchema = z.object({
  type: z.literal('note'),
  over: z.array(participantId).min(1).max(2).describe('One participant, or two to span between them'),
  text: z.string().min(1).max(500),
});

export const DividerStepSchema = z.object({
  type: z.literal('divider'),
  text: z.string().min(1).max(120),
});

export const FragmentStartSchema = z.object({
  type: z.literal('fragment_start'),
  kind: z.enum(FRAGMENT_KINDS),
  label: z.string().max(160).default('').describe('Condition / description, e.g. "payment approved"'),
});

export const FragmentElseSchema = z.object({
  type: z.literal('fragment_else'),
  label: z.string().max(160).default('').describe('Condition of the next branch (only inside alt, par or critical)'),
});

export const FragmentEndSchema = z.object({
  type: z.literal('fragment_end'),
});

export const StepSchema = z.discriminatedUnion('type', [
  MessageStepSchema,
  NoteStepSchema,
  DividerStepSchema,
  FragmentStartSchema,
  FragmentElseSchema,
  FragmentEndSchema,
]);

export const SequenceDiagramSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  autonumber: z.boolean().default(true),
  participants: z.array(ParticipantSchema).min(2),
  steps: z
    .array(StepSchema)
    .min(1)
    .describe('Flat, ordered list. Open combined fragments with fragment_start, separate branches with fragment_else and close them with fragment_end.'),
});

export type SequenceDiagramInput = z.input<typeof SequenceDiagramSchema>;
export type SequenceDiagram = z.output<typeof SequenceDiagramSchema>;
export type Participant = z.output<typeof ParticipantSchema>;
export type Step = z.output<typeof StepSchema>;
export type MessageStep = z.output<typeof MessageStepSchema>;
export type FragmentKind = (typeof FRAGMENT_KINDS)[number];
