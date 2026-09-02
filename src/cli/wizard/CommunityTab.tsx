
import { Box, Text, useInput } from 'ink';
import { Alert, Spinner, TextInput } from '@inkjs/ui';
import { useEffect, useMemo, useState } from 'react';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

import {
  type CatalogEntry,
  type CatalogIndexRow,
  EntryError,
  catalogEntryUrl,
  catalogIndexUrl,
  validateCatalogIndex,
  validatePerEntryDocument,
} from '../../catalog/entry.js';
import { catalogBaseUrl } from '../../config/config.js';
import { defaultPaths } from '../../engine/workflow-engine.js';
import * as registry from '../../registry/registry.js';
import { PRODUCT_DIR } from '../../config/paths.js';
import { PublishWizard } from './PublishWizard.js';
import { windowAround, useViewportRows, MoreRow } from './viewport.js';
import { CURSOR } from './theme.js';
import { useTheme } from './themeContext.js';

export interface CommunityCliTask {
  readonly kind: 'add' | 'trust' | 'init' | 'update';
  readonly id: string;
  readonly wfId: string;
  readonly entryDir?: string;
  readonly cwd: string;
}

export interface CommunityPostStep {
  readonly stage: 'trust' | 'init' | 'restart';
  readonly wfId: string;
  readonly cwd: string;
}

async function fetchJson(url: string): Promise<unknown | null> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new EntryError(`cannot reach the catalog at ${url}: ${msg}`);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new EntryError(`catalog request failed: ${url} → HTTP ${res.status}`);
  return (await res.json()) as unknown;
}

function rowMatches(r: CatalogIndexRow, q: string): boolean {
  if (r.id.toLowerCase().includes(q) || r.summary.toLowerCase().includes(q)) return true;
  for (const t of r.tags ?? []) if (t.toLowerCase().includes(q)) return true;
  for (const c of r.categories ?? []) if (c.toLowerCase().includes(q)) return true;
  return false;
}

function basenameOf(idOrPath: string): string {
  return idOrPath.includes('/') || idOrPath.includes('\\') ? basename(idOrPath) : idOrPath;
}

