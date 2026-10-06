import { ARCHIMATE_RELATIONSHIP_TABLE } from './relationships.generated.js';

export const ELEMENT_TYPES = [
  // Strategy
  'Resource',
  'Capability',
  'ValueStream',
  'CourseOfAction',
  // Business
  'BusinessActor',
  'BusinessRole',
  'BusinessCollaboration',
  'BusinessInterface',
  'BusinessProcess',
  'BusinessFunction',
  'BusinessInteraction',
  'BusinessEvent',
  'BusinessService',
  'BusinessObject',
  'Contract',
  'Representation',
  'Product',
  // Application
  'ApplicationComponent',
  'ApplicationCollaboration',
  'ApplicationInterface',
  'ApplicationFunction',
  'ApplicationInteraction',
  'ApplicationProcess',
  'ApplicationEvent',
  'ApplicationService',
  'DataObject',
  // Technology
  'Node',
  'Device',
  'SystemSoftware',
  'TechnologyCollaboration',
  'TechnologyInterface',
  'Path',
  'CommunicationNetwork',
  'TechnologyFunction',
  'TechnologyProcess',
  'TechnologyInteraction',
  'TechnologyEvent',
  'TechnologyService',
  'Artifact',
  // Physical
  'Equipment',
  'Facility',
  'DistributionNetwork',
  'Material',
  // Motivation
  'Stakeholder',
  'Driver',
  'Assessment',
  'Goal',
  'Outcome',
  'Principle',
  'Requirement',
  'Constraint',
  'Meaning',
  'Value',
  // Implementation & Migration
  'WorkPackage',
  'Deliverable',
  'ImplementationEvent',
  'Plateau',
  'Gap',
  // Other
  'Grouping',
  'Location',
  'AndJunction',
  'OrJunction',
] as const;

export type ElementType = (typeof ELEMENT_TYPES)[number];

export const RELATIONSHIP_TYPES = [
  'Composition',
  'Aggregation',
  'Assignment',
  'Realization',
  'Serving',
  'Access',
  'Influence',
  'Triggering',
  'Flow',
  'Specialization',
  'Association',
] as const;

export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

const LETTER: Record<RelationshipType, string> = {
  Access: 'a',
  Composition: 'c',
  Flow: 'f',
  Aggregation: 'g',
  Assignment: 'i',
  Influence: 'n',
  Association: 'o',
  Realization: 'r',
  Specialization: 's',
  Triggering: 't',
  Serving: 'v',
};

export type Layer = 'motivation' | 'strategy' | 'business' | 'application' | 'technology' | 'physical' | 'implementation' | 'other';

/** Row inside a layer band of the auto-layout. */
export type RowKind = 'active' | 'service' | 'behavior' | 'passive' | 'other';

export type Glyph =
  | 'actor'
  | 'role'
  | 'collaboration'
  | 'interface'
  | 'process'
  | 'function'
  | 'interaction'
  | 'event'
  | 'service'
  | 'object'
  | 'contract'
  | 'representation'
  | 'product'
  | 'component'
  | 'node'
  | 'device'
  | 'systemSoftware'
  | 'path'
  | 'network'
  | 'artifact'
  | 'equipment'
  | 'facility'
  | 'distribution'
  | 'material'
  | 'stakeholder'
  | 'driver'
  | 'assessment'
  | 'goal'
  | 'outcome'
  | 'principle'
  | 'requirement'
  | 'constraint'
  | 'meaning'
  | 'value'
  | 'resource'
  | 'capability'
  | 'valueStream'
  | 'courseOfAction'
  | 'workPackage'
  | 'deliverable'
  | 'plateau'
  | 'gap'
  | 'location'
  | 'grouping'
  | 'junction';

export type Shape = 'rect' | 'rounded' | 'pill' | 'cut' | 'junction' | 'group';

export interface ElementInfo {
  type: ElementType;
  label: string;
  layer: Layer;
  row: RowKind;
  glyph: Glyph;
  shape: Shape;
  /** True for passive structure elements drawn with a header band. */
  headerBand?: boolean;
}

const info = (
  type: ElementType,
  label: string,
  layer: Layer,
  row: RowKind,
  glyph: Glyph,
  shape: Shape,
  headerBand = false,
): ElementInfo => ({ type, label, layer, row, glyph, shape, headerBand });

