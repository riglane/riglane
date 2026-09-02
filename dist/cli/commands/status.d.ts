export type TemplatesState = 'ok' | 'drift' | 'legacy' | 'absent';
export interface AdapterReadiness {
    readonly id: string;
    readonly skills_installed: boolean;
    readonly mcp_configured: boolean;
    readonly ready: boolean;
}
export interface ProjectStatus {
    readonly installed: boolean;
    readonly mcp_configured: boolean;
    readonly templates: TemplatesState;
    readonly up_to_date: boolean;
    readonly action: 'init' | 'update' | 'migrate' | 'none';
    readonly adapters: readonly AdapterReadiness[];
}
export declare function computeProjectStatus(target: string): ProjectStatus;
export declare function runStatus(args: string[]): Promise<number>;
