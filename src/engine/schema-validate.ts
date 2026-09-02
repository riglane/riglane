
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { parse as parseYamlText } from 'yaml';

import type {
  CustomField,
  FrontmatterField,
  StructSchema,
  ValidationResult,
} from '../types/struct.js';
import {
  extractSectionContent,
  parseMarkdownFrontmatter,
  parseMarkdownSections,
} from './markdown.js';


export function loadYaml<T = unknown>(path: string): T {
  const content = readFileSync(path, 'utf-8');
  return parseYamlText(content) as T;
}

export function loadJson<T = unknown>(path: string): T {
  const content = readFileSync(path, 'utf-8');
  return JSON.parse(content) as T;
}


function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function jsonTypeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'number';
  }
  if (typeof value === 'string') return 'string';
  if (typeof value === 'object') return 'object';
  return typeof value;
}

function pythonReMatch(pattern: string, value: string): boolean {
  const anchored = pattern.startsWith('^') ? pattern : `^${pattern}`;
  try {
    return new RegExp(anchored).test(value);
  } catch {
    return false;
  }
}


export type NestedFieldResult =
  | { readonly found: true; readonly value: unknown }
  | { readonly found: false };

export function getNestedField(obj: unknown, dotpath: string): NestedFieldResult {
  const parts = dotpath.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (part.endsWith('[]')) {
      const key = part.substring(0, part.length - 2);
      if (isPlainObject(current) && key in current) {
        const next = current[key];
        if (!Array.isArray(next)) return { found: false };
        current = next;
        continue;
      }
      return { found: false };
    }
    if (isPlainObject(current) && part in current) {
      current = current[part];
    } else {
      return { found: false };
    }
  }
  return { found: true, value: current };
}


export function checkType(value: unknown, expectedType: string): boolean {
  switch (expectedType) {
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return typeof value === 'boolean' || Number.isInteger(value);
    case 'number':
      return typeof value === 'boolean' || typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
    case 'list':
      return Array.isArray(value);
    case 'object':
      return isPlainObject(value);
    case 'enum':
      return true;
    default:
      return true;
  }
}


export function detectFormat(schema: StructSchema): 'json' | 'markdown' | 'yaml' | 'text' {
  if (schema.format) return schema.format;
  if (schema.type === 'object' && (schema.required || schema.properties)) {
    return 'json';
  }
  return 'text';
}


export function validateStandardJsonSchema(
  data: unknown,
  schema: StructSchema,
  filename: string,
): ValidationResult {
  let checks = 0;
  let failures = 0;
  const details: string[] = [];

  const required = schema.required ?? [];
  const properties = schema.properties ?? {};

  for (const fieldName of required) {
    checks += 1;
    if (!isPlainObject(data) || !(fieldName in data)) {
      failures += 1;
      details.push(`${filename}: missing required field '${fieldName}'`);
    }
  }

  if (isPlainObject(data)) {
    for (const [fieldName, fieldSchema] of Object.entries(properties)) {
      if (!(fieldName in data)) continue;

      const value = data[fieldName];
      const expectedType = fieldSchema.type;

      if (expectedType !== undefined) {
        checks += 1;
        if (!checkType(value, expectedType)) {
          failures += 1;
          details.push(
            `${filename}: '${fieldName}' type mismatch ` +
              `(expected ${expectedType}, got ${jsonTypeName(value)})`,
          );
        }
      }

      if (fieldSchema.enum !== undefined) {
        checks += 1;
        if (!fieldSchema.enum.includes(value)) {
          failures += 1;
          details.push(
            `${filename}: '${fieldName}' value '${value as string}' not in ${JSON.stringify(fieldSchema.enum)}`,
          );
        }
      }

      if (fieldSchema.pattern !== undefined && typeof value === 'string') {
        checks += 1;
        if (!pythonReMatch(fieldSchema.pattern, value)) {
          failures += 1;
          details.push(
            `${filename}: '${fieldName}' doesn't match pattern '${fieldSchema.pattern}'`,
          );
        }
      }

      if (fieldSchema.min_items !== undefined && Array.isArray(value)) {
        checks += 1;
        if (value.length < fieldSchema.min_items) {
          failures += 1;
          details.push(
            `${filename}: '${fieldName}' has ${value.length} items, ` +
              `min is ${fieldSchema.min_items}`,
          );
        }
      }

      if (fieldSchema.minimum !== undefined && typeof value === 'number') {
        checks += 1;
        if (value < (fieldSchema.minimum as number)) {
          failures += 1;
          details.push(
            `${filename}: '${fieldName}' value ${value} is below minimum ${fieldSchema.minimum as number}`,
          );
        }
      }
      if (fieldSchema.maximum !== undefined && typeof value === 'number') {
        checks += 1;
        if (value > (fieldSchema.maximum as number)) {
          failures += 1;
          details.push(
            `${filename}: '${fieldName}' value ${value} exceeds maximum ${fieldSchema.maximum as number}`,
          );
        }
      }

      if (fieldSchema.minLength !== undefined && typeof value === 'string') {
        checks += 1;
        if (value.length < (fieldSchema.minLength as number)) {
          failures += 1;
          details.push(
            `${filename}: '${fieldName}' length ${value.length} is below minLength ${fieldSchema.minLength as number}`,
          );
        }
      }
      if (fieldSchema.maxLength !== undefined && typeof value === 'string') {
        checks += 1;
        if (value.length > (fieldSchema.maxLength as number)) {
          failures += 1;
          details.push(
            `${filename}: '${fieldName}' length ${value.length} exceeds maxLength ${fieldSchema.maxLength as number}`,
          );
        }
      }

      if (expectedType === 'object' && isPlainObject(value)) {
        if (fieldSchema.required !== undefined || fieldSchema.properties !== undefined) {
          const nested = validateStandardJsonSchema(
            value,
            fieldSchema as StructSchema,
            `${filename}.${fieldName}`,
          );
          checks += nested.checks;
          failures += nested.failures;
          details.push(...nested.details);
        }
      }

      if (expectedType === 'array' && Array.isArray(value)) {
        const itemsSchema = fieldSchema.items;
        if (
          itemsSchema !== undefined &&
          itemsSchema.type === 'object' &&
          (itemsSchema.required !== undefined || itemsSchema.properties !== undefined)
        ) {
          for (let i = 0; i < value.length; i += 1) {
            const nested = validateStandardJsonSchema(
              value[i],
              itemsSchema as StructSchema,
              `${filename}.${fieldName}[${i}]`,
            );
            checks += nested.checks;
            failures += nested.failures;
            details.push(...nested.details);
          }
        }
      }
    }
  }

  return {
    passed: failures === 0,
    checks,
    failures,
    details,
  };
}


