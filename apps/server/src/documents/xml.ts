/**
 * Minimal non-validating XML tooling for Office parts: a linear-time tag scanner, a tree parser (slides, notes,
 * charts, SmartArt) and a well-formedness check. Nothing here expands custom entities or loads external resources,
 * and every scan looks at each byte a bounded number of times, so hostile XML stays cheap.
 */
import { decodeXml, parseAttrs } from './limits.js';

export interface XmlElement {
  /** Qualified name, e.g. "p:sp". */
  name: string;
  /** Name without its namespace prefix, e.g. "sp". */
  localName: string;
  /** Attributes by qualified name (prefixed names are also available without their prefix). */
  attrs: Record<string, string>;
  children: Array<XmlElement | string>;
}

const MAX_DEPTH = 256;
const START_TAG = /<([^\s/>!?<]+)((?:\s+[^\s=/><]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
const END_TAG = /<\/([^\s><]+)\s*>/y;

export interface XmlScanHandlers {
  /** Raw (still entity-encoded) text between tags; `cdata` for CDATA sections. */
  text?(raw: string, cdata: boolean): void;
  /** A start tag; return false to stop scanning. */
  open?(name: string, attrSource: string, selfClosing: boolean, start: number, end: number): boolean | void;
  /** An end tag; return false to stop scanning. */
  close?(name: string, start: number, end: number): boolean | void;
  /** Called for DOCTYPE and other declarations. */
  declaration?(start: number, end: number): void;
}

/**
 * Walks the markup of `xml` from `from` in document order, skipping comments, processing instructions and
 * declarations. Linear: every construct is located with indexOf or a sticky regex anchored at its '<'.
 * Throws an Error for markup that cannot be tokenised (unterminated comment, broken tag, ...).
 */
export function scanXml(xml: string, handlers: XmlScanHandlers, from = 0): void {
  let i = from;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) {
      handlers.text?.(xml.slice(i), false);
      return;
    }
    if (lt > i) handlers.text?.(xml.slice(i, lt), false);
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      if (end < 0) throw new Error('unterminated comment');
      i = end + 3;
    } else if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      if (end < 0) throw new Error('unterminated CDATA section');
      handlers.text?.(xml.slice(lt + 9, end), true);
      i = end + 3;
    } else if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2);
      if (end < 0) throw new Error('unterminated processing instruction');
      i = end + 2;
    } else if (xml.startsWith('<!', lt)) {
      // DOCTYPE (with an optional internal subset); its declarations are ignored, never expanded. The '[' is only
      // looked for inside this declaration, so many declarations cannot make the scan quadratic.
      const close = xml.indexOf('>', lt);
      if (close < 0) throw new Error('unterminated declaration');
      const bracket = xml.slice(lt, close).indexOf('[');
      const end = bracket >= 0 ? xml.indexOf(']>', lt + bracket) + 1 : close;
      if (end <= 0) throw new Error('unterminated declaration');
      handlers.declaration?.(lt, end + 1);
      i = end + 1;
    } else if (xml.startsWith('</', lt)) {
      END_TAG.lastIndex = lt;
      const m = END_TAG.exec(xml);
      if (!m) throw new Error(`malformed closing tag at ${lt}`);
      i = END_TAG.lastIndex;
      if (handlers.close?.(m[1]!, lt, i) === false) return;
    } else {
      START_TAG.lastIndex = lt;
      const m = START_TAG.exec(xml);
      if (!m) throw new Error(`malformed tag at ${lt}`);
      i = START_TAG.lastIndex;
      if (handlers.open?.(m[1]!, m[2] ?? '', m[3] === '/', lt, i) === false) return;
    }
  }
}

/** Throws an Error unless `xml` is a single well-formed element tree (optionally without any DOCTYPE). */
export function assertWellFormed(xml: string, options: { allowDoctype?: boolean } = {}): void {
  const stack: string[] = [];
  let roots = 0;
  scanXml(xml, {
    open(name, _attrs, selfClosing) {
      if (!stack.length) roots += 1;
      if (roots > 1) throw new Error('more than one root element');
      if (!selfClosing) stack.push(name);
    },
    close(name) {
      if (stack.pop() !== name) throw new Error(`unexpected closing tag </${name}>`);
    },
    declaration() {
      if (!options.allowDoctype) throw new Error('DOCTYPE is not allowed');
    },
  });
  if (stack.length) throw new Error('unclosed elements');
  if (!roots) throw new Error('no root element');
}

function element(name: string, attrSource: string): XmlElement {
  const colon = name.indexOf(':');
  return { name, localName: colon >= 0 ? name.slice(colon + 1) : name, attrs: parseAttrs(attrSource), children: [] };
}

const normalizeText = (s: string) => s.replace(/\r\n?/g, '\n');

/** Parses a document and returns its root element; throws an Error for malformed input. */
export function parseXml(xml: string): XmlElement {
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  scanXml(xml, {
    text(raw, cdata) {
      const parent = stack[stack.length - 1];
      if (parent) {
        if (raw) parent.children.push(cdata ? normalizeText(raw) : decodeXml(normalizeText(raw)));
      } else if (raw.trim() && root) {
        throw new Error('text after the root element');
      }
    },
    open(name, attrSource, selfClosing) {
      const el = element(name, attrSource);
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(el);
      else if (root) throw new Error('more than one root element');
      else root = el;
      if (!selfClosing) {
        if (stack.length >= MAX_DEPTH) throw new Error('elements nested too deeply');
        stack.push(el);
      }
    },
    close(name, start) {
      const open = stack.pop();
      if (!open || open.name !== name) throw new Error(`unexpected closing tag at ${start}`);
    },
  });
  if (!root || stack.length) throw new Error(root ? 'unclosed elements' : 'no root element');
  return root;
}

/** Child elements, optionally only those with the given local name. */
export function kids(el: XmlElement | null | undefined, localName?: string): XmlElement[] {
  if (!el) return [];
  return el.children.filter((c): c is XmlElement => typeof c !== 'string' && (!localName || c.localName === localName));
}

export const kid = (el: XmlElement | null | undefined, localName: string): XmlElement | null => kids(el, localName)[0] ?? null;

/** Follows a chain of child local names. */
export function path(el: XmlElement | null, ...names: string[]): XmlElement | null {
  let cur = el;
  for (const n of names) {
    cur = kid(cur, n);
    if (!cur) return null;
  }
  return cur;
}

/** All descendant elements with the given local name, in document order. */
export function descendants(el: XmlElement | null | undefined, localName: string, out: XmlElement[] = []): XmlElement[] {
  for (const c of el?.children ?? []) {
    if (typeof c === 'string') continue;
    if (c.localName === localName) out.push(c);
    descendants(c, localName, out);
  }
  return out;
}

export function textContent(el: XmlElement | null | undefined): string {
  if (!el) return '';
  let s = '';
  for (const c of el.children) s += typeof c === 'string' ? c : textContent(c);
  return s;
}

/** Prefix a document binds to `namespace` (searched in the root element's xmlns declarations). */
export function prefixFor(rootAttrs: Record<string, string>, namespace: string): string | null {
  for (const [name, value] of Object.entries(rootAttrs)) {
    if (value === namespace && name.startsWith('xmlns:')) return name.slice(6);
  }
  return null;
}

/** Value of an attribute in the given namespace (whatever prefix the document binds to it on the root). */
export function attrNS(el: XmlElement, root: XmlElement, namespace: string, localName: string): string | null {
  const prefix = prefixFor(root.attrs, namespace);
  return prefix ? (el.attrs[`${prefix}:${localName}`] ?? null) : null;
}
