#!/usr/bin/env node
// Validate every ports/*.yml against schema/port.schema.json.
// Usage: node scripts/validate.mjs [ports-dir]
import { resolve } from 'node:path';
import { loadPorts } from './lib.mjs';

const dir = process.argv[2] ? resolve(process.argv[2]) : undefined;
const { ports, errors } = loadPorts(dir);
if (errors.length) {
  for (const e of errors) console.error(`✗ ${e}`);
  console.error(`\n${errors.length} error(s). See CONTRIBUTING.md for the entry format.`);
  process.exit(1);
}
console.log(`✓ ${ports.length} ports valid`);
