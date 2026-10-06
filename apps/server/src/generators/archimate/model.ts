import { z } from 'zod';
import { ELEMENT_TYPES, RELATIONSHIP_TYPES } from './metamodel.js';

const id = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/, 'ids may contain letters, digits, ".", "_" and "-" (max 80 chars)');

export const ArchimateElementSchema = z.object({
  id: id.describe('Unique, stable id chosen by you, e.g. "app-order-service"'),
  type: z.enum(ELEMENT_TYPES).describe('ArchiMate 3.2 element type (Open Exchange Format name)'),
  name: z.string().min(1).max(200),
  documentation: z.string().max(4000).optional(),
  properties: z.record(z.string(), z.string()).optional().describe('Optional key/value properties, e.g. {"Owner": "IT Ops"}'),
});

export const ArchimateRelationshipSchema = z.object({
  id: id.optional().describe('Optional unique id; generated when omitted'),
  type: z.enum(RELATIONSHIP_TYPES),
  source: id.describe('Source element id'),
  target: id.describe('Target element id'),
  name: z.string().max(200).optional(),
  documentation: z.string().max(4000).optional(),
  accessType: z.enum(['Access', 'Read', 'Write', 'ReadWrite']).optional().describe('Only for Access relationships'),
  isDirected: z.boolean().optional().describe('Only for Association relationships'),
  influenceModifier: z.string().max(10).optional().describe('Only for Influence relationships, e.g. "+", "++", "-", "--"'),
});

export const ArchimateViewSchema = z.object({
  id: id.optional(),
  name: z.string().min(1).max(200),
  documentation: z.string().max(4000).optional(),
  viewpoint: z.string().max(100).optional().describe('Informative viewpoint name shown in the diagram title, e.g. "Layered", "Application Cooperation"'),
  elements: z.array(id).optional().describe('Element ids shown in this view; omit to show every element'),
  relationships: z
    .array(id)
    .optional()
    .describe('Relationship ids shown in this view; omit to show every relationship whose both ends are in the view'),
});

export const ArchimateModelSchema = z.object({
  name: z.string().min(1).max(200).describe('Model name, e.g. "Order Platform - Target Architecture"'),
  documentation: z.string().max(8000).optional(),
  language: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).optional().describe('xml:lang of names, default "en" (use "id" for Bahasa Indonesia)'),
  elements: z.array(ArchimateElementSchema).min(1),
  relationships: z.array(ArchimateRelationshipSchema).default([]),
  views: z.array(ArchimateViewSchema).optional().describe('Diagrams to render; omit for one layered view with everything'),
});

export type ArchimateModelInput = z.input<typeof ArchimateModelSchema>;
export type ArchimateModel = z.output<typeof ArchimateModelSchema>;
export type ArchimateElement = z.output<typeof ArchimateElementSchema>;
export type ArchimateRelationship = z.output<typeof ArchimateRelationshipSchema> & { id: string };
export type ArchimateView = z.output<typeof ArchimateViewSchema>;

/** Model after validation: every relationship and view has an id and explicit members. */
export interface NormalizedArchimateModel {
  name: string;
  documentation?: string;
  language: string;
  elements: ArchimateElement[];
  relationships: ArchimateRelationship[];
  views: Array<ArchimateView & { id: string; elements: string[]; relationships: string[] }>;
}
