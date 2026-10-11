import type { z } from 'zod';
import { both, type Lang, type Localized, type MessageArgs, type MessageKey } from '../i18n.js';

/**
 * Validation messages of the HTTP API in the language of the request. English keeps zod's own messages; Indonesian
 * gets its own short texts. A message a schema sets itself (a hint such as "baseUrl must start with http://") comes
 * from the catalog through {@link schemaMessage} and is shown in either language. The field path stays as it is
 * ("prompt: ..."), it names a field of the request body.
 */

type Issue = z.core.$ZodRawIssue | z.core.$ZodIssue;

/** The messages schemas set themselves, in both languages, by their English text (the text zod keeps in the issue). */
const SCHEMA_MESSAGES = new Map<string, Localized>();

/**
 * A schema's own validation message, e.g. `.regex(re, schemaMessage('validation.idFormat'))`. A zod issue holds one
 * text, and a schema's own message wins over the error map of a parse, so the schema carries the English text (logs and
 * the English UI) and {@link formatZodIssues} turns it into the language of the request, whichever route parsed it.
 */
export function schemaMessage<K extends MessageKey>(key: K, ...args: MessageArgs<K>): string {
  const text = both(key, ...args);
  SCHEMA_MESSAGES.set(text.en, text);
  return text.en;
}

/** The text of a schema's own message in `lang`; for an invalid record key, that of the key's own issue. */
function schemaText(issue: z.core.$ZodIssue, lang: Lang): string | undefined {
  const own = SCHEMA_MESSAGES.get(issue.message);
  if (own) return own[lang];
  if (issue.code === 'invalid_key' || issue.code === 'invalid_element') {
    const inner = issue.issues.map((i) => SCHEMA_MESSAGES.get(i.message)).find((m) => m !== undefined);
    if (inner) return inner[lang];
  }
  return undefined;
}

const TYPE_ID: Record<string, string> = {
  string: 'teks',
  number: 'angka',
  int: 'bilangan bulat',
  boolean: 'boolean (true/false)',
  array: 'daftar (array)',
  object: 'objek',
  date: 'tanggal',
};

const FORMAT_ID: Record<string, string> = {
  email: 'alamat email',
  url: 'URL',
  uuid: 'UUID',
  datetime: 'tanggal dan waktu ISO',
  date: 'tanggal ISO',
  time: 'jam ISO',
};

const UNIT_ID: Record<string, string> = { string: 'karakter', array: 'item', set: 'item', file: 'byte' };

/** The Indonesian text of a zod issue; null leaves zod's own (English) message. */
function issueId(issue: Issue): string | null {
  switch (issue.code) {
    case 'invalid_type': {
      // a missing field: the raw issue still has its input, a finished one only zod's English message
      const missing = 'input' in issue ? issue.input === undefined : /received undefined$/.test(String((issue as { message?: unknown }).message ?? ''));
      if (missing) return 'wajib diisi';
      return `harus berupa ${TYPE_ID[issue.expected] ?? issue.expected}`;
    }
    case 'too_small': {
      const min = Number(issue.minimum);
      const unit = UNIT_ID[issue.origin ?? ''];
      if (unit) {
        if (min <= 1 && issue.inclusive !== false) return issue.origin === 'string' ? 'tidak boleh kosong' : `minimal 1 ${unit}`;
        return `minimal ${issue.inclusive === false ? min + 1 : min} ${unit}`;
      }
      return issue.inclusive === false ? `harus lebih dari ${min}` : `minimal ${min}`;
    }
    case 'too_big': {
      const max = Number(issue.maximum);
      const unit = UNIT_ID[issue.origin ?? ''];
      if (unit) return `maksimal ${issue.inclusive === false ? max - 1 : max} ${unit}`;
      return issue.inclusive === false ? `harus kurang dari ${max}` : `maksimal ${max}`;
    }
    case 'invalid_value': {
      const values = issue.values.map((v) => JSON.stringify(v));
      return values.length === 1 ? `harus ${values[0]}` : `harus salah satu dari: ${values.join(', ')}`;
    }
    case 'invalid_format':
      return FORMAT_ID[issue.format] ? `${FORMAT_ID[issue.format]} tidak valid` : 'format tidak valid';
    case 'not_multiple_of':
      return `harus kelipatan ${String(issue.divisor)}`;
    case 'unrecognized_keys':
      return `kunci tidak dikenal: ${issue.keys.join(', ')}`;
    case 'invalid_key':
      return 'nama kunci tidak valid';
    default:
      return 'isian tidak valid';
  }
}

/**
 * Error map for `schema.safeParse(value, { error })`: messages in `lang`. Messages a schema sets itself (e.g. a regex
 * with its own text) still win; {@link formatZodIssues} translates those made with {@link schemaMessage}.
 */
export function zodErrorMap(lang: Lang): z.core.$ZodErrorMap | undefined {
  if (lang === 'en') return undefined;
  return (issue) => issueId(issue) ?? undefined;
}

/**
 * The issues of a failed validation as one line, "path: message; path: message", in `lang`. A schema's own message
 * ({@link schemaMessage}) is shown in `lang`; other issues from a parse that already ran with {@link zodErrorMap} keep
 * their message, those thrown by a store (zod's English) are translated.
 */
export function formatZodIssues(issues: readonly z.core.$ZodIssue[], lang: Lang, translated = false): string {
  return issues
    .map((i) => {
      const message = schemaText(i, lang) ?? (lang === 'en' || translated ? i.message : (issueId(i) ?? i.message));
      return `${i.path.map(String).join('.') || 'body'}: ${message}`;
    })
    .join('; ');
}
