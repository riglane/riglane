import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text, useInput } from 'ink';
import { Alert, TextInput } from '@inkjs/ui';
import { useEffect, useMemo, useState } from 'react';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import * as registry from '../../registry/registry.js';
import { PRODUCT_DIR } from '../../config/paths.js';
import { listProjectWorkflows } from './workflowRun.js';
import { packLock, pathInsideRepo, repinEntryText, runPreflight, scaffoldEntryText, validateCatalogCheckout, writeEntryFiles, } from './publishSteps.js';
import { CURSOR } from './theme.js';
import { useTheme } from './themeContext.js';
export function PublishWizard({ active, onClose, onRehearse, }) {
    const theme = useTheme();
    const [screen, setScreen] = useState('project');
    const [focusIdx, setFocusIdx] = useState(0);
    const [editing, setEditing] = useState(false);
    const [error, setError] = useState('');
    const projects = useMemo(() => {
        if (!active)
            return [];
        try {
            return registry
                .list()
                .filter((e) => existsSync(join(e.path, PRODUCT_DIR)))
                .map((e) => ({ slug: e.slug, path: e.path }));
        }
        catch {
            return [];
        }
    }, [active]);
    const [workflows, setWorkflows] = useState([]);
    const [customPath, setCustomPath] = useState('');
    const [workflowDir, setWorkflowDir] = useState('');
    const [preflight, setPreflight] = useState(null);
    const [pack, setPack] = useState(null);
    const [catalogRoot, setCatalogRoot] = useState('');
    const [catalogEditing, setCatalogEditing] = useState(false);
    const [entryExists, setEntryExists] = useState(false);
    const [summaryField, setSummaryField] = useState('');
    const [authorField, setAuthorField] = useState('');
    const [fieldFocus, setFieldFocus] = useState('summary');
    const [writeResult, setWriteResult] = useState(null);
    useEffect(() => {
        if (active)
            return;
        setScreen('project');
        setFocusIdx(0);
        setEditing(false);
        setError('');
        setWorkflowDir('');
        setPreflight(null);
        setPack(null);
        setWriteResult(null);
        setCatalogEditing(false);
    }, [active]);
    const enterWorkflowDir = (dir) => {
        setWorkflowDir(dir);
        setError('');
        const report = runPreflight(dir);
        setPreflight(report);
        setScreen('preflight');
        setFocusIdx(0);
    };
    const runPack = () => {
        try {
            setPack(packLock(workflowDir));
            setScreen('pack');
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    };
    const entryDir = catalogRoot === '' || preflight === null ? '' : join(resolve(catalogRoot), 'catalog', preflight.id);
    const doWrite = () => {
        if (preflight === null || pack === null || entryDir === '')
            return;
        try {
            const pin = {
                repo: preflight.git.remoteUrl,
                path: pathInsideRepo(workflowDir),
                sha: preflight.git.headSha,
            };
            let entryText;
            if (entryExists) {
                entryText = repinEntryText(readFileSync(join(entryDir, 'entry.yaml'), 'utf-8'), pin);
            }
            else {
                entryText = scaffoldEntryText({
                    id: preflight.id,
                    summary: summaryField.trim() || 'TODO: one line, max 140 chars.',
                    author: authorField.trim() || 'TODO',
                    license: preflight.licenseName || 'TODO',
                    pin,
                });
            }
            mkdirSync(entryDir, { recursive: true });
            writeEntryFiles(entryDir, entryText, pack.lockText);
            const v = validateCatalogCheckout(resolve(catalogRoot));
            const lines = [
                `wrote ${join(entryDir, 'entry.yaml')}${entryExists ? ' (source re-pinned; your prose untouched)' : ' (scaffold — finish the TODO fields)'}`,
                `wrote ${join(entryDir, 'entry.lock.yaml')} (generated — never edit)`,
                v.ran ? `validate-entries: ${v.ok ? 'PASS' : 'FAIL'}` : 'validate-entries: not present in the checkout',
                ...(v.output !== '' ? v.output.split('\n').slice(-6) : []),
            ];
            setWriteResult({ ok: v.ok, lines });
            setScreen('done');
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    };
    useInput((_input, key) => {
        if (!key.escape)
            return;
        if (screen === 'custom-path') {
            setEditing(false);
            setScreen('project');
        }
        else if (screen === 'entry-dir') {
            setCatalogEditing(false);
            setScreen('pack');
        }
        else if (screen === 'entry-fields') {
            setEditing(false);
            onClose();
        }
    }, { isActive: active && (editing || catalogEditing) });
    useInput((input, key) => {
        if (editing || catalogEditing)
            return;
        if (key.escape) {
            onClose();
            return;
        }
        if (screen === 'project') {
            const total = projects.length + 1;
            if (key.downArrow || input === 'j')
                setFocusIdx((i) => Math.min(i + 1, total - 1));
            else if (key.upArrow || input === 'k')
                setFocusIdx((i) => Math.max(i - 1, 0));
            else if (key.return) {
                if (focusIdx === projects.length) {
                    setEditing(true);
                    setScreen('custom-path');
                }
                else {
                    const p = projects[focusIdx];
                    if (p) {
                        const groups = listProjectWorkflows(p.path);
                        setWorkflows(groups.flatMap((g) => g.workflows));
                        setScreen('workflow');
                        setFocusIdx(0);
                    }
                }
            }
            return;
        }
        if (screen === 'workflow') {
            if (key.downArrow || input === 'j')
                setFocusIdx((i) => Math.min(i + 1, Math.max(0, workflows.length - 1)));
            else if (key.upArrow || input === 'k')
                setFocusIdx((i) => Math.max(i - 1, 0));
            else if (key.return) {
                const w = workflows[focusIdx];
                if (w)
                    enterWorkflowDir(dirname(w.path));
            }
            else if (input === 'b') {
                setScreen('project');
                setFocusIdx(0);
            }
            return;
        }
        if (screen === 'preflight') {
            if (key.return && preflight !== null && !preflight.blocked)
                runPack();
            else if (input === 'b') {
                setScreen('project');
                setFocusIdx(0);
            }
            return;
        }
        if (screen === 'pack') {
            if (key.return) {
                setCatalogEditing(true);
                setScreen('entry-dir');
            }
            return;
        }
        if (screen === 'entry-fields') {
            return;
        }
        if (screen === 'write') {
            if (key.return)
                doWrite();
            return;
        }
        if (screen === 'done') {
            if (input === 'r' && entryDir !== '')
                onRehearse(entryDir);
            else if (key.return)
                onClose();
        }
    }, { isActive: active && !editing && !catalogEditing });
    if (!active)
        return _jsx(Box, {});
    const head = (label) => (_jsxs(Text, { bold: true, color: theme.brand, children: ["Publish my workflow \u2014 ", label] }));
    const cmd = (c) => (_jsxs(Text, { color: theme.hint, children: ["  (the CLI form: ", c, ")"] }));
    const err = error !== '' ? _jsx(Alert, { variant: "error", children: error }) : null;
    if (screen === 'project') {
        return (_jsxs(Box, { flexDirection: "column", children: [head('pick the source'), _jsx(Text, { color: theme.muted, children: "A registered riglane project, or a custom path (e.g. a public-repo checkout)." }), _jsxs(Box, { marginTop: 1, flexDirection: "column", children: [projects.map((p, i) => (_jsxs(Box, { children: [_jsxs(Text, { ...(i === focusIdx ? { color: theme.brand } : {}), children: [i === focusIdx ? CURSOR : ' ', " "] }), _jsx(Text, { bold: i === focusIdx, children: p.slug }), _jsxs(Text, { color: theme.hint, children: [" \u2014 ", p.path] })] }, p.path))), _jsxs(Box, { children: [_jsxs(Text, { ...(focusIdx === projects.length ? { color: theme.brand } : {}), children: [focusIdx === projects.length ? CURSOR : ' ', ' '] }), _jsx(Text, { bold: focusIdx === projects.length, children: "Custom path\u2026" }), _jsxs(Text, { color: theme.hint, children: [" \u2014 a directory holding ", '<id>', "/workflow.yaml"] })] })] }), _jsx(Box, { marginTop: 1, children: _jsx(Text, { color: theme.hint, children: "enter select \u00B7 esc close" }) }), err] }));
    }
    if (screen === 'custom-path') {
        return (_jsxs(Box, { flexDirection: "column", children: [head('the workflow directory'), _jsx(Text, { color: theme.muted, children: "The directory that holds workflow.yaml \u2014 its NAME becomes the entry id, and its git checkout provides the pin." }), _jsxs(Box, { marginTop: 1, children: [_jsx(Text, { color: theme.brand, children: "dir: " }), editing ? (_jsx(TextInput, { defaultValue: customPath, onChange: setCustomPath, onSubmit: (v) => {
                                setEditing(false);
                                const p = v.trim();
                                if (p === '') {
                                    setScreen('project');
                                    return;
                                }
                                if (!existsSync(join(p, 'workflow.yaml'))) {
                                    setError(`no workflow.yaml in ${p}`);
                                    setScreen('project');
                                    return;
                                }
                                enterWorkflowDir(p);
                            } })) : (_jsx(Text, { children: customPath }))] }), err] }));
    }
    if (screen === 'preflight' && preflight !== null) {
        return (_jsxs(Box, { flexDirection: "column", children: [head(`preflight · ${preflight.id}`), _jsx(Text, { color: theme.muted, children: workflowDir }), _jsx(Box, { marginTop: 1, flexDirection: "column", children: preflight.rows.map((r) => (_jsxs(Box, { children: [_jsx(Text, { color: r.status === 'ok' ? theme.success : r.status === 'warn' ? theme.warning : theme.danger, children: r.status === 'ok' ? ' ✓ ' : r.status === 'warn' ? ' ⚠ ' : ' ✗ ' }), _jsx(Text, { children: r.label }), r.detail !== '' ? _jsxs(Text, { color: theme.hint, children: [" \u2014 ", r.detail] }) : null] }, r.label))) }), _jsx(Box, { marginTop: 1, children: preflight.blocked ? (_jsx(Text, { color: theme.danger, children: "Fix the \u2717 rows first \u2014 each is something the catalog CI or `riglane add` would refuse." })) : (_jsx(Text, { color: theme.hint, children: "enter continue (pack the lock) \u00B7 b back \u00B7 esc close" })) }), err] }));
    }
    if (screen === 'pack' && pack !== null && preflight !== null) {
        return (_jsxs(Box, { flexDirection: "column", children: [head('the capability lock'), cmd(`riglane catalog pack ${preflight.id} --out entry.lock.yaml`), _jsxs(Box, { marginTop: 1, flexDirection: "column", children: [_jsx(Text, { children: pack.summary }), _jsxs(Text, { children: ["trust level (derived, never granted):", ' ', _jsx(Text, { bold: true, color: pack.level === 'verified' ? theme.success : theme.warning, children: pack.level }), pack.level === 'community' ? ' — it declares shell surface, so it installs switched off' : ' — zero shell surface'] }), _jsxs(Text, { color: theme.muted, children: ["pinned commit: ", preflight.git.headSha.slice(0, 12), "\u2026 \u00B7 the lock describes exactly this tree; CI regenerates and byte-compares it."] }), pack.fromCommit ? (_jsx(Text, { color: theme.muted, children: "packed from HEAD's committed bytes (git archive) \u2014 line endings match what CI will fetch." })) : (_jsx(Text, { color: theme.warning, children: "\u26A0 packed from the WORKING TREE (git archive unavailable) \u2014 on Windows a CRLF checkout can fail CI's byte-compare; pack from a clean LF checkout if the PR is refused." }))] }), _jsx(Box, { marginTop: 1, children: _jsx(Text, { color: theme.hint, children: "enter continue (the catalog entry) \u00B7 esc close" }) }), err] }));
    }
    if (screen === 'entry-dir') {
        return (_jsxs(Box, { flexDirection: "column", children: [head('the catalog checkout'), _jsxs(Text, { color: theme.muted, children: ["The ROOT of your catalog clone \u2014 the directory that holds catalog/ (and usually scripts/validate-entries.mjs). The entry lands in catalog/", preflight?.id ?? '<id>', "/ there."] }), _jsx(Text, { color: theme.hint, children: "e.g. E:\\projects\\riglane-catalog \u2014 your fork clone, where you will commit and open the PR from." }), _jsxs(Box, { marginTop: 1, children: [_jsx(Text, { color: theme.brand, children: "catalog: " }), catalogEditing ? (_jsx(TextInput, { defaultValue: catalogRoot, onChange: setCatalogRoot, onSubmit: (v) => {
                                const p = v.trim();
                                if (p === '' || !existsSync(p)) {
                                    setError(p === '' ? 'a path is needed' : `${p} does not exist`);
                                    return;
                                }
                                setError('');
                                setCatalogEditing(false);
                                const dir = join(resolve(p), 'catalog', preflight?.id ?? '');
                                const exists = existsSync(join(dir, 'entry.yaml'));
                                setEntryExists(exists);
                                setScreen(exists ? 'write' : 'entry-fields');
                                setFieldFocus('summary');
                                setEditing(!exists);
                            } })) : (_jsx(Text, { children: catalogRoot }))] }), _jsx(Box, { marginTop: 1, children: _jsx(Text, { color: theme.hint, children: "enter continue \u00B7 esc back" }) }), err] }));
    }
    if (screen === 'entry-fields') {
        return (_jsxs(Box, { flexDirection: "column", children: [head('the human half of the entry'), _jsxs(Text, { color: theme.muted, children: ["No entry.yaml yet at catalog/", preflight?.id, "/ \u2014 a scaffold will be written. Two fields are yours; description stays a TODO for your editor (it deserves more than a TUI line)."] }), _jsxs(Box, { marginTop: 1, children: [_jsx(Text, { color: theme.brand, children: "summary (\u2264140): " }), fieldFocus === 'summary' && editing ? (_jsx(TextInput, { defaultValue: summaryField, onChange: setSummaryField, onSubmit: () => setFieldFocus('author') })) : (_jsx(Text, { children: summaryField }))] }), _jsxs(Box, { children: [_jsx(Text, { color: theme.brand, children: "author: " }), fieldFocus === 'author' && editing ? (_jsx(TextInput, { defaultValue: authorField, onChange: setAuthorField, onSubmit: () => {
                                setEditing(false);
                                setScreen('write');
                            } })) : (_jsx(Text, { children: authorField }))] }), err] }));
    }
    if (screen === 'write' && preflight !== null) {
        return (_jsxs(Box, { flexDirection: "column", children: [head('write the two files'), _jsxs(Box, { marginTop: 1, flexDirection: "column", children: [_jsx(Text, { children: entryExists
                                ? `entry.yaml exists — only its source: block is re-pinned (repo, path, sha); your prose is untouched.`
                                : `a fresh entry.yaml scaffold + the generated lock will be written.` }), _jsxs(Text, { color: theme.muted, children: ["target: ", entryDir] }), _jsxs(Text, { color: theme.muted, children: ["pin: ", preflight.git.remoteUrl, " @ ", preflight.git.headSha.slice(0, 12), "\u2026 \u00B7 path:", ' ', pathInsideRepo(workflowDir) || "'' (repo root)"] })] }), _jsx(Box, { marginTop: 1, children: _jsx(Text, { color: theme.hint, children: "enter write + validate \u00B7 esc close" }) }), err] }));
    }
    if (screen === 'done' && writeResult !== null) {
        return (_jsxs(Box, { flexDirection: "column", children: [head(writeResult.ok ? 'written — what remains is yours' : 'written, but validation failed'), _jsx(Box, { marginTop: 1, flexDirection: "column", children: writeResult.lines.map((l, i) => (_jsx(Text, { ...(i < 2 ? {} : { color: theme.muted }), children: l }, i))) }), _jsxs(Box, { marginTop: 1, flexDirection: "column", children: [_jsx(Text, { bold: true, children: "The steps a UI cannot honestly do for you:" }), _jsx(Text, { children: " 1. Review the entry (finish any TODO fields), commit it in the catalog checkout." }), _jsx(Text, { children: " 2. Fork the catalog repository and push the branch there." }), _jsx(Text, { children: " 3. Open the pull request \u2014 CI refetches your pin and byte-compares the lock." })] }), _jsx(Box, { marginTop: 1, children: _jsxs(Text, { color: theme.hint, children: ["(r) rehearse the install now \u2014 the canonical `riglane add ", '<entry-dir>', "` flow \u00B7 enter close"] }) }), err] }));
    }
    return _jsx(Box, {});
}
