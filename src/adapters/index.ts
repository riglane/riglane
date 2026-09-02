
import type { Host } from '../types/enums.js';

import {
  CC_RULE_FRONTMATTER,
  COPILOT_RULE_FRONTMATTER,
  CURSOR_RULE_FRONTMATTER,
  OPENCODE_RULE_FRONTMATTER,
} from './spec-guidance.js';

export type AdapterId = 'claude' | 'cursor' | 'codex' | 'opencode' | 'copilot' | 'gemini';

export interface CopyStep {
  readonly srcSubdir: string;
  readonly dstDir: string;
  readonly prune?: boolean;
}

export type HooksSpec =
  | { readonly kind: 'claude-settings' }
  | { readonly kind: 'cursor-hooks' }
  | { readonly kind: 'codex-toml' }
  | { readonly kind: 'opencode-plugin'; readonly srcSubdir: string; readonly dstDir: string }
  | { readonly kind: 'copilot-hooks-json'; readonly srcSubdir: string; readonly dstDir: string }
  | { readonly kind: 'gemini-settings-json' };

export type McpSpec =
  | { readonly kind: 'json-template'; readonly src: string; readonly dst: string }
  | { readonly kind: 'json-file'; readonly src: string; readonly dst: string }
  | { readonly kind: 'codex-toml' }
  | { readonly kind: 'opencode-json'; readonly src: string; readonly dst: string }
  | { readonly kind: 'copilot-mcp-json'; readonly src: string; readonly dst: string }
  | { readonly kind: 'gemini-settings-json' };

export type SpecGuidanceSpec =
  | { readonly via: 'rule-file'; readonly path: string; readonly frontmatter: string }
  | { readonly via: 'managed-block'; readonly file: string; readonly sentinel: string };

export interface AdapterDescriptor {
  readonly id: AdapterId;
  readonly label: string;
  readonly projectDir: string;
  readonly srcDir: string;
  readonly skills?: CopyStep;
  readonly rules?: CopyStep;
  readonly hooks: HooksSpec;
  readonly mcp: McpSpec;
  readonly generatesPerStepSubagents: boolean;
  readonly agents?: CopyStep;
  readonly commands?: CopyStep;
  readonly hostId: Host;
  readonly specGuidance?: SpecGuidanceSpec;
}

