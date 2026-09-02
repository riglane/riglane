
export const GATE_LEDGER_SCHEMA = 2 as const;

export interface BranchRecord {
  passed: boolean;
  checks: number;
  failures: number;
  details: string[];
  loop_count: number;
  validated_at: string;
  source: 'hook' | 'engine-inline';
}

export interface LegacyBranchResult {
  branch_index: number;
  passed: boolean;
  checks: number;
  failures: number;
  details: string[];
}

export interface GateLedgerV2 {
  step: string;
  run_token: string;
  schema: typeof GATE_LEDGER_SCHEMA;
  branches: Record<string, BranchRecord>;
  passed: boolean;
  failed_branches: number[];
  checks: number;
  failures: number;
  details: string[];
  loop_count: number;
  branch_results?: LegacyBranchResult[];
  source?: 'engine-inline';
}

export type GateResultFile = GateLedgerV2;
