export declare const WORKFLOW_TOOL_RE: RegExp;
export interface WorkflowToolValidatorOptions {
    readonly stdin?: string;
    readonly stderr?: (chunk: string) => void;
    readonly cwd?: string;
    readonly workflow?: string;
    readonly step?: string;
    readonly profile?: string;
    readonly root?: string;
    readonly startDir?: string;
}
export declare function parseValidatorArgs(argv: readonly string[]): {
    workflow?: string;
    step?: string;
    profile?: string;
    root?: string;
};
interface WorkflowDoc {
    name?: string;
    tools?: Array<Record<string, unknown>>;
    [key: string]: unknown;
}
export declare function readPayload(stdinText: string): unknown;
export declare function extractToolName(payload: unknown): string;
export declare function extractToolInput(payload: unknown): Record<string, unknown>;
export declare function parseWorkflowTool(toolName: string): string | null;
export declare function loadWorkflowByName(name: string, cwd: string): WorkflowDoc | null;
export declare function findWorkflowWithTool(calledCombined: string, cwd: string): [WorkflowDoc, Record<string, unknown>] | null;
export declare function runWorkflowToolValidator(argvOrOpts?: readonly string[] | WorkflowToolValidatorOptions): Promise<number>;
export {};
