import { parse as parseToml } from 'smol-toml';
import { CLI_NAME } from '../config/product.js';
export function probeWorkflowEngineMcp(text, kind) {
    let cfg;
    try {
        cfg = (kind === 'toml' ? parseToml(text) : JSON.parse(text));
    }
    catch (e) {
        return { ok: false, detail: e instanceof Error ? e.message : String(e), parseError: true };
    }
    if (kind === 'opencode-json') {
        const servers = cfg.mcp ?? {};
        const we = servers.workflow_engine ?? {};
        const cmd = we.command ?? [];
        const ok = Array.isArray(cmd) && cmd[0] === CLI_NAME && cmd[1] === 'mcp-server';
        return {
            ok,
            detail: ok ? '' : `found: ${Array.isArray(cmd) ? cmd.join(' ') : String(cmd)}`.trim(),
            parseError: false,
        };
    }
    const serversKey = kind === 'toml' ? 'mcp_servers' : 'mcpServers';
    const servers = cfg[serversKey] ?? {};
    const we = servers.workflow_engine ?? {};
    const cmd = we.command ?? '';
    const args = we.args ?? [];
    const ok = cmd === CLI_NAME && args.length > 0 && args[0] === 'mcp-server';
    return { ok, detail: ok ? '' : `found: ${cmd} ${args.join(' ')}`.trim(), parseError: false };
}
