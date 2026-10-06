/** Shared sample inputs used by the generator and agent tests. */

export const sampleArchimate = {
  name: 'Order Platform - Target Architecture',
  documentation: 'Sample & <test> model',
  elements: [
    { id: 'ba-customer', type: 'BusinessActor', name: 'Customer' },
    { id: 'br-buyer', type: 'BusinessRole', name: 'Buyer' },
    { id: 'bs-order', type: 'BusinessService', name: 'Ordering' },
    { id: 'bp-place-order', type: 'BusinessProcess', name: 'Place Order' },
    { id: 'bo-order', type: 'BusinessObject', name: 'Order' },
    { id: 'ac-web', type: 'ApplicationComponent', name: 'Web Storefront', properties: { Owner: 'Digital' } },
    { id: 'ai-order-api', type: 'ApplicationInterface', name: 'Order API' },
    { id: 'ac-order', type: 'ApplicationComponent', name: 'Order Service' },
    { id: 'as-order', type: 'ApplicationService', name: 'Order Management' },
    { id: 'do-order', type: 'DataObject', name: 'Order Record' },
    { id: 'tn-k8s', type: 'Node', name: 'Kubernetes Cluster' },
    { id: 'ss-pg', type: 'SystemSoftware', name: 'PostgreSQL' },
    { id: 'ts-hosting', type: 'TechnologyService', name: 'Container Hosting' },
  ],
  relationships: [
    { type: 'Assignment', source: 'ba-customer', target: 'br-buyer' },
    { type: 'Serving', source: 'bs-order', target: 'br-buyer' },
    { type: 'Realization', source: 'bp-place-order', target: 'bs-order' },
    { type: 'Access', source: 'bp-place-order', target: 'bo-order', accessType: 'Write' },
    { type: 'Serving', source: 'as-order', target: 'bp-place-order' },
    { type: 'Realization', source: 'ac-order', target: 'as-order' },
    { type: 'Composition', source: 'ac-order', target: 'ai-order-api' },
    { type: 'Flow', source: 'ac-web', target: 'ac-order', name: 'order request' },
    { type: 'Access', source: 'ac-order', target: 'do-order', accessType: 'ReadWrite' },
    { type: 'Realization', source: 'do-order', target: 'bo-order' },
    { type: 'Serving', source: 'ts-hosting', target: 'ac-order' },
    { type: 'Realization', source: 'tn-k8s', target: 'ts-hosting' },
    { type: 'Composition', source: 'tn-k8s', target: 'ss-pg' },
  ],
  views: [
    { name: 'Layered View', viewpoint: 'Layered' },
    { name: 'Application Cooperation', viewpoint: 'Application Cooperation', elements: ['ac-web', 'ac-order', 'ai-order-api', 'as-order', 'do-order'] },
  ],
};

export const sampleSequence = {
  title: 'Place order',
  participants: [
    { id: 'Customer', label: 'Customer', kind: 'actor' },
    { id: 'Web', label: 'Web Storefront' },
    { id: 'OrderSvc', label: 'Order Service', kind: 'control' },
    { id: 'DB', label: 'Order DB', kind: 'database' },
  ],
  steps: [
    { type: 'message', from: 'Customer', to: 'Web', text: 'Checkout; pay #1' },
    { type: 'message', from: 'Web', to: 'OrderSvc', text: 'POST /orders', activate: true },
    { type: 'fragment_start', kind: 'alt', label: 'valid cart' },
    { type: 'message', from: 'OrderSvc', to: 'DB', text: 'INSERT order' },
    { type: 'fragment_else', label: 'invalid cart' },
    { type: 'note', over: ['OrderSvc'], text: 'Validation failed' },
    { type: 'fragment_end' },
    { type: 'message', from: 'OrderSvc', to: 'Web', text: '201 Created', style: 'reply', deactivate: true },
  ],
};

export function sampleTechSpec(diagramArtifactId: string) {
  return {
    language: 'id',
    title: 'Order Platform - Technical Specification',
    documentId: 'TSD-ORD-001',
    authors: ['Solution Architect'],
    executiveSummary: 'Ringkasan **solusi** pemesanan.',
    objectives: ['Mempercepat checkout'],
    scope: { inScope: ['Pemesanan online'], outOfScope: ['Pengiriman'] },
    architecture: {
      overview: 'Arsitektur berbasis layanan. <script>alert(1)</script>',
      diagrams: [{ artifactId: diagramArtifactId, caption: 'Layered view' }],
    },
    functionalRequirements: [
      { id: 'FR-01', title: 'Buat pesanan', description: 'Sistem harus membuat pesanan.', priority: 'Must', acceptanceCriteria: ['Given cart valid, when checkout, then order created'] },
    ],
    nonFunctionalRequirements: [{ id: 'NFR-01', category: 'Performance', requirement: 'API cepat', metric: 'p95 < 300 ms' }],
    integrations: [{ name: 'Order API', source: 'Web Storefront', target: 'Order Service', protocol: 'HTTPS/REST', security: 'OAuth 2.0' }],
    apis: [{ name: 'Create order', method: 'POST', path: '/orders', description: 'Create an order', request: '{"items": []}', response: '{"orderId": "o-1"}', errors: ['400 VALIDATION_ERROR'] }],
    risks: [{ id: 'RSK-01', description: 'Lonjakan trafik | promo', impact: 'High', likelihood: 'Medium', mitigation: 'Autoscaling' }],
  };
}