function validateArrayField(
  parentData: unknown,
  fullPath: string,
  fieldDef: CustomField,
  filename: string,
): ValidationResult {
  let checks = 0;
  let failures = 0;
  const details: string[] = [];

  const splitIdx = fullPath.indexOf('[].');
  const arrPath = fullPath.substring(0, splitIdx);
  const itemField = fullPath.substring(splitIdx + 3);

  const arrLookup = getNestedField(parentData, `${arrPath}[]`);
  checks += 1;
  if (!arrLookup.found || !Array.isArray(arrLookup.value)) {
    failures += 1;
    details.push(
      `${filename}: required array '${arrPath}' not found (or value is not an array). Fix: add '${arrPath}' as an array at the appropriate path.`,
    );
    return { passed: false, checks, failures, details };
  }
  const arrValue = arrLookup.value;

  if (fieldDef.min_items !== undefined && arrValue.length < fieldDef.min_items) {
    checks += 1;
    failures += 1;
    details.push(
      `${filename}: array '${arrPath}' has ${arrValue.length} items ` +
        `(minimum required: ${fieldDef.min_items}). ` +
        `Fix: add more items until the array has at least ${fieldDef.min_items} entries.`,
    );
  }

  for (let i = 0; i < arrValue.length; i += 1) {
    const item = arrValue[i];

    if (itemField.includes('[].')) {
      const nested = validateArrayField(item, itemField, fieldDef, filename);
      checks += nested.checks;
      failures += nested.failures;
      details.push(...nested.details);
      continue;
    }

    const itemLookup = getNestedField(item, itemField);
    if (!itemLookup.found) {
      checks += 1;
      failures += 1;
      details.push(
        `${filename}: array item '${arrPath}[${i}]' is missing required field '${itemField}'. ` +
          `Fix: add '${itemField}: <value>' to item at index ${i}.`,
      );
    } else if (fieldDef.type !== undefined && !checkType(itemLookup.value, fieldDef.type)) {
      checks += 1;
      failures += 1;
      details.push(
        `${filename}: array item '${arrPath}[${i}].${itemField}' has wrong type (expected '${fieldDef.type}', got '${jsonTypeName(itemLookup.value)}'). Fix: change the value to match the expected type.`,
      );
    } else if (fieldDef.enum !== undefined && !fieldDef.enum.includes(itemLookup.value)) {
      checks += 1;
      failures += 1;
      details.push(
        `${filename}: array item '${arrPath}[${i}].${itemField}' = ` +
          `'${String(itemLookup.value)}' is not allowed. ` +
          `Fix: choose one of ${JSON.stringify(fieldDef.enum)}.`,
      );
    }
  }

  return { passed: failures === 0, checks, failures, details };
}


