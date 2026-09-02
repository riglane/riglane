
import { Box, Text, useInput } from 'ink';
import { Alert, TextInput } from '@inkjs/ui';
import { useEffect, useMemo, useState } from 'react';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import * as registry from '../../registry/registry.js';
import { PRODUCT_DIR } from '../../config/paths.js';
import { listProjectWorkflows, type WorkflowEntry } from './workflowRun.js';
import {
  type PackResult,
  type PreflightReport,
  packLock,
  pathInsideRepo,
  repinEntryText,
  runPreflight,
  scaffoldEntryText,
  validateCatalogCheckout,
  writeEntryFiles,
} from './publishSteps.js';
import { CURSOR } from './theme.js';
import { useTheme } from './themeContext.js';

type Screen =
  | 'project'
  | 'workflow'
  | 'custom-path'
  | 'preflight'
  | 'pack'
  | 'entry-dir'
  | 'entry-fields'
  | 'write'
  | 'done';

interface ProjectRow {
  readonly slug: string;
  readonly path: string;
}

export function PublishWizard({
  active,
  onClose,
  onRehearse,
}: {
  active: boolean;
  onClose: () => void;
  onRehearse: (entryDir: string) => void;
}): React.JSX.Element {
  const theme = useTheme();

  const [screen, setScreen] = useState<Screen>('project');
  const [focusIdx, setFocusIdx] = useState(0);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');

  const projects = useMemo<ProjectRow[]>(() => {
    if (!active) return [];
    try {
      return registry
        .list()
        .filter((e) => existsSync(join(e.path, PRODUCT_DIR)))
        .map((e) => ({ slug: e.slug, path: e.path }));
    } catch {
      return [];
    }
  }, [active]);
  const [workflows, setWorkflows] = useState<WorkflowEntry[]>([]);
  const [customPath, setCustomPath] = useState('');
  const [workflowDir, setWorkflowDir] = useState('');

  const [preflight, setPreflight] = useState<PreflightReport | null>(null);
  const [pack, setPack] = useState<PackResult | null>(null);
  const [catalogRoot, setCatalogRoot] = useState('');
  const [catalogEditing, setCatalogEditing] = useState(false);
  const [entryExists, setEntryExists] = useState(false);
  const [summaryField, setSummaryField] = useState('');
  const [authorField, setAuthorField] = useState('');
  const [fieldFocus, setFieldFocus] = useState<'summary' | 'author'>('summary');
  const [writeResult, setWriteResult] = useState<{ ok: boolean; lines: string[] } | null>(null);

  useEffect(() => {
    if (active) return;
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

  const enterWorkflowDir = (dir: string): void => {
    setWorkflowDir(dir);
    setError('');
    const report = runPreflight(dir);
    setPreflight(report);
    setScreen('preflight');
    setFocusIdx(0);
  };

  const runPack = (): void => {
    try {
      setPack(packLock(workflowDir));
      setScreen('pack');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const entryDir = catalogRoot === '' || preflight === null ? '' : join(resolve(catalogRoot), 'catalog', preflight.id);

  const doWrite = (): void => {
    if (preflight === null || pack === null || entryDir === '') return;
    try {
      const pin = {
        repo: preflight.git.remoteUrl,
        path: pathInsideRepo(workflowDir),
        sha: preflight.git.headSha,
      };
      let entryText: string;
      if (entryExists) {
        entryText = repinEntryText(readFileSync(join(entryDir, 'entry.yaml'), 'utf-8'), pin);
      } else {
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useInput(
    (_input, key) => {
      if (!key.escape) return;
      if (screen === 'custom-path') {
        setEditing(false);
        setScreen('project');
      } else if (screen === 'entry-dir') {
        setCatalogEditing(false);
        setScreen('pack');
      } else if (screen === 'entry-fields') {
        setEditing(false);
        onClose();
      }
    },
    { isActive: active && (editing || catalogEditing) },
  );

  useInput(
    (input, key) => {
      if (editing || catalogEditing) return;
      if (key.escape) {
        onClose();
        return;
      }
      if (screen === 'project') {
        const total = projects.length + 1;
        if (key.downArrow || input === 'j') setFocusIdx((i) => Math.min(i + 1, total - 1));
        else if (key.upArrow || input === 'k') setFocusIdx((i) => Math.max(i - 1, 0));
        else if (key.return) {
          if (focusIdx === projects.length) {
            setEditing(true);
            setScreen('custom-path');
          } else {
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
        if (key.downArrow || input === 'j') setFocusIdx((i) => Math.min(i + 1, Math.max(0, workflows.length - 1)));
        else if (key.upArrow || input === 'k') setFocusIdx((i) => Math.max(i - 1, 0));
        else if (key.return) {
          const w = workflows[focusIdx];
          if (w) enterWorkflowDir(dirname(w.path));
        } else if (input === 'b') {
          setScreen('project');
          setFocusIdx(0);
        }
        return;
      }
      if (screen === 'preflight') {
        if (key.return && preflight !== null && !preflight.blocked) runPack();
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
        if (key.return) doWrite();
        return;
      }
      if (screen === 'done') {
        if (input === 'r' && entryDir !== '') onRehearse(entryDir);
        else if (key.return) onClose();
      }
    },
    { isActive: active && !editing && !catalogEditing },
  );

  if (!active) return <Box />;

  const head = (label: string): React.JSX.Element => (
    <Text bold color={theme.brand}>
      Publish my workflow — {label}
    </Text>
  );
  const cmd = (c: string): React.JSX.Element => (
    <Text color={theme.hint}>  (the CLI form: {c})</Text>
  );
  const err = error !== '' ? <Alert variant="error">{error}</Alert> : null;

  if (screen === 'project') {
    return (
      <Box flexDirection="column">
        {head('pick the source')}
        <Text color={theme.muted}>A registered riglane project, or a custom path (e.g. a public-repo checkout).</Text>
        <Box marginTop={1} flexDirection="column">
          {projects.map((p, i) => (
            <Box key={p.path}>
              <Text {...(i === focusIdx ? { color: theme.brand } : {})}>{i === focusIdx ? CURSOR : ' '} </Text>
              <Text bold={i === focusIdx}>{p.slug}</Text>
              <Text color={theme.hint}> — {p.path}</Text>
            </Box>
          ))}
          <Box>
            <Text {...(focusIdx === projects.length ? { color: theme.brand } : {})}>
              {focusIdx === projects.length ? CURSOR : ' '}{' '}
            </Text>
            <Text bold={focusIdx === projects.length}>Custom path…</Text>
            <Text color={theme.hint}> — a directory holding {'<id>'}/workflow.yaml</Text>
          </Box>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.hint}>enter select · esc close</Text>
        </Box>
        {err}
      </Box>
    );
  }

  if (screen === 'custom-path') {
    return (
      <Box flexDirection="column">
        {head('the workflow directory')}
        <Text color={theme.muted}>
          The directory that holds workflow.yaml — its NAME becomes the entry id, and its git checkout
          provides the pin.
        </Text>
        <Box marginTop={1}>
          <Text color={theme.brand}>dir: </Text>
          {editing ? (
            <TextInput
              defaultValue={customPath}
              onChange={setCustomPath}
              onSubmit={(v) => {
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
              }}
            />
          ) : (
            <Text>{customPath}</Text>
          )}
        </Box>
        {err}
      </Box>
    );
  }

  if (screen === 'preflight' && preflight !== null) {
    return (
      <Box flexDirection="column">
        {head(`preflight · ${preflight.id}`)}
        <Text color={theme.muted}>{workflowDir}</Text>
        <Box marginTop={1} flexDirection="column">
          {preflight.rows.map((r) => (
            <Box key={r.label}>
              <Text color={r.status === 'ok' ? theme.success : r.status === 'warn' ? theme.warning : theme.danger}>
                {r.status === 'ok' ? ' ✓ ' : r.status === 'warn' ? ' ⚠ ' : ' ✗ '}
              </Text>
              <Text>{r.label}</Text>
              {r.detail !== '' ? <Text color={theme.hint}> — {r.detail}</Text> : null}
            </Box>
          ))}
        </Box>
        <Box marginTop={1}>
          {preflight.blocked ? (
            <Text color={theme.danger}>Fix the ✗ rows first — each is something the catalog CI or `riglane add` would refuse.</Text>
          ) : (
            <Text color={theme.hint}>enter continue (pack the lock) · b back · esc close</Text>
          )}
        </Box>
        {err}
      </Box>
    );
  }

  if (screen === 'pack' && pack !== null && preflight !== null) {
    return (
      <Box flexDirection="column">
        {head('the capability lock')}
        {cmd(`riglane catalog pack ${preflight.id} --out entry.lock.yaml`)}
        <Box marginTop={1} flexDirection="column">
          <Text>{pack.summary}</Text>
          <Text>
            trust level (derived, never granted):{' '}
            <Text bold color={pack.level === 'verified' ? theme.success : theme.warning}>
              {pack.level}
            </Text>
            {pack.level === 'community' ? ' — it declares shell surface, so it installs switched off' : ' — zero shell surface'}
          </Text>
          <Text color={theme.muted}>
            pinned commit: {preflight.git.headSha.slice(0, 12)}… · the lock describes exactly this tree; CI
            regenerates and byte-compares it.
          </Text>
          {pack.fromCommit ? (
            <Text color={theme.muted}>
              packed from HEAD&apos;s committed bytes (git archive) — line endings match what CI will fetch.
            </Text>
          ) : (
            <Text color={theme.warning}>
              ⚠ packed from the WORKING TREE (git archive unavailable) — on Windows a CRLF checkout can
              fail CI&apos;s byte-compare; pack from a clean LF checkout if the PR is refused.
            </Text>
          )}
        </Box>
        <Box marginTop={1}>
          <Text color={theme.hint}>enter continue (the catalog entry) · esc close</Text>
        </Box>
        {err}
      </Box>
    );
  }

  if (screen === 'entry-dir') {
    return (
      <Box flexDirection="column">
        {head('the catalog checkout')}
        <Text color={theme.muted}>
          The ROOT of your catalog clone — the directory that holds catalog/ (and usually
          scripts/validate-entries.mjs). The entry lands in catalog/{preflight?.id ?? '<id>'}/ there.
        </Text>
        <Text color={theme.hint}>
          e.g. E:\projects\riglane-catalog — your fork clone, where you will commit and open the PR from.
        </Text>
        <Box marginTop={1}>
          <Text color={theme.brand}>catalog: </Text>
          {catalogEditing ? (
            <TextInput
              defaultValue={catalogRoot}
              onChange={setCatalogRoot}
              onSubmit={(v) => {
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
              }}
            />
          ) : (
            <Text>{catalogRoot}</Text>
          )}
        </Box>
        <Box marginTop={1}>
          <Text color={theme.hint}>enter continue · esc back</Text>
        </Box>
        {err}
      </Box>
    );
  }

  if (screen === 'entry-fields') {
    return (
      <Box flexDirection="column">
        {head('the human half of the entry')}
        <Text color={theme.muted}>
          No entry.yaml yet at catalog/{preflight?.id}/ — a scaffold will be written. Two fields are yours;
          description stays a TODO for your editor (it deserves more than a TUI line).
        </Text>
        <Box marginTop={1}>
          <Text color={theme.brand}>summary (≤140): </Text>
          {fieldFocus === 'summary' && editing ? (
            <TextInput
              defaultValue={summaryField}
              onChange={setSummaryField}
              onSubmit={() => setFieldFocus('author')}
            />
          ) : (
            <Text>{summaryField}</Text>
          )}
        </Box>
        <Box>
          <Text color={theme.brand}>author: </Text>
          {fieldFocus === 'author' && editing ? (
            <TextInput
              defaultValue={authorField}
              onChange={setAuthorField}
              onSubmit={() => {
                setEditing(false);
                setScreen('write');
              }}
            />
          ) : (
            <Text>{authorField}</Text>
          )}
        </Box>
        {err}
      </Box>
    );
  }

  if (screen === 'write' && preflight !== null) {
    return (
      <Box flexDirection="column">
        {head('write the two files')}
        <Box marginTop={1} flexDirection="column">
          <Text>
            {entryExists
              ? `entry.yaml exists — only its source: block is re-pinned (repo, path, sha); your prose is untouched.`
              : `a fresh entry.yaml scaffold + the generated lock will be written.`}
          </Text>
          <Text color={theme.muted}>target: {entryDir}</Text>
          <Text color={theme.muted}>
            pin: {preflight.git.remoteUrl} @ {preflight.git.headSha.slice(0, 12)}… · path:{' '}
            {pathInsideRepo(workflowDir) || "'' (repo root)"}
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.hint}>enter write + validate · esc close</Text>
        </Box>
        {err}
      </Box>
    );
  }

  if (screen === 'done' && writeResult !== null) {
    return (
      <Box flexDirection="column">
        {head(writeResult.ok ? 'written — what remains is yours' : 'written, but validation failed')}
        <Box marginTop={1} flexDirection="column">
          {writeResult.lines.map((l, i) => (
            <Text key={i} {...(i < 2 ? {} : { color: theme.muted })}>
              {l}
            </Text>
          ))}
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text bold>The steps a UI cannot honestly do for you:</Text>
          <Text> 1. Review the entry (finish any TODO fields), commit it in the catalog checkout.</Text>
          <Text> 2. Fork the catalog repository and push the branch there.</Text>
          <Text> 3. Open the pull request — CI refetches your pin and byte-compares the lock.</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.hint}>
            (r) rehearse the install now — the canonical `riglane add {'<entry-dir>'}` flow · enter close
          </Text>
        </Box>
        {err}
      </Box>
    );
  }

  return <Box />;
}
