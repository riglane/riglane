
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export function templatesRoot(): string {
  return resolve(HERE, 'templates');
}