export const ELEMENT_INFO: Record<ElementType, ElementInfo> = {
  Resource: info('Resource', 'Resource', 'strategy', 'active', 'resource', 'rect'),
  Capability: info('Capability', 'Capability', 'strategy', 'behavior', 'capability', 'rounded'),
  ValueStream: info('ValueStream', 'Value Stream', 'strategy', 'behavior', 'valueStream', 'rounded'),
  CourseOfAction: info('CourseOfAction', 'Course of Action', 'strategy', 'behavior', 'courseOfAction', 'rounded'),

  BusinessActor: info('BusinessActor', 'Business Actor', 'business', 'active', 'actor', 'rect'),
  BusinessRole: info('BusinessRole', 'Business Role', 'business', 'active', 'role', 'rect'),
  BusinessCollaboration: info('BusinessCollaboration', 'Business Collaboration', 'business', 'active', 'collaboration', 'rect'),
  BusinessInterface: info('BusinessInterface', 'Business Interface', 'business', 'active', 'interface', 'rect'),
  BusinessProcess: info('BusinessProcess', 'Business Process', 'business', 'behavior', 'process', 'rounded'),
  BusinessFunction: info('BusinessFunction', 'Business Function', 'business', 'behavior', 'function', 'rounded'),
  BusinessInteraction: info('BusinessInteraction', 'Business Interaction', 'business', 'behavior', 'interaction', 'rounded'),
  BusinessEvent: info('BusinessEvent', 'Business Event', 'business', 'behavior', 'event', 'rounded'),
  BusinessService: info('BusinessService', 'Business Service', 'business', 'service', 'service', 'pill'),
  BusinessObject: info('BusinessObject', 'Business Object', 'business', 'passive', 'object', 'rect', true),
  Contract: info('Contract', 'Contract', 'business', 'passive', 'contract', 'rect', true),
  Representation: info('Representation', 'Representation', 'business', 'passive', 'representation', 'rect'),
  Product: info('Product', 'Product', 'business', 'passive', 'product', 'rect'),

  ApplicationComponent: info('ApplicationComponent', 'Application Component', 'application', 'active', 'component', 'rect'),
  ApplicationCollaboration: info('ApplicationCollaboration', 'Application Collaboration', 'application', 'active', 'collaboration', 'rect'),
  ApplicationInterface: info('ApplicationInterface', 'Application Interface', 'application', 'active', 'interface', 'rect'),
  ApplicationFunction: info('ApplicationFunction', 'Application Function', 'application', 'behavior', 'function', 'rounded'),
  ApplicationInteraction: info('ApplicationInteraction', 'Application Interaction', 'application', 'behavior', 'interaction', 'rounded'),
  ApplicationProcess: info('ApplicationProcess', 'Application Process', 'application', 'behavior', 'process', 'rounded'),
  ApplicationEvent: info('ApplicationEvent', 'Application Event', 'application', 'behavior', 'event', 'rounded'),
  ApplicationService: info('ApplicationService', 'Application Service', 'application', 'service', 'service', 'pill'),
  DataObject: info('DataObject', 'Data Object', 'application', 'passive', 'object', 'rect', true),

  Node: info('Node', 'Node', 'technology', 'active', 'node', 'rect'),
  Device: info('Device', 'Device', 'technology', 'active', 'device', 'rect'),
  SystemSoftware: info('SystemSoftware', 'System Software', 'technology', 'active', 'systemSoftware', 'rect'),
  TechnologyCollaboration: info('TechnologyCollaboration', 'Technology Collaboration', 'technology', 'active', 'collaboration', 'rect'),
  TechnologyInterface: info('TechnologyInterface', 'Technology Interface', 'technology', 'active', 'interface', 'rect'),
  Path: info('Path', 'Path', 'technology', 'active', 'path', 'rect'),
  CommunicationNetwork: info('CommunicationNetwork', 'Communication Network', 'technology', 'active', 'network', 'rect'),
  TechnologyFunction: info('TechnologyFunction', 'Technology Function', 'technology', 'behavior', 'function', 'rounded'),
  TechnologyProcess: info('TechnologyProcess', 'Technology Process', 'technology', 'behavior', 'process', 'rounded'),
  TechnologyInteraction: info('TechnologyInteraction', 'Technology Interaction', 'technology', 'behavior', 'interaction', 'rounded'),
  TechnologyEvent: info('TechnologyEvent', 'Technology Event', 'technology', 'behavior', 'event', 'rounded'),
  TechnologyService: info('TechnologyService', 'Technology Service', 'technology', 'service', 'service', 'pill'),
  Artifact: info('Artifact', 'Artifact', 'technology', 'passive', 'artifact', 'rect'),

  Equipment: info('Equipment', 'Equipment', 'physical', 'active', 'equipment', 'rect'),
  Facility: info('Facility', 'Facility', 'physical', 'active', 'facility', 'rect'),
  DistributionNetwork: info('DistributionNetwork', 'Distribution Network', 'physical', 'active', 'distribution', 'rect'),
  Material: info('Material', 'Material', 'physical', 'passive', 'material', 'rect'),

  Stakeholder: info('Stakeholder', 'Stakeholder', 'motivation', 'active', 'stakeholder', 'cut'),
  Driver: info('Driver', 'Driver', 'motivation', 'active', 'driver', 'cut'),
  Assessment: info('Assessment', 'Assessment', 'motivation', 'active', 'assessment', 'cut'),
  Goal: info('Goal', 'Goal', 'motivation', 'behavior', 'goal', 'cut'),
  Outcome: info('Outcome', 'Outcome', 'motivation', 'behavior', 'outcome', 'cut'),
  Principle: info('Principle', 'Principle', 'motivation', 'behavior', 'principle', 'cut'),
  Requirement: info('Requirement', 'Requirement', 'motivation', 'behavior', 'requirement', 'cut'),
  Constraint: info('Constraint', 'Constraint', 'motivation', 'behavior', 'constraint', 'cut'),
  Meaning: info('Meaning', 'Meaning', 'motivation', 'passive', 'meaning', 'cut'),
  Value: info('Value', 'Value', 'motivation', 'passive', 'value', 'cut'),

  WorkPackage: info('WorkPackage', 'Work Package', 'implementation', 'behavior', 'workPackage', 'rounded'),
  Deliverable: info('Deliverable', 'Deliverable', 'implementation', 'passive', 'deliverable', 'rect'),
  ImplementationEvent: info('ImplementationEvent', 'Implementation Event', 'implementation', 'behavior', 'event', 'rounded'),
  Plateau: info('Plateau', 'Plateau', 'implementation', 'other', 'plateau', 'rect'),
  Gap: info('Gap', 'Gap', 'implementation', 'other', 'gap', 'rect'),

  Grouping: info('Grouping', 'Grouping', 'other', 'other', 'grouping', 'group'),
  Location: info('Location', 'Location', 'other', 'other', 'location', 'rect'),
  AndJunction: info('AndJunction', 'And Junction', 'other', 'other', 'junction', 'junction'),
  OrJunction: info('OrJunction', 'Or Junction', 'other', 'other', 'junction', 'junction'),
};

