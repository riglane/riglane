export declare const MAX_UI_PREFS_BYTES: number;
export interface UiPrefs {
    readonly [key: string]: unknown;
}
export declare function uiPrefsPath(): string;
export declare function readUiPrefs(): UiPrefs;
export declare function writeUiPrefs(patch: Record<string, unknown>): UiPrefs | null;
