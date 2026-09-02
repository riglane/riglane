export declare const AGENT_NOTES_VERSION = 1;
export type NoteStatus = 'success' | 'partial' | 'failed' | 'experimental';
export type NoteConfidence = 'high' | 'medium' | 'low';
export interface NoteFrontmatter {
    readonly topic: string;
    readonly step_template: string;
    readonly status: NoteStatus;
    readonly confidence: NoteConfidence;
    readonly project: string;
    readonly run_id: string;
    readonly generated_workflow_path?: string;
    readonly tags: readonly string[];
    readonly related_runs: readonly string[];
    readonly date: string;
    readonly version: number;
}
export interface IndexEntry {
    readonly file: string;
    readonly topic: string;
    readonly status: NoteStatus;
    readonly confidence: NoteConfidence;
    readonly tags: readonly string[];
    readonly date: string;
    readonly project: string;
}
export interface AgentNotesIndex {
    readonly version: number;
    readonly step_template: string;
    readonly entries: readonly IndexEntry[];
}
export declare function assertSafeStepTemplate(stepTemplate: string): void;
export declare function agentNotesRoot(agentDir: string): string;
export declare function stepTemplateNotesDir(agentDir: string, stepTemplate: string): string;
export declare function noteFilePath(agentDir: string, stepTemplate: string, filename: string): string;
export declare function indexJsonPath(agentDir: string, stepTemplate: string): string;
export declare function ensureStepTemplateNotesDir(agentDir: string, stepTemplate: string): string;
export declare function isoDateLocal(d?: Date): string;
export declare function generateNoteFilename(date?: Date): string;
export declare function serializeFrontmatter(fm: NoteFrontmatter): string;
export declare function composeNoteFile(fm: NoteFrontmatter, body: string): string;
export declare function readIndex(agentDir: string, stepTemplate: string): AgentNotesIndex | null;
export declare function writeIndex(agentDir: string, stepTemplate: string, index: AgentNotesIndex): void;
export declare function appendIndexEntry(agentDir: string, stepTemplate: string, entry: IndexEntry): AgentNotesIndex;
export declare function listNoteFiles(agentDir: string, stepTemplate: string): string[];
export declare function stepTemplateNotesDirExists(agentDir: string, stepTemplate: string): boolean;
