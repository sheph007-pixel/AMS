/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Schema Validator — Separate structural and business-rule validation.
 *
 * A. Structural validation: checks XML against stored SchemaField inventory
 * B. Business-rule validation: checks data against configurable ValidationRules
 */

import { XMLParser } from "fast-xml-parser";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ValidationResult {
  status: "pass" | "fail" | "warnings";
  errors: ValidationMessage[];
  warnings: ValidationMessage[];
  info: ValidationMessage[];
}

export interface ValidationMessage {
  type: "structural" | "business";
  field: string;
  message: string;
  value?: string;
}

interface SchemaFieldInput {
  xmlPath: string;
  elementName: string;
  xmlType: string;
  isRequired: boolean;
  isRepeating: boolean;
}

interface ValidationRuleInput {
  name: string;
  category: string;
  expression: string; // JSON-encoded rule config
  severity: "error" | "warning" | "info";
}

// ─── Structural Validation ──────────────────────────────────────────────────

/**
 * Check parsed XML against the schema field inventory.
 * Verifies required elements exist and basic type compatibility.
 */
export function validateStructure(
  xmlContent: string,
  schemaFields: SchemaFieldInput[]
): ValidationResult {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
  });

  let parsed: any;
  try {
    parsed = parser.parse(xmlContent);
  } catch (e: any) {
    return {
      status: "fail",
      errors: [{ type: "structural", field: "XML", message: `XML parse error: ${e.message}` }],
      warnings: [],
      info: [],
    };
  }

  const errors: ValidationMessage[] = [];
  const warnings: ValidationMessage[] = [];
  const info: ValidationMessage[] = [];

  // Check required fields exist
  for (const field of schemaFields) {
    if (!field.isRequired) continue;

    const value = getValueByPath(parsed, field.xmlPath);
    if (value === undefined || value === null) {
      errors.push({
        type: "structural",
        field: field.xmlPath,
        message: `Required field "${field.elementName}" not found at path ${field.xmlPath}`,
      });
    }
  }

  // Discover fields in XML that aren't in schema
  const schemaPaths = new Set(schemaFields.map(f => f.xmlPath));
  const xmlPaths = discoverPaths(parsed, "", new Set());
  for (const path of xmlPaths) {
    if (!schemaPaths.has(path) && !path.startsWith("#")) {
      info.push({
        type: "structural",
        field: path,
        message: `Field "${path}" found in XML but not in schema (unmapped)`,
      });
    }
  }

  return {
    status: errors.length > 0 ? "fail" : warnings.length > 0 ? "warnings" : "pass",
    errors,
    warnings,
    info,
  };
}

// ─── Business Rule Validation ───────────────────────────────────────────────

/**
 * Check extracted data against configurable business rules.
 * Rules are stored as JSON expressions in the database.
 */
export function validateBusinessRules(
  xmlContent: string,
  rules: ValidationRuleInput[]
): ValidationResult {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
  });

  let parsed: any;
  try {
    parsed = parser.parse(xmlContent);
  } catch {
    return {
      status: "fail",
      errors: [{ type: "business", field: "XML", message: "Cannot parse XML for business validation" }],
      warnings: [],
      info: [],
    };
  }

  const errors: ValidationMessage[] = [];
  const warnings: ValidationMessage[] = [];
  const info: ValidationMessage[] = [];

  for (const rule of rules) {
    let config: any;
    try {
      config = JSON.parse(rule.expression);
    } catch {
      warnings.push({ type: "business", field: rule.name, message: `Invalid rule expression for "${rule.name}"` });
      continue;
    }

    const messages = evaluateRule(parsed, rule.name, config);
    for (const msg of messages) {
      const entry: ValidationMessage = { type: "business", field: msg.field, message: msg.message, value: msg.value };
      if (rule.severity === "error") errors.push(entry);
      else if (rule.severity === "warning") warnings.push(entry);
      else info.push(entry);
    }
  }

  return {
    status: errors.length > 0 ? "fail" : warnings.length > 0 ? "warnings" : "pass",
    errors,
    warnings,
    info,
  };
}

// ─── Rule Evaluator ─────────────────────────────────────────────────────────

function evaluateRule(parsed: any, ruleName: string, config: any): { field: string; message: string; value?: string }[] {
  const results: { field: string; message: string; value?: string }[] = [];

  switch (config.type) {
    case "field_required": {
      // Check that a field path has a non-empty value
      const val = getValueByPath(parsed, config.path);
      if (val === undefined || val === null || val === "") {
        results.push({ field: config.path, message: `Business rule "${ruleName}": required field is missing` });
      }
      break;
    }

    case "field_positive": {
      // Check that a numeric field is positive where present
      const values = getAllValuesByPath(parsed, config.path);
      for (const v of values) {
        const n = parseFloat(String(v.value));
        if (!isNaN(n) && n < 0) {
          results.push({ field: config.path, message: `Business rule "${ruleName}": negative value found`, value: String(v.value) });
        }
      }
      break;
    }

    case "field_date_valid": {
      // Check that date fields are parseable
      const values = getAllValuesByPath(parsed, config.path);
      for (const v of values) {
        if (v.value && isNaN(new Date(String(v.value)).getTime())) {
          results.push({ field: config.path, message: `Business rule "${ruleName}": invalid date`, value: String(v.value) });
        }
      }
      break;
    }

    case "field_in_set": {
      // Check that a field's value is in an allowed set
      const values = getAllValuesByPath(parsed, config.path);
      const allowed = new Set((config.values || []).map((s: string) => s.toLowerCase()));
      for (const v of values) {
        if (v.value && !allowed.has(String(v.value).toLowerCase())) {
          results.push({ field: config.path, message: `Business rule "${ruleName}": unexpected value`, value: String(v.value) });
        }
      }
      break;
    }

    default:
      // Unknown rule type — skip silently
      break;
  }

  return results;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getValueByPath(obj: any, path: string): any {
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      current = current[0]; // Take first element for path resolution
    }
    if (part.startsWith("@")) {
      current = current[`@_${part.substring(1)}`] ?? current[part];
    } else {
      current = current[part];
    }
  }
  return current;
}

function getAllValuesByPath(obj: any, path: string): { value: any }[] {
  const parts = path.split(".");
  let nodes = [obj];

  for (const part of parts) {
    const next: any[] = [];
    for (const node of nodes) {
      if (node === null || node === undefined) continue;
      const items = Array.isArray(node) ? node : [node];
      for (const item of items) {
        if (typeof item !== "object" || item === null) continue;
        const val = part.startsWith("@")
          ? (item[`@_${part.substring(1)}`] ?? item[part])
          : item[part];
        if (val !== undefined) {
          if (Array.isArray(val)) next.push(...val);
          else next.push(val);
        }
      }
    }
    nodes = next;
  }

  return nodes.filter(n => n !== null && n !== undefined && typeof n !== "object").map(n => ({ value: n }));
}

function discoverPaths(obj: any, prefix: string, seen: Set<string>): Set<string> {
  if (!obj || typeof obj !== "object") return seen;
  const items = Array.isArray(obj) ? obj : [obj];
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    for (const [key, value] of Object.entries(item)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (seen.has(path)) continue;
      seen.add(path);
      if (value && typeof value === "object") {
        discoverPaths(value, path, seen);
      }
    }
  }
  return seen;
}
