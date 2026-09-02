import { HostValues } from '../types/enums.js';
export function parseHostFlag(args) {
    for (let i = 0; i < args.length; i += 1) {
        const a = args[i] ?? '';
        let val = null;
        if (a === '--host')
            val = args[i + 1] ?? null;
        else if (a.startsWith('--host='))
            val = a.slice('--host='.length);
        if (val !== null) {
            return HostValues.includes(val) ? val : null;
        }
    }
    return null;
}
export function emitPreToolUseDeny(host, reason, io) {
    const line = reason.endsWith('\n') ? reason : `${reason}\n`;
    if (host === 'cursor') {
        io.stdout(`${JSON.stringify({ permission: 'deny', agent_message: reason, user_message: reason })}\n`);
        return 2;
    }
    if (host === 'opencode') {
        io.stdout(`${JSON.stringify({ permission: 'deny', reason })}\n`);
        return 2;
    }
    if (host === 'codex') {
        io.stdout(`${JSON.stringify({
            hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'deny',
                permissionDecisionReason: reason,
            },
        })}\n`);
        return 2;
    }
    if (host === 'copilot') {
        io.stdout(`${JSON.stringify({ permissionDecision: 'deny', permissionDecisionReason: reason })}\n`);
        return 2;
    }
    if (host === 'gemini') {
        io.stdout(`${JSON.stringify({ decision: 'deny', reason })}\n`);
        return 0;
    }
    io.stderr(line);
    return 2;
}
