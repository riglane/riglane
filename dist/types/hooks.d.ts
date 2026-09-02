import type { CursorStatus } from './enums.js';
export interface HookInputCC {
    readonly agent_id?: string;
    readonly agent_transcript_path?: string;
    readonly agent_type?: string;
    readonly hook_event_name?: string;
    readonly task?: string | null;
    readonly model?: string | null;
    readonly status?: string | null;
    readonly [key: string]: unknown;
}
export interface HookInputCursor {
    readonly cursor_version?: string;
    readonly hook_event_name?: string;
    readonly status: CursorStatus;
    readonly loop_count?: number;
    readonly subagent_id?: string;
    readonly task?: string | null;
    readonly summary?: string | null;
    readonly agent_transcript_path?: string | null;
    readonly model?: string | null;
    readonly message_count?: number;
    readonly tool_call_count?: number;
    readonly modified_files?: readonly string[];
    readonly [key: string]: unknown;
}
export interface CursorDecision {
    readonly followup_message?: string;
}
export type HookInput = {
    readonly host: 'claude-code';
    readonly payload: HookInputCC;
} | {
    readonly host: 'cursor';
    readonly payload: HookInputCursor;
};
