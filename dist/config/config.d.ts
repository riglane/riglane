export interface RiglaneConfig {
    engine: {
        gate_file_wait_ms: number;
        auto_open_trace_viewer: boolean;
        inbox_webhook_url: string;
        inbox_ask_max_hold_ms: number;
    };
    ui: {
        theme: 'dark' | 'light';
    };
    catalog: {
        base_url: string;
    };
    run: {
        skip_approvals: boolean;
    };
}
export declare const DEFAULTS: Readonly<RiglaneConfig>;
export interface SettingMeta {
    readonly key: string;
    readonly group: string;
    readonly label: string;
    readonly hint: string;
    readonly type: 'number' | 'boolean' | 'string';
    readonly envVar?: string;
    readonly default: unknown;
    readonly min?: number;
    readonly max?: number;
    readonly options?: readonly string[];
}
export declare const SETTING_DEFS: readonly SettingMeta[];
export declare function configDir(): string;
export declare function configPath(): string;
export declare function readConfigRaw(): Record<string, unknown>;
export declare function resolve<T>(meta: SettingMeta): T;
export declare function gateFileWaitMs(): number;
export declare function inboxWebhookUrl(): string;
export declare function inboxAskMaxHoldMs(): number;
export declare function autoOpenTraceViewer(): boolean;
export declare function skipApprovalsDefault(): boolean;
export declare function writeSetting(key: string, value: unknown): void;
export declare function resetSetting(key: string): void;
export declare function resetGroup(group?: string): void;
export declare function readAllSettings(): Array<SettingMeta & {
    value: unknown;
    isDefault: boolean;
}>;
export declare function catalogBaseUrl(): string;
