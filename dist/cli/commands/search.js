import process from 'node:process';
import { EntryError, catalogIndexUrl, validateCatalogIndex } from '../../catalog/entry.js';
import { catalogBaseUrl } from '../../config/config.js';
const USAGE = 'Usage: riglane search [query]\n';
export async function runSearchCli(argv, deps = {}) {
    const flags = argv.filter((a) => a.startsWith('--'));
    const positionals = argv.filter((a) => !a.startsWith('--'));
    if (flags.length > 0 || positionals.length > 1) {
        process.stderr.write(`search: unexpected arguments\n${USAGE}`);
        return 2;
    }
    const query = (positionals[0] ?? '').toLowerCase();
    const base = catalogBaseUrl();
    const url = catalogIndexUrl(base);
    const fetchJson = deps.fetchJson ?? defaultFetchJson;
    let raw;
    try {
        raw = await fetchJson(url);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        process.stderr.write(`search: cannot reach the catalog: ${msg}\n`);
        return 1;
    }
    if (raw === null) {
        process.stderr.write(`search: the catalog has no index at ${url} — is the base URL right?\n`);
        return 1;
    }
    let rows;
    try {
        rows = validateCatalogIndex(raw).entries;
    }
    catch (e) {
        if (e instanceof EntryError) {
            process.stderr.write(`search: ${e.message}\n`);
            return 1;
        }
        throw e;
    }
    const matches = query === '' ? rows : rows.filter((r) => rowMatches(r, query));
    if (matches.length === 0) {
        process.stdout.write(query === '' ? 'The catalog is empty.\n' : `No catalog entries match '${query}'.\n`);
        return 0;
    }
    const idWidth = Math.max(...matches.map((r) => r.id.length));
    for (const r of matches) {
        const level = r.level === 'verified' ? 'verified ' : 'community';
        const shell = r.script_tools === 0 && r.deciders === 0 ? 'no shell         ' : `tools:${r.script_tools} deciders:${r.deciders}`.padEnd(17);
        const author = r.author !== undefined ? `  (${r.author})` : '';
        process.stdout.write(`  ${r.id.padEnd(idWidth)}  [${level}]  ${shell}  ${r.summary}${author}\n`);
    }
    process.stdout.write(`\n${matches.length} entr${matches.length === 1 ? 'y' : 'ies'}. ` +
        `Install with 'riglane add <id>' — it shows what the workflow can execute, and it lands switched off.\n`);
    return 0;
}
function rowMatches(r, q) {
    if (r.id.toLowerCase().includes(q) || r.summary.toLowerCase().includes(q))
        return true;
    for (const t of r.tags ?? [])
        if (t.toLowerCase().includes(q))
            return true;
    for (const c of r.categories ?? [])
        if (c.toLowerCase().includes(q))
            return true;
    return false;
}
async function defaultFetchJson(url) {
    let res;
    try {
        res = await fetch(url);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new EntryError(`${url}: ${msg}`);
    }
    if (res.status === 404)
        return null;
    if (!res.ok)
        throw new EntryError(`${url} → HTTP ${res.status}`);
    return (await res.json());
}
