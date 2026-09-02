export interface OutgoingRequest {
    readonly result: Promise<unknown>;
    cancel(): void;
}
export interface HostBridge {
    sendRequest(method: string, params: Record<string, unknown>): OutgoingRequest;
    sendNotification(method: string, params: Record<string, unknown>): void;
    clientCapabilities(): Record<string, unknown>;
    protocolVersion(): string;
}
export interface CallContext {
    readonly progressToken?: string | number;
    readonly signal?: AbortSignal;
}
export declare function setHostBridge(b: HostBridge | null): void;
export declare function getHostBridge(): HostBridge | null;
export declare function runWithCallContext<T>(ctx: CallContext, fn: () => Promise<T>): Promise<T>;
export declare function currentCallContext(): CallContext;
export declare function elicitationAvailable(): boolean;
export declare function emitCallProgress(message: string, progress: number, total?: number): void;
