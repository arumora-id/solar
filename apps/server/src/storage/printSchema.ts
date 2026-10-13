/**
 * `npm run db:schema`: prints the complete Postgres schema of SOLAR (storage/schema.ts) as one SQL file to stdout.
 *
 *   npm run -s db:schema > schema.sql          (-s: without npm's own "> solar@..." lines)
 *   npm run db:schema -- --out docs/schema.sql (writes the file; docs/schema.sql is the committed snapshot)
 *   npm run -s db:schema -- --json             (the statements as a JSON array, e.g. for a tool that runs a list)
 */
import { writeFileSync } from 'node:fs';
import { POSTGRES_SCHEMA, renderSchemaSql } from './schema.js';

const args = process.argv.slice(2);
const text = args.includes('--json') ? `${JSON.stringify(POSTGRES_SCHEMA, null, 2)}\n` : renderSchemaSql();
const outAt = args.indexOf('--out');
if (outAt >= 0) {
  const file = args[outAt + 1];
  if (!file) {
    process.stderr.write('--out needs a file name\n');
    process.exit(2);
  }
  writeFileSync(file, text);
  process.stderr.write(`Wrote ${file} (${POSTGRES_SCHEMA.length} statements)\n`);
} else {
  process.stdout.write(text);
}
