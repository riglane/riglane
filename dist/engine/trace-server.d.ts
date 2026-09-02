export declare function _setLocalServerStartForTests(fn: ((root: string) => Promise<string | null>) | null): void;
export declare function isLoopbackHost(hostHeader: string | undefined): boolean;
export declare function ensureLocalServer(root: string): Promise<string | null>;
export declare function openToolViewer(toolsParent: string, relPath: string): Promise<string | null>;
export declare function openTraceViewer(agentDir: string, traceServerPath: string): void;
export declare function currentLocalServerBase(): string | null;
export declare function refTraceServer(): void;
export declare function stopTraceServer(): void;
