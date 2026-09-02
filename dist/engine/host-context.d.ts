import type { Host } from '../types/enums.js';
export interface ClientInfo {
    readonly name?: string;
    readonly version?: string;
}
export declare function resolveHostFromClientName(name: string | null | undefined): Host | null;
export interface ClientHandshake {
    readonly protocolVersion?: string;
    readonly capabilities?: Record<string, unknown>;
}
export declare function recordEngineClient(clientInfo: ClientInfo | null | undefined, baseDir?: string, logger?: (msg: string) => void, handshake?: ClientHandshake): void;
export interface RecordedClient {
    readonly name: string;
    readonly version: string | null;
    readonly host: Host | null;
    readonly protocol_version?: string;
    readonly capabilities?: Record<string, unknown>;
}
export declare function readEngineClientSidecar(baseDir?: string): RecordedClient | null;
export declare function recordedElicitation(rec: RecordedClient | null): boolean | null;
export declare function getEngineClientName(): string | null;
export declare function getEngineClientVersion(): string | null;
export declare function getEngineHost(): Host | null;
export declare function _resetEngineClient(): void;
export declare function detectOrchestratorModel(host: Host | null, projectRoot: string): string | null;
