import type { CustomFieldType, FrontmatterFieldType, StandardFieldType, StructFormat } from './enums.js';
export interface StructSchema {
    readonly name?: string;
    readonly description?: string;
    readonly file_checks?: FileChecks;
    readonly format?: StructFormat;
    readonly type?: 'object';
    readonly required?: readonly string[];
    readonly properties?: Readonly<Record<string, StandardField>>;
    readonly json_schema?: CustomSchemaBlock;
    readonly yaml_schema?: CustomSchemaBlock;
    readonly frontmatter?: FrontmatterBlock;
    readonly required_sections?: readonly string[];
    readonly [key: string]: unknown;
}
export interface FileChecks {
    readonly exists?: boolean;
    readonly min_size?: number;
    readonly max_size?: number;
    readonly name_pattern?: string;
}
export interface StandardField {
    readonly type?: StandardFieldType;
    readonly enum?: readonly unknown[];
    readonly pattern?: string;
    readonly min_items?: number;
    readonly minimum?: number;
    readonly maximum?: number;
    readonly minLength?: number;
    readonly maxLength?: number;
    readonly required?: readonly string[];
    readonly properties?: Readonly<Record<string, StandardField>>;
    readonly items?: StandardField;
    readonly description?: string;
}
export interface CustomSchemaBlock {
    readonly required_fields?: readonly CustomField[];
    readonly optional_fields?: readonly CustomField[];
}
export interface CustomField {
    readonly field: string;
    readonly type?: CustomFieldType;
    readonly pattern?: string;
    readonly enum?: readonly unknown[];
    readonly min_items?: number;
    readonly values?: readonly unknown[];
    readonly description?: string;
}
export interface FrontmatterBlock {
    readonly required?: readonly FrontmatterField[];
    readonly optional?: readonly FrontmatterField[];
}
export interface FrontmatterField {
    readonly field: string;
    readonly type?: FrontmatterFieldType;
    readonly pattern?: string;
    readonly values?: readonly unknown[];
    readonly body_match_section?: string;
    readonly description?: string;
}
export interface ValidationResult {
    readonly passed: boolean;
    readonly checks: number;
    readonly failures: number;
    readonly details: readonly string[];
    readonly proof_results?: readonly ProofResult[];
}
export interface ProofResult {
    readonly path: string;
    readonly mode: string;
    readonly status: string;
}