function scanInstalled(): Array<{ id: string; project: string; projectPath: string; trusted: boolean }> {
  const rows = [];
  try {
    for (const e of registry.list()) {
      if (!existsSync(join(e.path, PRODUCT_DIR))) continue;
      let communityDir = '';
      try {
        communityDir = defaultPaths(e.path).communityDir;
      } catch {
        continue;
      }
      if (!existsSync(communityDir)) continue;
      let trustedIds = new Set<string>();
      try {
        const t = JSON.parse(
          readFileSync(join(e.path, PRODUCT_DIR, 'local', 'trusted.json'), 'utf-8'),
        ) as { workflows?: Record<string, unknown> };
        trustedIds = new Set(Object.keys(t.workflows ?? {}));
      } catch {
      }
      for (const d of readdirSync(communityDir, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        rows.push({ id: d.name, project: e.slug, projectPath: e.path, trusted: trustedIds.has(d.name) });
      }
    }
  } catch {
  }
  return rows.sort((a, b) => a.id.localeCompare(b.id) || a.project.localeCompare(b.project));
}

function installedDirFor(id: string, projectDir?: string): string {
  try {
    const dir = join(defaultPaths(projectDir).communityDir, id);
    return existsSync(dir) ? dir : '';
  } catch {
    return '';
  }
}

export function CommunityTab({
  active,
  onCaptureChange,
  onCliTask,
  post,
}: {
  active: boolean;
  onCaptureChange: (capturing: boolean) => void;
  onCliTask: (task: CommunityCliTask) => void;
  post?: CommunityPostStep;
}): React.JSX.Element {
  const theme = useTheme();
  const vpRows = useViewportRows();

  const [rows, setRows] = useState<readonly CatalogIndexRow[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [reloadTick, setReloadTick] = useState(0);
  const [filter, setFilter] = useState('');
  const [filterEditing, setFilterEditing] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);

  const [detailId, setDetailId] = useState('');
  const [detailEntry, setDetailEntry] = useState<CatalogEntry | null>(null);
  const [detailError, setDetailError] = useState('');

  const [localEditing, setLocalEditing] = useState(false);
  const [localMode, setLocalMode] = useState<'add' | 'update' | 'trust'>('add');
  const [localPath, setLocalPath] = useState('');

  const [publishing, setPublishing] = useState(false);

  const [postStep, setPostStep] = useState<CommunityPostStep | null>(post ?? null);

  const [pendingTask, setPendingTask] = useState<{ kind: 'add' | 'trust' | 'update'; id: string } | null>(null);
  const [pickIdx, setPickIdx] = useState(0);
  const projects = useMemo(() => {
    if (pendingTask === null) return [] as Array<{ slug: string; path: string }>;
    try {
      const fromRegistry = registry
        .list()
        .filter((e) => existsSync(join(e.path, PRODUCT_DIR)))
        .map((e) => ({ slug: e.slug, path: e.path }));
      return fromRegistry;
    } catch {
      return [];
    }
  }, [pendingTask]);
  const requestTask = (kind: 'add' | 'trust' | 'update', id: string): void => {
    setPendingTask({ kind, id });
    setPickIdx(0);
  };

  useEffect(() => {
    if (!active || (rows !== null && reloadTick === 0)) return;
    let stale = false;
    setLoadError('');
    setRows(null);
    void (async () => {
      try {
        const raw = await fetchJson(catalogIndexUrl(catalogBaseUrl()));
        if (stale) return;
        if (raw === null) {
          setLoadError('The catalog has no index — is the base URL right?');
          setRows([]);
          return;
        }
        setRows(validateCatalogIndex(raw).entries);
      } catch (e) {
        if (stale) return;
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
    if (detailId === '') return;
    let stale = false;
    setDetailEntry(null);
    setDetailError('');
    void (async () => {
      try {
        const raw = await fetchJson(catalogEntryUrl(catalogBaseUrl(), detailId));
        if (stale) return;
        if (raw === null) {
          setDetailError(`No catalog entry '${detailId}' — the index may be ahead of the entries.`);
          return;
        }
        setDetailEntry(validatePerEntryDocument(raw, detailId).entry);
      } catch (e) {
        if (stale) return;
        setDetailError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      stale = true;
    };
  }, [detailId]);

  useEffect(() => {
    onCaptureChange(
      active &&
        (filterEditing || localEditing || publishing || pendingTask !== null || postStep !== null || detailId !== ''),
    );
  }, [active, filterEditing, localEditing, publishing, pendingTask, postStep, detailId, onCaptureChange]);

  useInput(
    (input, key) => {
      if (postStep === null) return;
      if (key.escape || input === 'q') {
        setPostStep(null);
        return;
      }
      if (postStep.stage === 'restart') {
        if (key.return) setPostStep(null);
        return;
      }
      if (key.return || (postStep.stage === 'trust' && input === 't') || (postStep.stage === 'init' && input === 'i')) {
        const t = postStep;
        setPostStep(null);
        onCliTask({ kind: t.stage === 'trust' ? 'trust' : 'init', id: t.wfId, wfId: t.wfId, cwd: t.cwd });
      }
    },
    { isActive: active && postStep !== null && pendingTask === null && !publishing },
  );

  useInput(
    (input, key) => {
      if (key.escape || input === 'q') {
        setPendingTask(null);
        return;
      }
      if (key.downArrow || input === 'j') setPickIdx((i) => Math.min(i + 1, Math.max(0, projects.length - 1)));
      else if (key.upArrow || input === 'k') setPickIdx((i) => Math.max(i - 1, 0));
      else if (key.return && pendingTask !== null && projects.length > 0) {
        const p = projects[Math.min(pickIdx, projects.length - 1)];
        if (p) {
          const t = pendingTask;
          setPendingTask(null);
          const wfId = basenameOf(t.id);
          onCliTask(
            t.kind === 'update'
              ? { kind: 'update', id: wfId, wfId, entryDir: t.id, cwd: p.path }
              : { ...t, wfId, cwd: p.path },
          );
        }
      }
    },
    { isActive: active && pendingTask !== null },
  );

  const installed = useMemo(() => (active ? scanInstalled() : []), [active, reloadTick, postStep]);

  const q = filter.trim().toLowerCase();
  const matches = useMemo(
    () => (rows === null ? [] : q === '' ? rows : rows.filter((r) => rowMatches(r, q))),
    [rows, q],
  );
  const clampedIdx = Math.min(focusIdx, Math.max(0, matches.length - 1));
  const detailInstalledDir = detailId === '' ? '' : installedDirFor(detailId);

  useInput(
    (input, key) => {
      if (filterEditing || localEditing || publishing || pendingTask !== null || postStep !== null) return;
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
        if (row) setDetailId(row.id);
      }
    },
    { isActive: active && !filterEditing },
  );

  useInput(
    (_input, key) => {
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
    },
    { isActive: active && filterEditing },
  );

  useInput(
    (_input, key) => {
      if (key.return) {
        const p = localPath.trim();
        setLocalEditing(false);
        setLocalPath('');
        if (p !== '') requestTask(localMode, p);
        return;
      }
      if (key.escape) {
        setLocalEditing(false);
        setLocalPath('');
      }
    },
    { isActive: active && localEditing },
  );

  if (!active) return <Box />;

  const tGap = vpRows <= 12 ? 0 : 1;

  if (postStep !== null) {
    const projName = basename(postStep.cwd);
    return (
      <Box flexDirection="column">
        <Text bold color={theme.brand}>
          {postStep.stage === 'trust'
            ? `Installed into ${projName} — switched off`
            : postStep.stage === 'init'
              ? `Trusted in ${projName}`
              : `Ready in ${projName}`}
        </Text>
        {postStep.stage === 'trust' ? (
          <Box marginTop={tGap} flexDirection="column">
            <Text color={theme.muted}>
              {postStep.wfId} is installed — its files are in your project, and nothing has run.
            </Text>
            <Box marginTop={tGap}>
              <Text color={theme.muted}>
                Next comes trust: a short review of what this workflow can actually execute on your
                machine — its script commands, and which of them read your environment or reach the
                network. Installing said &quot;put it on disk&quot;; trusting says &quot;this may run here&quot;. Those
                are different decisions, so each one is yours to make, and the engine keeps the
                workflow switched off until the second one. You confirm by typing the workflow&apos;s
                name — proof you saw the list, not a reflex &quot;y&quot;.
              </Text>
            </Box>
            <Box marginTop={tGap}>
              <Text color={theme.hint}>Press enter to continue to trust · esc — later (it stays installed, just off)</Text>
            </Box>
          </Box>
        ) : postStep.stage === 'init' ? (
          <Box marginTop={tGap} flexDirection="column">
            <Text color={theme.muted}>
              {postStep.wfId} is trusted — it may run in {projName} now.
            </Text>
            <Box marginTop={tGap}>
              <Text color={theme.muted}>
                One preparation step left: this workflow declares script tools, and each step&apos;s
                agent gets a file whitelisting exactly the tools that step may call. Generating
                those files now is what makes the whitelist real at run time.
              </Text>
            </Box>
            <Box marginTop={tGap}>
              <Text color={theme.hint}>Press enter to generate the step agents · esc later</Text>
            </Box>
          </Box>
        ) : (
          <Box marginTop={tGap} flexDirection="column">
            <Text color={theme.muted}>
              {postStep.wfId} is trusted and initialized — everything on disk is ready.
            </Text>
            <Box marginTop={tGap}>
              <Text color={theme.muted}>
                Last step, and the one thing this screen cannot do for you: restart your agent host
                in {postStep.cwd}. Hosts read the workflow&apos;s tools once, at startup — after the
                restart, start a run and enjoy.
              </Text>
            </Box>
            <Box marginTop={tGap}>
              <Text color={theme.hint}>enter close</Text>
            </Box>
          </Box>
        )}
      </Box>
    );
  }

  if (pendingTask !== null) {
    const verb = pendingTask.kind === 'add' ? 'Install' : pendingTask.kind === 'trust' ? 'Trust' : 'Update';
    return (
      <Box flexDirection="column">
        <Text bold color={theme.brand}>
          {verb} — pick the target project
        </Text>
        <Text color={theme.muted}>
          Installs and trust grants are PER-PROJECT: the workflow lands in (and runs in) exactly the
          project you choose here.
        </Text>
        <Box marginTop={tGap} flexDirection="column">
          {projects.length === 0 ? (
            <Text color={theme.warning}>
              No riglane projects in the registry — run `riglane init {'<path>'}` first (Projects tab).
            </Text>
          ) : (
            projects.map((p, i) => {
              const focused = i === Math.min(pickIdx, projects.length - 1);
              const has = pendingTask.kind === 'trust' || installedDirFor(basenameOf(pendingTask.id), p.path) !== '';
              return (
                <Box key={p.path}>
                  <Text {...(focused ? { color: theme.brand } : {})}>{focused ? CURSOR : ' '} </Text>
                  <Text bold={focused}>{p.slug}</Text>
                  {pendingTask.kind === 'add' && has ? (
                    <Text color={theme.success}> ✓ already installed</Text>
                  ) : null}
                  <Text color={theme.hint}> — {p.path}</Text>
                </Box>
              );
            })
          )}
        </Box>
        <Box marginTop={tGap}>
          <Text color={theme.hint}>enter choose · esc cancel</Text>
        </Box>
      </Box>
    );
  }

  if (publishing) {
    return (
      <PublishWizard
        active={publishing}
        onClose={() => setPublishing(false)}
        onRehearse={(entryDir: string) => {
          setPublishing(false);
          requestTask('add', entryDir);
        }}
      />
    );
  }

  if (detailId !== '') {
    const row = (rows ?? []).find((r) => r.id === detailId);
    const meta = (detailEntry?.meta ?? {}) as Record<string, unknown>;
    const str = (k: string): string => (typeof meta[k] === 'string' ? (meta[k] as string) : '');
    return (
      <Box flexDirection="column">
        <Text bold color={theme.brand}>
          {detailId}
        </Text>
        {row ? (
          <Text color={theme.muted}>
            [{row.level}] {row.script_tools === 0 && row.deciders === 0
              ? 'no shell surface'
              : `script tools: ${row.script_tools} · deciders: ${row.deciders}`}
            {row.author !== undefined ? ` · by ${row.author}` : ''}
          </Text>
        ) : null}
        {detailEntry === null && detailError === '' ? (
          <Box marginTop={tGap}>
            <Spinner label="Fetching the entry…" />
          </Box>
        ) : null}
        {detailError !== '' ? (
          <Box marginTop={tGap}>
            <Alert variant="error">{detailError}</Alert>
          </Box>
        ) : null}
        {detailEntry !== null ? (
          <Box marginTop={tGap} flexDirection="column">
            {str('summary') !== '' ? <Text>{str('summary')}</Text> : null}
            {str('description') !== '' ? (
              <Box marginTop={tGap}>
                <Text color={theme.muted}>{str('description').trim()}</Text>
              </Box>
            ) : null}
            <Box marginTop={tGap} flexDirection="column">
              {str('license') !== '' ? <Text color={theme.muted}>license: {str('license')}</Text> : null}
              <Text color={theme.muted}>source: {detailEntry.source.repo}</Text>
              <Text color={theme.muted}>
                pinned: {detailEntry.source.sha.slice(0, 12)}… (installs stay on this commit)
              </Text>
            </Box>
          </Box>
        ) : null}
        <Box marginTop={tGap} flexDirection="column">
          {detailInstalledDir !== '' ? (
            <Text color={theme.success}>installed: {detailInstalledDir}</Text>
          ) : null}
          <Text color={theme.hint}>
            (i) install into a project — full pre-install inspection, typed-id confirm, lands SWITCHED
            OFF · (t) trust it in a project — executable-surface review, typed-id confirm · esc back
          </Text>
        </Box>
      </Box>
    );
  }

  const cap = Math.max(2, vpRows - (filterEditing || filter !== '' ? 8 : 7));
  const win = windowAround(matches.length, clampedIdx, cap);
  const idWidth = matches.length > 0 ? Math.max(...matches.map((r) => r.id.length)) : 0;
  return (
    <Box flexDirection="column">
      <Text bold color={theme.brand}>
        Community
      </Text>
      <Text color={theme.muted}>Shared workflows from the public catalog.</Text>
      {localEditing ? (
        <Box marginTop={tGap} flexDirection="column">
          <Text color={theme.brand}>
            {localMode === 'add'
              ? 'Install from a local entry directory (entry.yaml + entry.lock.yaml):'
              : localMode === 'update'
                ? 'Update an installed workflow from a local entry directory (entry.yaml + entry.lock.yaml):'
                : 'Trust an installed community workflow (by its id):'}
          </Text>
          <Text color={theme.muted}>
            {localMode === 'add'
              ? 'The pre-publish rehearsal — it fetches the pinned repo, verifies the lock byte-for-byte and shows the same inspect screen a catalog user would see.'
              : localMode === 'update'
                ? 'Moves the install to the entry’s newer pinned commit: shows the DIFF of the shell-bearing surfaces, asks for the typed id again, and DROPS the trust grant (the content changed).'
                : 'The RUN consent — a review of the executable surface in the project you pick, confirmed by typing the id. Community workflows stay switched off without it.'}
            {' '}Enter to continue · Esc to cancel.
          </Text>
          <Box>
            <Text color={theme.brand}>{localMode === 'trust' ? 'id: ' : 'dir: '}</Text>
            <TextInput defaultValue={localPath} onChange={setLocalPath} />
          </Box>
        </Box>
      ) : null}
      {filterEditing ? (
        <Box marginTop={tGap}>
          <Text color={theme.brand}>/ </Text>
          <TextInput defaultValue={filter} onChange={setFilter} onSubmit={() => setFilterEditing(false)} />
        </Box>
      ) : filter !== '' ? (
        <Box marginTop={tGap}>
          <Text color={theme.muted}>filter: {filter} (/ to edit)</Text>
        </Box>
      ) : null}
      {rows === null ? (
        <Box marginTop={tGap}>
          <Spinner label="Fetching the catalog index…" />
        </Box>
      ) : null}
      {loadError !== '' ? (
        <Box marginTop={tGap}>
          <Alert variant="error">{loadError}</Alert>
        </Box>
      ) : null}
      {rows !== null && loadError === '' && matches.length === 0 ? (
        <Box marginTop={tGap}>
          <Text color={theme.muted}>
            {q === '' ? 'The catalog is empty.' : `No catalog entries match '${filter.trim()}'.`}
          </Text>
        </Box>
      ) : null}
      {matches.length > 0 ? (
        <Box marginTop={tGap} flexDirection="column">
          <MoreRow count={win.start} dir="up" />
          {matches.slice(win.start, win.end).map((r, j) => {
            const i = win.start + j;
            const focused = i === clampedIdx;
            const shell =
              r.script_tools === 0 && r.deciders === 0
                ? 'no shell'
                : `tools:${r.script_tools} deciders:${r.deciders}`;
            const installed = installedDirFor(r.id) !== '';
            return (
              <Box key={r.id} flexDirection="column">
                <Box>
                  <Text {...(focused ? { color: theme.brand } : {})}>{focused ? CURSOR : ' '}</Text>
                  <Text bold={focused} color={focused ? theme.brand : theme.tabInactive}>
                    {' '}
                    {r.id.padEnd(idWidth)}
                  </Text>
                  <Text color={r.level === 'verified' ? (theme.success) : theme.muted}>
                    {'  '}[{r.level}]
                  </Text>
                  <Text color={theme.muted}>
                    {'  '}{shell}
                  </Text>
                  {installed ? <Text color={theme.success}>{'  ✓ installed'}</Text> : null}
                </Box>
                <Box marginLeft={4}>
                  <Text color={theme.hint} wrap="wrap">
                    {r.summary}
                  </Text>
                </Box>
              </Box>
            );
          })}
          <MoreRow count={matches.length - win.end} dir="down" />
        </Box>
      ) : null}
      {installed.length > 0 ? (
        <Box marginTop={tGap} flexDirection="column">
          <Text bold color={theme.brand}>
            Installed in your projects
          </Text>
          {installed.map((r) => (
            <Box key={`${r.projectPath}:${r.id}`}>
              <Text>{'  '}{r.id}</Text>
              <Text color={theme.muted}> — {r.project}</Text>
              {r.trusted ? (
                <Text color={theme.success}> ✓ trusted</Text>
              ) : (
                <Text color={theme.warning}> switched off — (t) to trust</Text>
              )}
            </Box>
          ))}
        </Box>
      ) : null}
      <Box marginTop={tGap}>
        <Text color={theme.hint}>
          enter open · (i)nstall from detail · (l)ocal entry install · (u)pdate from local entry ·
          (t)rust an installed workflow · (p)ublish my workflow · / filter · r reload
        </Text>
      </Box>
    </Box>
  );
}
