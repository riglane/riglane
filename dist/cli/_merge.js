import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync, } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { PRODUCT_DIR, LEGACY_ACP_DIR } from '../config/paths.js';
import { CLI_NAME } from '../config/product.js';
import { atomicWriteJson } from './_fs.js';
const CURSOR_IGNORE_SENTINEL = '# Riglane — visibility overrides';
const LEGACY_CURSOR_IGNORE_SENTINELS = [
    '# Agentic Control Plane — visibility overrides',
];
const CURSOR_IGNORE_BLOCK = `\n${CURSOR_IGNORE_SENTINEL}\n# Make workflow engine files visible to Cursor despite .gitignore\n!${PRODUCT_DIR}/\n!.cursor/\n!.mcp.json\n`;
export function ensureCursorIgnore(target, opts = {}) {
    const dryRun = Boolean(opts.dryRun);
    const path = join(target, '.cursorignore');
    process.stdout.write('Cursor visibility (.cursorignore)\n');
    let existing = '';
    if (isFile(path)) {
        existing = readFileSync(path, 'utf-8');
    }
    let normalized = existing;
    for (const legacy of LEGACY_CURSOR_IGNORE_SENTINELS) {
        normalized = normalized.split(legacy).join(CURSOR_IGNORE_SENTINEL);
    }
    const sentinelUpgraded = normalized !== existing;
    if (normalized.includes(CURSOR_IGNORE_SENTINEL)) {
        const staleNegation = `!${LEGACY_ACP_DIR}/`;
        const currentNegation = `!${PRODUCT_DIR}/`;
        if (normalized.includes(staleNegation) && !normalized.includes(currentNegation)) {
            if (dryRun) {
                process.stdout.write(`  WOULD UPDATE  .cursorignore (${staleNegation} -> ${currentNegation})\n`);
                return;
            }
            writeFileSync(path, normalized.split(staleNegation).join(currentNegation), 'utf-8');
            process.stdout.write(`  UPDATE  .cursorignore (${staleNegation} -> ${currentNegation})\n`);
            return;
        }
        if (sentinelUpgraded) {
            if (dryRun) {
                process.stdout.write('  WOULD UPDATE  .cursorignore (legacy sentinel -> current)\n');
                return;
            }
            writeFileSync(path, normalized, 'utf-8');
            process.stdout.write('  UPDATE  .cursorignore (legacy sentinel -> current)\n');
            return;
        }
        process.stdout.write('  SKIP  .cursorignore (visibility block already present)\n');
        return;
    }
    if (dryRun) {
        process.stdout.write('  WOULD ADD  visibility negation block to .cursorignore\n');
        return;
    }
    writeFileSync(path, existing + CURSOR_IGNORE_BLOCK, 'utf-8');
    if (existing) {
        process.stdout.write('  MERGE  appended visibility block to .cursorignore\n');
    }
    else {
        process.stdout.write('  NEW    .cursorignore with visibility overrides\n');
    }
    process.stdout.write('\n');
}
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function blockMarkers(sentinelId) {
    return { begin: `<!-- ${sentinelId}:BEGIN -->`, end: `<!-- ${sentinelId}:END -->` };
}
const LEGACY_SENTINEL_IDS = {
    'RIGLANE:SPEC-GUIDANCE': ['ACP:SPEC-GUIDANCE'],
};
function normalizeLegacySentinels(text, sentinelId) {
    let out = text;
    for (const legacy of LEGACY_SENTINEL_IDS[sentinelId] ?? []) {
        for (const suffix of [':BEGIN', ':END']) {
            out = out.split(`${legacy}${suffix}`).join(`${sentinelId}${suffix}`);
        }
    }
    return out;
}
function blockRegex(sentinelId) {
    const b = escapeRegExp(`${sentinelId}:BEGIN`);
    const e = escapeRegExp(`${sentinelId}:END`);
    return new RegExp(`[ \\t]*<!--\\s*${b}\\s*-->[\\s\\S]*?<!--\\s*${e}\\s*-->[ \\t]*(?:\\r?\\n)?`);
}
function detectEol(content) {
    return content.includes('\r\n') ? '\r\n' : '\n';
}
function splitBom(s) {
    return s.charCodeAt(0) === 0xfeff ? { bom: '﻿', rest: s.slice(1) } : { bom: '', rest: s };
}
function atomicWriteText(absFile, content) {
    const tmp = `${absFile}.tmp`;
    writeFileSync(tmp, content, 'utf-8');
    renameSync(tmp, absFile);
}
export function hasManagedBlock(absFile, sentinelId) {
    if (!isFile(absFile))
        return false;
    return blockRegex(sentinelId).test(readFileSync(absFile, 'utf-8'));
}
export function injectManagedBlock(absFile, sentinelId, body, opts = {}) {
    const dryRun = Boolean(opts.dryRun);
    const createIfAbsent = opts.createIfAbsent ?? true;
    const { begin, end } = blockMarkers(sentinelId);
    const exists = isFile(absFile);
    if (!exists && !createIfAbsent)
        return { action: 'absent', file: absFile };
    const raw = exists ? readFileSync(absFile, 'utf-8') : '';
    const { bom, rest: rawExisting } = splitBom(raw);
    const existing = normalizeLegacySentinels(rawExisting, sentinelId);
    const eol = exists && existing.length > 0 ? detectEol(existing) : '\n';
    const trimmedBody = body.replace(/^\s+|\s+$/g, '');
    const block = `${begin}${eol}${trimmedBody}${eol}${end}`;
    const canonical = `${block}${eol}`;
    const globalRe = new RegExp(blockRegex(sentinelId).source, 'g');
    const matchCount = (existing.match(globalRe) ?? []).length;
    let next;
    let action;
    if (matchCount > 0) {
        if (matchCount > 1) {
            process.stdout.write(`  WARN  ${sentinelId}: ${matchCount} blocks in ${absFile} — collapsing to one\n`);
        }
        let replaced = false;
        next = existing.replace(new RegExp(blockRegex(sentinelId).source, 'g'), () => {
            if (!replaced) {
                replaced = true;
                return canonical;
            }
            return '';
        });
        action = next === existing && existing === rawExisting ? 'unchanged' : 'updated';
    }
    else if (exists && existing.length > 0) {
        const base = existing.endsWith(eol) ? existing : `${existing}${eol}`;
        next = `${base}${eol}${canonical}`;
        action = 'appended';
    }
    else {
        next = canonical;
        action = exists ? 'appended' : 'created';
    }
    if (action === 'unchanged') {
        process.stdout.write(`  SKIP  ${absFile} (${sentinelId} up to date)\n`);
        return { action, file: absFile };
    }
    if (dryRun) {
        const verb = action === 'created' ? 'CREATE' : action === 'appended' ? 'APPEND' : 'UPDATE';
        process.stdout.write(`  WOULD ${verb}  ${absFile} (${sentinelId})\n`);
        return { action: 'would-write', file: absFile };
    }
    atomicWriteText(absFile, bom + next);
    const label = action === 'created' ? 'NEW   ' : action === 'appended' ? 'MERGE ' : 'UPDATE';
    process.stdout.write(`  ${label} ${absFile} (${sentinelId})\n`);
    return { action, file: absFile };
}
export function removeManagedBlock(absFile, sentinelId, opts = {}) {
    const dryRun = Boolean(opts.dryRun);
    if (!isFile(absFile))
        return { action: 'absent', file: absFile };
    const raw = readFileSync(absFile, 'utf-8');
    const { bom, rest: rawExisting } = splitBom(raw);
    const existing = normalizeLegacySentinels(rawExisting, sentinelId);
    if (!blockRegex(sentinelId).test(existing)) {
        process.stdout.write(`  SKIP  ${absFile} (no ${sentinelId} block)\n`);
        return { action: 'absent', file: absFile };
    }
    if (dryRun) {
        process.stdout.write(`  WOULD REMOVE  ${sentinelId} block from ${absFile}\n`);
        return { action: 'would-remove', file: absFile };
    }
    const next = existing.replace(new RegExp(blockRegex(sentinelId).source, 'g'), '');
    atomicWriteText(absFile, bom + next);
    process.stdout.write(`  REMOVE  ${sentinelId} block from ${absFile}\n`);
    return { action: 'removed', file: absFile };
}
export function checkDependencies() {
}
export function isGateCheckCommand(cmd) {
    return typeof cmd === 'string' && cmd.includes('gate-check');
}
export function isToolCallLoggerCommand(cmd) {
    return typeof cmd === 'string' && cmd.includes('tool-call-logger');
}
export function isFileGuardCommand(cmd) {
    return typeof cmd === 'string' && cmd.includes('file-guard');
}
export function isSpawnThrottleCommand(cmd) {
    return typeof cmd === 'string' && cmd.includes('spawn-throttle');
}
const SHELL_WRAP_PREFIX = 'cmd /c ';
function stripShellWrap(cmd) {
    return typeof cmd === 'string' && cmd.startsWith(SHELL_WRAP_PREFIX)
        ? cmd.slice(SHELL_WRAP_PREFIX.length)
        : cmd;
}
function hookEqualModuloShellWrap(a, b) {
    if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
        return deepEqual(a, b);
    }
    const na = { ...a, command: stripShellWrap(a.command) };
    const nb = { ...b, command: stripShellWrap(b.command) };
    return deepEqual(na, nb);
}
function mergeHookGroupByFamily(settings, event, srcGroup, isFamily, force, update) {
    const srcHooksList = srcGroup.hooks ?? [];
    if (srcHooksList.length === 0)
        return false;
    const ourHook = srcHooksList[0];
    const hooksObj = setdefaultObject(settings, 'hooks');
    const groups = setdefaultArray(hooksObj, event);
    let foundGroupIdx = null;
    let foundHookIdx = null;
    for (let gi = 0; gi < groups.length; gi += 1) {
        const groupHooks = groups[gi].hooks ?? [];
        for (let hi = 0; hi < groupHooks.length; hi += 1) {
            if (isFamily(groupHooks[hi].command)) {
                foundGroupIdx = gi;
                foundHookIdx = hi;
                break;
            }
        }
        if (foundGroupIdx !== null)
            break;
    }
    if (foundGroupIdx === null) {
        groups.push(srcGroup);
        return true;
    }
    const group = groups[foundGroupIdx];
    const groupHooks = group.hooks ?? [];
    if (groupHooks.length === 1) {
        if (deepEqual(group, srcGroup))
            return false;
        if (force || update) {
            groups[foundGroupIdx] = srcGroup;
            return true;
        }
        return false;
    }
    const idx = foundHookIdx ?? 0;
    if (deepEqual(groupHooks[idx], ourHook))
        return false;
    if (force || update) {
        groupHooks[idx] = ourHook;
        return true;
    }
    return false;
}
export function mergeHooks(srcHooksPath, dstHooksPath, opts = {}) {
    const force = Boolean(opts.force);
    const update = Boolean(opts.update);
    const dryRun = Boolean(opts.dryRun);
    const ourHooks = JSON.parse(readFileSync(srcHooksPath, 'utf-8'));
    const ourSubagentHooks = readArrayPath(ourHooks, ['hooks', 'subagentStop']);
    if (ourSubagentHooks.length === 0) {
        process.stdout.write('  WARN  No subagentStop hooks found in source — skipping merge\n');
        return;
    }
    const ourFirstHook = ourSubagentHooks[0];
    const ourCommand = ourFirstHook.command ?? '';
    if (existsSync(dstHooksPath)) {
        const existing = JSON.parse(readFileSync(dstHooksPath, 'utf-8'));
        const existingHooks = setdefaultObject(existing, 'hooks');
        const existingSubagent = setdefaultArray(existingHooks, 'subagentStop');
        let foundIdx = null;
        for (let i = 0; i < existingSubagent.length; i += 1) {
            const hook = existingSubagent[i];
            if (isGateCheckCommand(hook.command)) {
                foundIdx = i;
                break;
            }
        }
        if (foundIdx !== null) {
            if (force || update) {
                if (deepEqual(existingSubagent[foundIdx], ourFirstHook)) {
                    process.stdout.write('  SKIP  hooks.json (hook unchanged)\n');
                    return;
                }
                if (dryRun) {
                    process.stdout.write('  WOULD UPDATE  hooks.json (hook config changed)\n');
                    return;
                }
                existingSubagent[foundIdx] = ourFirstHook;
                if (!('version' in existing))
                    existing.version = 1;
                writeFileSync(dstHooksPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf-8');
                process.stdout.write(`  UPDATE  hooks.json (hook: ${ourCommand})\n`);
            }
            else {
                process.stdout.write('  SKIP  hooks.json (hook already present)\n');
            }
            return;
        }
        if (dryRun) {
            process.stdout.write(`  WOULD ADD     hooks.json (hook: ${ourCommand})\n`);
            return;
        }
        existingSubagent.push(...ourSubagentHooks);
        if (!('version' in existing))
            existing.version = 1;
        writeFileSync(dstHooksPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf-8');
        process.stdout.write(`  MERGE hooks.json (added: ${ourCommand})\n`);
    }
    else {
        if (dryRun) {
            process.stdout.write('  WOULD ADD     hooks.json\n');
            return;
        }
        mkdirSync(dirname(dstHooksPath), { recursive: true });
        copyFileSync(srcHooksPath, dstHooksPath);
        process.stdout.write('  COPY  hooks.json\n');
    }
}
const CURSOR_LOGGER_EVENTS = ['afterMCPExecution', 'afterShellExecution', 'afterFileEdit'];
export function mergeCursorLoggerHooks(srcHooksPath, dstHooksPath, opts = {}) {
    const overwrite = Boolean(opts.force) || Boolean(opts.update);
    const dryRun = Boolean(opts.dryRun);
    if (!existsSync(dstHooksPath))
        return;
    const src = JSON.parse(readFileSync(srcHooksPath, 'utf-8'));
    const srcHooks = src.hooks ?? {};
    const existing = JSON.parse(readFileSync(dstHooksPath, 'utf-8'));
    const existingHooks = setdefaultObject(existing, 'hooks');
    const added = [];
    const replaced = [];
    for (const ev of CURSOR_LOGGER_EVENTS) {
        const srcArr = Array.isArray(srcHooks[ev]) ? srcHooks[ev] : [];
        const ourHook = srcArr.find((h) => isToolCallLoggerCommand(h?.command));
        if (ourHook === undefined)
            continue;
        const dstArr = setdefaultArray(existingHooks, ev);
        const foundIdx = dstArr.findIndex((h) => isToolCallLoggerCommand(h?.command));
        if (foundIdx === -1) {
            dstArr.push(ourHook);
            added.push(ev);
        }
        else if (!hookEqualModuloShellWrap(dstArr[foundIdx], ourHook) && overwrite) {
            dstArr[foundIdx] = ourHook;
            replaced.push(ev);
        }
    }
    if (added.length === 0 && replaced.length === 0) {
        process.stdout.write('  SKIP  hooks.json (tool-call-logger present)\n');
        return;
    }
    const detail = [
        ...(replaced.length > 0 ? [`updated: ${replaced.join(', ')}`] : []),
        ...(added.length > 0 ? [`added: ${added.join(', ')}`] : []),
    ].join('; ');
    if (dryRun) {
        const verb = replaced.length > 0 ? 'WOULD UPDATE' : 'WOULD ADD    ';
        process.stdout.write(`  ${verb}  hooks.json (tool-call-logger: ${detail})\n`);
        return;
    }
    if (!('version' in existing))
        existing.version = 1;
    writeFileSync(dstHooksPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf-8');
    process.stdout.write(`  ${replaced.length > 0 ? 'UPDATE' : 'MERGE'} hooks.json (tool-call-logger: ${detail})\n`);
}
function mergeCursorFamilyHook(srcHooksPath, dstHooksPath, event, isFamily, label, opts = {}) {
    const overwrite = Boolean(opts.force) || Boolean(opts.update);
    const dryRun = Boolean(opts.dryRun);
    if (!existsSync(dstHooksPath))
        return;
    const src = JSON.parse(readFileSync(srcHooksPath, 'utf-8'));
    const srcHooks = src.hooks ?? {};
    const srcArr = Array.isArray(srcHooks[event]) ? srcHooks[event] : [];
    const ourHook = srcArr.find((h) => isFamily(h?.command));
    if (ourHook === undefined)
        return;
    const existing = JSON.parse(readFileSync(dstHooksPath, 'utf-8'));
    const existingHooks = setdefaultObject(existing, 'hooks');
    const dstArr = setdefaultArray(existingHooks, event);
    const foundIdx = dstArr.findIndex((h) => isFamily(h?.command));
    if (foundIdx !== -1) {
        if (hookEqualModuloShellWrap(dstArr[foundIdx], ourHook) || !overwrite) {
            process.stdout.write(`  SKIP  hooks.json (${label} ${event} present)\n`);
            return;
        }
        if (dryRun) {
            process.stdout.write(`  WOULD UPDATE  hooks.json (${event}: riglane ${label})\n`);
            return;
        }
        dstArr[foundIdx] = ourHook;
        if (!('version' in existing))
            existing.version = 1;
        writeFileSync(dstHooksPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf-8');
        process.stdout.write(`  UPDATE  hooks.json (${event}: riglane ${label})\n`);
        return;
    }
    if (dryRun) {
        process.stdout.write(`  WOULD ADD     hooks.json (${event}: riglane ${label})\n`);
        return;
    }
    dstArr.push(ourHook);
    if (!('version' in existing))
        existing.version = 1;
    writeFileSync(dstHooksPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf-8');
    process.stdout.write(`  MERGE hooks.json (${event}: riglane ${label})\n`);
}
export function mergeCursorFileGuardHook(srcHooksPath, dstHooksPath, opts = {}) {
    mergeCursorFamilyHook(srcHooksPath, dstHooksPath, 'preToolUse', isFileGuardCommand, 'file-guard', opts);
}
export function mergeCursorSpawnThrottleHook(srcHooksPath, dstHooksPath, opts = {}) {
    mergeCursorFamilyHook(srcHooksPath, dstHooksPath, 'subagentStart', isSpawnThrottleCommand, 'spawn-throttle', opts);
}
export function normalizeCursorHookShell(dstHooksPath, platform = process.platform, opts = {}) {
    if (!existsSync(dstHooksPath))
        return;
    let existing;
    try {
        existing = JSON.parse(readFileSync(dstHooksPath, 'utf-8'));
    }
    catch {
        return;
    }
    const hooks = existing.hooks;
    if (!hooks || typeof hooks !== 'object')
        return;
    const isWin = platform === 'win32';
    const PREFIX = 'cmd /c ';
    let changed = false;
    const normalize = (cmd) => {
        const bare = cmd.startsWith(PREFIX) ? cmd.slice(PREFIX.length) : cmd;
        if (!bare.startsWith(`${CLI_NAME} `))
            return cmd;
        return isWin ? `${PREFIX}${bare}` : bare;
    };
    for (const ev of Object.keys(hooks)) {
        const arr = hooks[ev];
        if (!Array.isArray(arr))
            continue;
        for (const h of arr) {
            if (h && typeof h === 'object' && typeof h.command === 'string') {
                const rec = h;
                const next = normalize(rec.command);
                if (next !== rec.command) {
                    rec.command = next;
                    changed = true;
                }
            }
        }
    }
    if (!changed)
        return;
    if (opts.dryRun) {
        process.stdout.write('  WOULD UPDATE  hooks.json (per-OS hook shell wrap)\n');
        return;
    }
    writeFileSync(dstHooksPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf-8');
    process.stdout.write(`  UPDATE  hooks.json (${isWin ? 'wrapped riglane hooks with `cmd /c` (Windows no-shell fix)' : 'unwrapped riglane hooks (non-Windows)'})\n`);
}
export function mergeMcpConfig(srcMcpPath, dstMcpPath, opts = {}) {
    const force = Boolean(opts.force);
    const update = Boolean(opts.update);
    const dryRun = Boolean(opts.dryRun);
    const ourConfig = JSON.parse(readFileSync(srcMcpPath, 'utf-8'));
    const ourServers = ourConfig.mcpServers ?? {};
    if (Object.keys(ourServers).length === 0) {
        process.stdout.write('  WARN  No mcpServers found in source — skipping merge\n');
        return;
    }
    if (existsSync(dstMcpPath)) {
        const existing = JSON.parse(readFileSync(dstMcpPath, 'utf-8'));
        const existingServers = setdefaultObject(existing, 'mcpServers');
        let changed = false;
        for (const [name, config] of Object.entries(ourServers)) {
            if (name in existingServers) {
                if (force || update) {
                    if (deepEqual(existingServers[name], config)) {
                        process.stdout.write(`  SKIP  mcp.json (server unchanged: ${name})\n`);
                        continue;
                    }
                    if (dryRun) {
                        process.stdout.write(`  WOULD UPDATE  mcp.json (server: ${name})\n`);
                        continue;
                    }
                    existingServers[name] = config;
                    process.stdout.write(`  UPDATE  mcp.json (server: ${name})\n`);
                    changed = true;
                }
                else {
                    process.stdout.write(`  SKIP  mcp.json (server already present: ${name})\n`);
                }
            }
            else {
                if (dryRun) {
                    process.stdout.write(`  WOULD ADD     mcp.json (server: ${name})\n`);
                    continue;
                }
                existingServers[name] = config;
                process.stdout.write(`  MERGE mcp.json (added server: ${name})\n`);
                changed = true;
            }
        }
        if (changed) {
            writeFileSync(dstMcpPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf-8');
        }
    }
    else {
        if (dryRun) {
            process.stdout.write('  WOULD ADD     mcp.json\n');
            return;
        }
        const parent = dirname(dstMcpPath) || '.';
        mkdirSync(parent, { recursive: true });
        copyFileSync(srcMcpPath, dstMcpPath);
        process.stdout.write('  COPY  mcp.json\n');
    }
}
export function mergeClaudeSettings(srcSettingsPath, dstSettingsPath, opts = {}) {
    const force = Boolean(opts.force);
    const update = Boolean(opts.update);
    const dryRun = Boolean(opts.dryRun);
    const mcpTokenLimit = opts.mcpTokenLimit;
    const src = JSON.parse(readFileSync(srcSettingsPath, 'utf-8'));
    const srcSubagent = readArrayPath(src, ['hooks', 'SubagentStop']);
    if (srcSubagent.length === 0) {
        process.stdout.write('  WARN  No SubagentStop hooks in source — skipping merge\n');
        return;
    }
    const srcGroup = srcSubagent[0];
    const srcHooksList = srcGroup.hooks ?? [];
    if (srcHooksList.length === 0) {
        process.stdout.write('  WARN  Source SubagentStop group has empty hooks[] — skipping\n');
        return;
    }
    const ourHook = srcHooksList[0];
    const ourCommand = ourHook.command ?? '';
    let settings;
    let existed = false;
    if (existsSync(dstSettingsPath)) {
        let raw;
        try {
            raw = readFileSync(dstSettingsPath, 'utf-8');
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new Error(`ERROR: cannot read ${dstSettingsPath}: ${msg}`);
        }
        let parsed;
        try {
            parsed = JSON.parse(raw);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new Error(`ERROR: ${dstSettingsPath} is not valid JSON: ${msg}\n       Refusing to overwrite to avoid data loss. Fix the file manually or remove it, then re-run init.`);
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            throw new Error(`ERROR: ${dstSettingsPath} top-level is not a JSON object. Refusing to overwrite.`);
        }
        settings = parsed;
        existed = true;
    }
    else {
        settings = {};
        existed = false;
    }
    const hooksObj = setdefaultObject(settings, 'hooks');
    const subagentGroups = setdefaultArray(hooksObj, 'SubagentStop');
    let foundGroupIdx = null;
    let foundHookIdx = null;
    for (let gi = 0; gi < subagentGroups.length; gi += 1) {
        const group = subagentGroups[gi];
        const groupHooks = group.hooks ?? [];
        for (let hi = 0; hi < groupHooks.length; hi += 1) {
            const hk = groupHooks[hi];
            if (isGateCheckCommand(hk.command)) {
                foundGroupIdx = gi;
                foundHookIdx = hi;
                break;
            }
        }
        if (foundGroupIdx !== null)
            break;
    }
    let changed = false;
    if (foundGroupIdx !== null) {
        const group = subagentGroups[foundGroupIdx];
        const groupHooks = group.hooks ?? [];
        if (groupHooks.length === 1) {
            if (deepEqual(group, srcGroup)) {
            }
            else if (force || update) {
                subagentGroups[foundGroupIdx] = srcGroup;
                changed = true;
            }
        }
        else {
            const idx = foundHookIdx ?? 0;
            if (deepEqual(groupHooks[idx], ourHook)) {
            }
            else if (force || update) {
                groupHooks[idx] = ourHook;
                changed = true;
            }
        }
    }
    else {
        subagentGroups.push(srcGroup);
        changed = true;
    }
    let loggerChanged = false;
    const srcPostToolUse = readArrayPath(src, ['hooks', 'PostToolUse']);
    if (srcPostToolUse.length > 0) {
        loggerChanged = mergeHookGroupByFamily(settings, 'PostToolUse', srcPostToolUse[0], isToolCallLoggerCommand, force, update);
    }
    let fileGuardChanged = false;
    const srcPreToolUse = readArrayPath(src, ['hooks', 'PreToolUse']);
    if (srcPreToolUse.length > 0) {
        fileGuardChanged = mergeHookGroupByFamily(settings, 'PreToolUse', srcPreToolUse[0], isFileGuardCommand, force, update);
    }
    let spawnThrottleChanged = false;
    const srcSubagentStart = readArrayPath(src, ['hooks', 'SubagentStart']);
    if (srcSubagentStart.length > 0) {
        spawnThrottleChanged = mergeHookGroupByFamily(settings, 'SubagentStart', srcSubagentStart[0], isSpawnThrottleCommand, force, update);
    }
    let envChanged = false;
    if (mcpTokenLimit !== undefined) {
        const envBlock = setdefaultObject(settings, 'env');
        const newVal = String(mcpTokenLimit);
        if (envBlock.MAX_MCP_OUTPUT_TOKENS !== newVal) {
            envBlock.MAX_MCP_OUTPUT_TOKENS = newVal;
            envChanged = true;
        }
    }
    const label = '.claude/settings.json';
    if (!changed && !loggerChanged && !fileGuardChanged && !spawnThrottleChanged && !envChanged) {
        if (existed) {
            process.stdout.write(`  SKIP  ${label} (already up to date)\n`);
        }
        else {
            if (dryRun) {
                process.stdout.write(`  WOULD ADD     ${label}\n`);
            }
            else {
                atomicWriteJson(dstSettingsPath, settings);
                process.stdout.write(`  NEW   ${label}\n`);
            }
        }
        return;
    }
    if (dryRun) {
        const verb = existed ? 'WOULD UPDATE' : 'WOULD ADD    ';
        const detail = [];
        if (changed)
            detail.push(`hook: ${ourCommand}`);
        if (loggerChanged)
            detail.push('PostToolUse: riglane tool-call-logger');
        if (fileGuardChanged)
            detail.push('PreToolUse: riglane file-guard');
        if (spawnThrottleChanged)
            detail.push('SubagentStart: riglane spawn-throttle');
        if (envChanged)
            detail.push(`MAX_MCP_OUTPUT_TOKENS=${mcpTokenLimit}`);
        process.stdout.write(`  ${verb}  ${label} (${detail.join(', ')})\n`);
        return;
    }
    atomicWriteJson(dstSettingsPath, settings);
    if (existed) {
        process.stdout.write(`  UPDATE  ${label}\n`);
    }
    else {
        process.stdout.write(`  NEW   ${label}\n`);
    }
    if (changed) {
        process.stdout.write(`          hook: ${ourCommand}\n`);
    }
    if (loggerChanged) {
        process.stdout.write(`          PostToolUse: riglane tool-call-logger\n`);
    }
    if (fileGuardChanged) {
        process.stdout.write(`          PreToolUse: riglane file-guard\n`);
    }
    if (spawnThrottleChanged) {
        process.stdout.write(`          SubagentStart: riglane spawn-throttle\n`);
    }
    if (envChanged) {
        process.stdout.write(`          MAX_MCP_OUTPUT_TOKENS=${mcpTokenLimit}\n`);
    }
}
export function mergeGeminiSettings(srcSettingsPath, dstSettingsPath, opts = {}) {
    const force = Boolean(opts.force);
    const update = Boolean(opts.update);
    const dryRun = Boolean(opts.dryRun);
    const src = JSON.parse(readFileSync(srcSettingsPath, 'utf-8'));
    let settings;
    let existed = false;
    if (existsSync(dstSettingsPath)) {
        let raw;
        try {
            raw = readFileSync(dstSettingsPath, 'utf-8');
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new Error(`ERROR: cannot read ${dstSettingsPath}: ${msg}`);
        }
        let parsed;
        try {
            parsed = JSON.parse(raw);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new Error(`ERROR: ${dstSettingsPath} is not valid JSON: ${msg}\n       Refusing to overwrite to avoid data loss. Fix the file manually or remove it, then re-run init.`);
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            throw new Error(`ERROR: ${dstSettingsPath} top-level is not a JSON object. Refusing to overwrite.`);
        }
        settings = parsed;
        existed = true;
    }
    else {
        settings = {};
    }
    const changedFamilies = [];
    const srcHooks = (src.hooks ?? {});
    for (const [event, groups] of Object.entries(srcHooks)) {
        if (!Array.isArray(groups))
            continue;
        for (const groupRaw of groups) {
            const group = groupRaw;
            const cmd = group.hooks?.[0]
                ?.command ?? '';
            const family = isGateCheckCommand(cmd)
                ? { match: isGateCheckCommand, label: 'gate-check' }
                : isToolCallLoggerCommand(cmd)
                    ? { match: isToolCallLoggerCommand, label: 'tool-call-logger' }
                    : isFileGuardCommand(cmd)
                        ? { match: isFileGuardCommand, label: 'file-guard' }
                        : null;
            if (!family)
                continue;
            if (mergeHookGroupByFamily(settings, event, group, family.match, force, update)) {
                changedFamilies.push(`${event}: riglane ${family.label}`);
            }
        }
    }
    let mcpChanged = false;
    const srcServers = (src.mcpServers ?? {});
    if (Object.keys(srcServers).length > 0) {
        const dstServers = setdefaultObject(settings, 'mcpServers');
        for (const [name, def] of Object.entries(srcServers)) {
            if (!(name in dstServers)) {
                dstServers[name] = def;
                mcpChanged = true;
            }
            else if (!deepEqual(dstServers[name], def) && (force || update)) {
                dstServers[name] = def;
                mcpChanged = true;
            }
        }
    }
    let contextChanged = false;
    const srcContext = (src.context ?? {});
    const srcFileNames = Array.isArray(srcContext.fileName)
        ? srcContext.fileName.filter((x) => typeof x === 'string')
        : [];
    if (srcFileNames.length > 0) {
        const ctx = setdefaultObject(settings, 'context');
        const existing = ctx.fileName;
        let list;
        if (Array.isArray(existing)) {
            list = existing.filter((x) => typeof x === 'string');
        }
        else if (typeof existing === 'string' && existing.length > 0) {
            list = [existing];
        }
        else {
            list = [];
        }
        const beforeLegacyStrip = list.length;
        list = list.filter((n) => n !== 'acp-workflow-context.md');
        if (list.length !== beforeLegacyStrip)
            contextChanged = true;
        if (list.length === 0) {
            ctx.fileName = [...srcFileNames];
            contextChanged = true;
        }
        else {
            for (const name of srcFileNames) {
                if (!name.startsWith('riglane-'))
                    continue;
                if (!list.includes(name)) {
                    list.push(name);
                    contextChanged = true;
                }
            }
            if (contextChanged)
                ctx.fileName = list;
        }
    }
    const label = '.gemini/settings.json';
    const anyChange = changedFamilies.length > 0 || mcpChanged || contextChanged;
    if (!anyChange) {
        if (existed) {
            process.stdout.write(`  SKIP  ${label} (already up to date)\n`);
        }
        else if (dryRun) {
            process.stdout.write(`  WOULD ADD     ${label}\n`);
        }
        else {
            atomicWriteJson(dstSettingsPath, settings);
            process.stdout.write(`  NEW   ${label}\n`);
        }
        return;
    }
    const detail = [...changedFamilies];
    if (mcpChanged)
        detail.push('mcpServers: workflow_engine + workflow_tools');
    if (contextChanged)
        detail.push('context.fileName: riglane-workflow-context.md');
    if (dryRun) {
        const verb = existed ? 'WOULD UPDATE' : 'WOULD ADD    ';
        process.stdout.write(`  ${verb}  ${label} (${detail.join(', ')})\n`);
        return;
    }
    atomicWriteJson(dstSettingsPath, settings);
    process.stdout.write(`  ${existed ? 'UPDATE' : 'NEW  '}  ${label}\n`);
    for (const d of detail)
        process.stdout.write(`          ${d}\n`);
}
export function mergeCodexConfig(srcTemplatePath, dstConfigPath, opts = {}) {
    const overwrite = Boolean(opts.force) || Boolean(opts.update);
    const dryRun = Boolean(opts.dryRun);
    const label = '.codex/config.toml';
    const srcText = readFileSync(srcTemplatePath, 'utf-8');
    const src = parseToml(srcText);
    const srcServers = src.mcp_servers ?? {};
    const srcHookGroup = firstHookGroup(src, 'SubagentStop');
    const ourHandler = hookHandlers(srcHookGroup)[0] ?? null;
    const ourHookCommand = ourHandler?.command ?? '';
    const srcPostGroup = firstHookGroup(src, 'PostToolUse');
    const ourPostHandler = hookHandlers(srcPostGroup)[0] ?? null;
    const ourPostCommand = ourPostHandler?.command ?? '';
    if (Object.keys(srcServers).length === 0 && srcHookGroup === null && srcPostGroup === null) {
        process.stdout.write('  WARN  No [mcp_servers.*] or [hooks.*] in source — skipping merge\n');
        return;
    }
    if (!existsSync(dstConfigPath)) {
        if (dryRun) {
            process.stdout.write(`  WOULD ADD     ${label}\n`);
            return;
        }
        mkdirSync(dirname(dstConfigPath), { recursive: true });
        copyFileSync(srcTemplatePath, dstConfigPath);
        process.stdout.write(`  COPY  ${label}\n`);
        return;
    }
    const dstText = readFileSync(dstConfigPath, 'utf-8');
    let dst;
    try {
        dst = parseToml(dstText);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`ERROR: ${dstConfigPath} is not valid TOML: ${msg}\n       Refusing to overwrite to avoid data loss. Fix the file manually or remove it, then re-run.`);
    }
    if (typeof dst !== 'object' || dst === null || Array.isArray(dst)) {
        throw new Error(`ERROR: ${dstConfigPath} top-level is not a TOML table. Refusing to overwrite.`);
    }
    const existingServers = dst.mcp_servers ?? {};
    const serverAdds = [];
    const serverReplaces = [];
    for (const [name, cfg] of Object.entries(srcServers)) {
        if (name in existingServers) {
            if (deepEqual(existingServers[name], cfg))
                continue;
            if (overwrite)
                serverReplaces.push(name);
        }
        else {
            serverAdds.push(name);
        }
    }
    let hookAdd = false;
    let hookReplace = false;
    if (srcHookGroup !== null) {
        const matches = findHookHandlersByFamily(dst, 'SubagentStop', isGateCheckCommand);
        if (matches.length === 0)
            hookAdd = true;
        else if (overwrite && (matches.length > 1 || !deepEqual(matches[0], ourHandler)))
            hookReplace = true;
    }
    let postHookAdd = false;
    let postHookReplace = false;
    if (srcPostGroup !== null) {
        const matches = findHookHandlersByFamily(dst, 'PostToolUse', isToolCallLoggerCommand);
        if (matches.length === 0)
            postHookAdd = true;
        else if (overwrite && (matches.length > 1 || !deepEqual(matches[0], ourPostHandler)))
            postHookReplace = true;
    }
    const srcAgents = src.agents ?? {};
    const dstAgents = dst.agents ?? {};
    const agentAdds = [];
    const agentReplaces = [];
    for (const [key, val] of Object.entries(srcAgents)) {
        if (key in dstAgents) {
            if (deepEqual(dstAgents[key], val))
                continue;
            if (overwrite)
                agentReplaces.push(key);
        }
        else {
            agentAdds.push(key);
        }
    }
    const needReplace = serverReplaces.length > 0 || hookReplace || postHookReplace ||
        agentReplaces.length > 0;
    const needAdd = serverAdds.length > 0 || hookAdd || postHookAdd || agentAdds.length > 0;
    const detail = [
        ...serverReplaces.map((n) => `server: ${n}`),
        ...serverAdds.map((n) => `server: ${n}`),
        ...(hookReplace || hookAdd ? [`hook: ${ourHookCommand}`] : []),
        ...(postHookReplace || postHookAdd ? [`hook: ${ourPostCommand}`] : []),
        ...[...agentReplaces, ...agentAdds].map((k) => `agents.${k}`),
    ].join(', ');
    if (!needReplace && !needAdd) {
        process.stdout.write(`  SKIP  ${label} (already present)\n`);
        return;
    }
    if (dryRun) {
        const verb = needReplace ? 'WOULD UPDATE' : 'WOULD ADD    ';
        process.stdout.write(`  ${verb}  ${label} (${detail})\n`);
        return;
    }
    if (needReplace) {
        const servers = setdefaultObject(dst, 'mcp_servers');
        for (const name of [...serverReplaces, ...serverAdds])
            servers[name] = srcServers[name];
        if (hookReplace)
            replaceHookHandlersByFamily(dst, 'SubagentStop', isGateCheckCommand, ourHandler);
        if (hookAdd)
            setdefaultArray(setdefaultObject(dst, 'hooks'), 'SubagentStop').push(srcHookGroup);
        if (postHookReplace)
            replaceHookHandlersByFamily(dst, 'PostToolUse', isToolCallLoggerCommand, ourPostHandler);
        if (postHookAdd)
            setdefaultArray(setdefaultObject(dst, 'hooks'), 'PostToolUse').push(srcPostGroup);
        if (agentReplaces.length > 0 || agentAdds.length > 0) {
            const agents = setdefaultObject(dst, 'agents');
            for (const key of [...agentReplaces, ...agentAdds])
                agents[key] = srcAgents[key];
        }
        writeFileSync(dstConfigPath, `${stringifyToml(dst)}\n`, 'utf-8');
        process.stdout.write(`  UPDATE  ${label} (${detail})\n`);
        process.stdout.write('  WARN  config.toml was rewritten — comments in the original file were not preserved (TOML round-trip)\n');
        return;
    }
    const frag = {};
    if (serverAdds.length > 0) {
        const addServers = {};
        for (const name of serverAdds)
            addServers[name] = srcServers[name];
        frag.mcp_servers = addServers;
    }
    if (hookAdd || postHookAdd) {
        const fragHooks = {};
        if (hookAdd)
            fragHooks.SubagentStop = [srcHookGroup];
        if (postHookAdd)
            fragHooks.PostToolUse = [srcPostGroup];
        frag.hooks = fragHooks;
    }
    if (agentAdds.length > 0) {
        const addAgents = {};
        for (const key of agentAdds)
            addAgents[key] = srcAgents[key];
        frag.agents = addAgents;
    }
    const sep = dstText.endsWith('\n') ? '\n' : '\n\n';
    writeFileSync(dstConfigPath, `${dstText}${sep}${stringifyToml(frag)}\n`, 'utf-8');
    process.stdout.write(`  MERGE ${label} (${detail})\n`);
}
export const OPENCODE_INSTRUCTIONS_ENTRY = '.opencode/riglane/*.md';
export const OPENCODE_LEGACY_INSTRUCTIONS_ENTRIES = ['.opencode/acp/*.md'];
export const OPENCODE_MCP_SERVERS = ['workflow_engine', 'workflow_tools'];
function stripJsonc(text) {
    let out = '';
    let i = 0;
    let inString = false;
    while (i < text.length) {
        const c = text[i];
        if (inString) {
            out += c;
            if (c === '\\') {
                out += text[i + 1] ?? '';
                i += 2;
                continue;
            }
            if (c === '"')
                inString = false;
            i++;
            continue;
        }
        if (c === '"') {
            inString = true;
            out += c;
            i++;
            continue;
        }
        if (c === '/' && text[i + 1] === '/') {
            while (i < text.length && text[i] !== '\n')
                i++;
            continue;
        }
        if (c === '/' && text[i + 1] === '*') {
            i += 2;
            while (i < text.length && !(text[i] === '*' && text[i + 1] === '/'))
                i++;
            i += 2;
            continue;
        }
        if (c === ',') {
            let j = i + 1;
            while (j < text.length && /\s/.test(text[j]))
                j++;
            if (text[j] === '}' || text[j] === ']') {
                i++;
                continue;
            }
        }
        out += c;
        i++;
    }
    return out;
}
export function parseJsonLenient(text) {
    try {
        return JSON.parse(text);
    }
    catch (strictErr) {
        try {
            return JSON.parse(stripJsonc(text));
        }
        catch {
            throw strictErr;
        }
    }
}
export function mergeOpencodeConfig(srcTemplatePath, dstConfigPath, opts = {}) {
    const overwrite = Boolean(opts.force) || Boolean(opts.update);
    const dryRun = Boolean(opts.dryRun);
    const label = '.opencode/opencode.json';
    const src = JSON.parse(readFileSync(srcTemplatePath, 'utf-8'));
    const srcServers = src.mcp ?? {};
    const srcInstructions = src.instructions ?? [];
    if (Object.keys(srcServers).length === 0 && srcInstructions.length === 0) {
        process.stdout.write('  WARN  No mcp servers or instructions in source — skipping merge\n');
        return;
    }
    if (!existsSync(dstConfigPath)) {
        if (dryRun) {
            process.stdout.write(`  WOULD ADD     ${label}\n`);
            return;
        }
        mkdirSync(dirname(dstConfigPath), { recursive: true });
        copyFileSync(srcTemplatePath, dstConfigPath);
        process.stdout.write(`  COPY  ${label}\n`);
        return;
    }
    const dstText = readFileSync(dstConfigPath, 'utf-8');
    let dst;
    try {
        dst = parseJsonLenient(dstText);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`ERROR: ${dstConfigPath} is not valid JSON: ${msg}\n       Refusing to overwrite to avoid data loss. Fix the file manually or remove it, then re-run.`);
    }
    if (typeof dst !== 'object' || dst === null || Array.isArray(dst)) {
        throw new Error(`ERROR: ${dstConfigPath} top-level is not a JSON object. Refusing to overwrite.`);
    }
    const existingServers = dst.mcp ?? {};
    const serverAdds = [];
    const serverReplaces = [];
    for (const [name, cfg] of Object.entries(srcServers)) {
        if (name in existingServers) {
            if (deepEqual(existingServers[name], cfg))
                continue;
            if (overwrite)
                serverReplaces.push(name);
        }
        else {
            serverAdds.push(name);
        }
    }
    const existingInstructions = Array.isArray(dst.instructions)
        ? dst.instructions
        : [];
    const instructionAdds = srcInstructions.filter((e) => !existingInstructions.includes(e));
    const instructionRemoves = overwrite
        ? existingInstructions.filter((e) => typeof e === 'string' && OPENCODE_LEGACY_INSTRUCTIONS_ENTRIES.includes(e))
        : [];
    const schemaAdd = !('$schema' in dst) && typeof src.$schema === 'string';
    const needReplace = serverReplaces.length > 0 || instructionRemoves.length > 0;
    const needAdd = serverAdds.length > 0 || instructionAdds.length > 0 || schemaAdd;
    if (!needReplace && !needAdd) {
        process.stdout.write(`  SKIP  ${label} (already present)\n`);
        return;
    }
    const detail = [
        ...serverReplaces.map((n) => `server: ${n}`),
        ...serverAdds.map((n) => `server: ${n}`),
        ...instructionAdds.map((e) => `instructions: ${e}`),
        ...instructionRemoves.map((e) => `instructions removed: ${e}`),
        ...(schemaAdd ? ['$schema'] : []),
    ].join(', ');
    if (dryRun) {
        const verb = needReplace ? 'WOULD UPDATE' : 'WOULD ADD    ';
        process.stdout.write(`  ${verb}  ${label} (${detail})\n`);
        return;
    }
    if (schemaAdd)
        dst.$schema = src.$schema;
    if (serverAdds.length > 0 || serverReplaces.length > 0) {
        const servers = setdefaultObject(dst, 'mcp');
        for (const name of [...serverReplaces, ...serverAdds])
            servers[name] = srcServers[name];
    }
    if (instructionRemoves.length > 0) {
        dst.instructions = existingInstructions.filter((e) => !(typeof e === 'string' && instructionRemoves.includes(e)));
    }
    if (instructionAdds.length > 0) {
        const arr = setdefaultArray(dst, 'instructions');
        arr.push(...instructionAdds);
    }
    atomicWriteJson(dstConfigPath, dst);
    process.stdout.write(`  ${needReplace ? 'UPDATE' : 'MERGE'} ${label} (${detail})\n`);
    const OWNED_KEYS = new Set(['$schema', 'mcp', 'instructions']);
    const hasForeignKeys = Object.keys(dst).some((k) => !OWNED_KEYS.has(k));
    const hadJsoncisms = dstText !== stripJsonc(dstText);
    if (hasForeignKeys || hadJsoncisms) {
        process.stdout.write(`  NOTE  ${label} was re-serialized (2-space JSON) — comments/formatting in the original file were not preserved\n`);
    }
}
function firstHookGroup(obj, event) {
    const groups = readArrayPath(obj, ['hooks', event]);
    const g = groups[0];
    return typeof g === 'object' && g !== null && !Array.isArray(g)
        ? g
        : null;
}
function hookHandlers(group) {
    const h = group?.hooks;
    if (!Array.isArray(h))
        return [];
    return h.filter((x) => typeof x === 'object' && x !== null && !Array.isArray(x));
}
function findHookHandlersByFamily(obj, event, isFamily) {
    const out = [];
    for (const group of readArrayPath(obj, ['hooks', event])) {
        if (typeof group !== 'object' || group === null || Array.isArray(group))
            continue;
        for (const handler of hookHandlers(group)) {
            if (isFamily(handler.command))
                out.push(handler);
        }
    }
    return out;
}
function replaceHookHandlersByFamily(obj, event, isFamily, replacement) {
    if (replacement === null)
        return;
    const hooksTable = obj.hooks;
    if (!hooksTable || typeof hooksTable !== 'object')
        return;
    const groups = hooksTable[event];
    if (!Array.isArray(groups))
        return;
    let placed = false;
    const keptGroups = [];
    for (const group of groups) {
        if (typeof group !== 'object' || group === null || Array.isArray(group)) {
            keptGroups.push(group);
            continue;
        }
        const g = group;
        const handlers = g.hooks;
        if (!Array.isArray(handlers)) {
            keptGroups.push(g);
            continue;
        }
        const next = [];
        for (const h of handlers) {
            if (h && typeof h === 'object' && isFamily(h.command)) {
                if (!placed) {
                    next.push(replacement);
                    placed = true;
                }
            }
            else {
                next.push(h);
            }
        }
        if (next.length > 0) {
            g.hooks = next;
            keptGroups.push(g);
        }
    }
    if (keptGroups.length > 0)
        hooksTable[event] = keptGroups;
    else
        delete hooksTable[event];
    if (Object.keys(hooksTable).length === 0)
        delete obj.hooks;
}
function isFile(p) {
    try {
        return statSync(p).isFile();
    }
    catch {
        return false;
    }
}
function setdefaultObject(parent, key) {
    let val = parent[key];
    if (typeof val !== 'object' || val === null || Array.isArray(val)) {
        val = {};
        parent[key] = val;
    }
    return val;
}
function setdefaultArray(parent, key) {
    let val = parent[key];
    if (!Array.isArray(val)) {
        val = [];
        parent[key] = val;
    }
    return val;
}
function readArrayPath(obj, path) {
    let cur = obj;
    for (const seg of path) {
        if (typeof cur !== 'object' || cur === null || Array.isArray(cur))
            return [];
        cur = cur[seg];
        if (cur === undefined)
            return [];
    }
    return Array.isArray(cur) ? cur : [];
}
function deepEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}