export const LAYER_ORDER: Layer[] = ['motivation', 'strategy', 'business', 'application', 'technology', 'physical', 'implementation', 'other'];

export const LAYER_LABEL: Record<Layer, string> = {
  motivation: 'Motivation',
  strategy: 'Strategy',
  business: 'Business',
  application: 'Application',
  technology: 'Technology',
  physical: 'Physical',
  implementation: 'Implementation & Migration',
  other: 'Other',
};

/** Rows of each band, top to bottom, following the usual layered-view reading order. */
export const LAYER_ROWS: Record<Layer, RowKind[]> = {
  motivation: ['active', 'behavior', 'passive', 'other'],
  strategy: ['active', 'behavior', 'other'],
  business: ['active', 'service', 'behavior', 'passive', 'other'],
  application: ['service', 'active', 'behavior', 'passive', 'other'],
  technology: ['service', 'active', 'behavior', 'passive', 'other'],
  physical: ['active', 'passive', 'other'],
  implementation: ['behavior', 'passive', 'other'],
  other: ['other'],
};

export const LAYER_FILL: Record<Layer, string> = {
  motivation: '#CCCCFF',
  strategy: '#F5DEAA',
  business: '#FFFFB5',
  application: '#B5FFFF',
  technology: '#C9E7B7',
  physical: '#C9E7B7',
  implementation: '#FFE0E0',
  other: '#FFFFFF',
};

export const LAYER_BAND_FILL: Record<Layer, string> = {
  motivation: '#F3F3FF',
  strategy: '#FDF8EC',
  business: '#FFFFEE',
  application: '#EEFFFF',
  technology: '#F1F8EC',
  physical: '#F1F8EC',
  implementation: '#FFF6F6',
  other: '#FAFAFA',
};

export function elementFill(type: ElementType): string {
  if (type === 'Plateau' || type === 'Gap') return '#E0FFE0';
  if (type === 'Location') return '#FBB875';
  if (type === 'Grouping') return 'none';
  if (type === 'AndJunction') return '#000000';
  if (type === 'OrJunction') return '#FFFFFF';
  return LAYER_FILL[ELEMENT_INFO[type].layer];
}

/** Concept name used by the relationship table (both junction kinds share "Junction"). */
function tableConcept(type: ElementType): string {
  return type === 'AndJunction' || type === 'OrJunction' ? 'Junction' : type;
}

export function isJunction(type: ElementType): boolean {
  return type === 'AndJunction' || type === 'OrJunction';
}

/** Relationship types allowed by the ArchiMate 3.2 specification (Appendix B) between two element types. */
export function allowedRelationships(source: ElementType, target: ElementType): RelationshipType[] {
  const letters = ARCHIMATE_RELATIONSHIP_TABLE[tableConcept(source)]?.[tableConcept(target)] ?? '';
  return RELATIONSHIP_TYPES.filter((r) => letters.includes(LETTER[r]));
}

export function isRelationshipAllowed(type: RelationshipType, source: ElementType, target: ElementType): boolean {
  return allowedRelationships(source, target).includes(type);
}
