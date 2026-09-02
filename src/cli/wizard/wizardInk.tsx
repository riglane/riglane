
import { Box, Text, render, useApp, useInput } from 'ink';
import { Alert, StatusMessage, TextInput } from '@inkjs/ui';
import { useEffect, useMemo, useState } from 'react';
import { existsSync, mkdirSync, statSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { runInit } from '../commands/init.js';
import { runUpdate } from '../commands/update.js';
import { runRunWorkflowCli } from '../commands/run-workflow.js';
import { PROJECT_ID_REL } from '../projectId.js';
import {
  buildLaunchArgs,
  buildParamArgs,
  buildPreviewCommand,
  detectRunAdapters,
  listProjectWorkflows,
  listWorkflowTraces,
  missingRequired,
  MODEL_OVERRIDE_CHOICES,
  detectedAdapterIds,
  modelOverrideLabel,
  readActiveRun,
  runAdapterStatus,
  warmRunnableCache,
  type RunAdapter,
  type TraceMeta,
  type WorkflowEntry,
  type WorkflowGroup,
} from './workflowRun.js';
import {
  loadWorkflowState,
  saveWorkflowModelOverride,
  saveWorkflowParam,
  saveWorkflowTarget,
} from './workflowParamsStore.js';
import * as registry from '../../registry/registry.js';
import {
  ADAPTERS,
  SELECTABLE_ADAPTERS,
  adaptersToInstallOptions,
  type AdapterId,
} from '../../adapters/index.js';
import { driftLabel, probe, type DriftStatus, type ProbeResult } from '../../registry/probe.js';
import { windowAround, useViewportRows, MoreRow } from './viewport.js';
import { clearWorkflowRun } from '../commands/workflow-clear.js';
import { openToolViewer, openTraceViewer } from '../../engine/trace-server.js';
import { PRODUCT_DIR } from '../../config/paths.js';
import { templatesRoot } from '../templates.js';
import * as acpConfig from '../../config/config.js';
import { CommunityTab, type CommunityCliTask, type CommunityPostStep } from './CommunityTab.js';
import { spawnSync } from 'node:child_process';
import { readSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { CCFrame, useTerminalWidth } from './CCFrame.js';
import { HelpOverlay } from './HelpOverlay.js';
import {
  defaultKeybinds,
  tabKeybinds,
  editKeybinds,
  tooltipKeybinds,
} from './keybinds.js';
import { CURSOR } from './theme.js';
import { ThemeContext, useTheme } from './themeContext.js';
import { THEMES, type ThemeName } from './themes.js';

const TABS = ['Projects', 'Tools', 'Community', 'Settings'] as const;
type TabName = (typeof TABS)[number];

interface LaunchResume {
  projectPath: string;
  workflow: string;
}


function App({
  onLaunch,
  onCliTask,
  initialResume,
  initialTab,
  initialPost,
}: {
  onLaunch: (args: string[], resume: LaunchResume) => void;
  onCliTask: (task: CommunityCliTask) => void;
  initialResume?: LaunchResume;
  initialTab?: TabName;
  initialPost?: CommunityPostStep;
}): React.JSX.Element {
  const { exit } = useApp();

  const requestLaunch = (args: string[], resume: LaunchResume): void => {
    onLaunch(args, resume);
    exit();
  };
  const requestCliTask = (task: CommunityCliTask): void => {
    onCliTask(task);
    exit();
  };
  const [active, setActive] = useState<TabName>(initialTab ?? 'Projects');
  const [helpOpen, setHelpOpen] = useState(false);
  const [capturingKeys, setCapturingKeys] = useState(false);
  const [subTabActive, setSubTabActive] = useState(false);
  const [themeName, setThemeName] = useState<ThemeName>(() => {
    const settings = acpConfig.readAllSettings();
    const val = settings.find((s) => s.key === 'ui.theme')?.value;
    return val === 'light' ? 'light' : 'dark';
  });

  useInput(
    (input, key) => {
      if (helpOpen) {
        if (key.escape || input === '?') setHelpOpen(false);
        return;
      }
      if (key.tab && !subTabActive) {
        setActive((cur) => (key.shift ? prevTab(cur) : nextTab(cur)));
        return;
      }
      if (input === '?' && !capturingKeys) {
        setHelpOpen(true);
        return;
      }
      if (capturingKeys) return;
      if (key.escape) {
        exit();
        return;
      }
      if (input === 'q' && !key.ctrl && !key.meta) {
        exit();
        return;
      }
    },
    { isActive: true },
  );

  const tabs = TABS.map((name) => ({
    id: name,
    label: name,
  }));

  return (
    <ThemeContext.Provider value={THEMES[themeName]}>
      {helpOpen ? (
        <Box flexDirection="column" paddingX={1} paddingY={1}>
          <HelpOverlay
            title="riglane ui — keyboard shortcuts"
            sections={[
              { heading: 'Navigation', keybinds: defaultKeybinds },
              { heading: 'Tabs', keybinds: tabKeybinds },
              {
                heading: 'Projects tab',
                keybinds: [
                  { key: 'enter', label: 'open action menu for focused row' },
                  { key: 'D', label: 'run doctor on focused row (skip menu)' },
                  { key: 'r', label: 'refresh registry from disk' },
                  { key: 'U', label: 'bulk update all projects' },
                  { key: 'T', label: 'forget temporary projects (under the OS temp dir; files left intact)' },
                ],
              },
              {
                heading: 'Community tab',
                keybinds: [
                  { key: 'enter', label: 'open the focused catalog entry' },
                  { key: 'i', label: 'install (full CLI inspection + typed-id confirm)' },
                  { key: 'l', label: 'install from a LOCAL entry dir (pre-publish rehearsal)' },
                  { key: 'p', label: 'publish my workflow (preflight → lock → entry → checklist)' },
                  { key: 't', label: 'trust an installed workflow (CLI review + typed-id confirm)' },
                  { key: '/', label: 'filter the list' },
                  { key: 'r', label: 'reload the catalog index' },
                ],
              },
              { heading: 'Tooltips (rows with ⓘ icon)', keybinds: tooltipKeybinds },
              { heading: 'Editing (when a field is being edited)', keybinds: editKeybinds },
            ]}
          />
        </Box>
      ) : (
        <CCFrame tabs={tabs} activeTab={active} hideTabs={subTabActive}>
          <SettingsTab active={active === 'Settings'} onThemeChange={setThemeName} />
          <ToolsTab active={active === 'Tools'} />
          <CommunityTab
            active={active === 'Community'}
            onCaptureChange={setCapturingKeys}
            onCliTask={requestCliTask}
            {...(initialPost ? { post: initialPost } : {})}
          />
          <ProjectsTab
            active={active === 'Projects'}
            onCaptureChange={setCapturingKeys}
            onOwnTabs={setSubTabActive}
            onLaunch={requestLaunch}
            {...(initialResume ? { initialResume } : {})}
          />
        </CCFrame>
      )}
    </ThemeContext.Provider>
  );
}



interface ToolInfo {
  name: string;
  file: string;
  description: string;
  projectScoped?: boolean;
  unifiedStudio?: boolean;
}

const TOOLS: readonly ToolInfo[] = [
  {
    name: 'Workflow Studio',
    file: 'workflow-studio.html',
    description: 'Unified workflow editor + trace viewer (live). Editor and Traces via the top switch.',
    unifiedStudio: true,
  },
  {
    name: 'Projects Spec & Audit',
    file: 'projects-spec-audit.html',
    description: 'Interactive spec map + spec-audit run reports (live)',
    projectScoped: true,
  },
];

function resolveProjectForTool(): { dir: string; name: string } | { error: string } {
  const cwd = process.cwd();
  if (existsSync(join(cwd, PRODUCT_DIR))) return { dir: cwd, name: basename(cwd) };
  try {
    const withRiglane = registry.list().filter((e) => existsSync(join(e.path, PRODUCT_DIR)));
    const recent = [...withRiglane].sort((a, b) => (b.last_seen ?? '').localeCompare(a.last_seen ?? ''))[0];
    if (recent) return { dir: recent.path, name: recent.slug };
    return { error: 'No Riglane project found — run `riglane ui` from a project directory.' };
  } catch {
    return { error: 'No Riglane project found — run `riglane ui` from a project directory.' };
  }
}

function ToolsTab({ active }: { active: boolean }): React.JSX.Element {
  const theme = useTheme();
  const vpRows = useViewportRows();
  const [focusIdx, setFocusIdx] = useState(0);
  const [statusMsg, setStatusMsg] = useState('');

  const outdatedProjects = useMemo(() => {
    if (!active) return [];
    try {
      const entries = registry.list();
      return entries
        .map((e) => ({ entry: e, probe: probe(e) }))
        .filter((r) => r.probe.drift === 'outdated');
    } catch {
      return [];
    }
  }, [active]);

  const toolsRoot = resolve(templatesRoot(), 'agent', 'tools');

  useInput(
    (input, key) => {
      if (key.downArrow || input === 'j') {
        setFocusIdx((i) => Math.min(i + 1, TOOLS.length - 1));
        return;
      }
      if (key.upArrow || input === 'k') {
        setFocusIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (key.return) {
        const tool = TOOLS[focusIdx];
        if (!tool) return;
        if (tool.unifiedStudio) {
          const filePath = resolve(toolsRoot, tool.file);
          if (!existsSync(filePath)) {
            setStatusMsg(`${tool.file} not found — reinstall or update riglane.`);
            return;
          }
          const proj = resolveProjectForTool();
          const projParam = 'error' in proj ? '' : `?project=${encodeURIComponent(proj.name)}`;
          setStatusMsg(`Opening ${tool.name}…`);
          void openToolViewer(resolve(templatesRoot(), 'agent'), `tools/${tool.file}${projParam}`).then((url) => {
            setStatusMsg(url ? `${tool.name}: ${url}` : `Could not serve ${tool.name} (see terminal)`);
          });
          return;
        }
        if (tool.projectScoped) {
          const proj = resolveProjectForTool();
          if ('error' in proj) {
            setStatusMsg(proj.error);
            return;
          }
          const acpDir = join(proj.dir, PRODUCT_DIR);
          const installed = join(acpDir, 'tools', tool.file);
          if (!existsSync(installed)) {
            setStatusMsg(`${tool.file} is not installed in ${proj.name} — run \`riglane update\` there first.`);
            return;
          }
          setStatusMsg(`Opening ${tool.name} for ${proj.name}…`);
          void openToolViewer(acpDir, `tools/${tool.file}?project=${encodeURIComponent(proj.name)}`).then(
            (url) => {
              setStatusMsg(url ? `${tool.name}: ${url}` : `Could not serve ${tool.name} (see terminal)`);
            },
          );
          return;
        }
        const filePath = resolve(toolsRoot, tool.file);
        if (!existsSync(filePath)) {
          setStatusMsg(`File not found: ${filePath}`);
          return;
        }
        setStatusMsg(`Opening ${tool.name}…`);
        void openToolViewer(resolve(templatesRoot(), 'agent'), `tools/${tool.file}`).then((url) => {
          setStatusMsg(
            url ? `${tool.name}: ${url}` : `Could not serve ${tool.name} (see terminal)`,
          );
        });
      }
    },
    { isActive: active },
  );

  if (!active) return <Box />;

  const tGap = vpRows <= 12 ? 0 : 1;
  const compact = vpRows <= 16;
  const toolCap = Math.max(2, vpRows - 6);
  const toolWin = windowAround(TOOLS.length, focusIdx, toolCap);
  return (
    <Box flexDirection="column">
      <Text bold color={theme.brand}>
        Tools
      </Text>
      <Box marginTop={tGap} flexDirection="column">
        <Text color={theme.muted}>Press Enter to open in browser. ↑/↓ to navigate.</Text>
        <Box marginTop={tGap} flexDirection="column">
          <MoreRow count={toolWin.start} dir="up" />
          {TOOLS.slice(toolWin.start, toolWin.end).map((tool, j) => {
            const i = toolWin.start + j;
            const focused = i === focusIdx;
            return (
              <Box key={tool.file}>
                <Text {...(focused ? { color: theme.brand } : {})}>{focused ? CURSOR : ' '}</Text>
                <Text bold={focused} color={focused ? theme.brand : theme.tabInactive}>
                  {' '}
                  {tool.name}
                </Text>
                <Text color={theme.hint}> — {tool.description}</Text>
              </Box>
            );
          })}
          <MoreRow count={TOOLS.length - toolWin.end} dir="down" />
        </Box>
      </Box>
      {statusMsg ? (
        <Box marginTop={tGap}>
          <StatusMessage variant="success">{statusMsg}</StatusMessage>
        </Box>
      ) : null}
      {outdatedProjects.length > 0 ? (
        compact ? (
          <Text color={theme.warning}>
            ⚠ {outdatedProjects.length} project{outdatedProjects.length > 1 ? 's' : ''} outdated — tools
            use the latest package version
          </Text>
        ) : (
          <Box marginTop={tGap} flexDirection="column">
            <Alert variant="warning">
              Tools will load the latest version from Riglane package. {outdatedProjects.length} project
              {outdatedProjects.length > 1 ? 's are' : ' is'} not up-to-date — tool versions may differ
              from what{' '}
              {outdatedProjects.length > 1 ? 'those projects have' : 'that project has'} installed:
            </Alert>
            {outdatedProjects.map((r) => (
              <Text key={r.entry.path} color={theme.warning}>
                {'  '}• {r.entry.path}
              </Text>
            ))}
          </Box>
        )
      ) : null}
    </Box>
  );
}


function SettingsTab({
  active,
  onThemeChange,
}: {
  active: boolean;
  onThemeChange?: (name: ThemeName) => void;
}): React.JSX.Element {
  const theme = useTheme();
  const vpRows = useViewportRows();
  const configMod = acpConfig;

  const [settings, setSettings] = useState<
    Array<acpConfig.SettingMeta & { value: unknown; isDefault: boolean }>
  >([]);
  const [focusIdx, setFocusIdx] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editBuf, setEditBuf] = useState('');
  const [statusMsg, setStatusMsg] = useState('');

  const reload = (): void => {
    setSettings(acpConfig.readAllSettings());
  };

  if (settings.length === 0) {
    const initial = acpConfig.readAllSettings();
    if (initial.length > 0 && settings.length === 0) {
      setSettings(initial);
    }
  }

  const groups = useMemo(() => {
    const map = new Map<string, typeof settings>();
    for (const s of settings) {
      const arr = map.get(s.group) ?? [];
      arr.push(s);
      map.set(s.group, arr);
    }
    return [...map.entries()];
  }, [settings]);

  const flatItems = useMemo(() => {
    const items: Array<{ kind: 'setting'; idx: number } | { kind: 'reset-group'; group: string } | { kind: 'reset-all' }> = [];
    for (const [group, groupSettings] of groups) {
      for (let i = 0; i < groupSettings.length; i++) {
        const globalIdx = settings.indexOf(groupSettings[i]!);
        items.push({ kind: 'setting', idx: globalIdx });
      }
      items.push({ kind: 'reset-group', group });
    }
    items.push({ kind: 'reset-all' });
    return items;
  }, [groups, settings]);

  useInput(
    (input, key) => {
      if (editing) {
        if (key.return) {
          const item = flatItems[focusIdx];
          if (item?.kind === 'setting') {
            const s = settings[item.idx]!;
            const numVal = Number(editBuf);
            if (!isNaN(numVal)) {
              configMod?.writeSetting(s.key, numVal);
              reload();
              setStatusMsg(`${s.label} = ${numVal}`);
            }
          }
          setEditing(false);
          return;
        }
        if (key.escape) {
          setEditing(false);
          return;
        }
        if (key.backspace || key.delete) {
          setEditBuf((b) => b.slice(0, -1));
          return;
        }
        if (/^[0-9]$/.test(input)) {
          setEditBuf((b) => b + input);
          return;
        }
        return;
      }

      if (key.downArrow || input === 'j') {
        setFocusIdx((i) => Math.min(i + 1, flatItems.length - 1));
        return;
      }
      if (key.upArrow || input === 'k') {
        setFocusIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (key.return) {
        const item = flatItems[focusIdx];
        if (!item) return;
        if (item.kind === 'setting') {
          const s = settings[item.idx]!;
          if (s.type === 'number') {
            setEditBuf(String(s.value));
            setEditing(true);
          } else if (s.type === 'boolean') {
            configMod?.writeSetting(s.key, !s.value);
            reload();
            setStatusMsg(`${s.label} = ${!s.value}`);
          } else if (s.type === 'string' && s.options && s.options.length > 0) {
            const opts = s.options as string[];
            const currentIdx = opts.indexOf(String(s.value));
            const nextVal = opts[(currentIdx + 1) % opts.length] ?? opts[0]!;
            configMod?.writeSetting(s.key, nextVal);
            if (s.key === 'ui.theme') onThemeChange?.(nextVal as ThemeName);
            reload();
            setStatusMsg(`${s.label} = ${nextVal}`);
          }
        } else if (item.kind === 'reset-group') {
          configMod?.resetGroup(item.group);
          reload();
          setStatusMsg(`Reset group: ${item.group}`);
        } else if (item.kind === 'reset-all') {
          configMod?.resetGroup();
          reload();
          setStatusMsg('Reset all settings to defaults');
        }
        return;
      }
      if (input === 'r') {
        const item = flatItems[focusIdx];
        if (item?.kind === 'setting') {
          const s = settings[item.idx]!;
          configMod?.resetSetting(s.key);
          reload();
          setStatusMsg(`${s.label} reset to default (${s.default})`);
        }
      }
    },
    { isActive: active && !editing },
  );

  useInput(
    (input, key) => {
      if (!editing) return;
      if (key.return) {
        const item = flatItems[focusIdx];
        if (item?.kind === 'setting') {
          const s = settings[item.idx]!;
          const numVal = Number(editBuf);
          if (!isNaN(numVal)) {
            configMod?.writeSetting(s.key, numVal);
            reload();
            setStatusMsg(`${s.label} = ${numVal}`);
          }
        }
        setEditing(false);
        return;
      }
      if (key.escape) { setEditing(false); return; }
      if (key.backspace || key.delete) { setEditBuf((b) => b.slice(0, -1)); return; }
      if (/^[0-9]$/.test(input)) { setEditBuf((b) => b + input); }
    },
    { isActive: editing },
  );

  if (!active) return <Box />;

  type FlatSetting = (typeof settings)[number];
  type FlatItem =
    | { kind: 'setting'; group: string; s: FlatSetting }
    | { kind: 'reset-group'; group: string }
    | { kind: 'reset-all' };
  const flat: FlatItem[] = [];
  for (const [group, groupSettings] of groups) {
    for (const s of groupSettings) flat.push({ kind: 'setting', group, s });
    flat.push({ kind: 'reset-group', group });
  }
  flat.push({ kind: 'reset-all' });

  const sGap = vpRows <= 12 ? 0 : 1;
  const setCap = Math.max(3, vpRows - 5 - groups.length);
  const setWin = windowAround(flat.length, focusIdx, setCap);
  let lastGroup: string | null = null;

  return (
    <Box flexDirection="column">
      <Text bold color={theme.brand}>Settings</Text>
      <Text color={theme.muted}>Enter: edit · r: reset to default · ↑/↓: navigate</Text>
      <Text color={theme.hint}>Config: {configMod.configPath()}</Text>
      <MoreRow count={setWin.start} dir="up" />
      {flat.slice(setWin.start, setWin.end).map((item, j) => {
        const i = setWin.start + j;
        const focused = i === focusIdx;
        const itemGroup = item.kind === 'reset-all' ? null : item.group;
        const header =
          itemGroup && itemGroup !== lastGroup ? (
            <Text bold underline color={theme.muted}>{itemGroup}</Text>
          ) : null;
        lastGroup = itemGroup;

        if (item.kind === 'setting') {
          const s = item.s;
          const modified = !s.isDefault;
          return (
            <Box key={`s-${s.key}`} flexDirection="column" marginTop={header ? sGap : 0}>
              {header}
              <Box flexDirection="column">
                <Box>
                  <Text {...(focused ? { color: theme.brand } : {})}>{focused ? CURSOR : ' '}</Text>
                  <Text bold={focused} color={focused ? theme.brand : theme.tabInactive}>
                    {' '}{s.label}:{' '}
                  </Text>
                  {editing && focused ? (
                    <Text color={theme.accent}>{editBuf}▏</Text>
                  ) : (
                    <Text color={modified ? theme.accent : theme.tabInactive}>{String(s.value)}</Text>
                  )}
                  {modified ? <Text color={theme.muted}> (default: {String(s.default)})</Text> : null}
                </Box>
                {focused ? (
                  <Box marginLeft={4}>
                    <Text color={theme.muted} italic>{s.hint}</Text>
                  </Box>
                ) : null}
              </Box>
            </Box>
          );
        }
        if (item.kind === 'reset-group') {
          return (
            <Box key={`rg-${item.group}`} flexDirection="column" marginTop={header ? sGap : 0}>
              {header}
              <Box>
                <Text {...(focused ? { color: theme.brand } : {})}>{focused ? CURSOR : ' '}</Text>
                <Text bold={focused} color={focused ? theme.warning : theme.tabInactive}>
                  {' '}Reset {item.group} to defaults
                </Text>
              </Box>
            </Box>
          );
        }
        return (
          <Box key="reset-all" marginTop={sGap}>
            <Text {...(focused ? { color: theme.brand } : {})}>{focused ? CURSOR : ' '}</Text>
            <Text bold={focused} color={focused ? theme.danger : theme.tabInactive}>
              {' '}Reset ALL settings to defaults
            </Text>
          </Box>
        );
      })}
      <MoreRow count={flat.length - setWin.end} dir="down" />
      {statusMsg ? (
        <Box marginTop={1}>
          <StatusMessage variant="success">{statusMsg}</StatusMessage>
        </Box>
      ) : null}
    </Box>
  );
}


interface ProjectRow {
  entry: registry.Entry;
  probe: ProbeResult;
}

function loadProjectRows(): ProjectRow[] {
  return registry.list().map((entry) => ({ entry, probe: probe(entry) }));
}

type ProjectsMode =
  | { kind: 'list' }
  | { kind: 'actions'; rowIdx: number; actionIdx: number }
  | { kind: 'adding'; draft: string }
  | {
      kind: 'adding-adapters';
      path: string;
      focusIdx: number;
      selected: Partial<Record<AdapterId, boolean>>;
      existing: readonly AdapterId[];
      specGuidance: boolean;
      returnRowIdx?: number;
    }
  | { kind: 'project-settings'; rowIdx: number; focusIdx: number }
  | { kind: 'relinking'; rowIdx: number }
  | { kind: 'doctor-output'; rowIdx: number; output: string; exitCode: number; scroll: number }
  | { kind: 'busy'; message: string }
  | { kind: 'done'; message: string; returnTo?: ProjectsMode }
  | { kind: 'error'; message: string; returnTo?: ProjectsMode }
  | { kind: 'confirm-update-all'; total: number }
  | { kind: 'confirm-forget-temp'; total: number }
  | { kind: 'wf-list'; rowIdx: number; groups: WorkflowGroup[]; focusIdx: number }
  | {
      kind: 'wf-run';
      rowIdx: number;
      wf: WorkflowEntry;
      adapters: RunAdapter[];
      values: Record<string, string>;
      target: string;
      focusIdx: number;
      editing: boolean;
      editNonce: number;
      skipApprovals: boolean;
      modelOverride: string;
      subTab: WfSubTab;
      traces: TraceMeta[];
      runChoice: { runId: string; state: 'waiting' | 'stalled'; step: string | null; adapterName: string } | null;
    };

const WF_SUBTABS = ['parameters', 'run', 'traces'] as const;
type WfSubTab = (typeof WF_SUBTABS)[number];
const WF_SUBTAB_LABELS: Record<WfSubTab, string> = {
  parameters: 'Parameters',
  run: 'Run',
  traces: 'Traces',
};

type RowActionId =
  | 'run-workflow'
  | 'project-settings'
  | 'update'
  | 'doctor'
  | 'relink'
  | 'unregister';

interface RowAction {
  readonly id: RowActionId;
  readonly label: string;
  readonly destructive?: boolean;
}

const ACTION_RUN_WORKFLOW: RowAction = { id: 'run-workflow', label: 'Run Workflow' };
const ACTION_PROJECT_SETTINGS: RowAction = {
  id: 'project-settings',
  label: 'Project Settings',
};
const ACTION_UPDATE: RowAction = { id: 'update', label: 'Update (riglane update)' };
const ACTION_DOCTOR: RowAction = { id: 'doctor', label: 'Doctor (diagnose this project)' };
const ACTION_RELINK: RowAction = { id: 'relink', label: 'Relink to new path…' };
const ACTION_UNREGISTER: RowAction = {
  id: 'unregister',
  label: 'Unregister from registry',
  destructive: true,
};

function actionsForRow(row: ProjectRow): readonly RowAction[] {
  if (row.probe.drift === 'path-gone') {
    if (row.entry.id !== undefined && row.entry.id.length > 0) {
      return [ACTION_RELINK, ACTION_UNREGISTER];
    }
    return [ACTION_UNREGISTER];
  }
  return [
    ACTION_RUN_WORKFLOW,
    ACTION_PROJECT_SETTINGS,
    ACTION_UPDATE,
    ACTION_DOCTOR,
    ACTION_UNREGISTER,
  ];
}

function missingAdapters(installed: readonly AdapterId[]): AdapterId[] {
  return SELECTABLE_ADAPTERS.filter((a) => !installed.includes(a));
}

function offeredAdapters(existing: readonly AdapterId[]): AdapterId[] {
  return SELECTABLE_ADAPTERS.filter((a) => !existing.includes(a)).sort((a, b) =>
    ADAPTERS[a].label.localeCompare(ADAPTERS[b].label),
  );
}

function ProjectsTab({
  active,
  onCaptureChange,
  onOwnTabs,
  onLaunch,
  initialResume,
}: {
  active: boolean;
  onCaptureChange: (capturing: boolean) => void;
  onOwnTabs: (owns: boolean) => void;
  onLaunch: (args: string[], resume: LaunchResume) => void;
  initialResume?: LaunchResume;
}): React.JSX.Element {
  const theme = useTheme();
  const vpRows = useViewportRows();
  const cols = useTerminalWidth();
  const [rows, setRows] = useState<ProjectRow[]>(() => loadProjectRows());
  const [focusIdx, setFocusIdx] = useState(0);
  const [mode, setModeState] = useState<ProjectsMode>({ kind: 'list' });
  const [status, setStatus] = useState<string | null>(null);
  const [statusKind, setStatusKind] = useState<'ok' | 'error'>('ok');

  const addRowIdx = rows.length;
  const totalRows = rows.length + 1;

  const setMode = (next: ProjectsMode): void => {
    setModeState(next);
    onCaptureChange(next.kind !== 'list');
    onOwnTabs(next.kind === 'wf-run');
  };

  const refresh = (): void => {
    setRows(loadProjectRows());
  };

  const driftSummary = useMemo(() => {
    let ood = 0;
    let gone = 0;
    let temp = 0;
    for (const r of rows) {
      if (r.probe.drift === 'outdated') ood += 1;
      if (r.probe.drift === 'path-gone') gone += 1;
      if (r.probe.temporary) temp += 1;
    }
    return { ood, gone, temp };
  }, [rows]);

  const updateOne = async (entry: registry.Entry): Promise<void> => {
    setMode({ kind: 'busy', message: `Updating ${entry.slug}…` });
    try {
      const adapterOpts = adaptersToInstallOptions(entry.adapters);
      const code = await runUpdate(entry.path, adapterOpts);
      if (code === 0) {
        setMode({ kind: 'done', message: `Updated ${entry.slug}.` });
      } else {
        setMode({ kind: 'error', message: `riglane update returned exit ${code} for ${entry.slug}.` });
      }
      refresh();
    } catch (err) {
      setMode({ kind: 'error', message: `Update failed: ${(err as Error).message}` });
    }
  };

  const toggleSpecGuidance = async (
    entry: registry.Entry,
    returnTo?: ProjectsMode,
  ): Promise<void> => {
    const next = !(entry.specGuidance ?? true);
    setMode({
      kind: 'busy',
      message: `${next ? 'Enabling' : 'Disabling'} spec-guidance for ${entry.slug}…`,
    });
    try {
      const code = await runUpdate(entry.path, {
        ...adaptersToInstallOptions(entry.adapters),
        specGuidance: next,
      });
      if (code === 0) {
        setMode({
          kind: 'done',
          message: `Spec-guidance ${next ? 'enabled' : 'disabled'} for ${entry.slug}.`,
          ...(returnTo ? { returnTo } : {}),
        });
      } else {
        setMode({
          kind: 'error',
          message: `riglane update returned exit ${code} for ${entry.slug}.`,
          ...(returnTo ? { returnTo } : {}),
        });
      }
      refresh();
    } catch (err) {
      setMode({
        kind: 'error',
        message: `Spec-guidance toggle failed: ${(err as Error).message}`,
        ...(returnTo ? { returnTo } : {}),
      });
    }
  };

  const forgetTemporary = (): void => {
    const temps = rows.filter((r) => r.probe.temporary);
    let n = 0;
    for (const r of temps) if (registry.unregister(r.entry.path)) n += 1;
    refresh();
    setMode({
      kind: 'done',
      message: `Forgot ${n} temporary project(s); files left intact. To remove the directories too: riglane projects forget --temp --delete`,
    });
  };

  const updateAll = async (): Promise<void> => {
    if (rows.length === 0) {
      setStatus('No projects to update.');
      setStatusKind('ok');
      setMode({ kind: 'list' });
      return;
    }
    setMode({ kind: 'busy', message: `Updating ${rows.length} project(s)…` });
    let okCount = 0;
    const failures: string[] = [];
    for (const r of rows) {
      setMode({ kind: 'busy', message: `Updating ${r.entry.slug} (${okCount + failures.length + 1}/${rows.length})…` });
      try {
        const bulkAdapterOpts = adaptersToInstallOptions(r.entry.adapters);
        const code = await runUpdate(r.entry.path, bulkAdapterOpts);
        if (code === 0) okCount += 1;
        else failures.push(`${r.entry.slug} (exit ${code})`);
      } catch (err) {
        failures.push(`${r.entry.slug} (${(err as Error).message})`);
      }
    }
    refresh();
    if (failures.length === 0) {
      setMode({ kind: 'done', message: `Updated ${okCount}/${rows.length} project(s).` });
    } else {
      setMode({
        kind: 'error',
        message: `${okCount}/${rows.length} succeeded. Failed: ${failures.join('; ')}`,
      });
    }
  };

  const doctorProject = async (entry: registry.Entry, rowIdx: number, fix = false): Promise<void> => {
    setMode({ kind: 'busy', message: `Running doctor${fix ? ' --fix' : ''} on ${entry.slug}…` });
    const lines: string[] = [];
    try {
      const proc = spawn(
        process.execPath,
        [process.argv[1] as string, 'doctor', entry.path, ...(fix ? ['--fix'] : [])],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      proc.stdout.on('data', (chunk: Buffer) => lines.push(chunk.toString('utf-8')));
      proc.stderr.on('data', (chunk: Buffer) => lines.push(chunk.toString('utf-8')));
      const exitCode = await new Promise<number>((resolveExit) => {
        proc.on('close', (code) => resolveExit(code ?? 1));
        proc.on('error', () => resolveExit(1));
      });
      setMode({
        kind: 'doctor-output',
        rowIdx,
        output: lines.join(''),
        exitCode,
        scroll: 0,
      });
      refresh();
    } catch (err) {
      setMode({ kind: 'error', message: `Doctor failed: ${(err as Error).message}` });
    }
  };

  const relinkProject = async (entry: registry.Entry, rawPath: string): Promise<void> => {
    const trimmed = rawPath.trim();
    if (trimmed.length === 0) {
      setMode({ kind: 'list' });
      setStatus('Empty path — nothing relinked.');
      setStatusKind('ok');
      return;
    }
    if (entry.id === undefined || entry.id.length === 0) {
      setMode({ kind: 'error', message: 'This entry has no project id; cannot safely relink.' });
      return;
    }
    const expanded =
      trimmed === '~'
        ? homedir()
        : trimmed.startsWith('~/') || trimmed.startsWith('~\\')
          ? join(homedir(), trimmed.slice(2))
          : trimmed;
    const abs = resolve(expanded);
    if (!existsSync(abs)) {
      setMode({ kind: 'error', message: `Path does not exist: ${abs}` });
      return;
    }
    let isDir = false;
    try {
      isDir = statSync(abs).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) {
      setMode({ kind: 'error', message: `Not a directory: ${abs}` });
      return;
    }
    const idFile = join(abs, PROJECT_ID_REL);
    if (!existsSync(idFile)) {
      setMode({
        kind: 'error',
        message: `Not an Riglane project (no ${PROJECT_ID_REL}): ${abs}. Use '+ Add new project' to init a fresh install.`,
      });
      return;
    }
    let onDiskId = '';
    try {
      onDiskId = readFileSync(idFile, 'utf-8').trim();
    } catch (err) {
      setMode({ kind: 'error', message: `Failed to read ${PROJECT_ID_REL}: ${(err as Error).message}` });
      return;
    }
    if (onDiskId !== entry.id) {
      setMode({
        kind: 'error',
        message: `ID mismatch: ${abs} is a different project (id ${onDiskId.slice(0, 8)}… vs entry's ${entry.id.slice(0, 8)}…). Use '+ Add new project' to register it separately.`,
      });
      return;
    }
    setMode({ kind: 'busy', message: `Relinking ${entry.slug} → ${abs}…` });
    try {
      const relinkAdapterOpts = adaptersToInstallOptions(entry.adapters);
      const code = await runUpdate(abs, relinkAdapterOpts);
      if (code === 0) {
        setMode({ kind: 'done', message: `Relinked ${entry.slug} to ${abs}.` });
      } else {
        setMode({ kind: 'error', message: `riglane update returned exit ${code} during relink.` });
      }
      refresh();
    } catch (err) {
      setMode({ kind: 'error', message: `Relink failed: ${(err as Error).message}` });
    }
  };

  const addProject = async (
    rawPath: string,
    adapters: readonly AdapterId[],
    existing: readonly AdapterId[] = [],
    specGuidance?: boolean,
    returnTo?: ProjectsMode,
  ): Promise<void> => {
    const isAdding = existing.length > 0;
    const trimmed = rawPath.trim();
    if (trimmed.length === 0) {
      setMode({ kind: 'list' });
      setStatus('Empty path — nothing added.');
      setStatusKind('ok');
      return;
    }
    const expanded =
      trimmed === '~'
        ? homedir()
        : trimmed.startsWith('~/') || trimmed.startsWith('~\\')
          ? join(homedir(), trimmed.slice(2))
          : trimmed;
    const abs = resolve(expanded);
    if (!existsSync(abs)) {
      try {
        mkdirSync(abs, { recursive: true });
      } catch (err) {
        setMode({
          kind: 'error',
          message: `Cannot create directory ${abs}: ${(err as Error).message}`,
        });
        return;
      }
    }
    let isDir = false;
    try {
      isDir = statSync(abs).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) {
      setMode({ kind: 'error', message: `Not a directory: ${abs}` });
      return;
    }
    setMode({
      kind: 'busy',
      message: isAdding ? `Adding integration in ${abs}…` : `Initializing riglane in ${abs}…`,
    });
    try {
      const code = await runInit(abs, {
        adapters,
        ...(specGuidance !== undefined ? { specGuidance } : {}),
      });
      if (code === 0) {
        const added = adapters
          .filter((a) => !existing.includes(a))
          .map((a) => ADAPTERS[a].label)
          .join(', ');
        setMode({
          kind: 'done',
          message: isAdding ? `Added ${added} to ${abs}.` : `Initialized ${abs}.`,
          ...(returnTo ? { returnTo } : {}),
        });
      } else {
        setMode({
          kind: 'error',
          message: `riglane init returned exit ${code}.`,
          ...(returnTo ? { returnTo } : {}),
        });
      }
      refresh();
    } catch (err) {
      setMode({
        kind: 'error',
        message: `Init failed: ${(err as Error).message}`,
        ...(returnTo ? { returnTo } : {}),
      });
    }
  };

  const projectKeyOf = (entry: registry.Entry): string =>
    entry.id !== undefined && entry.id.length > 0 ? entry.id : entry.path;

  const openWorkflowList = (entry: registry.Entry, rowIdx: number): void => {
    let groups: WorkflowGroup[] = [];
    try {
      groups = listProjectWorkflows(entry.path);
    } catch {
      groups = [];
    }
    if (groups.length === 0) {
      setStatus(`No workflows found in ${entry.slug} (is riglane installed there?).`);
      setStatusKind('error');
      setMode({ kind: 'list' });
      return;
    }
    setMode({ kind: 'wf-list', rowIdx, groups, focusIdx: 0 });
  };

  const openWorkflowRunner = (rowIdx: number, wf: WorkflowEntry): void => {
    const entry = rows[rowIdx]?.entry;
    if (!entry) return;
    const saved = loadWorkflowState(projectKeyOf(entry), wf.name);
    const adapters = detectRunAdapters(entry.adapters);
    const firstAvailable = adapters.find((a) => a.available);
    const target =
      saved.target && adapters.some((a) => a.name === saved.target)
        ? saved.target
        : (firstAvailable?.name ?? adapters[0]?.name ?? 'claude');
    const firstEmptyReq = wf.params.findIndex(
      (p) => p.category === 'required' && (saved.params[p.name] ?? '').trim().length === 0,
    );
    const adapterIdx = Math.max(0, adapters.findIndex((a) => a.name === target));
    setMode({
      kind: 'wf-run',
      rowIdx,
      wf,
      adapters,
      values: { ...saved.params },
      target,
      subTab: firstEmptyReq >= 0 ? 'parameters' : 'run',
      focusIdx: firstEmptyReq >= 0 ? firstEmptyReq : adapterIdx,
      editing: false,
      editNonce: 0,
      skipApprovals: acpConfig.skipApprovalsDefault(),
      modelOverride:
        saved.modelOverride && (MODEL_OVERRIDE_CHOICES as readonly string[]).includes(saved.modelOverride)
          ? saved.modelOverride
          : '',
      traces: [],
      runChoice: null,
    });
  };

  const launchWorkflowResume = (
    m: Extract<ProjectsMode, { kind: 'wf-run' }>,
    adapter: RunAdapter,
    runId: string,
  ): void => {
    const entry = rows[m.rowIdx]?.entry;
    if (!entry) return;
    if (!adapter.available) {
      setStatus(`${adapter.label}: ${runAdapterStatus(adapter).text}`);
      setStatusKind('error');
      return;
    }
    saveWorkflowTarget(projectKeyOf(entry), m.wf.name, adapter.name);
    const args = buildLaunchArgs({
      target: adapter.name,
      workflow: m.wf.name,
      dir: entry.path,
      paramArgs: ['--resume', runId],
      skipApprovals: m.skipApprovals,
      modelOverride: m.modelOverride,
    });
    onLaunch(args, { projectPath: entry.path, workflow: m.wf.name });
  };

  const launchWorkflow = (m: Extract<ProjectsMode, { kind: 'wf-run' }>, adapter: RunAdapter): void => {
    const entry = rows[m.rowIdx]?.entry;
    if (!entry) return;
    if (!adapter.available) {
      setStatus(`${adapter.label}: ${runAdapterStatus(adapter).text}`);
      setStatusKind('error');
      return;
    }
    if (adapter.name === 'codex-exec' && !m.skipApprovals) {
      setStatus(`${adapter.label}: requires Skip approvals — press s to enable, then launch`);
      setStatusKind('error');
      return;
    }
    if (adapter.name === 'copilot-headless' && !m.skipApprovals) {
      setStatus(`${adapter.label}: requires Skip approvals — press s to enable, then launch`);
      setStatusKind('error');
      return;
    }
    if (adapter.name === 'gemini-headless' && !m.skipApprovals) {
      setStatus(`${adapter.label}: requires Skip approvals — press s to enable, then launch`);
      setStatusKind('error');
      return;
    }
    const missing = missingRequired(m.wf.params, m.values);
    if (missing.length > 0) {
      setStatus(`Missing required param(s): ${missing.join(', ')}`);
      setStatusKind('error');
      return;
    }
    const paramArgs = buildParamArgs(m.wf.params, m.values);
    saveWorkflowTarget(projectKeyOf(entry), m.wf.name, adapter.name);
    const resume: LaunchResume = { projectPath: entry.path, workflow: m.wf.name };

    const args = buildLaunchArgs({
      target: adapter.name,
      workflow: m.wf.name,
      dir: entry.path,
      paramArgs,
      skipApprovals: m.skipApprovals,
      modelOverride: m.modelOverride,
    });
    onLaunch(args, resume);
  };

  const switchSubTab = (m: Extract<ProjectsMode, { kind: 'wf-run' }>, dir: 1 | -1): void => {
    const cur = WF_SUBTABS.indexOf(m.subTab);
    const next = WF_SUBTABS[(cur + dir + WF_SUBTABS.length) % WF_SUBTABS.length] as WfSubTab;
    const entry = rows[m.rowIdx]?.entry;
    const traces = next === 'traces' && entry ? listWorkflowTraces(entry.path, m.wf.name) : m.traces;
    setMode({ ...m, subTab: next, focusIdx: 0, editing: false, traces });
  };

  const clearActiveRun = (m: Extract<ProjectsMode, { kind: 'wf-run' }>): void => {
    const entry = rows[m.rowIdx]?.entry;
    if (!entry) return;
    try {
      const r = clearWorkflowRun(m.wf.name, entry.path);
      setStatus(
        r.cleared
          ? `Cleared previous run ${r.run_id} — finalized as ${r.status}.`
          : `Nothing to clear (${r.reason}).`,
      );
      setStatusKind('ok');
    } catch (e) {
      setStatus(`Clear failed: ${e instanceof Error ? e.message : String(e)}`);
      setStatusKind('error');
    }
    setMode({ ...m });
  };

  const openTraceFor = (m: Extract<ProjectsMode, { kind: 'wf-run' }>, trace: TraceMeta): void => {
    const entry = rows[m.rowIdx]?.entry;
    if (!entry) return;
    openTraceViewer(join(entry.path, PRODUCT_DIR), trace.serverPath);
    setStatus(`Opened trace ${trace.shortId} in browser.`);
    setStatusKind('ok');
  };

  useEffect(() => {
    if (!active) {
      setModeState({ kind: 'list' });
      onCaptureChange(false);
      onOwnTabs(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    if (!initialResume) return;
    const rowIdx = rows.findIndex((r) => r.entry.path === initialResume.projectPath);
    if (rowIdx < 0) return;
    let groups: WorkflowGroup[] = [];
    try {
      groups = listProjectWorkflows(initialResume.projectPath);
    } catch {
      return;
    }
    const wf = groups.flatMap((g) => g.workflows).find((w) => w.name === initialResume.workflow);
    if (!wf) return;
    setFocusIdx(rowIdx);
    openWorkflowRunner(rowIdx, wf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mode.kind !== 'wf-run') return;
    const needsProbe = mode.adapters.some((a) => a.binOnPath && a.binRunnable === undefined);
    if (!needsProbe) return;
    const entry = rows[mode.rowIdx]?.entry;
    if (!entry) return;
    let cancelled = false;
    void warmRunnableCache(mode.adapters).then((changed) => {
      if (cancelled || !changed) return;
      const refreshed = detectRunAdapters(entry.adapters);
      setModeState((cur) => (cur.kind === 'wf-run' ? { ...cur, adapters: refreshed } : cur));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode.kind, mode.kind === 'wf-run' ? mode.rowIdx : -1]);

  useInput(
    (input, key) => {
      if (!active) return;

      if (mode.kind === 'busy') return;
      if (mode.kind === 'done' || mode.kind === 'error') {
        if (key.return || key.escape) {
          setMode(mode.returnTo ?? { kind: 'list' });
          return;
        }
        return;
      }
      if (mode.kind === 'confirm-forget-temp') {
        if (input === 'y' || input === 'Y') {
          forgetTemporary();
          return;
        }
        if (input === 'n' || input === 'N' || key.escape) {
          setMode({ kind: 'list' });
          return;
        }
        return;
      }
      if (mode.kind === 'confirm-update-all') {
        if (input === 'y' || input === 'Y') {
          void updateAll();
          return;
        }
        if (input === 'n' || input === 'N' || key.escape) {
          setMode({ kind: 'list' });
          return;
        }
        return;
      }
      if (mode.kind === 'adding') {
        if (key.escape) {
          setMode({ kind: 'list' });
          setStatus('Add cancelled.');
          setStatusKind('ok');
        }
        return;
      }
      if (mode.kind === 'adding-adapters') {
        const offered = offeredAdapters(mode.existing);
        const showSg = mode.existing.length === 0;
        const sgIdx = showSg ? offered.length : -1;
        const submitIdx = offered.length + (showSg ? 1 : 0);
        if (key.escape) {
          if (mode.returnRowIdx !== undefined) {
            setMode({ kind: 'project-settings', rowIdx: mode.returnRowIdx, focusIdx: 0 });
          } else {
            setMode({ kind: 'list' });
            setStatus('Add cancelled.');
            setStatusKind('ok');
          }
          return;
        }
        if (key.downArrow || input === 'j') {
          setMode({ ...mode, focusIdx: Math.min(mode.focusIdx + 1, submitIdx) });
          return;
        }
        if (key.upArrow || input === 'k') {
          setMode({ ...mode, focusIdx: Math.max(mode.focusIdx - 1, 0) });
          return;
        }
        if (key.return) {
          if (mode.focusIdx < offered.length) {
            const a = offered[mode.focusIdx];
            if (a) {
              setMode({
                ...mode,
                selected: { ...mode.selected, [a]: !mode.selected[a] },
              });
            }
            return;
          }
          if (showSg && mode.focusIdx === sgIdx) {
            setMode({ ...mode, specGuidance: !mode.specGuidance });
            return;
          }
          const chosen = offered.filter((a) => mode.selected[a] === true);
          if (mode.existing.length > 0) {
            if (chosen.length === 0) {
              setMode({ kind: 'list' });
              setStatus('No integration selected — nothing added.');
              setStatusKind('ok');
              return;
            }
            const union = SELECTABLE_ADAPTERS.filter(
              (a) => mode.existing.includes(a) || chosen.includes(a),
            );
            void addProject(
              mode.path,
              union,
              mode.existing,
              mode.specGuidance,
              mode.returnRowIdx !== undefined
                ? { kind: 'project-settings', rowIdx: mode.returnRowIdx, focusIdx: 0 }
                : undefined,
            );
          } else {
            if (chosen.length === 0) {
              setStatus('Select at least one integration to install.');
              setStatusKind('error');
              return;
            }
            void addProject(mode.path, chosen, [], mode.specGuidance);
          }
          return;
        }
        return;
      }
      if (mode.kind === 'project-settings') {
        const psEntry = rows[mode.rowIdx]?.entry;
        if (!psEntry) {
          setMode({ kind: 'list' });
          return;
        }
        const psHasMissing = missingAdapters(psEntry.adapters).length > 0;
        const psRows: Array<'add-integration' | 'spec-guidance' | 'back'> = [
          ...(psHasMissing ? (['add-integration'] as const) : []),
          'spec-guidance',
          'back',
        ];
        const backToActions = () =>
          setMode({ kind: 'actions', rowIdx: mode.rowIdx, actionIdx: 0 });
        if (key.escape) {
          backToActions();
          return;
        }
        if (key.downArrow || input === 'j') {
          setMode({ ...mode, focusIdx: Math.min(mode.focusIdx + 1, psRows.length - 1) });
          return;
        }
        if (key.upArrow || input === 'k') {
          setMode({ ...mode, focusIdx: Math.max(mode.focusIdx - 1, 0) });
          return;
        }
        if (key.return) {
          const sel = psRows[mode.focusIdx];
          if (sel === 'add-integration') {
            const missing = missingAdapters(psEntry.adapters);
            const selected: Partial<Record<AdapterId, boolean>> = {};
            for (const a of missing) selected[a] = true;
            setMode({
              kind: 'adding-adapters',
              path: psEntry.path,
              focusIdx: 0,
              selected,
              existing: psEntry.adapters,
              specGuidance: psEntry.specGuidance ?? true,
              returnRowIdx: mode.rowIdx,
            });
          } else if (sel === 'spec-guidance') {
            void toggleSpecGuidance(psEntry, {
              kind: 'project-settings',
              rowIdx: mode.rowIdx,
              focusIdx: mode.focusIdx,
            });
          } else {
            backToActions();
          }
          return;
        }
        return;
      }
      if (mode.kind === 'relinking') {
        if (key.escape) {
          setMode({ kind: 'list' });
          setStatus('Relink cancelled.');
          setStatusKind('ok');
        }
        return;
      }
      if (mode.kind === 'doctor-output') {
        if (key.escape || key.return) {
          setMode({ kind: 'list' });
          return;
        }
        if (input === 'f' && mode.exitCode !== 0) {
          const r = rows[mode.rowIdx];
          if (r) void doctorProject(r.entry, mode.rowIdx, true);
          return;
        }
        if (key.upArrow) {
          setMode({ ...mode, scroll: Math.max(0, mode.scroll - 1) });
          return;
        }
        if (key.downArrow) {
          setMode({ ...mode, scroll: mode.scroll + 1 });
          return;
        }
        if (input === 'k') {
          setMode({ ...mode, scroll: Math.max(0, mode.scroll - 5) });
          return;
        }
        if (input === 'j') {
          setMode({ ...mode, scroll: mode.scroll + 5 });
          return;
        }
        return;
      }
      if (mode.kind === 'wf-list') {
        const flat = mode.groups.flatMap((g) => g.workflows);
        if (key.escape) {
          setMode({ kind: 'actions', rowIdx: mode.rowIdx, actionIdx: 0 });
          return;
        }
        if (key.upArrow || input === 'k') {
          if (flat.length > 0) {
            setMode({ ...mode, focusIdx: (mode.focusIdx - 1 + flat.length) % flat.length });
          }
          return;
        }
        if (key.downArrow || input === 'j') {
          if (flat.length > 0) {
            setMode({ ...mode, focusIdx: (mode.focusIdx + 1) % flat.length });
          }
          return;
        }
        if (key.return) {
          const wf = flat[mode.focusIdx];
          if (wf) openWorkflowRunner(mode.rowIdx, wf);
          return;
        }
        return;
      }
      if (mode.kind === 'wf-run') {
        if (mode.editing) {
          if (key.ctrl && input === 'u') {
            const p = mode.wf.params[mode.focusIdx];
            const entry = rows[mode.rowIdx]?.entry;
            if (p && entry) {
              saveWorkflowParam(projectKeyOf(entry), mode.wf.name, p.name, '');
              setMode({
                ...mode,
                values: { ...mode.values, [p.name]: '' },
                editNonce: mode.editNonce + 1,
              });
            }
            return;
          }
          if (key.escape) setMode({ ...mode, editing: false });
          return;
        }
        if (key.tab) {
          switchSubTab(mode, key.shift ? -1 : 1);
          return;
        }
        if (key.escape) {
          const entry = rows[mode.rowIdx]?.entry;
          if (entry) openWorkflowList(entry, mode.rowIdx);
          else setMode({ kind: 'list' });
          return;
        }
        const listLen =
          mode.subTab === 'parameters'
            ? mode.wf.params.length
            : mode.subTab === 'run'
              ? mode.adapters.length
              : mode.traces.length;
        if (key.upArrow || input === 'k') {
          setMode({ ...mode, focusIdx: Math.max(0, mode.focusIdx - 1) });
          return;
        }
        if (key.downArrow || input === 'j') {
          setMode({ ...mode, focusIdx: Math.min(Math.max(0, listLen - 1), mode.focusIdx + 1) });
          return;
        }
        if (mode.subTab === 'run') {
          if (mode.runChoice !== null) {
            const rc = mode.runChoice;
            const adapter = mode.adapters.find((a) => a.name === rc.adapterName);
            if (key.escape) {
              setMode({ ...mode, runChoice: null });
              return;
            }
            if (input === 'f') {
              setMode({ ...mode, runChoice: null });
              if (adapter) launchWorkflow({ ...mode, runChoice: null }, adapter);
              return;
            }
            if (input === 'c') {
              setMode({ ...mode, runChoice: null });
              clearActiveRun(mode);
              return;
            }
            if (key.return) {
              if (rc.state === 'stalled') {
                setMode({ ...mode, runChoice: null });
                if (adapter) launchWorkflowResume({ ...mode, runChoice: null }, adapter, rc.runId);
              } else {
                setMode({ ...mode, runChoice: null });
                setStatus('Answer the open question first (Studio → Messages, or your app) — the run continues from there.');
                setStatusKind('ok');
              }
              return;
            }
            return;
          }
          if (input === 's') {
            setMode({ ...mode, skipApprovals: !mode.skipApprovals });
            return;
          }
          if (input === 'm') {
            const cur = MODEL_OVERRIDE_CHOICES.indexOf(
              mode.modelOverride as (typeof MODEL_OVERRIDE_CHOICES)[number],
            );
            const next =
              MODEL_OVERRIDE_CHOICES[(cur + 1) % MODEL_OVERRIDE_CHOICES.length] ?? '';
            const entry = rows[mode.rowIdx]?.entry;
            if (entry) saveWorkflowModelOverride(projectKeyOf(entry), mode.wf.name, next);
            setMode({ ...mode, modelOverride: next });
            return;
          }
          if (input === 'c') {
            const entry = rows[mode.rowIdx]?.entry;
            if (entry && readActiveRun(entry.path, mode.wf.name)) clearActiveRun(mode);
            return;
          }
        }
        if (key.return) {
          if (mode.subTab === 'parameters') {
            if (mode.focusIdx < mode.wf.params.length) setMode({ ...mode, editing: true });
          } else if (mode.subTab === 'run') {
            const adapter = mode.adapters[mode.focusIdx];
            if (adapter) {
              const entry = rows[mode.rowIdx]?.entry;
              const active = entry ? readActiveRun(entry.path, mode.wf.name) : null;
              if (active && active.state !== 'running') {
                setMode({
                  ...mode,
                  runChoice: {
                    runId: active.runId,
                    state: active.state,
                    step: active.currentStep,
                    adapterName: adapter.name,
                  },
                });
              } else {
                launchWorkflow(mode, adapter);
              }
            }
          } else {
            const trace = mode.traces[mode.focusIdx];
            if (trace) openTraceFor(mode, trace);
          }
          return;
        }
        return;
      }

      if (mode.kind === 'list') {
        if (key.upArrow) {
          setFocusIdx((i) => Math.max(0, i - 1));
          return;
        }
        if (key.downArrow) {
          setFocusIdx((i) => Math.min(totalRows - 1, i + 1));
          return;
        }
        if (input === 'r') {
          refresh();
          setStatus('Refreshed.');
          setStatusKind('ok');
          return;
        }
        if (input === 'D' || input === 'd') {
          if (focusIdx < rows.length) {
            const row = rows[focusIdx];
            if (row && row.probe.drift !== 'path-gone') {
              void doctorProject(row.entry, focusIdx);
              return;
            }
          }
          return;
        }
        if (input === 'T') {
          const temps = rows.filter((r) => r.probe.temporary).length;
          if (temps === 0) {
            setStatus('No temporary projects — nothing under the OS temp directory is registered.');
            setStatusKind('ok');
            return;
          }
          setMode({ kind: 'confirm-forget-temp', total: temps });
          return;
        }
        if (input === 'U') {
          if (rows.length === 0) {
            setStatus('No projects to update.');
            setStatusKind('ok');
            return;
          }
          setMode({ kind: 'confirm-update-all', total: rows.length });
          return;
        }
        if (key.return) {
          if (focusIdx === addRowIdx) {
            setMode({ kind: 'adding', draft: '' });
            return;
          }
          if (focusIdx < rows.length) {
            setMode({ kind: 'actions', rowIdx: focusIdx, actionIdx: 0 });
            return;
          }
        }
        return;
      }
      if (mode.kind === 'actions') {
        const focusedRow = rows[mode.rowIdx];
        const availableActions = focusedRow ? actionsForRow(focusedRow) : [];
        if (key.escape) {
          setMode({ kind: 'list' });
          return;
        }
        if (key.upArrow) {
          setMode({ kind: 'actions', rowIdx: mode.rowIdx, actionIdx: Math.max(0, mode.actionIdx - 1) });
          return;
        }
        if (key.downArrow) {
          setMode({
            kind: 'actions',
            rowIdx: mode.rowIdx,
            actionIdx: Math.min(availableActions.length - 1, mode.actionIdx + 1),
          });
          return;
        }
        if (key.return) {
          const row = focusedRow;
          const action = availableActions[mode.actionIdx];
          if (!row || !action) return;
          if (action.id === 'run-workflow') {
            openWorkflowList(row.entry, mode.rowIdx);
            return;
          }
          if (action.id === 'project-settings') {
            setMode({ kind: 'project-settings', rowIdx: mode.rowIdx, focusIdx: 0 });
            return;
          }
          if (action.id === 'update') {
            void updateOne(row.entry);
            return;
          }
          if (action.id === 'doctor') {
            void doctorProject(row.entry, mode.rowIdx);
            return;
          }
          if (action.id === 'relink') {
            setMode({ kind: 'relinking', rowIdx: mode.rowIdx });
            return;
          }
          if (action.id === 'unregister') {
            const removed = registry.unregister(row.entry.path);
            refresh();
            setMode({ kind: 'list' });
            setStatus(
              removed ? `Unregistered ${row.entry.slug} (project files left intact).` : `Already gone: ${row.entry.slug}.`,
            );
            setStatusKind('ok');
            setFocusIdx((i) => Math.min(i, rows.length - 1 < 0 ? 0 : rows.length - 1));
            return;
          }
        }
      }
    },
    { isActive: active },
  );

  if (!active) return <Box />;

  if (mode.kind === 'busy') {
    return (
      <Box flexDirection="column">
        <Text bold color={theme.brand}>
          Projects
        </Text>
        <Box marginTop={1} flexDirection="column" borderStyle="round" borderColor={theme.warning} paddingX={1}>
          <Text color={theme.warning} bold>
            ⏳ {mode.message}
          </Text>
        </Box>
      </Box>
    );
  }
  if (mode.kind === 'done' || mode.kind === 'error') {
    const variant = mode.kind === 'done' ? 'success' : 'error';
    const color = mode.kind === 'done' ? theme.success : theme.danger;
    return (
      <Box flexDirection="column">
        <Text bold color={theme.brand}>
          Projects
        </Text>
        <Box marginTop={1} flexDirection="column" borderStyle="round" borderColor={color} paddingX={1}>
          <StatusMessage variant={variant}>{mode.message}</StatusMessage>
          <Text color={theme.muted}>Press Enter or Esc to continue.</Text>
        </Box>
      </Box>
    );
  }
  if (mode.kind === 'confirm-forget-temp') {
    return (
      <Box flexDirection="column">
        <Text bold color={theme.brand}>
          Projects — Forget temporary
        </Text>
        <Box marginTop={1} flexDirection="column" borderStyle="round" borderColor={theme.brand} paddingX={1}>
          <Text color={theme.brand} bold>
            Forget {mode.total} project(s) registered under the OS temp directory?
          </Text>
          <Box marginTop={1}>
            <Text color={theme.muted}>
              Registry only — the directories stay. Remove them afterwards with: riglane projects forget --temp --delete
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text color={theme.highlight}>y</Text>
            <Text color={theme.muted}> proceed   </Text>
            <Text color={theme.highlight}>n</Text>
            <Text color={theme.muted}> cancel</Text>
          </Box>
        </Box>
      </Box>
    );
  }
  if (mode.kind === 'confirm-update-all') {
    return (
      <Box flexDirection="column">
        <Text bold color={theme.brand}>
          Projects — Update all
        </Text>
        <Box marginTop={1} flexDirection="column" borderStyle="round" borderColor={theme.brand} paddingX={1}>
          <Text color={theme.brand} bold>
            Run `riglane update` against all {mode.total} registered project(s)?
          </Text>
          <Box marginTop={1}>
            <Text color={theme.muted}>
              Stops on no failure (continues per-project), reports a roll-up at the end.
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text color={theme.highlight}>y</Text>
            <Text color={theme.muted}> proceed   </Text>
            <Text color={theme.highlight}>n</Text>
            <Text color={theme.muted}> cancel</Text>
          </Box>
        </Box>
      </Box>
    );
  }
  if (mode.kind === 'actions') {
    const row = rows[mode.rowIdx];
    if (!row) {
      return <Box />;
    }
    const availableActions = actionsForRow(row);
    const installedLabels = [...row.entry.adapters]
      .sort((a, b) => ADAPTERS[a].label.localeCompare(ADAPTERS[b].label))
      .map((a) => ADAPTERS[a].label);
    const hasMissingIntegrations = missingAdapters(row.entry.adapters).length > 0;
    return (
      <Box flexDirection="column">
        <Text bold color={theme.brand}>
          {row.entry.slug}
        </Text>
        <Text color={theme.hint}>{row.entry.path}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text bold color={theme.brand}>
            Integrations (hosts)
          </Text>
          <Text wrap="wrap">
            {installedLabels.length > 0 ? installedLabels.join(' · ') : '(none installed)'}
          </Text>
          {hasMissingIntegrations ? (
            <Text color={theme.hint}>
              More available — add via Project Settings → Add integration (host)
            </Text>
          ) : null}
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text bold color={theme.brand}>
            Actions
          </Text>
          {availableActions.map((a, i) => {
            const focused = i === mode.actionIdx;
            const marker = focused ? CURSOR : ' ';
            const color = focused ? theme.accent : a.destructive ? theme.danger : undefined;
            const colorProps = color !== undefined ? { color } : {};
            return (
              <Box key={a.id}>
                <Text {...colorProps} bold={focused}>
                  {marker}  {a.label}
                  {a.destructive ? '  ⚠' : ''}
                </Text>
              </Box>
            );
          })}
          <Box marginTop={1}>
            <Text color={theme.muted}>↑/↓ move   ·   Enter pick   ·   Esc back</Text>
          </Box>
        </Box>
      </Box>
    );
  }
  if (mode.kind === 'adding') {
    return (
      <Box flexDirection="column">
        <Text bold color={theme.brand}>
          Projects — Add new
        </Text>
        <Box marginTop={1}>
          <Text color={theme.muted}>
            Enter the absolute or relative path to a project directory.
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.accent} bold>
            {CURSOR}{' '}
          </Text>
          <Text color={theme.muted}>path: </Text>
          <TextInput
            defaultValue=""
            onSubmit={(v) => {
              const trimmed = v.trim();
              if (trimmed.length === 0) {
                setMode({ kind: 'list' });
                setStatus('Empty path — nothing added.');
                setStatusKind('ok');
                return;
              }
              const detected = detectedAdapterIds();
              setMode({
                kind: 'adding-adapters',
                path: trimmed,
                focusIdx: 0,
                selected: Object.fromEntries(
                  offeredAdapters([]).filter((a) => detected.has(a)).map((a) => [a, true]),
                ),
                existing: [],
                specGuidance: true,
              });
            }}
            placeholder="/abs/path/to/project"
          />
        </Box>
        <Box marginTop={1}>
          <Text color={theme.muted}>Enter to continue · Esc to cancel</Text>
        </Box>
      </Box>
    );
  }
  if (mode.kind === 'adding-adapters') {
    const isAdding = mode.existing.length > 0;
    const offered = offeredAdapters(mode.existing);
    const anySelected = offered.some((a) => mode.selected[a] === true);
    const submitLabel = isAdding
      ? anySelected
        ? 'Add selected'
        : 'Add selected (none chosen)'
      : anySelected
        ? 'Install'
        : 'Install (select at least one integration)';
    const submitIdx = offered.length + (isAdding ? 0 : 1);
    return (
      <Box flexDirection="column">
        <Text bold color={theme.brand}>
          {isAdding ? 'Projects — Add integration' : 'Projects — Select adapters'}
        </Text>
        <Box marginTop={1}>
          <Text color={theme.muted}>Path: {mode.path}</Text>
        </Box>
        {isAdding && (
          <Box>
            <Text color={theme.muted}>
              Installed: {mode.existing.map((a) => ADAPTERS[a].label).join(', ') || '(none)'}
            </Text>
          </Box>
        )}
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.muted}>Integrations to install:</Text>
          {offered.map((a, i) => {
            const focused = i === mode.focusIdx;
            const on = mode.selected[a] === true;
            return (
              <Box key={a}>
                <Text {...(focused ? { color: theme.brand } : {})}>
                  {focused ? CURSOR : ' '}
                </Text>
                <Text color={on ? 'green' : theme.muted} bold={focused}>
                  {' '}
                  {on ? '[✓]' : '[ ]'} {ADAPTERS[a].label}
                </Text>
              </Box>
            );
          })}
          {!isAdding && (
            <Box marginTop={1}>
              <Text color={theme.muted}>Project settings:</Text>
            </Box>
          )}
          {!isAdding && (
            <Box>
              <Text {...(mode.focusIdx === offered.length ? { color: theme.brand } : {})}>
                {mode.focusIdx === offered.length ? CURSOR : ' '}
              </Text>
              <Text
                color={mode.specGuidance ? 'green' : theme.muted}
                bold={mode.focusIdx === offered.length}
              >
                {' '}
                {mode.specGuidance ? '[✓]' : '[ ]'} Spec-guidance — agents consult & propose behavioral specs
              </Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text {...(mode.focusIdx === submitIdx ? { color: theme.brand } : {})}>
              {mode.focusIdx === submitIdx ? CURSOR : ' '}
            </Text>
            <Text
              bold={mode.focusIdx === submitIdx}
              color={mode.focusIdx === submitIdx ? theme.brand : theme.muted}
            >
              {' '}
              {submitLabel}
            </Text>
          </Box>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.muted}>↑/↓ navigate · Enter toggle/confirm · Esc cancel</Text>
        </Box>
      </Box>
    );
  }
  if (mode.kind === 'project-settings') {
    const psEntry = rows[mode.rowIdx]?.entry;
    if (!psEntry) return <Box />;
    const psHasMissing = missingAdapters(psEntry.adapters).length > 0;
    const sgOn = psEntry.specGuidance ?? true;
    let i = 0;
    const addIdx = psHasMissing ? i++ : -1;
    const sgIdx = i++;
    const backIdx = i++;
    return (
      <Box flexDirection="column">
        <Text bold color={theme.brand}>
          Project Settings — {psEntry.slug}
        </Text>
        <Box marginTop={1}>
          <Text color={theme.muted}>{psEntry.path}</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          {psHasMissing && (
            <Box>
              <Text {...(mode.focusIdx === addIdx ? { color: theme.brand } : {})}>
                {mode.focusIdx === addIdx ? CURSOR : ' '}
              </Text>
              <Text
                bold={mode.focusIdx === addIdx}
                color={mode.focusIdx === addIdx ? theme.brand : theme.muted}
              >
                {' '}
                Add integration (host)
              </Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text color={theme.muted}>Settings:</Text>
          </Box>
          <Box>
            <Text {...(mode.focusIdx === sgIdx ? { color: theme.brand } : {})}>
              {mode.focusIdx === sgIdx ? CURSOR : ' '}
            </Text>
            <Text color={sgOn ? 'green' : theme.muted} bold={mode.focusIdx === sgIdx}>
              {' '}
              {sgOn ? '[✓]' : '[ ]'} Spec-guidance — agents consult & propose behavioral specs
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text {...(mode.focusIdx === backIdx ? { color: theme.brand } : {})}>
              {mode.focusIdx === backIdx ? CURSOR : ' '}
            </Text>
            <Text
              bold={mode.focusIdx === backIdx}
              color={mode.focusIdx === backIdx ? theme.brand : theme.muted}
            >
              {' '}
              ← Back
            </Text>
          </Box>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.muted}>↑/↓ navigate · Enter select/toggle · Esc back</Text>
        </Box>
      </Box>
    );
  }
  if (mode.kind === 'doctor-output') {
    const row = rows[mode.rowIdx];
    if (!row) return <Box />;
    const allLines = mode.output.split('\n');
    const VISIBLE_ROWS = Math.max(5, vpRows - 4);
    const maxScroll = Math.max(0, allLines.length - VISIBLE_ROWS);
    const scroll = Math.min(mode.scroll, maxScroll);
    const visible = allLines.slice(scroll, scroll + VISIBLE_ROWS);
    const status =
      mode.exitCode === 0 ? { text: 'All checks passed', color: theme.success }
        : { text: `Exit code ${mode.exitCode} — issues found`, color: theme.danger };
    const positionHint =
      allLines.length > VISIBLE_ROWS
        ? `lines ${scroll + 1}–${Math.min(scroll + VISIBLE_ROWS, allLines.length)} of ${allLines.length}`
        : `${allLines.length} lines`;
    return (
      <Box flexDirection="column">
        <Text bold color={theme.brand}>
          {row.entry.slug} — Doctor
        </Text>
        <Text color={theme.hint}>{row.entry.path}</Text>
        <Box marginTop={1}>
          <Text color={status.color} bold>
            {status.text}
          </Text>
          <Text color={theme.muted}>{'   ·   '}{positionHint}</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          {visible.map((line, i) => {
            let color: string | undefined;
            if (line.includes('[OK]')) color = theme.success;
            else if (line.includes('[FAILED]') || line.includes('[FAIL]')) color = theme.danger;
            else if (line.includes('[WARN]') || line.includes('FIXED:') || line.includes('SKIP:')) color = theme.warning;
            const colorProps = color !== undefined ? { color } : {};
            return (
              <Text key={`${scroll}-${i}`} {...colorProps}>
                {line.length > 0 ? line : ' '}
              </Text>
            );
          })}
        </Box>
        <Box marginTop={1}>
          <Text color={theme.muted}>
            ↑/↓ scroll · j/k page · Enter/Esc back
            {mode.exitCode !== 0 ? ' · f fix all issues' : ''}
          </Text>
        </Box>
      </Box>
    );
  }
  if (mode.kind === 'relinking') {
    const row = rows[mode.rowIdx];
    if (!row) return <Box />;
    return (
      <Box flexDirection="column">
        <Text bold color={theme.brand}>
          {row.entry.slug} — Relink
        </Text>
        <Text color={theme.hint}>old path: {row.entry.path}</Text>
        <Box marginTop={1}>
          <Text color={theme.muted}>
            Enter the project's new location on disk. The path must contain `{PROJECT_ID_REL}`
            with an id matching this entry; otherwise the relink is rejected.
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.accent} bold>
            {CURSOR}{' '}
          </Text>
          <Text color={theme.muted}>new path: </Text>
          <TextInput
            defaultValue=""
            onSubmit={(v) => {
              void relinkProject(row.entry, v);
            }}
            placeholder="/abs/path/to/moved-project"
          />
        </Box>
        <Box marginTop={1}>
          <Text color={theme.muted}>Enter to submit · Esc to cancel</Text>
        </Box>
      </Box>
    );
  }

  if (mode.kind === 'wf-list') {
    const row = rows[mode.rowIdx];
    if (!row) return <Box />;
    const flatWf = mode.groups.flatMap((g) => g.workflows.map((wf) => ({ bucket: g.bucket, wf })));
    const wfGap = vpRows <= 12 ? 0 : 1;
    const fDescLines = vpRows <= 12 ? 1 : vpRows <= 20 ? 2 : 4;
    const fDescCap = fDescLines * 78;
    const wfCap = Math.max(2, vpRows - 3 - mode.groups.length - fDescLines);
    const wfWin = windowAround(flatWf.length, mode.focusIdx, wfCap);
    let lastBucket: string | null = null;
    return (
      <Box flexDirection="column">
        <Text bold color={theme.brand}>
          {row.entry.slug} — Run Workflow
        </Text>
        <Text color={theme.hint}>{row.entry.path}</Text>
        <Box marginTop={wfGap} flexDirection="column">
          <MoreRow count={wfWin.start} dir="up" />
          {flatWf.slice(wfWin.start, wfWin.end).map((item, j) => {
            const myIdx = wfWin.start + j;
            const focused = myIdx === mode.focusIdx;
            const wf = item.wf;
            const desc = wf.description.replace(/\s+/g, ' ').trim();
            const short = desc.length > 50 ? `${desc.slice(0, 50).trimEnd()}…` : desc;
            const focusedDesc = desc.length > fDescCap ? `${desc.slice(0, fDescCap).trimEnd()}…` : desc;
            const header =
              item.bucket !== lastBucket ? (
                <Text bold underline color={theme.muted}>
                  {item.bucket}
                </Text>
              ) : null;
            lastBucket = item.bucket;
            return (
              <Box key={wf.path} flexDirection="column" marginTop={header && myIdx !== wfWin.start ? 1 : 0}>
                {header}
                <Box>
                  {}
                  <Box flexShrink={0}>
                    <Text bold={focused} color={focused ? theme.brand : theme.tabInactive}>
                      {focused ? CURSOR : ' '} {wf.name}
                    </Text>
                  </Box>
                  {!focused && short ? (
                    <Box flexShrink={1} marginLeft={1}>
                      <Text color={theme.hint} wrap="truncate-end">
                        — {short}
                      </Text>
                    </Box>
                  ) : null}
                </Box>
                {}
                {focused && focusedDesc ? (
                  <Box marginLeft={4}>
                    <Text color={theme.muted} italic>
                      {focusedDesc}
                    </Text>
                  </Box>
                ) : null}
              </Box>
            );
          })}
          <MoreRow count={flatWf.length - wfWin.end} dir="down" />
        </Box>
        <Box marginTop={wfGap}>
          <Text color={theme.muted}>↑/↓ navigate · Enter select · Esc back</Text>
        </Box>
      </Box>
    );
  }
  if (mode.kind === 'wf-run') {
    const entry = rows[mode.rowIdx]?.entry;
    if (!entry) return <Box />;
    const wrGap = vpRows <= 12 ? 0 : 1;
    const showSubtitle = vpRows > 18;
    const subTabDivider = '─'.repeat(Math.max(1, cols - 5));
    const headerLines =
      1 + (showSubtitle ? 1 : 0) + 1 + 1 + 1;

    const headerBlock = (
      <>
        <Text bold color={theme.brand}>
          {entry.slug} — {mode.wf.name}
        </Text>
        {showSubtitle ? (
          <Text color={theme.hint} wrap="truncate-end">
            {mode.wf.bucket}
            {mode.wf.description ? ` · ${mode.wf.description.replace(/\s+/g, ' ').trim()}` : ''}
          </Text>
        ) : null}
        <Text color={theme.muted}>{subTabDivider}</Text>
        <Box>
          {WF_SUBTABS.map((t) => (
            <Box key={t} marginRight={2}>
              <Text bold={mode.subTab === t} color={mode.subTab === t ? theme.brand : theme.tabInactive}>
                {WF_SUBTAB_LABELS[t]}
              </Text>
            </Box>
          ))}
        </Box>
        <Text color={theme.hint}>tab / shift+tab to switch</Text>
      </>
    );
    const statusBlock =
      status !== null ? (
        <Box marginTop={wrGap}>
          <StatusMessage variant={statusKind === 'error' ? 'error' : 'success'}>{status}</StatusMessage>
        </Box>
      ) : null;

    if (mode.subTab === 'parameters') {
      const pDescLines = vpRows <= 12 ? 1 : vpRows <= 20 ? 2 : 4;
      const pDescCap = pDescLines * 78;
      const pCap = Math.max(2, vpRows - headerLines - 1 - 2 - pDescLines);
      const pWin = windowAround(mode.wf.params.length, mode.focusIdx, pCap);
      return (
        <Box flexDirection="column">
          {headerBlock}
          <Box marginTop={wrGap} flexDirection="column">
            {mode.wf.params.length === 0 ? (
              <Text color={theme.hint}>{'  '}(no parameters)</Text>
            ) : (
              <>
                <MoreRow count={pWin.start} dir="up" />
                {mode.wf.params.slice(pWin.start, pWin.end).map((p, j) => {
                  const i = pWin.start + j;
                  const focused = i === mode.focusIdx;
                  const val = mode.values[p.name] ?? '';
                  const tag =
                    p.category === 'required'
                      ? { text: 'required', color: theme.danger }
                      : p.category === 'predefined'
                        ? { text: `default: ${p.defaultText}`, color: theme.muted }
                        : { text: 'optional', color: theme.muted };
                  const pDesc = (p.description ?? '').replace(/\s+/g, ' ').trim();
                  const pDescShown =
                    pDesc.length > pDescCap ? `${pDesc.slice(0, pDescCap).trimEnd()}…` : pDesc;
                  return (
                    <Box key={`p-${p.name}`} flexDirection="column">
                      <Box>
                        <Text {...(focused ? { color: theme.brand } : {})}>{focused ? CURSOR : ' '}</Text>
                        <Text bold={focused} color={focused ? theme.brand : theme.tabInactive}>
                          {' '}
                          {p.name}
                          {'  '}
                        </Text>
                        {focused && mode.editing ? (
                          <TextInput
                            key={`ti-${p.name}-${mode.editNonce}`}
                            defaultValue={val}
                            placeholder={p.defaultText || p.name}
                            onSubmit={(v) => {
                              const value = v.trim();
                              saveWorkflowParam(projectKeyOf(entry), mode.wf.name, p.name, value);
                              setMode({ ...mode, values: { ...mode.values, [p.name]: value }, editing: false });
                            }}
                          />
                        ) : val ? (
                          <Text color={theme.accent}>{val}</Text>
                        ) : (
                          <Text color={tag.color}>{tag.text}</Text>
                        )}
                      </Box>
                      {}
                      {focused && !mode.editing && pDescShown ? (
                        <Box marginLeft={4}>
                          <Text color={theme.muted} italic>
                            {pDescShown}
                          </Text>
                        </Box>
                      ) : null}
                    </Box>
                  );
                })}
                <MoreRow count={mode.wf.params.length - pWin.end} dir="down" />
              </>
            )}
          </Box>
          <Box marginTop={wrGap}>
            <Text color={theme.muted}>
              {mode.editing
                ? 'Enter save · ctrl+u clear field · Esc cancel'
                : '↑/↓ navigate · Enter edit · tab switch · Esc back'}
            </Text>
          </Box>
          {statusBlock}
        </Box>
      );
    }

    if (mode.subTab === 'run') {
      const activeRun = readActiveRun(entry.path, mode.wf.name);
      const focusedAdapter = mode.adapters[mode.focusIdx];
      const previewAdapter =
        focusedAdapter ?? mode.adapters.find((a) => a.name === mode.target) ?? mode.adapters[0];
      const preview = previewAdapter
        ? buildPreviewCommand({ adapter: previewAdapter, workflow: mode.wf.name, dir: entry.path, paramArgs: buildParamArgs(mode.wf.params, mode.values), modelOverride: mode.modelOverride })
        : '';
      const showPreview = vpRows > 16 && !!preview;
      const aCap = Math.max(
        2,
        vpRows -
          headerLines -
          (activeRun ? 2 : 0) -
          1 -
          3 -
          2 -
          2 -
          (showPreview ? 2 : 0) -
          1 -
          1,
      );
      const aWin = windowAround(mode.adapters.length, mode.focusIdx, aCap);
      let lastGroup = '';
      return (
        <Box flexDirection="column">
          {headerBlock}
          <Box marginTop={wrGap} flexDirection="column">
            <Text bold underline color={theme.muted}>
              Run With
            </Text>
            <MoreRow count={aWin.start} dir="up" />
            {mode.adapters.slice(aWin.start, aWin.end).map((a, j) => {
              const i = aWin.start + j;
              const focused = i === mode.focusIdx;
              const showGroup = a.group !== lastGroup;
              lastGroup = a.group;
              const stt = runAdapterStatus(a);
              const st2 =
                stt.kind === 'ok'
                  ? { text: `✓ ${stt.text}`, color: theme.success }
                  : stt.kind === 'disabled'
                    ? { text: `– ${stt.text}`, color: theme.muted }
                    : { text: `✗ ${stt.text}`, color: theme.danger };
              return (
                <Box key={`a-${a.name}`} flexDirection="column">
                  {showGroup ? (
                    <Text color={theme.muted}>
                      {'  '}
                      {a.group}
                    </Text>
                  ) : null}
                  <Box>
                    <Text {...(focused ? { color: theme.brand } : {})}>
                      {'  '}
                      {focused ? CURSOR : ' '}
                    </Text>
                    <Text bold={focused} color={focused ? theme.brand : theme.tabInactive}>
                      {' '}
                      {a.label}
                      {'  '}
                    </Text>
                    <Text color={st2.color}>{st2.text}</Text>
                  </Box>
                </Box>
              );
            })}
            <MoreRow count={mode.adapters.length - aWin.end} dir="down" />
          </Box>
          <Box marginTop={wrGap} flexDirection="column">
            <Text bold underline color={theme.muted}>
              Model Override
            </Text>
            <Box>
              {}
              <Box flexShrink={0}>
                <Text color={theme.brand}>
                  {'  '}
                  {modelOverrideLabel(mode.modelOverride)}
                </Text>
              </Box>
              <Box flexShrink={1}>
                <Text color={theme.muted} wrap="truncate-end">
                  {'  — press m to cycle ('}
                  {MODEL_OVERRIDE_CHOICES.map(modelOverrideLabel).join(' · ')}
                  {'); overrides model for all subagent steps'}
                </Text>
              </Box>
            </Box>
          </Box>
          {showPreview ? (
            <Box marginTop={wrGap} flexDirection="column">
              <Text bold underline color={theme.muted}>
                Command Preview
              </Text>
              <Text color={theme.hint} wrap="truncate-end">
                {'  '}
                {preview}
              </Text>
            </Box>
          ) : null}
          {activeRun ? (
            <Box marginTop={wrGap}>
              <Text color={theme.warning}>
                {activeRun.state === 'running'
                  ? `⚠ A run is WORKING right now (${activeRun.runId.split('-').pop()}` +
                    `${activeRun.startedAt ? `, started ${activeRun.startedAt.slice(11, 16)}` : ''}) — ` +
                    `Enter starts a fresh run alongside it.`
                  : activeRun.state === 'waiting'
                    ? `⚠ A run is WAITING FOR YOUR ANSWER${activeRun.currentStep ? ` at '${activeRun.currentStep}'` : ''} ` +
                      `(${activeRun.runId.split('-').pop()}) — Enter shows the choices.`
                    : `⚠ A run STOPPED unfinished${activeRun.currentStep ? ` at '${activeRun.currentStep}'` : ''} ` +
                      `(${activeRun.runId.split('-').pop()}) — Enter offers to continue it.`}
              </Text>
            </Box>
          ) : null}
          {mode.runChoice ? (
            <Box marginTop={1} flexDirection="column" borderStyle="round" borderColor={theme.brand} paddingX={1}>
              <Text bold color={theme.brand}>
                {mode.runChoice.state === 'stalled'
                  ? `Continue the stopped run?`
                  : `This run is waiting for YOUR answer`}
              </Text>
              <Text color={theme.muted}>
                {mode.runChoice.state === 'stalled'
                  ? `Run ${mode.runChoice.runId} stopped${mode.runChoice.step ? ` at '${mode.runChoice.step}'` : ''} with nothing left to wait for — its work so far is intact, and continuing picks up exactly there.`
                  : `Run ${mode.runChoice.runId} holds${mode.runChoice.step ? ` at '${mode.runChoice.step}'` : ''} until you answer (Studio → Messages, or the app that asked). Continuing now would RE-ASK the question instead of answering it.`}
              </Text>
              <Text color={theme.hint}>
                {mode.runChoice.state === 'stalled'
                  ? 'Enter continue · f fresh run alongside · c clear it (finalize as failed) · Esc back'
                  : 'Enter back (answer first) · f fresh run alongside · c clear it (finalize as failed) · Esc back'}
              </Text>
            </Box>
          ) : null}
          {}
          <Box marginTop={activeRun ? 1 : wrGap}>
            {mode.skipApprovals ? (
              <Text color={theme.warning}>
                ⚠ Skip approvals: ON — agent auto-approves every action
                {mode.target.startsWith('codex') ? ' (+ sandbox OFF)' : ''}. Press s to disable.
              </Text>
            ) : (
              <Text color={theme.muted}>Skip approvals: off — press s to enable (auto-approve, no prompts)</Text>
            )}
          </Box>
          <Box marginTop={wrGap}>
            <Text color={theme.muted}>
              ↑/↓ navigate · Enter launch · s skip-approvals · m model{activeRun ? ' · c clear' : ''} · tab switch · Esc back
            </Text>
          </Box>
          {statusBlock}
        </Box>
      );
    }

    const tCap = Math.max(2, vpRows - headerLines - 1 - 2);
    const tWin = windowAround(mode.traces.length, mode.focusIdx, tCap);
    const stateColor = (s: TraceMeta['state']): string =>
      s === 'completed'
        ? theme.success
        : s === 'failed'
          ? theme.danger
          : s === 'in-progress'
            ? theme.accent
            : theme.muted;
    return (
      <Box flexDirection="column">
        {headerBlock}
        <Box marginTop={wrGap} flexDirection="column">
          {mode.traces.length === 0 ? (
            <Text color={theme.hint}>{'  '}(no trace runs yet)</Text>
          ) : (
            <>
              <MoreRow count={tWin.start} dir="up" />
              {mode.traces.slice(tWin.start, tWin.end).map((tr, j) => {
                const i = tWin.start + j;
                const focused = i === mode.focusIdx;
                const when = tr.startedAt ? `${tr.startedAt.slice(5, 10)} ${tr.startedAt.slice(11, 16)}` : '—';
                return (
                  <Box key={tr.serverPath}>
                    <Text {...(focused ? { color: theme.brand } : {})}>{focused ? CURSOR : ' '}</Text>
                    <Text bold={focused} color={focused ? theme.brand : theme.tabInactive}>
                      {' '}
                      {when} · {tr.shortId}
                      {'  '}
                    </Text>
                    <Text color={stateColor(tr.state)}>{tr.state}</Text>
                  </Box>
                );
              })}
              <MoreRow count={mode.traces.length - tWin.end} dir="down" />
            </>
          )}
        </Box>
        <Box marginTop={wrGap}>
          <Text color={theme.muted}>↑/↓ navigate · Enter open in browser · tab switch · Esc back</Text>
        </Box>
        {statusBlock}
      </Box>
    );
  }

  const listItems = [
    ...rows.map((r, idx) => (
      <ProjectRowView key={r.entry.path} row={r} focused={idx === focusIdx} />
    )),
    <AddNewRow key="__add_new__" focused={focusIdx === addRowIdx} />,
  ];
  const driftShown = driftSummary.ood > 0 || driftSummary.gone > 0 || driftSummary.temp > 0;
  const dense = vpRows <= 12;
  const gap = dense ? 0 : 1;
  const driftText = [
    driftSummary.ood > 0 ? `${driftSummary.ood} outdated` : '',
    driftSummary.gone > 0 ? `${driftSummary.gone} path-gone` : '',
    driftSummary.temp > 0 ? `${driftSummary.temp} temporary (T to forget)` : '',
  ].filter(Boolean).join(' · ');
  const listReserve =
    1 +
    gap +
    1 +
    2 +
    gap +
    1 +
    (driftShown ? (dense ? 1 : 3 + gap) : 0) +
    (status !== null ? 1 + gap : 0);
  const listCap = Math.max(3, vpRows - listReserve);
  const listWin = windowAround(listItems.length, focusIdx, listCap);
  return (
    <Box flexDirection="column">
      <Text bold color={theme.brand}>
        Projects ({rows.length})
      </Text>
      {rows.length > 0 ? (
        <Box marginTop={gap} flexDirection="column">
          <ProjectsHeader />
          <MoreRow count={listWin.start} dir="up" />
          {listItems.slice(listWin.start, listWin.end)}
          <MoreRow count={listItems.length - listWin.end} dir="down" />
        </Box>
      ) : (
        <Box marginTop={gap} flexDirection="column">
          <Text color={theme.hint}>No projects registered yet.</Text>
          <Box marginTop={gap} flexDirection="column">
            <AddNewRow focused={focusIdx === addRowIdx} />
          </Box>
        </Box>
      )}
      {driftShown &&
        (dense ? (
          <Text color={theme.warning}>⚠ {driftText}</Text>
        ) : (
          <Box marginTop={gap}>
            <Alert variant="warning">{driftText}</Alert>
          </Box>
        ))}
      <Box marginTop={gap}>
        <Text color={theme.hint}>Enter actions   ·   D doctor   ·   r refresh   ·   U update all   ·   T forget temporary</Text>
      </Box>
      {status !== null && (
        <Box marginTop={gap}>
          <StatusMessage variant={statusKind === 'error' ? 'error' : 'success'}>
            {status}
          </StatusMessage>
        </Box>
      )}
    </Box>
  );
}

const PROJ_COLS = {
  marker: 2,
  project: 22,
  version: 13,
  status: 13,
} as const;

function ProjectsHeader(): React.JSX.Element {
  const theme = useTheme();
  return (
    <Box>
      <Box width={PROJ_COLS.marker} />
      <Box width={PROJ_COLS.project}>
        <Text color={theme.muted} bold>
          PROJECT
        </Text>
      </Box>
      <Box width={PROJ_COLS.version}>
        <Text color={theme.muted} bold>
          VERSION
        </Text>
      </Box>
      <Box width={PROJ_COLS.status}>
        <Text color={theme.muted} bold>
          STATUS
        </Text>
      </Box>
      <Box flexGrow={1}>
        <Text color={theme.muted} bold>
          PATH
        </Text>
      </Box>
    </Box>
  );
}

function ProjectRowView({
  row,
  focused,
}: {
  row: ProjectRow;
  focused: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  const { entry: e, probe: p } = row;
  const marker = focused ? CURSOR : ' ';
  const color = focused ? theme.accent : theme.tabInactive;
  const colorProps = { color };
  const driftC = driftColor(p.drift, theme);
  const driftProps = driftC !== undefined ? { color: driftC } : {};
  const versionCell = p.markerVersion ?? '—';
  return (
    <Box>
      <Box width={PROJ_COLS.marker}>
        <Text {...colorProps} bold={focused}>
          {marker}
        </Text>
      </Box>
      <Box width={PROJ_COLS.project}>
        <Text {...colorProps} bold={focused} wrap="truncate-end">
          {e.slug}
        </Text>
      </Box>
      <Box width={PROJ_COLS.version}>
        <Text {...colorProps} bold={focused} wrap="truncate-end">
          {versionCell}
        </Text>
      </Box>
      <Box width={PROJ_COLS.status}>
        <Text {...driftProps} bold={focused}>
          {driftLabel(p.drift)}
        </Text>
      </Box>
      <Box flexGrow={1}>
        <Text {...colorProps} bold={focused} wrap="truncate-middle">
          {p.temporary ? 'temp · ' : ''}{e.path}
        </Text>
      </Box>
    </Box>
  );
}

function driftColor(d: DriftStatus, theme: { success: string; warning: string; danger: string }): string | undefined {
  if (d === 'up-to-date') return theme.success;
  if (d === 'outdated') return theme.warning;
  if (d === 'missing-marker') return theme.warning;
  if (d === 'no-agent-dir') return theme.danger;
  if (d === 'path-gone') return theme.danger;
  return undefined;
}

function AddNewRow({ focused }: { focused: boolean }): React.JSX.Element {
  const theme = useTheme();
  const marker = focused ? CURSOR : ' ';
  const color = focused ? theme.accent : theme.tabInactive;
  return (
    <Box marginTop={1}>
      <Text color={color} bold={focused}>
        {marker}  + Add new project (riglane init &lt;path&gt;)
      </Text>
    </Box>
  );
}


function nextTab(cur: TabName): TabName {
  const idx = TABS.indexOf(cur);
  return TABS[(idx + 1) % TABS.length] as TabName;
}

function prevTab(cur: TabName): TabName {
  const idx = TABS.indexOf(cur);
  return TABS[(idx - 1 + TABS.length) % TABS.length] as TabName;
}


const ALT_SCREEN_ENTER = '\x1b[?1049h\x1b[H';
const ALT_SCREEN_EXIT = '\x1b[?1049l';

export async function runWizardInk(): Promise<number> {
  let exited = false;
  let inAlt = false;
  const enterAlt = (): void => {
    if (!inAlt) {
      process.stdout.write(ALT_SCREEN_ENTER);
      inAlt = true;
    }
  };
  const exitAlt = (): void => {
    if (inAlt) {
      process.stdout.write(ALT_SCREEN_EXIT);
      inAlt = false;
    }
  };
  const restore = (): void => {
    if (exited) return;
    exited = true;
    exitAlt();
  };

  process.once('exit', restore);
  const onSignal = (signal: NodeJS.Signals) => (): void => {
    restore();
    process.kill(process.pid, signal);
  };
  process.once('SIGINT', onSignal('SIGINT'));
  process.once('SIGTERM', onSignal('SIGTERM'));

  let launchArgs: string[] | null = null;
  let resumeTarget: LaunchResume | null = null;
  const onLaunch = (args: string[], resume: LaunchResume): void => {
    launchArgs = args;
    resumeTarget = resume;
  };
  let cliTask: CommunityCliTask | null = null;
  const onCliTask = (task: CommunityCliTask): void => {
    cliTask = task;
  };

  try {
    let nextResume: LaunchResume | undefined;
    let nextTab: TabName | undefined;
    let nextPost: CommunityPostStep | undefined;
    for (;;) {
      launchArgs = null;
      resumeTarget = null;
      cliTask = null;
      enterAlt();
      const resumeProp = nextResume;
      const postProp = nextPost;
      const { waitUntilExit } = render(
        <App
          onLaunch={onLaunch}
          onCliTask={onCliTask}
          {...(resumeProp ? { initialResume: resumeProp } : {})}
          {...(nextTab ? { initialTab: nextTab } : {})}
          {...(postProp ? { initialPost: postProp } : {})}
        />,
      );
      await waitUntilExit();
      exitAlt();
      if (process.stdin.isTTY && process.stdin.isRaw) process.stdin.setRawMode(false);
      process.stdin.pause();
      nextResume = undefined;
      nextTab = undefined;
      nextPost = undefined;
      if (cliTask !== null) {
        const t: CommunityCliTask = cliTask;
        const cliPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'index.js');
        const argv =
          t.kind === 'init'
            ? ['init-workflow', t.id]
            : t.kind === 'update'
              ? ['update', t.wfId, ...(t.entryDir !== undefined ? [t.entryDir] : [])]
              : [t.kind, t.id];
        const r = spawnSync(process.execPath, [cliPath, ...argv], { stdio: 'inherit', cwd: t.cwd });
        if (r.error) process.stderr.write(`${t.kind}: ${r.error.message}\n`);
        waitForEnterSync('\nPress Enter to return to riglane ui… ');
        nextTab = 'Community';
        if (r.status === 0) {
          const stage =
            t.kind === 'add' || t.kind === 'update' ? 'trust' : t.kind === 'trust' ? 'init' : 'restart';
          nextPost = { stage, wfId: t.wfId, cwd: t.cwd };
        }
        continue;
      }
      if (launchArgs === null) return 0;
      try {
        runRunWorkflowCli(launchArgs);
      } catch {
      }
      nextResume = resumeTarget ?? undefined;
    }
  } finally {
    restore();
  }
}

function waitForEnterSync(prompt: string): void {
  process.stdout.write(prompt);
  const buf = Buffer.alloc(64);
  try {
    for (;;) {
      const n = readSync(0, buf, 0, buf.length, null);
      if (n <= 0 || buf.subarray(0, n).includes(0x0a) || buf.subarray(0, n).includes(0x0d)) return;
    }
  } catch {
  }
}
