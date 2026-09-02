
import * as ajvNs from 'ajv';
import type { ErrorObject, ValidateFunction } from 'ajv';
import * as ajvFormatsNs from 'ajv-formats';

const Ajv = ajvNs.default as unknown as new (
  opts?: ConstructorParameters<typeof ajvNs.Ajv>[0],
) => InstanceType<typeof ajvNs.Ajv>;
const addFormats = ajvFormatsNs.default as unknown as (
  ajv: InstanceType<typeof ajvNs.Ajv>,
) => InstanceType<typeof ajvNs.Ajv>;

import gateResultSchema from './schemas/gate-result.schema.json' with { type: 'json' };
import hooksCcSchema from './schemas/hooks-cc.schema.json' with { type: 'json' };
import hooksCursorSchema from './schemas/hooks-cursor.schema.json' with { type: 'json' };
import manifestSchema from './schemas/manifest.schema.json' with { type: 'json' };
import mcpSchema from './schemas/mcp.schema.json' with { type: 'json' };
import snapshotSchema from './schemas/snapshot.schema.json' with { type: 'json' };
import specIndexSchema from './schemas/spec-index.schema.json' with { type: 'json' };
import specRegistrySchema from './schemas/spec-registry.schema.json' with { type: 'json' };
import structSchema from './schemas/struct.schema.json' with { type: 'json' };
import traceSchema from './schemas/trace.schema.json' with { type: 'json' };
import workflowSchema from './schemas/workflow.schema.json' with { type: 'json' };

import type { GateResultFile } from './gate-result.js';
import type { CursorDecision, HookInputCC, HookInputCursor } from './hooks.js';
import type { Manifest } from './manifest.js';
import type { ToolCallError, ToolCallSuccess } from './mcp.js';
import type { Snapshot } from './snapshot.js';
import type { SpecIndex, SpecRegistry } from './spec.js';
import type { StructSchema } from './struct.js';
import type { Trace } from './trace.js';
import type { Workflow } from './workflow.js';


const ajv = new Ajv({
  strict: false,
  allErrors: true,
  validateSchema: false,
  formats: {},
});
addFormats(ajv);


type SchemaJson = Record<string, unknown>;
const schemas: Record<string, SchemaJson> = {
  'riglane-gate-result-v2': gateResultSchema as unknown as SchemaJson,
  'riglane-hooks-cc-v1': hooksCcSchema as unknown as SchemaJson,
  'riglane-hooks-cursor-v1': hooksCursorSchema as unknown as SchemaJson,
  'riglane-manifest-v1': manifestSchema as unknown as SchemaJson,
  'riglane-mcp-v1': mcpSchema as unknown as SchemaJson,
  'riglane-snapshot-v1': snapshotSchema as unknown as SchemaJson,
  'riglane-spec-index-v1': specIndexSchema as unknown as SchemaJson,
  'riglane-spec-registry-v1': specRegistrySchema as unknown as SchemaJson,
  'riglane-struct-v1': structSchema as unknown as SchemaJson,
  'riglane-trace-v1': traceSchema as unknown as SchemaJson,
  'riglane-workflow-v1': workflowSchema as unknown as SchemaJson,
};

for (const [id, schema] of Object.entries(schemas)) {
  if (!ajv.getSchema(id)) ajv.addSchema(schema, id);
}

export const registeredSchemas = Object.freeze(schemas);


export type ValidationOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly ErrorObject[] };

export class SchemaValidationError extends Error {
  override readonly name = 'SchemaValidationError';
  constructor(
    public readonly schemaName: string,
    public readonly errors: readonly ErrorObject[],
  ) {
    super(`Schema validation failed (${schemaName}): ${formatAjvErrors(errors)}`);
  }
}

export function formatAjvErrors(errors: readonly ErrorObject[]): string {
  if (errors.length === 0) return '<no error details>';
  return errors.map((e) => `  at ${e.instancePath || '<root>'}: ${e.message ?? '?'}`).join('\n');
}


