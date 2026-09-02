
import { AsyncLocalStorage } from 'node:async_hooks';

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

let bridge: HostBridge | null = null;
const callContext = new AsyncLocalStorage<CallContext>();

export function setHostBridge(b: HostBridge | null): void {
  bridge = b;
}

export function getHostBridge(): HostBridge | null {
  return bridge;
}

export function runWithCallContext<T>(ctx: CallContext, fn: () => Promise<T>): Promise<T> {
  return callContext.run(ctx, fn);
}

export function currentCallContext(): CallContext {
  return callContext.getStore() ?? {};
}

export function elicitationAvailable(): boolean {
  if (!bridge) return false;
  return Object.prototype.hasOwnProperty.call(bridge.clientCapabilities(), 'elicitation');
}

export function emitCallProgress(message: string, progress: number, total?: number): void {
  const token = currentCallContext().progressToken;
  if (!bridge || token === undefined) return;
  bridge.sendNotification('notifications/progress', {
    progressToken: token,
    progress,
    ...(total !== undefined ? { total } : {}),
    message,
  });
}
