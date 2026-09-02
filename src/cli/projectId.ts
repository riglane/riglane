
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { PRODUCT_DIR } from '../config/paths.js';
import { PROJECT_ID_MARKER } from '../config/product.js';

export const PROJECT_ID_REL = `${PRODUCT_DIR}/${PROJECT_ID_MARKER}`;

export function readOrCreateProjectId(absTarget: string, dryRun: boolean): string {
  const idPath = join(absTarget, PROJECT_ID_REL);
  if (existsSync(idPath)) {
    const raw = readFileSync(idPath, 'utf-8').trim();
    if (raw.length > 0) return raw;
  }
  const fresh = randomUUID();
  if (!dryRun) {
    mkdirSync(join(absTarget, PRODUCT_DIR), { recursive: true });
    writeFileSync(idPath, `${fresh}\n`, 'utf-8');
  }
  return fresh;
}
