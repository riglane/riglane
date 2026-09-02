export const WorkflowStatusValues = ['in_progress', 'completed', 'failed', 'paused'];
export const StepStatusValues = [
    'pending',
    'in_progress',
    'completed',
    'failed',
    'skipped',
];
export const BranchStatusValues = ['pending', 'in_progress', 'completed', 'failed'];
export const CursorStatusValues = ['completed', 'errored', 'cancelled', 'unknown'];
export const HookStatusValues = ['completed', 'errored'];
export const HostValues = ['cursor', 'claude-code', 'codex', 'opencode', 'copilot', 'gemini'];
export const RetryTypeNonNullValues = ['gate', 'step', 'branch'];
export const GateTypeValues = ['structural', 'semantic', 'human'];
export const InjectModeValues = ['file', 'file_if_exists', 'reference'];
export const WriteProofModeValues = ['required', 'all_members_fresh', 'any_member', 'off'];
export const SnapshotWriteProofModeValues = [
    'required',
    'all_members_fresh',
    'any_member',
];
export const CarryForwardValues = ['none', 'summary'];
export const ToolTypeValues = ['script', 'mcp'];
export const StepCollectActionValues = [
    'PROCEED',
    'RETRY_STEP',
    'STOP_WORKFLOW',
    'VERIFY_MANUALLY',
    'BLOCKED_FOREIGN_CALLER',
];
export const StepCompleteActionValues = [
    'FIX_AND_RETRY',
    'LOOP_BACK',
    'ENTER_ROUTE',
    'ENTER_LANES',
    'LANE_WAIT',
    'AWAITING_LOOP_DECISION',
    'AWAITING_ROUTE_DECISION',
    'STOP_WORKFLOW',
    'USER_REJECTED',
    'AWAITING_HUMAN_RESPONSE',
    'BLOCKED_PARTIAL_FAILURE',
    'BLOCKED_LANES_FAILED',
    'BLOCKED_FOREIGN_CALLER',
];
export const TerminalWorkflowStatusValues = ['completed', 'failed'];
export const StructFormatValues = ['json', 'yaml', 'markdown', 'text'];
export const StandardFieldTypeValues = [
    'string',
    'integer',
    'number',
    'boolean',
    'array',
    'object',
    'list',
];
export const CustomFieldTypeValues = [
    'string',
    'integer',
    'number',
    'boolean',
    'array',
    'object',
    'list',
    'enum',
];
export const FrontmatterFieldTypeValues = [
    'string',
    'integer',
    'number',
    'boolean',
    'list',
    'enum',
];
