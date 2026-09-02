import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text, useInput } from 'ink';
import { Alert, Spinner, TextInput } from '@inkjs/ui';
import { useEffect, useMemo, useState } from 'react';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { EntryError, catalogEntryUrl, catalogIndexUrl, validateCatalogIndex, validatePerEntryDocument, } from '../../catalog/entry.js';
import { catalogBaseUrl } from '../../config/config.js';
import { defaultPaths } from '../../engine/workflow-engine.js';
import * as registry from '../../registry/registry.js';
import { PRODUCT_DIR } from '../../config/paths.js';
import { PublishWizard } from './PublishWizard.js';
import { windowAround, useViewportRows, MoreRow } from './viewport.js';
import { CURSOR } from './theme.js';
import { useTheme } from './themeContext.js';
async function fetchJson(url) {
    let res;
    try {
        res = await fetch(url);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new EntryError(`cannot reach the catalog at ${url}: ${msg}`);
    }
    if (res.status === 404)
        return null;
    if (!res.ok)
        throw new EntryError(`catalog request failed: ${url} → HTTP ${res.status}`);
    return (await res.json());
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
function basenameOf(idOrPath) {
    return idOrPath.includes('/') || idOrPath.includes('\\') ? basename(idOrPath) : idOrPath;
}
function scanInstalled() {
    const rows = [];
    try {
        for (const e of registry.list()) {
            if (!existsSync(join(e.path, PRODUCT_DIR)))
                continue;
            let communityDir = '';
            try {
                communityDir = defaultPaths(e.path).communityDir;
            }
            catch {
                continue;
            }
            if (!existsSync(communityDir))
                continue;
            let trustedIds = new Set();
            try {
                const t = JSON.parse(readFileSync(join(e.path, PRODUCT_DIR, 'local', 'trusted.json'), 'utf-8'));
                trustedIds = new Set(Object.keys(t.workflows ?? {}));
            }
            catch {
            }
            for (const d of readdirSync(communityDir, { withFileTypes: true })) {
                if (!d.isDirectory())
                    continue;
                rows.push({ id: d.name, project: e.slug, projectPath: e.path, trusted: trustedIds.has(d.name) });
            }
        }
    }
    catch {
    }
    return rows.sort((a, b) => a.id.localeCompare(b.id) || a.project.localeCompare(b.project));
}
function installedDirFor(id, projectDir) {
    try {
        const dir = join(defaultPaths(projectDir).communityDir, id);
        return existsSync(dir) ? dir : '';
    }
    catch {
        return '';
    }
}
export function CommunityTab({ active, onCaptureChange, onCliTask, post, }) {
    const theme = useTheme();
    const vpRows = useViewportRows();
    const [rows, setRows] = useState(null);
    const [loadError, setLoadError] = useState('');
    const [reloadTick, setReloadTick] = useState(0);
    const [filter, setFilter] = useState('');
    const [filterEditing, setFilterEditing] = useState(false);
    const [focusIdx, setFocusIdx] = useState(0);
    const [detailId, setDetailId] = useState('');
    const [detailEntry, setDetailEntry] = useState(null);
    const [detailError, setDetailError] = useState('');
    const [localEditing, setLocalEditing] = useState(false);
    const [localMode, setLocalMode] = useState('add');
    const [localPath, setLocalPath] = useState('');
    const [publishing, setPublishing] = useState(false);
    const [postStep, setPostStep] = useState(post ?? null);
    const [pendingTask, setPendingTask] = useState(null);
    const [pickIdx, setPickIdx] = useState(0);
    const projects = useMemo(() => {
        if (pendingTask === null)
            return [];
        try {
            const fromRegistry = registry
                .list()
                .filter((e) => existsSync(join(e.path, PRODUCT_DIR)))
                .map((e) => ({ slug: e.slug, path: e.path }));
            return fromRegistry;
        }
        catch {
            return [];
        }
    }, [pendingTask]);
    const requestTask = (kind, id) => {
        setPendingTask({ kind, id });
        setPickIdx(0);
    };
    useEffect(() => {
        if (!active || (rows !== null && reloadTick === 0))
            return;
        let stale = false;
        setLoadError('');
        setRows(null);
        void (async () => {
            try {
                const raw = await fetchJson(catalogIndexUrl(catalogBaseUrl()));
                if (stale)
                    return;
                if (raw === null) {
                    setLoadError('The catalog has no index — is the base URL right?');
                    setRows([]);
                    return;
                }
                setRows(validateCatalogIndex(raw).entries);
            }
            catch (e) {
                if (stale)
                    return;
                setLoadError(e instanceof Error ? e.message : String(e));
                setRows([]);
            }
        })();
        return () => {
            stale = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, reloadTick]);
    useEffect(() => {
        if (detailId === '')
            return;
        let stale = false;
        setDetailEntry(null);
        setDetailError('');
        void (async () => {
            try {
                const raw = await fetchJson(catalogEntryUrl(catalogBaseUrl(), detailId));
                if (stale)
                    return;
                if (raw === null) {
                    setDetailError(`No catalog entry '${detailId}' — the index may be ahead of the entries.`);
                    return;
                }
                setDetailEntry(validatePerEntryDocument(raw, detailId).entry);
            }
            catch (e) {
                if (stale)
                    return;
                setDetailError(e instanceof Error ? e.message : String(e));
            }
        })();
        return () => {
            stale = true;
        };
    }, [detailId]);
    useEffect(() => {
        onCaptureChange(active &&
            (filterEditing || localEditing || publishing || pendingTask !== null || postStep !== null || detailId !== ''));
    }, [active, filterEditing, localEditing, publishing, pendingTask, postStep, detailId, onCaptureChange]);
    useInput((input, key) => {
        if (postStep === null)
            return;
        if (key.escape || input === 'q') {
            setPostStep(null);
            return;
        }
        if (postStep.stage === 'restart') {
            if (key.return)
                setPostStep(null);
            return;
        }
        if (key.return || (postStep.stage === 'trust' && input === 't') || (postStep.stage === 'init' && input === 'i')) {
            const t = postStep;
            setPostStep(null);
            onCliTask({ kind: t.stage === 'trust' ? 'trust' : 'init', id: t.wfId, wfId: t.wfId, cwd: t.cwd });
        }
    }, { isActive: active && postStep !== null && pendingTask === null && !publishing });
    useInput((input, key) => {
        if (key.escape || input === 'q') {
            setPendingTask(null);
            return;
        }
        if (key.downArrow || input === 'j')
            setPickIdx((i) => Math.min(i + 1, Math.max(0, projects.length - 1)));
        else if (key.upArrow || input === 'k')
            setPickIdx((i) => Math.max(i - 1, 0));
        else if (key.return && pendingTask !== null && projects.length > 0) {
            const p = projects[Math.min(pickIdx, projects.length - 1)];
            if (p) {
                const t = pendingTask;
                setPendingTask(null);
                const wfId = basenameOf(t.id);
                onCliTask(t.kind === 'update'
                    ? { kind: 'update', id: wfId, wfId, entryDir: t.id, cwd: p.path }
                    : { ...t, wfId, cwd: p.path });
            }
        }
    }, { isActive: active && pendingTask !== null });
    const installed = useMemo(() => (active ? scanInstalled() : []), [active, reloadTick, postStep]);
    const q = filter.trim().toLowerCase();
    const matches = useMemo(() => (rows === null ? [] : q === '' ? rows : rows.filter((r) => rowMatches(r, q))), [rows, q]);
    const clampedIdx = Math.min(focusIdx, Math.max(0, matches.length - 1));
    const detailInstalledDir = detailId === '' ? '' : installedDirFor(detailId);
    useInput((input, key) => {
        if (filterEditing || localEditing || publishing || pendingTask !== null || postStep !== null)
            return;
        if (detailId !== '') {
            if (key.escape || input === 'q') {
                setDetailId('');
                return;
            }
            if (input === 'i') {
                requestTask('add', detailId);
                return;
            }
            if (input === 't') {
                requestTask('trust', detailId);
                return;
            }
            return;
        }
        if (key.downArrow || input === 'j') {
            setFocusIdx(Math.min(clampedIdx + 1, Math.max(0, matches.length - 1)));
            return;
        }
        if (key.upArrow || input === 'k') {
            setFocusIdx(Math.max(clampedIdx - 1, 0));
            return;
        }
        if (input === '/') {
            setFilterEditing(true);
            return;
        }
        if (input === 'r') {
            setReloadTick((t) => t + 1);
            return;
        }
        if (input === 'l') {
            setLocalMode('add');
            setLocalEditing(true);
            return;
        }
        if (input === 'u') {
            setLocalMode('update');
            setLocalEditing(true);
            return;
        }
        if (input === 't') {
            setLocalMode('trust');
            setLocalEditing(true);
            return;
        }
        if (input === 'p') {
            setPublishing(true);
            return;
        }
        if (key.return && matches.length > 0) {
            const row = matches[clampedIdx];
            if (row)
                setDetailId(row.id);
        }
    }, { isActive: active && !filterEditing });
    useInput((_input, key) => {
        if (key.return) {
            setFilterEditing(false);
            setFocusIdx(0);
            return;
        }
        if (key.escape) {
            setFilter('');
            setFilterEditing(false);
            setFocusIdx(0);
        }
    }, { isActive: active && filterEditing });
    useInput((_input, key) => {
        if (key.return) {
            const p = localPath.trim();
            setLocalEditing(false);
            setLocalPath('');
            if (p !== '')
                requestTask(localMode, p);
            return;
        }
        if (key.escape) {
            setLocalEditing(false);
            setLocalPath('');
        }
    }, { isActive: active && localEditing });
    if (!active)
        return _jsx(Box, {});
    const tGap = vpRows <= 12 ? 0 : 1;
    if (postStep !== null) {
        const projName = basename(postStep.cwd);
        return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { bold: true, color: theme.brand, children: postStep.stage === 'trust'
                        ? `Installed into ${projName} — switched off`
                        : postStep.stage === 'init'
                            ? `Trusted in ${projName}`
                            : `Ready in ${projName}` }), postStep.stage === 'trust' ? (_jsxs(Box, { marginTop: tGap, flexDirection: "column", children: [_jsxs(Text, { color: theme.muted, children: [postStep.wfId, " is installed \u2014 its files are in your project, and nothing has run."] }), _jsx(Box, { marginTop: tGap, children: _jsx(Text, { color: theme.muted, children: "Next comes trust: a short review of what this workflow can actually execute on your machine \u2014 its script commands, and which of them read your environment or reach the network. Installing said \"put it on disk\"; trusting says \"this may run here\". Those are different decisions, so each one is yours to make, and the engine keeps the workflow switched off until the second one. You confirm by typing the workflow's name \u2014 proof you saw the list, not a reflex \"y\"." }) }), _jsx(Box, { marginTop: tGap, children: _jsx(Text, { color: theme.hint, children: "Press enter to continue to trust \u00B7 esc \u2014 later (it stays installed, just off)" }) })] })) : postStep.stage === 'init' ? (_jsxs(Box, { marginTop: tGap, flexDirection: "column", children: [_jsxs(Text, { color: theme.muted, children: [postStep.wfId, " is trusted \u2014 it may run in ", projName, " now."] }), _jsx(Box, { marginTop: tGap, children: _jsx(Text, { color: theme.muted, children: "One preparation step left: this workflow declares script tools, and each step's agent gets a file whitelisting exactly the tools that step may call. Generating those files now is what makes the whitelist real at run time." }) }), _jsx(Box, { marginTop: tGap, children: _jsx(Text, { color: theme.hint, children: "Press enter to generate the step agents \u00B7 esc later" }) })] })) : (_jsxs(Box, { marginTop: tGap, flexDirection: "column", children: [_jsxs(Text, { color: theme.muted, children: [postStep.wfId, " is trusted and initialized \u2014 everything on disk is ready."] }), _jsx(Box, { marginTop: tGap, children: _jsxs(Text, { color: theme.muted, children: ["Last step, and the one thing this screen cannot do for you: restart your agent host in ", postStep.cwd, ". Hosts read the workflow's tools once, at startup \u2014 after the restart, start a run and enjoy."] }) }), _jsx(Box, { marginTop: tGap, children: _jsx(Text, { color: theme.hint, children: "enter close" }) })] }))] }));
    }
    if (pendingTask !== null) {
        const verb = pendingTask.kind === 'add' ? 'Install' : pendingTask.kind === 'trust' ? 'Trust' : 'Update';
        return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { bold: true, color: theme.brand, children: [verb, " \u2014 pick the target project"] }), _jsx(Text, { color: theme.muted, children: "Installs and trust grants are PER-PROJECT: the workflow lands in (and runs in) exactly the project you choose here." }), _jsx(Box, { marginTop: tGap, flexDirection: "column", children: projects.length === 0 ? (_jsxs(Text, { color: theme.warning, children: ["No riglane projects in the registry \u2014 run `riglane init ", '<path>', "` first (Projects tab)."] })) : (projects.map((p, i) => {
                        const focused = i === Math.min(pickIdx, projects.length - 1);
                        const has = pendingTask.kind === 'trust' || installedDirFor(basenameOf(pendingTask.id), p.path) !== '';
                        return (_jsxs(Box, { children: [_jsxs(Text, { ...(focused ? { color: theme.brand } : {}), children: [focused ? CURSOR : ' ', " "] }), _jsx(Text, { bold: focused, children: p.slug }), pendingTask.kind === 'add' && has ? (_jsx(Text, { color: theme.success, children: " \u2713 already installed" })) : null, _jsxs(Text, { color: theme.hint, children: [" \u2014 ", p.path] })] }, p.path));
                    })) }), _jsx(Box, { marginTop: tGap, children: _jsx(Text, { color: theme.hint, children: "enter choose \u00B7 esc cancel" }) })] }));
    }
    if (publishing) {
        return (_jsx(PublishWizard, { active: publishing, onClose: () => setPublishing(false), onRehearse: (entryDir) => {
                setPublishing(false);
                requestTask('add', entryDir);
            } }));
    }
    if (detailId !== '') {
        const row = (rows ?? []).find((r) => r.id === detailId);
        const meta = (detailEntry?.meta ?? {});
        const str = (k) => (typeof meta[k] === 'string' ? meta[k] : '');
        return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { bold: true, color: theme.brand, children: detailId }), row ? (_jsxs(Text, { color: theme.muted, children: ["[", row.level, "] ", row.script_tools === 0 && row.deciders === 0
                            ? 'no shell surface'
                            : `script tools: ${row.script_tools} · deciders: ${row.deciders}`, row.author !== undefined ? ` · by ${row.author}` : ''] })) : null, detailEntry === null && detailError === '' ? (_jsx(Box, { marginTop: tGap, children: _jsx(Spinner, { label: "Fetching the entry\u2026" }) })) : null, detailError !== '' ? (_jsx(Box, { marginTop: tGap, children: _jsx(Alert, { variant: "error", children: detailError }) })) : null, detailEntry !== null ? (_jsxs(Box, { marginTop: tGap, flexDirection: "column", children: [str('summary') !== '' ? _jsx(Text, { children: str('summary') }) : null, str('description') !== '' ? (_jsx(Box, { marginTop: tGap, children: _jsx(Text, { color: theme.muted, children: str('description').trim() }) })) : null, _jsxs(Box, { marginTop: tGap, flexDirection: "column", children: [str('license') !== '' ? _jsxs(Text, { color: theme.muted, children: ["license: ", str('license')] }) : null, _jsxs(Text, { color: theme.muted, children: ["source: ", detailEntry.source.repo] }), _jsxs(Text, { color: theme.muted, children: ["pinned: ", detailEntry.source.sha.slice(0, 12), "\u2026 (installs stay on this commit)"] })] })] })) : null, _jsxs(Box, { marginTop: tGap, flexDirection: "column", children: [detailInstalledDir !== '' ? (_jsxs(Text, { color: theme.success, children: ["installed: ", detailInstalledDir] })) : null, _jsx(Text, { color: theme.hint, children: "(i) install into a project \u2014 full pre-install inspection, typed-id confirm, lands SWITCHED OFF \u00B7 (t) trust it in a project \u2014 executable-surface review, typed-id confirm \u00B7 esc back" })] })] }));
    }
    const cap = Math.max(2, vpRows - (filterEditing || filter !== '' ? 8 : 7));
    const win = windowAround(matches.length, clampedIdx, cap);
    const idWidth = matches.length > 0 ? Math.max(...matches.map((r) => r.id.length)) : 0;
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { bold: true, color: theme.brand, children: "Community" }), _jsx(Text, { color: theme.muted, children: "Shared workflows from the public catalog." }), localEditing ? (_jsxs(Box, { marginTop: tGap, flexDirection: "column", children: [_jsx(Text, { color: theme.brand, children: localMode === 'add'
                            ? 'Install from a local entry directory (entry.yaml + entry.lock.yaml):'
                            : localMode === 'update'
                                ? 'Update an installed workflow from a local entry directory (entry.yaml + entry.lock.yaml):'
                                : 'Trust an installed community workflow (by its id):' }), _jsxs(Text, { color: theme.muted, children: [localMode === 'add'
                                ? 'The pre-publish rehearsal — it fetches the pinned repo, verifies the lock byte-for-byte and shows the same inspect screen a catalog user would see.'
                                : localMode === 'update'
                                    ? 'Moves the install to the entry’s newer pinned commit: shows the DIFF of the shell-bearing surfaces, asks for the typed id again, and DROPS the trust grant (the content changed).'
                                    : 'The RUN consent — a review of the executable surface in the project you pick, confirmed by typing the id. Community workflows stay switched off without it.', ' ', "Enter to continue \u00B7 Esc to cancel."] }), _jsxs(Box, { children: [_jsx(Text, { color: theme.brand, children: localMode === 'trust' ? 'id: ' : 'dir: ' }), _jsx(TextInput, { defaultValue: localPath, onChange: setLocalPath })] })] })) : null, filterEditing ? (_jsxs(Box, { marginTop: tGap, children: [_jsx(Text, { color: theme.brand, children: "/ " }), _jsx(TextInput, { defaultValue: filter, onChange: setFilter, onSubmit: () => setFilterEditing(false) })] })) : filter !== '' ? (_jsx(Box, { marginTop: tGap, children: _jsxs(Text, { color: theme.muted, children: ["filter: ", filter, " (/ to edit)"] }) })) : null, rows === null ? (_jsx(Box, { marginTop: tGap, children: _jsx(Spinner, { label: "Fetching the catalog index\u2026" }) })) : null, loadError !== '' ? (_jsx(Box, { marginTop: tGap, children: _jsx(Alert, { variant: "error", children: loadError }) })) : null, rows !== null && loadError === '' && matches.length === 0 ? (_jsx(Box, { marginTop: tGap, children: _jsx(Text, { color: theme.muted, children: q === '' ? 'The catalog is empty.' : `No catalog entries match '${filter.trim()}'.` }) })) : null, matches.length > 0 ? (_jsxs(Box, { marginTop: tGap, flexDirection: "column", children: [_jsx(MoreRow, { count: win.start, dir: "up" }), matches.slice(win.start, win.end).map((r, j) => {
                        const i = win.start + j;
                        const focused = i === clampedIdx;
                        const shell = r.script_tools === 0 && r.deciders === 0
                            ? 'no shell'
                            : `tools:${r.script_tools} deciders:${r.deciders}`;
                        const installed = installedDirFor(r.id) !== '';
                        return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { children: [_jsx(Text, { ...(focused ? { color: theme.brand } : {}), children: focused ? CURSOR : ' ' }), _jsxs(Text, { bold: focused, color: focused ? theme.brand : theme.tabInactive, children: [' ', r.id.padEnd(idWidth)] }), _jsxs(Text, { color: r.level === 'verified' ? (theme.success) : theme.muted, children: ['  ', "[", r.level, "]"] }), _jsxs(Text, { color: theme.muted, children: ['  ', shell] }), installed ? _jsx(Text, { color: theme.success, children: '  ✓ installed' }) : null] }), _jsx(Box, { marginLeft: 4, children: _jsx(Text, { color: theme.hint, wrap: "wrap", children: r.summary }) })] }, r.id));
                    }), _jsx(MoreRow, { count: matches.length - win.end, dir: "down" })] })) : null, installed.length > 0 ? (_jsxs(Box, { marginTop: tGap, flexDirection: "column", children: [_jsx(Text, { bold: true, color: theme.brand, children: "Installed in your projects" }), installed.map((r) => (_jsxs(Box, { children: [_jsxs(Text, { children: ['  ', r.id] }), _jsxs(Text, { color: theme.muted, children: [" \u2014 ", r.project] }), r.trusted ? (_jsx(Text, { color: theme.success, children: " \u2713 trusted" })) : (_jsx(Text, { color: theme.warning, children: " switched off \u2014 (t) to trust" }))] }, `${r.projectPath}:${r.id}`)))] })) : null, _jsx(Box, { marginTop: tGap, children: _jsx(Text, { color: theme.hint, children: "enter open \u00B7 (i)nstall from detail \u00B7 (l)ocal entry install \u00B7 (u)pdate from local entry \u00B7 (t)rust an installed workflow \u00B7 (p)ublish my workflow \u00B7 / filter \u00B7 r reload" }) })] }));
}
