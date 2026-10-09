import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import yaml from 'js-yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export const ROOT = new URL('..', import.meta.url).pathname;

const schema = JSON.parse(readFileSync(join(ROOT, 'schema/port.schema.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const check = ajv.compile(schema);

// Validate every ports/*.yml under `dir`. Returns { ports, errors }; errors are
// human-readable strings prefixed with the offending file.
export function loadPorts(dir = join(ROOT, 'ports'), imageRoot = ROOT) {
  const ports = [];
  const errors = [];
  const files = readdirSync(dir).filter((f) => !f.startsWith('.')).sort();
  for (const file of files) {
    const where = `ports/${file}`;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*\.yml$/.test(file)) {
      errors.push(`${where}: filename must be <kebab-case-slug>.yml`);
      continue;
    }
    let data;
    try {
      data = yaml.load(readFileSync(join(dir, file), 'utf8'), { schema: yaml.JSON_SCHEMA });
    } catch (e) {
      errors.push(`${where}: invalid YAML: ${e.message.split('\n')[0]}`);
      continue;
    }
    if (!check(data)) {
      for (const err of check.errors) {
        const path = err.instancePath || '(root)';
        const extra = err.params?.additionalProperty ? ` '${err.params.additionalProperty}'` : '';
        const allowed = err.params?.allowedValues ? ` (one of: ${err.params.allowedValues.join(', ')})` : '';
        errors.push(`${where}: ${path} ${err.message}${extra}${allowed}`);
      }
      continue;
    }
    if (data.version_date > data.last_checked) {
      errors.push(`${where}: version_date is after last_checked`);
    }
    for (const shot of data.screenshots ?? []) {
      if (!shot.file.startsWith(`images/${basename(file, '.yml')}/`)) {
        errors.push(`${where}: screenshot ${shot.file} must live under images/${basename(file, '.yml')}/`);
      } else if (!existsSync(join(imageRoot, shot.file))) {
        errors.push(`${where}: screenshot ${shot.file} does not exist`);
      }
    }
    ports.push({ slug: basename(file, '.yml'), ...data });
  }
  const seen = new Map();
  for (const p of ports) {
    const key = p.name.toLowerCase();
    if (seen.has(key)) errors.push(`ports/${p.slug}.yml: duplicate name '${p.name}' (also ports/${seen.get(key)}.yml)`);
    seen.set(key, p.slug);
  }
  return { ports, errors };
}
