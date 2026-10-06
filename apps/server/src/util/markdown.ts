import { Marked } from 'marked';

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const SAFE_URL = /^(https?:|mailto:|#|\.{0,2}\/|[A-Za-z0-9_-]+\.(svg|png|jpe?g|gif|webp|md|html|xml|json|puml|mmd)$)/i;

function safeUrl(href: string): string | null {
  const trimmed = href.trim();
  return SAFE_URL.test(trimmed) ? trimmed : null;
}

/**
 * Markdown -> HTML for model-generated content: raw HTML is escaped (never executed) and only
 * http(s), mailto, anchors and relative file links are kept.
 */
export function createSafeMarked(imageHook?: (href: string, alt: string) => string | null): Marked {
  return new Marked({
    gfm: true,
    breaks: false,
    renderer: {
      html({ text }) {
        return escapeHtml(text);
      },
      link({ href, title, tokens }) {
        const inner = this.parser.parseInline(tokens);
        const url = safeUrl(href);
        if (!url) return inner;
        return `<a href="${escapeHtml(url)}"${title ? ` title="${escapeHtml(title)}"` : ''} rel="noopener noreferrer">${inner}</a>`;
      },
      image({ href, title, text }) {
        const hooked = imageHook?.(href, text);
        if (hooked !== undefined && hooked !== null) return hooked;
        const url = safeUrl(href);
        if (!url) return escapeHtml(text);
        return `<img src="${escapeHtml(url)}" alt="${escapeHtml(text)}"${title ? ` title="${escapeHtml(title)}"` : ''}>`;
      },
    },
  });
}

const defaultMarked = createSafeMarked();

export function renderMarkdown(markdown: string): string {
  return defaultMarked.parse(markdown, { async: false }) as string;
}

export function renderMarkdownInline(markdown: string): string {
  return defaultMarked.parseInline(markdown, { async: false }) as string;
}

/** Very small markdown -> plain text conversion (used for speech and summaries). */
export function markdownToPlain(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
