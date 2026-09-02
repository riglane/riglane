import { AsyncLocalStorage } from 'node:async_hooks';
let bridge = null;
const callContext = new AsyncLocalStorage();
export function setHostBridge(b) {
    bridge = b;
}
export function getHostBridge() {
    return bridge;
}
export function runWithCallContext(ctx, fn) {
    return callContext.run(ctx, fn);
}
export function currentCallContext() {
    return callContext.getStore() ?? {};
}
export function elicitationAvailable() {
    if (!bridge)
        return false;
    return Object.prototype.hasOwnProperty.call(bridge.clientCapabilities(), 'elicitation');
}
export function emitCallProgress(message, progress, total) {
    const token = currentCallContext().progressToken;
    if (!bridge || token === undefined)
        return;
    bridge.sendNotification('notifications/progress', {
        progressToken: token,
        progress,
        ...(total !== undefined ? { total } : {}),
        message,
    });
}