export const ADAPTERS: Record<AdapterId, AdapterDescriptor> = {
  claude: {
    id: 'claude',
    label: 'Claude Code',
    projectDir: '.claude',
    srcDir: 'claude',
    skills: { srcSubdir: 'skills', dstDir: '.claude/skills' },
    rules: { srcSubdir: 'rules', dstDir: '.claude/rules' },
    hooks: { kind: 'claude-settings' },
    mcp: { kind: 'json-template', src: 'mcp.json.template', dst: '.mcp.json' },
    generatesPerStepSubagents: true,
    hostId: 'claude-code',
    specGuidance: {
      via: 'rule-file',
      path: '.claude/rules/riglane-spec-guidance.md',
      frontmatter: CC_RULE_FRONTMATTER,
    },
  },
  cursor: {
    id: 'cursor',
    label: 'Cursor',
    projectDir: '.cursor',
    srcDir: 'cursor',
    skills: { srcSubdir: 'skills', dstDir: '.cursor/skills' },
    rules: { srcSubdir: 'rules', dstDir: '.cursor/rules' },
    hooks: { kind: 'cursor-hooks' },
    mcp: { kind: 'json-file', src: 'cursor/mcp.json', dst: '.cursor/mcp.json' },
    generatesPerStepSubagents: false,
    hostId: 'cursor',
    specGuidance: {
      via: 'rule-file',
      path: '.cursor/rules/riglane-spec-guidance.mdc',
      frontmatter: CURSOR_RULE_FRONTMATTER,
    },
  },
  codex: {
    id: 'codex',
    label: 'Codex',
    projectDir: '.codex',
    srcDir: 'codex',
    skills: { srcSubdir: 'skills', dstDir: '.agents/skills' },
    hooks: { kind: 'codex-toml' },
    mcp: { kind: 'codex-toml' },
    generatesPerStepSubagents: false,
    hostId: 'codex',
    specGuidance: { via: 'managed-block', file: 'AGENTS.md', sentinel: 'RIGLANE:SPEC-GUIDANCE' },
  },
  opencode: {
    id: 'opencode',
    label: 'OpenCode',
    projectDir: '.opencode',
    srcDir: 'opencode',
    skills: { srcSubdir: 'skills', dstDir: '.opencode/skills' },
    rules: { srcSubdir: 'riglane', dstDir: '.opencode/riglane' },
    hooks: { kind: 'opencode-plugin', srcSubdir: 'plugins', dstDir: '.opencode/plugins' },
    mcp: {
      kind: 'opencode-json',
      src: 'opencode/opencode.json.template',
      dst: '.opencode/opencode.json',
    },
    generatesPerStepSubagents: false,
    agents: { srcSubdir: 'agents', dstDir: '.opencode/agents' },
    commands: { srcSubdir: 'commands', dstDir: '.opencode/commands' },
    hostId: 'opencode',
    specGuidance: {
      via: 'rule-file',
      path: '.opencode/riglane/riglane-spec-guidance.md',
      frontmatter: OPENCODE_RULE_FRONTMATTER,
    },
  },
  copilot: {
    id: 'copilot',
    label: 'GitHub Copilot',
    projectDir: '.github',
    srcDir: 'copilot',
    skills: { srcSubdir: 'skills', dstDir: '.github/skills', prune: false },
    rules: { srcSubdir: 'instructions', dstDir: '.github/instructions', prune: false },
    hooks: { kind: 'copilot-hooks-json', srcSubdir: 'hooks', dstDir: '.github/hooks' },
    mcp: {
      kind: 'copilot-mcp-json',
      src: 'copilot/mcp.json.template',
      dst: '.github/mcp.json',
    },
    generatesPerStepSubagents: false,
    agents: { srcSubdir: 'agents', dstDir: '.github/agents', prune: false },
    hostId: 'copilot',
    specGuidance: {
      via: 'rule-file',
      path: '.github/instructions/riglane-spec-guidance.instructions.md',
      frontmatter: COPILOT_RULE_FRONTMATTER,
    },
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini CLI',
    projectDir: '.gemini',
    srcDir: 'gemini',
    rules: { srcSubdir: 'rules', dstDir: '.', prune: false },
    hooks: { kind: 'gemini-settings-json' },
    mcp: { kind: 'gemini-settings-json' },
    generatesPerStepSubagents: false,
    agents: { srcSubdir: 'agents', dstDir: '.gemini/agents', prune: false },
    commands: { srcSubdir: 'commands', dstDir: '.gemini/commands/riglane' },
    hostId: 'gemini',
    specGuidance: {
      via: 'managed-block',
      file: 'riglane-workflow-context.md',
      sentinel: 'RIGLANE:SPEC-GUIDANCE',
    },
  },
};

export const SELECTABLE_ADAPTERS: readonly AdapterId[] = [
  'claude',
  'cursor',
  'codex',
  'opencode',
  'copilot',
  'gemini',
];

export const DEFAULT_ADAPTERS: readonly Exclude<
  AdapterId,
  'codex' | 'opencode' | 'copilot' | 'gemini'
>[] = ['cursor', 'claude'];

export function adaptersToInstallOptions(
  adapters: readonly AdapterId[],
): { adapters: readonly AdapterId[] } {
  return { adapters };
}

export function mcpConfigProbe(d: AdapterDescriptor): {
  kind: 'json' | 'toml' | 'opencode-json';
  path: string;
} {
  if (d.mcp.kind === 'codex-toml') return { kind: 'toml', path: `${d.projectDir}/config.toml` };
  if (d.mcp.kind === 'opencode-json') return { kind: 'opencode-json', path: d.mcp.dst };
  if (d.mcp.kind === 'gemini-settings-json')
    return { kind: 'json', path: `${d.projectDir}/settings.json` };
  return { kind: 'json', path: d.mcp.dst };
}
