import { describe, expect, it } from 'vitest';
import { buildArchimate } from '../src/generators/archimate/index.js';
import { layoutView } from '../src/generators/archimate/layout.js';
import { routeArchiMateEdges, layoutArchiMateLabels } from '../src/generators/archimate/routing.js';
import { sampleArchimate } from './fixtures.js';

describe('ArchiMate export geometry parity — phase C', () => {
  it('uses one routed path and label placement in SVG, mxGraph and Exchange XML', () => {
    const res = buildArchimate(sampleArchimate);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { model, views, drawio, exchangeXml } = res.output;
    for (const [index, view] of model.views.entries()) {
      const nodes = view.elements.map((id) => model.elements.find((n) => n.id === id)!);
      const rels = view.relationships.map((id) => model.relationships.find((r) => r.id === id)!);
      const layout = layoutView(nodes, rels);
      const routes = routeArchiMateEdges(layout, rels);
      const labels = layoutArchiMateLabels(layout, rels, routes);
      for (const [i, r] of rels.entries()) {
        const route = routes.get(r.id);
        expect(route, 'missing route for ' + r.id).toBeDefined();
        const points = route!.points;
        // Renderer uses the shared route as its SVG path, without re-routing.
        const path = points.map((p, j) =>
          (j === 0 ? 'M' : 'L') + Math.round(p.x * 10) / 10 + ' ' + Math.round(p.y * 10) / 10).join('');
        expect(views[index]!.svg).toContain('data-id="' + r.id + '" d="' + path + '"');

        const edge = drawio.match(new RegExp('<mxCell id="rel-' + index + '-' + i + '"[^>]*>([\\s\\S]*?)</mxCell>'));
        expect(edge, 'missing editable mxGraph relationship ' + r.id).not.toBeNull();
        expect(edge![0]).toContain('edgeStyle=none;orthogonal=1');
        for (const p of points.slice(1, -1)) {
          expect(edge![1]).toContain('x="' + Math.round(p.x) + '" y="' + Math.round(p.y) + '"');
        }
        // Each relationship exchange entry uses the same full list, including node attachments.
        const connection = exchangeXml.match(new RegExp('<connection[^>]*relationshipRef="id-' + r.id + '"[^>]*>([\\s\\S]*?)</connection>'));
        expect(connection, 'missing semantic connection with routed geometry ' + r.id).not.toBeNull();
        expect(connection![1]).toContain('<sourceAttachment x="' + Math.max(0, Math.round(points[0]!.x)));
        expect(connection![1]).toContain('<targetAttachment x="' + Math.max(0, Math.round(points[points.length - 1]!.x)));
        for (const p of points.slice(1, -1)) {
          expect(connection![1]).toContain('<bendpoint x="' + Math.max(0, Math.round(p.x)) +
            '" y="' + Math.max(0, Math.round(p.y)) + '"/>');
        }
        const label = labels.get(r.id);
        if (label) {
          expect(drawio).toContain('id="rel-label-' + index + '-' + i + '"');
          expect(views[index]!.svg).toContain('x="' +
            Math.round((label.box.x + label.box.w / 2) * 10) / 10 + '"');
        }
      }
    }
    expect(exchangeXml).toContain('<bendpoint x="');
    expect(drawio).toContain('<Array as="points">');
  });
});
