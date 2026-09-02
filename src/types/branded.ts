
declare const __brand: unique symbol;

type Brand<T, B extends string> = T & { readonly [__brand]: B };


export type RunId = Brand<string, 'RunId'>;
export const RunIdPattern = /^[a-z][a-z0-9_-]*-\d{8}-\d{6}-[0-9a-f]{4}$/;
export const isRunId = (v: unknown): v is RunId => typeof v === 'string' && RunIdPattern.test(v);
export const asRunId = (v: string): RunId => {
  if (!RunIdPattern.test(v)) throw new TypeError(`Invalid RunId: ${v}`);
  return v as RunId;
};

export type RunToken = Brand<string, 'RunToken'>;
export const RunTokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isRunToken = (v: unknown): v is RunToken =>
  typeof v === 'string' && RunTokenPattern.test(v);
export const asRunToken = (v: string): RunToken => {
  if (!RunTokenPattern.test(v)) throw new TypeError(`Invalid RunToken: ${v}`);
  return v as RunToken;
};


export type WorkflowName = Brand<string, 'WorkflowName'>;
export type StepName = Brand<string, 'StepName'>;
export const WorkflowOrStepNamePattern = /^[a-z][a-z0-9_-]*$/;
export const isWorkflowName = (v: unknown): v is WorkflowName =>
  typeof v === 'string' && WorkflowOrStepNamePattern.test(v);
export const isStepName = (v: unknown): v is StepName =>
  typeof v === 'string' && WorkflowOrStepNamePattern.test(v);
export const asWorkflowName = (v: string): WorkflowName => {
  if (!WorkflowOrStepNamePattern.test(v)) throw new TypeError(`Invalid WorkflowName: ${v}`);
  return v as WorkflowName;
};
export const asStepName = (v: string): StepName => {
  if (!WorkflowOrStepNamePattern.test(v)) throw new TypeError(`Invalid StepName: ${v}`);
  return v as StepName;
};

export type ParamName = Brand<string, 'ParamName'>;
export type ToolName = Brand<string, 'ToolName'>;
export const ParamOrToolNamePattern = /^[a-z][a-z0-9_]*$/;
export const isParamName = (v: unknown): v is ParamName =>
  typeof v === 'string' && ParamOrToolNamePattern.test(v);
export const isToolName = (v: unknown): v is ToolName =>
  typeof v === 'string' && ParamOrToolNamePattern.test(v);
export const asParamName = (v: string): ParamName => {
  if (!ParamOrToolNamePattern.test(v)) throw new TypeError(`Invalid ParamName: ${v}`);
  return v as ParamName;
};
export const asToolName = (v: string): ToolName => {
  if (!ParamOrToolNamePattern.test(v)) throw new TypeError(`Invalid ToolName: ${v}`);
  return v as ToolName;
};


export type Sha256Hex = Brand<string, 'Sha256Hex'>;
export const Sha256HexPattern = /^[0-9a-f]{64}$/;
export const isSha256Hex = (v: unknown): v is Sha256Hex =>
  typeof v === 'string' && Sha256HexPattern.test(v);
export const asSha256Hex = (v: string): Sha256Hex => {
  if (!Sha256HexPattern.test(v)) throw new TypeError(`Invalid Sha256Hex: ${v}`);
  return v as Sha256Hex;
};

export type IsoDateTime = Brand<string, 'IsoDateTime'>;
export const isIsoDateTime = (v: unknown): v is IsoDateTime =>
  typeof v === 'string' && !Number.isNaN(Date.parse(v));
export const asIsoDateTime = (v: string): IsoDateTime => {
  if (Number.isNaN(Date.parse(v))) throw new TypeError(`Invalid IsoDateTime: ${v}`);
  return v as IsoDateTime;
};


export type ParamBindingRef = Brand<string, 'ParamBindingRef'>;
export const ParamBindingRefPattern = /^.+::.+$/;
export const isParamBindingRef = (v: unknown): v is ParamBindingRef =>
  typeof v === 'string' && ParamBindingRefPattern.test(v);
export const asParamBindingRef = (v: string): ParamBindingRef => {
  if (!ParamBindingRefPattern.test(v)) throw new TypeError(`Invalid ParamBindingRef: ${v}`);
  return v as ParamBindingRef;
};
