export const MODEL_MODES = ['inherit', 'auto', 'lightest', 'strongest'];
export function isModelMode(v) {
    return typeof v === 'string' && MODEL_MODES.includes(v);
}
export const PLANNING_DEFAULTS = {
    maxSubsteps: 7,
    maxPlanAttempts: 3,
    allowParallel: false,
    allowDelegation: false,
};
export function resolvePlanningRestrictions(step) {
    return {
        maxSubsteps: step.max_substeps ?? PLANNING_DEFAULTS.maxSubsteps,
        maxPlanAttempts: step.max_plan_attempts ?? PLANNING_DEFAULTS.maxPlanAttempts,
        allowParallel: step.allow_parallel ?? PLANNING_DEFAULTS.allowParallel,
        allowDelegation: step.allow_delegation ?? PLANNING_DEFAULTS.allowDelegation,
    };
}
