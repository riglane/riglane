import type { StructSchema, ValidationResult } from '../types/struct.js';
export declare function loadYaml<T = unknown>(path: string): T;
export declare function loadJson<T = unknown>(path: string): T;
export type NestedFieldResult = {
    readonly found: true;
    readonly value: unknown;
} | {
    readonly found: false;
};
export declare function getNestedField(obj: unknown, dotpath: string): NestedFieldResult;
export declare function checkType(value: unknown, expectedType: string): boolean;
export declare function detectFormat(schema: StructSchema): 'json' | 'markdown' | 'yaml' | 'text';
export declare function validateStandardJsonSchema(data: unknown, schema: StructSchema, filename: string): ValidationResult;
export declare function validateFile(filePath: string, schema: StructSchema): ValidationResult;
