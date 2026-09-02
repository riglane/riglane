
import { parse as parseToml } from 'smol-toml';

import { CLI_NAME } from '../config/product.js';

export interface McpProbeResult {
  readonly ok: boolean;
  readonly detail: string;
  readonly parseError: boolean;
}

export function probeWorkflowEngineMcp(
  text: string,
  kind: 'json' | 'toml' | 'opencode-json',
): McpProbeResult {
  let cfg: Record<string, unknown>;
  try {
    cfg = (kind === 'toml' ? parseToml(text) : JSON.parse(text)) as Record<string, unknown>;
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e), parseError: true };
  }

  if (kind === 'opencode-json') {
    const servers = (cfg.mcp as Record<string, unknown> | undefined) ?? {};
    const we = (servers.workflow_engine as Record<string, unknown> | undefined) ?? {};
    const cmd = (we.command as string[] | undefined) ?? [];
    const ok = Array.isArray(cmd) && cmd[0] === CLI_NAME && cmd[1] === 'mcp-server';
    return {
      ok,
      detail: ok ? '' : `found: ${Array.isArray(cmd) ? cmd.join(' ') : String(cmd)}`.trim(),
      parseError: false,
    };
  }

  const serversKey = kind === 'toml' ? 'mcp_servers' : 'mcpServers';
  const servers = (cfg[serversKey] as Record<string, unknown> | undefined) ?? {};
  const we = (servers.workflow_engine as Record<string, unknown> | undefined) ?? {};
  const cmd = (we.command as string | undefined) ?? '';
  const args = (we.args as string[] | undefined) ?? [];
  const ok = cmd === CLI_NAME && args.length > 0 && args[0] === 'mcp-server';
  return { ok, detail: ok ? '' : `found: ${cmd} ${args.join(' ')}`.trim(), parseError: false };
}
