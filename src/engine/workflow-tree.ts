
export interface StepTreeWorkflow {
  readonly steps?: unknown;
}

export function collectAllSteps(workflow: StepTreeWorkflow): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const visit = (steps: unknown): void => {
    if (!Array.isArray(steps)) return;
    for (const s of steps) {
      if (s === null || typeof s !== 'object' || Array.isArray(s)) continue;
      const sd = s as Record<string, unknown>;
      out.push(sd);
      const routes = sd.routes as
        | { define?: ReadonlyArray<{ steps?: unknown }> }
        | undefined;
      if (routes && Array.isArray(routes.define)) {
        for (const r of routes.define) visit(r.steps);
      }
      const lanes = sd.lanes as
        | { define?: ReadonlyArray<{ steps?: unknown }> }
        | undefined;
      if (lanes && Array.isArray(lanes.define)) {
        for (const l of lanes.define) visit(l.steps);
      }
    }
  };
  visit(workflow.steps);
  return out;
}

export function findStepConfig(
  workflow: StepTreeWorkflow,
  stepName: string,
): Record<string, unknown> | null {
  for (const s of collectAllSteps(workflow)) {
    if (s.name === stepName) return s;
  }
  return null;
}