export function validateFile(filePath: string, schema: StructSchema): ValidationResult {
  let checks = 0;
  let failures = 0;
  const details: string[] = [];

  const filename = basename(filePath);

  const fileChecks = schema.file_checks ?? {};

  if (fileChecks.exists !== false) {
    checks += 1;
    let exists = false;
    try {
      exists = statSync(filePath).isFile();
    } catch {
      exists = false;
    }
    if (!exists) {
      failures += 1;
      details.push(`File not found: ${filePath}`);
      return { passed: false, checks, failures, details };
    }
  }

  let cachedSize: number | null = null;
  const getSize = (): number => {
    if (cachedSize === null) cachedSize = statSync(filePath).size;
    return cachedSize;
  };

  if (fileChecks.min_size !== undefined) {
    checks += 1;
    const size = getSize();
    if (size < fileChecks.min_size) {
      failures += 1;
      details.push(
        `${filename}: file is too small (${size} bytes, minimum ${fileChecks.min_size}). Likely cause: required content is missing or sections are empty. Fix: ensure all required sections have substantive content.`,
      );
    }
  }

  if (fileChecks.max_size !== undefined) {
    checks += 1;
    const size = getSize();
    if (size > fileChecks.max_size) {
      failures += 1;
      details.push(
        `${filename}: file is too large (${size} bytes, maximum ${fileChecks.max_size}). Fix: split the content into multiple files or remove redundant sections.`,
      );
    }
  }

  if (fileChecks.name_pattern !== undefined) {
    checks += 1;
    if (!pythonReMatch(fileChecks.name_pattern, filename)) {
      failures += 1;
      details.push(
        `${filename}: filename does not match required pattern '${fileChecks.name_pattern}'. Fix: rename the file so its basename matches this regex.`,
      );
    }
  }

  const fmt = detectFormat(schema);

  if (fmt === 'json') {
    checks += 1;
    let data: unknown;
    try {
      data = loadJson(filePath);
    } catch (e) {
      failures += 1;
      const msg = e instanceof Error ? e.message : String(e);
      details.push(
        `${filename}: invalid JSON — ${msg}. Fix: check the file for JSON syntax errors (missing commas, unmatched braces/brackets, trailing commas, unquoted keys).`,
      );
      return { passed: false, checks, failures, details };
    }

    if (schema.required !== undefined || schema.properties !== undefined) {
      const nested = validateStandardJsonSchema(data, schema, filename);
      checks += nested.checks;
      failures += nested.failures;
      details.push(...nested.details);
    }

    const jsonSchema = schema.json_schema ?? {};
    for (const fieldDef of jsonSchema.required_fields ?? []) {
      const fieldName = fieldDef.field;

      if (fieldName.includes('[].')) {
        const result = validateArrayField(data, fieldName, fieldDef, filename);
        checks += result.checks;
        failures += result.failures;
        details.push(...result.details);
      } else {
        checks += 1;
        const lookup = getNestedField(data, fieldName);
        if (!lookup.found) {
          failures += 1;
          details.push(
            `${filename}: required field '${fieldName}' is missing. ` +
              `Fix: add '${fieldName}' to the JSON object at the appropriate path.`,
          );
          continue;
        }
        const value = lookup.value;

        if (fieldDef.type !== undefined && !checkType(value, fieldDef.type)) {
          checks += 1;
          failures += 1;
          details.push(
            `${filename}: field '${fieldName}' has wrong type (expected '${fieldDef.type}', got '${jsonTypeName(value)}'). Fix: change the value to match the expected type.`,
          );
        }

        if (fieldDef.pattern !== undefined && typeof value === 'string') {
          checks += 1;
          if (!pythonReMatch(fieldDef.pattern, value)) {
            failures += 1;
            details.push(
              `${filename}: field '${fieldName}' = '${value}' does not match ` +
                `required pattern '${fieldDef.pattern}'. ` +
                `Fix: change '${fieldName}' to match this regex.`,
            );
          }
        }

        if (fieldDef.enum !== undefined && !fieldDef.enum.includes(value)) {
          checks += 1;
          failures += 1;
          details.push(
            `${filename}: field '${fieldName}' = '${String(value)}' is not allowed. ` +
              `Fix: choose one of ${JSON.stringify(fieldDef.enum)}.`,
          );
        }

        if (fieldDef.min_items !== undefined && Array.isArray(value)) {
          checks += 1;
          if (value.length < fieldDef.min_items) {
            failures += 1;
            details.push(
              `${filename}: array '${fieldName}' has ${value.length} items ` +
                `(minimum required: ${fieldDef.min_items}). ` +
                `Fix: add more items until the array has at least ${fieldDef.min_items} entries.`,
            );
          }
        }
      }
    }
  } else if (fmt === 'markdown') {
    const frontmatterSchema = schema.frontmatter ?? {};
    const requiredSections = schema.required_sections ?? [];

    checks += 1;
    let parseResult: { frontmatter: Record<string, unknown> | null; body: string };
    try {
      parseResult = parseMarkdownFrontmatter(filePath);
    } catch (e) {
      failures += 1;
      const msg = e instanceof Error ? e.message : String(e);
      details.push(
        `${filename}: failed to parse markdown file — ${msg}. Fix: ensure the file has valid YAML frontmatter between '---' markers at the top, followed by markdown body content.`,
      );
      return { passed: false, checks, failures, details };
    }
    const { frontmatter, body } = parseResult;

    if (frontmatterSchema.required !== undefined && frontmatterSchema.required.length > 0) {
      if (frontmatter === null) {
        checks += 1;
        failures += 1;
        details.push(
          `${filename}: YAML frontmatter block is missing. Fix: add a frontmatter block at the very top of the file, delimited by '---' on its own line before and after the YAML.`,
        );
      } else {
        for (const fieldDef of frontmatterSchema.required as readonly FrontmatterField[]) {
          const fieldName = fieldDef.field;
          checks += 1;
          if (!(fieldName in frontmatter)) {
            const allowed = fieldDef.values;
            const hint =
              allowed !== undefined ? ` Allowed values: ${JSON.stringify(allowed)}.` : '';
            failures += 1;
            details.push(
              `${filename}: required frontmatter field '${fieldName}' is missing. ` +
                `Fix: add '${fieldName}: <value>' to the YAML frontmatter.${hint}`,
            );
            continue;
          }
          const value = frontmatter[fieldName];

          if (fieldDef.type !== undefined && !checkType(value, fieldDef.type)) {
            checks += 1;
            failures += 1;
            details.push(
              `${filename}: frontmatter '${fieldName}' has wrong type (expected '${fieldDef.type}', got '${jsonTypeName(value)}'). Fix: change the value format to match the expected type.`,
            );
          }

          if (fieldDef.pattern !== undefined && typeof value === 'string') {
            checks += 1;
            if (!pythonReMatch(fieldDef.pattern, value)) {
              failures += 1;
              details.push(
                `${filename}: frontmatter '${fieldName}' = '${value}' does not ` +
                  `match required pattern '${fieldDef.pattern}'. ` +
                  `Fix: change '${fieldName}' to match this regex.`,
              );
            }
          }

          if (fieldDef.values !== undefined && !fieldDef.values.includes(value)) {
            checks += 1;
            failures += 1;
            details.push(
              `${filename}: frontmatter '${fieldName}' = '${String(value)}' is not allowed. ` +
                `Fix: choose one of ${JSON.stringify(fieldDef.values)}.`,
            );
          }

          if (fieldDef.body_match_section !== undefined && typeof value === 'string') {
            const targetSection = fieldDef.body_match_section;
            const sectionText = extractSectionContent(body, targetSection);
            checks += 1;
            if (sectionText !== null && !sectionText.toLowerCase().includes(value.toLowerCase())) {
              failures += 1;
              details.push(
                `${filename}: frontmatter declares '${fieldName}: ${value}' but the word '${value}' does not appear literally in the body of '## ${targetSection}'. Fix: rewrite the '## ${targetSection}' body to use '${value}' directly (e.g., 'The system ${value} do X').`,
              );
            }
          }
        }
      }
    }

    if (requiredSections.length > 0) {
      const sections = parseMarkdownSections(body);
      for (const section of requiredSections) {
        checks += 1;
        if (!sections.includes(section)) {
          failures += 1;
          details.push(
            `${filename}: required markdown section '## ${section}' is missing. Fix: add '## ${section}' as a heading at the top level (##, not ### or deeper), followed by body content for that section.`,
          );
        }
      }
    }
  } else if (fmt === 'yaml') {
    checks += 1;
    let data: unknown;
    try {
      data = loadYaml(filePath);
    } catch (e) {
      failures += 1;
      const msg = e instanceof Error ? e.message : String(e);
      details.push(
        `${filename}: invalid YAML — ${msg}. Fix: check the file for YAML syntax errors (indentation, unmatched quotes, tabs mixed with spaces).`,
      );
      return { passed: false, checks, failures, details };
    }

    const yamlSchema = schema.yaml_schema ?? {};
    for (const fieldDef of yamlSchema.required_fields ?? []) {
      const fieldName = fieldDef.field;
      checks += 1;
      const lookup = getNestedField(data, fieldName);
      if (!lookup.found) {
        failures += 1;
        details.push(
          `${filename}: required YAML field '${fieldName}' is missing. ` +
            `Fix: add '${fieldName}: <value>' at the appropriate path.`,
        );
      }
    }
  }

  return { passed: failures === 0, checks, failures, details };
}
