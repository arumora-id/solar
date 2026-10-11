import DOMPurify from 'dompurify';
import { Marked } from 'marked';
import { t } from './i18n';

const marked = new Marked({ gfm: true, breaks: true });

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

/** Renders agent markdown to sanitized HTML. */
export function renderMarkdown(markdown: string, rewriteImage?: (src: string) => string | null): string {
  const raw = marked.parse(markdown, { async: false }) as string;
  const clean = DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
  if (!rewriteImage) return clean;
  const doc = new DOMParser().parseFromString(`<div>${clean}</div>`, 'text/html');
  doc.querySelectorAll('img').forEach((img) => {
    const next = rewriteImage(img.getAttribute('src') ?? '');
    if (next) img.setAttribute('src', next);
  });
  return doc.body.firstElementChild?.innerHTML ?? clean;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Uploaded documents: raw HTML is shown as text (never interpreted or hidden) and images are not loaded (shown as
 * "[gambar: alt]" / "[image: alt]" in the current language, read at render time).
 */
const documentMarked = new Marked({
  gfm: true,
  renderer: {
    html: ({ text }) => escapeHtml(text),
    image: ({ text }) => {
      const words = t().agent.markdown;
      return escapeHtml(`[${text ? words.imageWithAlt(text) : words.image}]`);
    },
  },
});

/** Renders extracted document text for the preview so that it shows what the agent reads. */
export function renderDocumentMarkdown(markdown: string): string {
  const raw = documentMarked.parse(markdown, { async: false }) as string;
  return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true }, FORBID_TAGS: ['img', 'style'], FORBID_ATTR: ['style'] });
}

/** Plain text for speech synthesis: no code, links shown as their text, short. */
export function speakableSummary(markdown: string, maxChars = 320): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\bart_[A-Za-z0-9]+\b/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~>|#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > 80 ? cut.slice(0, end + 1) : `${cut}…`;
}
