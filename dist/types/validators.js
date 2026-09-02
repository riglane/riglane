import * as ajvNs from 'ajv';
import * as ajvFormatsNs from 'ajv-formats';
const Ajv = ajvNs.default;
const addFormats = ajvFormatsNs.default;
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
const ajv = new Ajv({
    strict: false,
    allErrors: true,
    validateSchema: false,
    formats: {},
});
addFormats(ajv);
const schemas = {
    'riglane-gate-result-v2': gateResultSchema,
    'riglane-hooks-cc-v1': hooksCcSchema,
    'riglane-hooks-cursor-v1': hooksCursorSchema,
    'riglane-manifest-v1': manifestSchema,
    'riglane-mcp-v1': mcpSchema,
    'riglane-snapshot-v1': snapshotSchema,
    'riglane-spec-index-v1': specIndexSchema,
    'riglane-spec-registry-v1': specRegistrySchema,
    'riglane-struct-v1': structSchema,
    'riglane-trace-v1': traceSchema,
    'riglane-workflow-v1': workflowSchema,
};
for (const [id, schema] of Object.entries(schemas)) {
    if (!ajv.getSchema(id))
        ajv.addSchema(schema, id);
}
export const registeredSchemas = Object.freeze(schemas);
export class SchemaValidationError extends Error {
    schemaName;
    errors;
    name = 'SchemaValidationError';
    constructor(schemaName, errors) {
        super(`Schema validation failed (${schemaName}): ${formatAjvErrors(errors)}`);
        this.schemaName = schemaName;
        this.errors = errors;
    }
}
export function formatAjvErrors(errors) {
    if (errors.length === 0)
        return '<no error details>';
    return errors.map((e) => `  at ${e.instancePath || '<root>'}: ${e.message ?? '?'}`).join('\n');
}
function makeValidator(schemaRefOrId) {
    const fn = ajv.getSchema(schemaRefOrId);
    if (!fn) {
        const compiled = ajv.compile({ $ref: schemaRefOrId });
        return makeValidatorFromFn(compiled, schemaRefOrId);
    }
    return makeValidatorFromFn(fn, schemaRefOrId);
}
function makeValidatorFromFn(fn, name) {
    const tryValidate = (value) => {
        if (fn(value))
            return { ok: true, value: value };
        return { ok: false, errors: fn.errors ?? [] };
    };
    const validate = (value) => {
        if (fn(value))
            return value;
        throw new SchemaValidationError(name, fn.errors ?? []);
    };
    return { fn, validate, tryValidate };
}
const _workflow = makeValidator('riglane-workflow-v1');
export const validateWorkflow = _workflow.validate;
export const tryValidateWorkflow = _workflow.tryValidate;
const _manifest = makeValidator('riglane-manifest-v1');
export const validateManifest = _manifest.validate;
export const tryValidateManifest = _manifest.tryValidate;
const _trace = makeValidator('riglane-trace-v1');
export const validateTrace = _trace.validate;
export const tryValidateTrace = _trace.tryValidate;
const _hookInputCC = makeValidator('riglane-hooks-cc-v1');
export const validateHookInputCC = _hookInputCC.validate;
export const tryValidateHookInputCC = _hookInputCC.tryValidate;
const _hookInputCursor = makeValidator('riglane-hooks-cursor-v1#/definitions/input');
export const validateHookInputCursor = _hookInputCursor.validate;
export const tryValidateHookInputCursor = _hookInputCursor.tryValidate;
const _cursorDecision = makeValidator('riglane-hooks-cursor-v1#/definitions/decision');
export const validateCursorDecision = _cursorDecision.validate;
export const tryValidateCursorDecision = _cursorDecision.tryValidate;
const _gateResult = makeValidator('riglane-gate-result-v2');
export const validateGateResult = _gateResult.validate;
export const tryValidateGateResult = _gateResult.tryValidate;
const _struct = makeValidator('riglane-struct-v1');
export const validateStruct = _struct.validate;
export const tryValidateStruct = _struct.tryValidate;
const _snapshot = makeValidator('riglane-snapshot-v1');
export const validateSnapshot = _snapshot.validate;
export const tryValidateSnapshot = _snapshot.tryValidate;
const _specIndex = makeValidator('riglane-spec-index-v1');
export const validateSpecIndex = _specIndex.validate;
export const tryValidateSpecIndex = _specIndex.tryValidate;
const _specRegistry = makeValidator('riglane-spec-registry-v1');
export const validateSpecRegistry = _specRegistry.validate;
export const tryValidateSpecRegistry = _specRegistry.tryValidate;
const _toolCallSuccess = makeValidator('riglane-mcp-v1#/definitions/tool_call_success');
export const validateToolCallSuccess = _toolCallSuccess.validate;
export const tryValidateToolCallSuccess = _toolCallSuccess.tryValidate;
const _toolCallError = makeValidator('riglane-mcp-v1#/definitions/tool_call_error');
export const validateToolCallError = _toolCallError.validate;
export const tryValidateToolCallError = _toolCallError.tryValidate;
export const tryValidateMcpDef = (defName, value) => makeValidator(`riglane-mcp-v1#/definitions/${defName}`).tryValidate(value);
