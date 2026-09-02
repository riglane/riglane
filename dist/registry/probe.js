import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PRODUCT_DIR } from '../config/paths.js';
import { LEGACY_DIRS, VERSION_MARKER } from '../config/product.js';
import { VERSION as INSTALLED_VERSION } from '../cli/version.js';
import { computeTemplatesHash } from './templateHash.js';
import { isTemporaryLocation } from './registry.js';
function parseMarker(raw) {
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed[0] !== '{')
        return null;
    try {
        const obj = JSON.parse(trimmed);
        if (typeof obj.installedBy === 'string' && typeof obj.templateHash === 'string') {
            return { installedBy: obj.installedBy, templateHash: obj.templateHash };
        }
    }
    catch {
    }
    return null;
}
export function probe(entry) {
    return { ...probeDrift(entry), temporary: isTemporaryLocation(entry.path) };
}
function probeDrift(entry) {
    const installedVersion = INSTALLED_VERSION;
    const installedHash = computeTemplatesHash();
    let pathExists = false;
    try {
        pathExists = statSync(entry.path).isDirectory();
    }
    catch {
        pathExists = false;
    }
    if (!pathExists) {
        return {
            pathExists: false,
            agentDirExists: false,
            markerVersion: null,
            markerHash: null,
            installedVersion,
            installedHash,
            drift: 'path-gone',
        };
    }
    const agentDir = join(entry.path, PRODUCT_DIR);
    const agentDirExists = existsSync(agentDir);
    if (!agentDirExists) {
        const hasLegacyDir = LEGACY_DIRS.some((d) => existsSync(join(entry.path, d)));
        return {
            pathExists: true,
            agentDirExists: false,
            markerVersion: null,
            markerHash: null,
            installedVersion,
            installedHash,
            drift: hasLegacyDir ? 'legacy-dir' : 'no-agent-dir',
        };
    }
    const markerPath = join(agentDir, VERSION_MARKER);
    let raw = null;
    try {
        raw = readFileSync(markerPath, 'utf-8');
    }
    catch {
        raw = null;
    }
    if (raw === null || raw.trim().length === 0) {
        return {
            pathExists: true,
            agentDirExists: true,
            markerVersion: null,
            markerHash: null,
            installedVersion,
            installedHash,
            drift: 'missing-marker',
        };
    }
    const parsed = parseMarker(raw);
    if (parsed === null) {
        return {
            pathExists: true,
            agentDirExists: true,
            markerVersion: raw.trim(),
            markerHash: null,
            installedVersion,
            installedHash,
            drift: 'legacy-marker',
        };
    }
    return {
        pathExists: true,
        agentDirExists: true,
        markerVersion: parsed.installedBy,
        markerHash: parsed.templateHash,
        installedVersion,
        installedHash,
        drift: parsed.templateHash === installedHash ? 'up-to-date' : 'outdated',
    };
}
export function driftLabel(d) {
    switch (d) {
        case 'up-to-date':
            return 'up-to-date';
        case 'outdated':
            return 'outdated';
        case 'legacy-marker':
            return 'legacy';
        case 'missing-marker':
            return 'no-marker';
        case 'legacy-dir':
            return 'needs migrate';
        case 'no-agent-dir':
            return 'no .riglane/';
        case 'path-gone':
            return 'gone';
    }
}
