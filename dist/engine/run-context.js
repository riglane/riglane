let currentRunId = null;
export function setCurrentRunId(runId) {
    currentRunId = runId ? runId : null;
}
export function getCurrentRunId() {
    return currentRunId;
}
export function clearCurrentRunId() {
    currentRunId = null;
}
export function _resetCurrentRunId() {
    currentRunId = null;
}
