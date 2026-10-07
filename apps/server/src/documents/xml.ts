/**
 * Minimal non-validating XML tree parser for Office parts (slides, notes, charts, SmartArt). It never expands custom
 * entities or loads external resources, and caps nesting depth, so hostile XML stays cheap.
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
const START_TAG = /<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
const END_TAG = /<\/([^\s>]+)\s*>/y;

function element(name: string, attrSource: string): XmlElement {
  const colon = name.indexOf(':');
  return { name, localName: colon >= 0 ? name.slice(colon + 1) : name, attrs: parseAttrs(attrSource), children: [] };
}

/** Parses a document and returns its root element; throws an Error for malformed input. */
export function parseXml(xml: string): XmlElement {
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  let i = 0;
  const addText = (text: string) => {
    const parent = stack[stack.length - 1];
    if (parent && text) parent.children.push(text);
  };
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) {
      if (xml.slice(i).trim() && !stack.length) throw new Error('text after the root element');
      addText(decodeXml(xml.slice(i).replace(/\r\n?/g, '\n')));
      break;
    }
    if (lt > i) addText(decodeXml(xml.slice(i, lt).replace(/\r\n?/g, '\n')));
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      if (end < 0) throw new Error('unterminated comment');
      i = end + 3;
    } else if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      if (end < 0) throw new Error('unterminated CDATA section');
      addText(xml.slice(lt + 9, end).replace(/\r\n?/g, '\n'));
      i = end + 3;
    } else if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2);
      if (end < 0) throw new Error('unterminated processing instruction');
      i = end + 2;
    } else if (xml.startsWith('<!', lt)) {
      // DOCTYPE (with an optional internal subset); its declarations are ignored, never expanded
      const bracket = xml.indexOf('[', lt);
      const close = xml.indexOf('>', lt);
      const end = bracket >= 0 && bracket < close ? xml.indexOf(']>', bracket) + 1 : close;
      if (end <= 0) throw new Error('unterminated declaration');
      i = end + 1;
    } else if (xml.startsWith('</', lt)) {
      END_TAG.lastIndex = lt;
      const m = END_TAG.exec(xml);
      const open = stack.pop();
      if (!m || !open || open.name !== m[1]) throw new Error(`unexpected closing tag at ${lt}`);
      i = END_TAG.lastIndex;
    } else {
      START_TAG.lastIndex = lt;
      const m = START_TAG.exec(xml);
      if (!m) throw new Error(`malformed tag at ${lt}`);
      const el = element(m[1]!, m[2] ?? '');
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(el);
      else if (root) throw new Error('more than one root element');
      else root = el;
      if (m[3] !== '/') {
        if (stack.length >= MAX_DEPTH) throw new Error('elements nested too deeply');
        stack.push(el);
      }
      i = START_TAG.lastIndex;
    }
  }
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

/** Value of an attribute in the given namespace (whatever prefix the document binds to it on the root). */
export function attrNS(el: XmlElement, root: XmlElement, namespace: string, localName: string): string | null {
  for (const [name, value] of Object.entries(root.attrs)) {
    if (value === namespace && name.startsWith('xmlns:')) {
      const v = el.attrs[`${name.slice(6)}:${localName}`];
      if (v !== undefined) return v;
    }
  }
  return null;
}
