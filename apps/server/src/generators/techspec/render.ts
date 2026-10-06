import { createSafeMarked, escapeHtml } from '../../util/markdown.js';
import type { BuiltDocument } from './document.js';
import { t } from './i18n.js';

function mdCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>').trim() || '-';
}

function mdTable(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.map(mdCell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(mdCell).join(' | ')} |`),
  ].join('\n');
}

function fence(text: string): string {
  // use a fence longer than any backtick run inside the content
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  return '`'.repeat(longest + 1);
}

/** GitHub-flavoured Markdown. Diagrams are linked as sibling SVG files (`./name.svg`). */
export function renderTechSpecMarkdown(doc: BuiltDocument): string {
  const out: string[] = [`# ${doc.title}`, ''];
  out.push(`## ${t(doc.lang, 'documentControl')}`, '');
  out.push(mdTable(['', ''], doc.meta.map(([k, v]) => [`**${k}**`, v])), '');
  out.push(`**${t(doc.lang, 'revisionHistory')}**`, '');
  out.push(mdTable(doc.revisionHeaders, doc.revisions), '');

  const toc = doc.blocks.filter((b) => b.kind === 'heading' && b.toc);
  out.push(`## ${t(doc.lang, 'toc')}`, '');
  for (const h of toc) if (h.kind === 'heading') out.push(`- [${h.text}](#${h.anchor})`);
  out.push('');

  for (const b of doc.blocks) {
    switch (b.kind) {
      case 'heading':
        out.push(`${'#'.repeat(b.level)} ${b.text}`, '');
        break;
      case 'markdown':
        out.push(b.text, '');
        break;
      case 'list':
        b.items.forEach((item, i) => out.push(`${b.ordered ? `${i + 1}.` : '-'} ${item.replace(/\r?\n/g, ' ')}`));
        out.push('');
        break;
      case 'table':
        out.push(mdTable(b.headers, b.rows), '');
        break;
      case 'figure':
        out.push(`![${b.caption.replace(/[[\]]/g, '')}](./${b.diagram.fileName})`, '');
        out.push(`*${t(doc.lang, 'figure')} ${b.number}: ${b.caption}*`, '');
        break;
      case 'code': {
        const f = fence(b.text);
        out.push(`${f}${b.language}`, b.text.replace(/\s+$/, ''), f, '');
        break;
      }
      case 'mermaid': {
        const f = fence(b.text);
        out.push('<details>', `<summary>${b.summary}</summary>`, '', `${f}mermaid`, b.text.replace(/\s+$/, ''), f, '', '</details>', '');
        break;
      }
    }
  }
  out.push('---', '', `_${t(doc.lang, 'generatedBy')}_`, '');
  return out.join('\n');
}

const CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: #f6f8fa; color: #1f2328; font: 15px/1.6 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; }
main { max-width: 1040px; margin: 0 auto; padding: 48px 56px 64px; background: #fff; min-height: 100vh; }
h1 { font-size: 30px; line-height: 1.25; margin: 0 0 24px; }
h2 { font-size: 22px; margin: 40px 0 12px; padding-bottom: 6px; border-bottom: 1px solid #d0d7de; }
h3 { font-size: 17px; margin: 28px 0 8px; }
h4 { font-size: 15px; margin: 20px 0 6px; }
p, ul, ol { margin: 0 0 12px; }
table { width: 100%; border-collapse: collapse; margin: 8px 0 18px; font-size: 13.5px; }
th, td { border: 1px solid #d0d7de; padding: 6px 10px; text-align: left; vertical-align: top; }
th { background: #f6f8fa; font-weight: 600; }
table.meta th { width: 220px; }
code { background: #f6f8fa; padding: 1px 5px; border-radius: 4px; font-size: 90%; }
pre { background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 6px; padding: 12px 14px; overflow-x: auto; font-size: 12.5px; line-height: 1.5; }
pre code { background: none; padding: 0; }
figure { margin: 16px 0 24px; padding: 12px; border: 1px solid #d0d7de; border-radius: 8px; overflow-x: auto; text-align: center; }
figure svg { max-width: 100%; height: auto; }
figcaption { margin-top: 8px; font-size: 13px; color: #57606a; font-style: italic; }
nav.toc { background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 8px; padding: 12px 20px; margin: 16px 0 8px; }
nav.toc ul { margin: 0; padding-left: 18px; }
footer { margin-top: 48px; font-size: 12px; color: #57606a; border-top: 1px solid #d0d7de; padding-top: 12px; }
@media print {
  body { background: #fff; }
  main { padding: 0; max-width: none; }
  h2 { break-after: avoid; }
  figure, table, pre { break-inside: avoid; }
  nav.toc { break-after: page; }
}
@media (max-width: 720px) { main { padding: 24px 16px; } }
`;

/** Standalone, print-ready HTML (open in a browser and "Print to PDF", or open in Word). */
export function renderTechSpecHtml(doc: BuiltDocument): string {
  const marked = createSafeMarked();
  const block = (md: string) => marked.parse(md, { async: false }) as string;
  const inline = (md: string) => (marked.parseInline(md, { async: false }) as string).replace(/\r?\n/g, '<br>');
  const table = (headers: string[], rows: string[][], cls = '') =>
    `<table${cls ? ` class="${cls}"` : ''}><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows
      .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
      .join('')}</tbody></table>`;

  const body: string[] = [];
  body.push(`<h1>${escapeHtml(doc.title)}</h1>`);
  body.push(`<h2 id="document-control">${escapeHtml(t(doc.lang, 'documentControl'))}</h2>`);
  body.push(
    `<table class="meta"><tbody>${doc.meta.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${inline(v)}</td></tr>`).join('')}</tbody></table>`,
  );
  body.push(`<h3>${escapeHtml(t(doc.lang, 'revisionHistory'))}</h3>`);
  body.push(table(doc.revisionHeaders, doc.revisions));
  const toc = doc.blocks.filter((b) => b.kind === 'heading' && b.toc);
  body.push(
    `<nav class="toc"><strong>${escapeHtml(t(doc.lang, 'toc'))}</strong><ul>${toc
      .map((h) => (h.kind === 'heading' ? `<li><a href="#${escapeHtml(h.anchor)}">${escapeHtml(h.text)}</a></li>` : ''))
      .join('')}</ul></nav>`,
  );

  for (const b of doc.blocks) {
    switch (b.kind) {
      case 'heading':
        body.push(`<h${b.level} id="${escapeHtml(b.anchor)}">${escapeHtml(b.text)}</h${b.level}>`);
        break;
      case 'markdown':
        body.push(block(b.text));
        break;
      case 'list': {
        const tag = b.ordered ? 'ol' : 'ul';
        body.push(`<${tag}>${b.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${tag}>`);
        break;
      }
      case 'table':
        body.push(table(b.headers, b.rows));
        break;
      case 'figure': {
        // the SVG was produced by SOLAR's own renderer; strip the XML prolog if any
        const svg = b.diagram.svg.replace(/^<\?xml[^>]*>\s*/, '');
        body.push(`<figure>${svg}<figcaption>${escapeHtml(`${t(doc.lang, 'figure')} ${b.number}: ${b.caption}`)}</figcaption></figure>`);
        break;
      }
      case 'code':
        body.push(`<pre><code class="language-${escapeHtml(b.language)}">${escapeHtml(b.text)}</code></pre>`);
        break;
      case 'mermaid':
        // the rendered SVG is already embedded above; keep the source for reuse
        body.push(`<details><summary>${escapeHtml(b.summary)}</summary><pre><code class="language-mermaid">${escapeHtml(b.text)}</code></pre></details>`);
        break;
    }
  }
  body.push(`<footer>${escapeHtml(t(doc.lang, 'generatedBy'))}</footer>`);

  return `<!doctype html>
<html lang="${doc.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(doc.title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
${body.join('\n')}
</main>
</body>
</html>
`;
}
