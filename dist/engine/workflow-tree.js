export function collectAllSteps(workflow) {
    const out = [];
    const visit = (steps) => {
        if (!Array.isArray(steps))
            return;
        for (const s of steps) {
            if (s === null || typeof s !== 'object' || Array.isArray(s))
                continue;
            const sd = s;
            out.push(sd);
            const routes = sd.routes;
            if (routes && Array.isArray(routes.define)) {
                for (const r of routes.define)
                    visit(r.steps);
            }
            const lanes = sd.lanes;
            if (lanes && Array.isArray(lanes.define)) {
                for (const l of lanes.define)
                    visit(l.steps);
            }
        }
    };
    visit(workflow.steps);
    return out;
}
export function findStepConfig(workflow, stepName) {
    for (const s of collectAllSteps(workflow)) {
        if (s.name === stepName)
            return s;
    }
    return null;
}
