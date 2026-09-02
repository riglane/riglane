import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { CLI_NAME } from '../config/product.js';
export function codexHomeDir(env = process.env) {
    const fromEnv = env.CODEX_HOME?.trim();
    return fromEnv ? fromEnv : join(homedir(), '.codex');
}
const EVENT_KEY_LABELS = {
    PreToolUse: 'pre_tool_use',
    PermissionRequest: 'permission_request',
    PostToolUse: 'post_tool_use',
    PreCompact: 'pre_compact',
    PostCompact: 'post_compact',
    SessionStart: 'session_start',
    SessionEnd: 'session_end',
    UserPromptSubmit: 'user_prompt_submit',
    SubagentStart: 'subagent_start',
    SubagentStop: 'subagent_stop',
    Stop: 'stop',
};
const MATCHERLESS_EVENTS = new Set(['UserPromptSubmit', 'Stop']);
function sortKeysDeep(value) {
    if (Array.isArray(value))
        return value.map(sortKeysDeep);
    if (value !== null && typeof value === 'object') {
        const src = value;
        const out = {};
        for (const key of Object.keys(src).sort())
            out[key] = sortKeysDeep(src[key]);
        return out;
    }
    return value;
}
export function computeCodexHookHash(identity) {
    const serialized = JSON.stringify(sortKeysDeep(identity));
    return `sha256:${createHash('sha256').update(serialized).digest('hex')}`;
}
function normalizeTimeout(event, timeout) {
    if (event !== 'SessionEnd')
        return Math.max(timeout ?? 600, 1);
    return Math.min(Math.max(timeout ?? 1, 1), 3);
}
export function isRiglaneHookCommand(command) {
    const cmd = command.trim();
    return cmd.startsWith(`${CLI_NAME} `) || cmd.startsWith(`cmd /c ${CLI_NAME} `);
}
export function codexConfigKeyPath(projectConfigPath) {
    try {
        return realpathSync.native(projectConfigPath);
    }
    catch {
        return resolve(projectConfigPath);
    }
}
export function computeCodexTrustEntries(projectConfigPath, opts = {}) {
    if (!existsSync(projectConfigPath))
        return [];
    const platform = opts.platform ?? process.platform;
    const parsed = parseToml(readFileSync(projectConfigPath, 'utf-8'));
    const hooks = parsed.hooks;
    if (typeof hooks !== 'object' || hooks === null)
        return [];
    const keyPath = codexConfigKeyPath(projectConfigPath);
    const entries = [];
    for (const [event, label] of Object.entries(EVENT_KEY_LABELS)) {
        const groups = hooks[event];
        if (!Array.isArray(groups))
            continue;
        for (const [groupIdx, groupRaw] of groups.entries()) {
            const group = (groupRaw ?? {});
            const rawMatcher = typeof group.matcher === 'string' ? group.matcher : undefined;
            const matcher = MATCHERLESS_EVENTS.has(event) ? undefined : rawMatcher;
            if (matcher !== undefined) {
                try {
                    new RegExp(matcher);
                }
                catch {
                    continue;
                }
            }
            const handlers = Array.isArray(group.hooks) ? group.hooks : [];
            for (const [handlerIdx, handlerRaw] of handlers.entries()) {
                const h = (handlerRaw ?? {});
                if (h.type !== 'command' || typeof h.command !== 'string')
                    continue;
                const commandWindows = typeof h.commandWindows === 'string'
                    ? h.commandWindows
                    : typeof h.command_windows === 'string'
                        ? h.command_windows
                        : undefined;
                const command = platform === 'win32' ? (commandWindows ?? h.command) : h.command;
                const isAsync = h.async === true;
                if (isAsync && event !== 'SessionEnd')
                    continue;
                if (command.trim() === '')
                    continue;
                if (!isRiglaneHookCommand(command))
                    continue;
                const identity = {
                    event_name: label,
                    hooks: [
                        {
                            async: isAsync,
                            command,
                            timeout: normalizeTimeout(event, typeof h.timeout === 'number' ? h.timeout : undefined),
                            type: 'command',
                            ...(typeof h.statusMessage === 'string' ? { statusMessage: h.statusMessage } : {}),
                        },
                    ],
                    ...(matcher !== undefined ? { matcher } : {}),
                };
                entries.push({
                    key: `${keyPath}:${label}:${groupIdx}:${handlerIdx}`,
                    hash: computeCodexHookHash(identity),
                    event,
                    command,
                });
            }
        }
    }
    return entries;
}
export function readCodexHookState(codexHome) {
    const configPath = join(codexHome, 'config.toml');
    if (!existsSync(configPath))
        return {};
    try {
        const parsed = parseToml(readFileSync(configPath, 'utf-8'));
        const hooks = parsed.hooks;
        const state = hooks?.state;
        if (state === undefined)
            return {};
        if (typeof state !== 'object' || state === null || Array.isArray(state))
            return null;
        return state;
    }
    catch {
        return null;
    }
}
export function checkCodexHookTrust(projectConfigPath, opts = {}) {
    const entries = computeCodexTrustEntries(projectConfigPath, opts);
    if (entries.length === 0)
        return { checks: [], entries };
    const state = readCodexHookState(opts.codexHome ?? codexHomeDir());
    if (state === null)
        return { checks: null, entries };
    const checks = entries.map((entry) => {
        const existing = state[entry.key]?.trusted_hash;
        const status = existing === undefined ? 'untrusted' : existing === entry.hash ? 'trusted' : 'modified';
        return { entry, status };
    });
    return { checks, entries };
}
function tomlQuoteKey(key) {
    if (!key.includes("'") && !key.includes('\n'))
        return `'${key}'`;
    return `"${key.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}
export function upsertCodexHookTrust(projectConfigPath, opts = {}) {
    const empty = { added: [], updated: [], unchanged: [], skipped: false };
    let entries;
    try {
        entries = computeCodexTrustEntries(projectConfigPath, opts);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        process.stdout.write(`  WARN  Could not parse ${projectConfigPath}: ${msg} — skipping hook trust\n`);
        return { ...empty, skipped: true };
    }
    if (entries.length === 0)
        return empty;
    const codexHome = opts.codexHome ?? codexHomeDir();
    const globalConfigPath = join(codexHome, 'config.toml');
    let globalText = '';
    let globalParsed = {};
    if (existsSync(globalConfigPath)) {
        globalText = readFileSync(globalConfigPath, 'utf-8');
        try {
            globalParsed = parseToml(globalText);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            process.stdout.write(`  WARN  ${globalConfigPath} is not valid TOML: ${msg} — skipping hook trust (codex hooks stay untrusted until fixed)\n`);
            return { ...empty, skipped: true };
        }
    }
    const hooksTable = (globalParsed.hooks ?? {});
    const stateTable = (hooksTable.state ?? {});
    const added = [];
    const updated = [];
    const unchanged = [];
    for (const entry of entries) {
        const existing = stateTable[entry.key]?.trusted_hash;
        if (existing === entry.hash)
            unchanged.push(entry.key);
        else if (existing === undefined)
            added.push(entry.key);
        else
            updated.push(entry.key);
    }
    if (added.length === 0 && updated.length === 0) {
        process.stdout.write(`  SKIP  codex hook trust (all ${unchanged.length} hooks already trusted)\n`);
        return { added, updated, unchanged, skipped: false };
    }
    const byKey = new Map(entries.map((e) => [e.key, e]));
    if (opts.dryRun) {
        for (const key of [...added, ...updated]) {
            const verb = updated.includes(key) ? 'WOULD RE-TRUST' : 'WOULD TRUST   ';
            process.stdout.write(`  ${verb} ${byKey.get(key)?.command} (${globalConfigPath})\n`);
        }
        return { added, updated, unchanged, skipped: false };
    }
    mkdirSync(codexHome, { recursive: true });
    if (updated.length > 0) {
        for (const key of [...updated, ...added]) {
            const entry = byKey.get(key);
            if (entry === undefined)
                continue;
            stateTable[key] = { ...stateTable[key], trusted_hash: entry.hash };
        }
        hooksTable.state = stateTable;
        globalParsed.hooks = hooksTable;
        writeFileSync(globalConfigPath, `${stringifyToml(globalParsed)}\n`, 'utf-8');
        process.stdout.write(`  UPDATE codex hook trust (${updated.length} re-trusted, ${added.length} added) in ${globalConfigPath}\n`);
        process.stdout.write('  WARN  config.toml was rewritten — comments in the original file were not preserved (TOML round-trip)\n');
        return { added, updated, unchanged, skipped: false };
    }
    const fragment = added
        .map((key) => {
        const entry = byKey.get(key);
        return `[hooks.state.${tomlQuoteKey(key)}]\ntrusted_hash = "${entry?.hash}"\n`;
    })
        .join('\n');
    const sep = globalText === '' || globalText.endsWith('\n') ? '\n' : '\n\n';
    const header = globalText === ''
        ? '# Codex global config — hook trust entries below were added by `riglane init`.\n'
        : '';
    writeFileSync(globalConfigPath, `${header}${globalText}${sep}${fragment}`, 'utf-8');
    for (const key of added) {
        process.stdout.write(`  TRUST ${byKey.get(key)?.command} (${globalConfigPath})\n`);
    }
    return { added, updated, unchanged, skipped: false };
}
