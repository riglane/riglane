

export const WorkflowStatusValues = ['in_progress', 'completed', 'failed', 'paused'] as const;
export type WorkflowStatus = (typeof WorkflowStatusValues)[number];

export const StepStatusValues = [
  'pending',
  'in_progress',
  'completed',
  'failed',
  'skipped',
] as const;
export type StepStatus = (typeof StepStatusValues)[number];

export const BranchStatusValues = ['pending', 'in_progress', 'completed', 'failed'] as const;
export type BranchStatus = (typeof BranchStatusValues)[number];


export const CursorStatusValues = ['completed', 'errored', 'cancelled', 'unknown'] as const;
export type CursorStatus = (typeof CursorStatusValues)[number];

export const HookStatusValues = ['completed', 'errored'] as const;
export type HookStatus = (typeof HookStatusValues)[number];

export const HostValues = ['cursor', 'claude-code', 'codex', 'opencode', 'copilot', 'gemini'] as const;
export type Host = (typeof HostValues)[number];


export const RetryTypeNonNullValues = ['gate', 'step', 'branch'] as const;
export type RetryTypeNonNull = (typeof RetryTypeNonNullValues)[number];
export type RetryType = RetryTypeNonNull | null;


export const GateTypeValues = ['structural', 'semantic', 'human'] as const;
export type GateType = (typeof GateTypeValues)[number];


export const InjectModeValues = ['file', 'file_if_exists', 'reference'] as const;
export type InjectMode = (typeof InjectModeValues)[number];

export const WriteProofModeValues = ['required', 'all_members_fresh', 'any_member', 'off'] as const;
export type WriteProofMode = (typeof WriteProofModeValues)[number];

export const SnapshotWriteProofModeValues = [
  'required',
  'all_members_fresh',
  'any_member',
] as const;
export type SnapshotWriteProofMode = (typeof SnapshotWriteProofModeValues)[number];


export const CarryForwardValues = ['none', 'summary'] as const;
export type CarryForward = (typeof CarryForwardValues)[number];


export const ToolTypeValues = ['script', 'mcp'] as const;
export type ToolType = (typeof ToolTypeValues)[number];


export const StepCollectActionValues = [
  'PROCEED',
  'RETRY_STEP',
  'STOP_WORKFLOW',
  'VERIFY_MANUALLY',
  'BLOCKED_FOREIGN_CALLER',
] as const;
export type StepCollectAction = (typeof StepCollectActionValues)[number];

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
] as const;
export type StepCompleteAction = (typeof StepCompleteActionValues)[number];


export const TerminalWorkflowStatusValues = ['completed', 'failed'] as const;
export type TerminalWorkflowStatus = (typeof TerminalWorkflowStatusValues)[number];


export const StructFormatValues = ['json', 'yaml', 'markdown', 'text'] as const;
export type StructFormat = (typeof StructFormatValues)[number];

export const StandardFieldTypeValues = [
  'string',
  'integer',
  'number',
  'boolean',
  'array',
  'object',
  'list',
] as const;
export type StandardFieldType = (typeof StandardFieldTypeValues)[number];

export const CustomFieldTypeValues = [
  'string',
  'integer',
  'number',
  'boolean',
  'array',
  'object',
  'list',
  'enum',
] as const;
export type CustomFieldType = (typeof CustomFieldTypeValues)[number];

export const FrontmatterFieldTypeValues = [
  'string',
  'integer',
  'number',
  'boolean',
  'list',
  'enum',
] as const;
export type FrontmatterFieldType = (typeof FrontmatterFieldTypeValues)[number];
