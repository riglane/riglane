export interface LintWarning {
    readonly id: string;
    readonly step?: string;
    readonly message: string;
    readonly topic: string;
}
export declare const STRUCT_FIELD_CONTAINERS: ReadonlyArray<string>;
export declare function structHasFieldContainer(parsed: unknown): boolean;
export declare function structUnknownTopLevelKeys(parsed: unknown): string[];
export declare function isLocalWebhookUrl(url: string): boolean;
export declare const LINT_WARNING_IDS: ReadonlyArray<string>;
export declare function lintWorkflow(workflow: Record<string, unknown>, opts?: {
    readonly definitionDir?: string;
}): LintWarning[];
