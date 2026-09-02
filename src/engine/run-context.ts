
let currentRunId: string | null = null;

export function setCurrentRunId(runId: string | null | undefined): void {
  currentRunId = runId ? runId : null;
}

export function getCurrentRunId(): string | null {
  return currentRunId;
}

export function clearCurrentRunId(): void {
  currentRunId = null;
}

export function _resetCurrentRunId(): void {
  currentRunId = null;
}