function makeValidator<T>(schemaRefOrId: string): {
  fn: ValidateFunction<T>;
  validate: (value: unknown) => T;
  tryValidate: (value: unknown) => ValidationOutcome<T>;
} {
  const fn = ajv.getSchema<T>(schemaRefOrId);
  if (!fn) {
    const compiled = ajv.compile<T>({ $ref: schemaRefOrId });
    return makeValidatorFromFn(compiled, schemaRefOrId);
  }
  return makeValidatorFromFn(fn, schemaRefOrId);
}

function makeValidatorFromFn<T>(
  fn: ValidateFunction<T>,
  name: string,
): {
  fn: ValidateFunction<T>;
  validate: (value: unknown) => T;
  tryValidate: (value: unknown) => ValidationOutcome<T>;
} {
  const tryValidate = (value: unknown): ValidationOutcome<T> => {
    if (fn(value)) return { ok: true, value: value as T };
    return { ok: false, errors: fn.errors ?? [] };
  };
  const validate = (value: unknown): T => {
    if (fn(value)) return value as T;
    throw new SchemaValidationError(name, fn.errors ?? []);
  };
  return { fn, validate, tryValidate };
}


const _workflow = makeValidator<Workflow>('riglane-workflow-v1');
export const validateWorkflow = _workflow.validate;
export const tryValidateWorkflow = _workflow.tryValidate;

const _manifest = makeValidator<Manifest>('riglane-manifest-v1');
export const validateManifest = _manifest.validate;
export const tryValidateManifest = _manifest.tryValidate;

const _trace = makeValidator<Trace>('riglane-trace-v1');
export const validateTrace = _trace.validate;
export const tryValidateTrace = _trace.tryValidate;

const _hookInputCC = makeValidator<HookInputCC>('riglane-hooks-cc-v1');
export const validateHookInputCC = _hookInputCC.validate;
export const tryValidateHookInputCC = _hookInputCC.tryValidate;

const _hookInputCursor = makeValidator<HookInputCursor>('riglane-hooks-cursor-v1#/definitions/input');
export const validateHookInputCursor = _hookInputCursor.validate;
export const tryValidateHookInputCursor = _hookInputCursor.tryValidate;

const _cursorDecision = makeValidator<CursorDecision>('riglane-hooks-cursor-v1#/definitions/decision');
export const validateCursorDecision = _cursorDecision.validate;
export const tryValidateCursorDecision = _cursorDecision.tryValidate;

const _gateResult = makeValidator<GateResultFile>('riglane-gate-result-v2');
export const validateGateResult = _gateResult.validate;
export const tryValidateGateResult = _gateResult.tryValidate;

const _struct = makeValidator<StructSchema>('riglane-struct-v1');
export const validateStruct = _struct.validate;
export const tryValidateStruct = _struct.tryValidate;

const _snapshot = makeValidator<Snapshot>('riglane-snapshot-v1');
export const validateSnapshot = _snapshot.validate;
export const tryValidateSnapshot = _snapshot.tryValidate;

const _specIndex = makeValidator<SpecIndex>('riglane-spec-index-v1');
export const validateSpecIndex = _specIndex.validate;
export const tryValidateSpecIndex = _specIndex.tryValidate;

const _specRegistry = makeValidator<SpecRegistry>('riglane-spec-registry-v1');
export const validateSpecRegistry = _specRegistry.validate;
export const tryValidateSpecRegistry = _specRegistry.tryValidate;


const _toolCallSuccess = makeValidator<ToolCallSuccess>(
  'riglane-mcp-v1#/definitions/tool_call_success',
);
export const validateToolCallSuccess = _toolCallSuccess.validate;
export const tryValidateToolCallSuccess = _toolCallSuccess.tryValidate;

const _toolCallError = makeValidator<ToolCallError>('riglane-mcp-v1#/definitions/tool_call_error');
export const validateToolCallError = _toolCallError.validate;
export const tryValidateToolCallError = _toolCallError.tryValidate;


export const tryValidateMcpDef = <T>(defName: string, value: unknown): ValidationOutcome<T> =>
  makeValidator<T>(`riglane-mcp-v1#/definitions/${defName}`).tryValidate(value);
