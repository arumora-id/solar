import { Fragment, type ReactNode } from 'react';
import type { Dict } from '../../lib/i18n';

/**
 * A dictionary text with inline markup (the "markup" texts of i18n/<lang>/settings.ts): **bold** and `code`, nothing
 * else. The whole sentence stays one text per language, so each language keeps its own word order.
 */
export function rich(text: string): ReactNode {
  // with a capturing group, split() puts the marked parts at the odd indexes
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, i) => {
    if (i % 2 === 0) return part ? <Fragment key={i}>{part}</Fragment> : null;
    return part.startsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <code key={i}>{part.slice(1, -1)}</code>;
  });
}

/**
 * A message kept in component state: a text from the server (already in the request language), or one rendered from
 * the dictionary, so it follows a language switch while it is on screen.
 */
export type Message = string | ((t: Dict) => string);

export function messageText(message: Message, t: Dict): string {
  return typeof message === 'string' ? message : message(t);
}
