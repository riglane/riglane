export const RunIdPattern = /^[a-z][a-z0-9_-]*-\d{8}-\d{6}-[0-9a-f]{4}$/;
export const isRunId = (v) => typeof v === 'string' && RunIdPattern.test(v);
export const asRunId = (v) => {
    if (!RunIdPattern.test(v))
        throw new TypeError(`Invalid RunId: ${v}`);
    return v;
};
export const RunTokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isRunToken = (v) => typeof v === 'string' && RunTokenPattern.test(v);
export const asRunToken = (v) => {
    if (!RunTokenPattern.test(v))
        throw new TypeError(`Invalid RunToken: ${v}`);
    return v;
};
export const WorkflowOrStepNamePattern = /^[a-z][a-z0-9_-]*$/;
export const isWorkflowName = (v) => typeof v === 'string' && WorkflowOrStepNamePattern.test(v);
export const isStepName = (v) => typeof v === 'string' && WorkflowOrStepNamePattern.test(v);
export const asWorkflowName = (v) => {
    if (!WorkflowOrStepNamePattern.test(v))
        throw new TypeError(`Invalid WorkflowName: ${v}`);
    return v;
};
export const asStepName = (v) => {
    if (!WorkflowOrStepNamePattern.test(v))
        throw new TypeError(`Invalid StepName: ${v}`);
    return v;
};
export const ParamOrToolNamePattern = /^[a-z][a-z0-9_]*$/;
export const isParamName = (v) => typeof v === 'string' && ParamOrToolNamePattern.test(v);
export const isToolName = (v) => typeof v === 'string' && ParamOrToolNamePattern.test(v);
export const asParamName = (v) => {
    if (!ParamOrToolNamePattern.test(v))
        throw new TypeError(`Invalid ParamName: ${v}`);
    return v;
};
export const asToolName = (v) => {
    if (!ParamOrToolNamePattern.test(v))
        throw new TypeError(`Invalid ToolName: ${v}`);
    return v;
};
export const Sha256HexPattern = /^[0-9a-f]{64}$/;
export const isSha256Hex = (v) => typeof v === 'string' && Sha256HexPattern.test(v);
export const asSha256Hex = (v) => {
    if (!Sha256HexPattern.test(v))
        throw new TypeError(`Invalid Sha256Hex: ${v}`);
    return v;
};
export const isIsoDateTime = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
export const asIsoDateTime = (v) => {
    if (Number.isNaN(Date.parse(v)))
        throw new TypeError(`Invalid IsoDateTime: ${v}`);
    return v;
};
export const ParamBindingRefPattern = /^.+::.+$/;
export const isParamBindingRef = (v) => typeof v === 'string' && ParamBindingRefPattern.test(v);
export const asParamBindingRef = (v) => {
    if (!ParamBindingRefPattern.test(v))
        throw new TypeError(`Invalid ParamBindingRef: ${v}`);
    return v;
};
