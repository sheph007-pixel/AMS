/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Schema Mapper — Auto-mapping, guardrails, and field application.
 *
 * Provides:
 * - autoMapFields(): Suggest initial mappings from known EN field patterns
 * - validateMappings(): Check for guardrail violations
 * - applyMappings(): Extract values from parsed XML using mapping config
 */

import type { ParsedField } from "./xsd-parser";

export interface SuggestedMapping {
  xmlPath: string;
  elementName: string;
  targetModel: string | null;
  targetColumn: string | null;
  reportingName: string | null;
  targetType: string;
  fallbackFields: string[];
  confidence: "exact" | "fuzzy" | "none";
}

export interface MappingWarning {
  type: "unmapped_required" | "duplicate_target" | "excluded_required" | "risky_type_change" | "unmapped";
  severity: "error" | "warning" | "info";
  fieldPath: string;
  message: string;
}

// ─── Known EN Field → DB Mapping Table ──────────────────────────────────────
// Derived from the hardcoded chains in xml-import.ts and report-cache.ts

const KNOWN_MAPPINGS: Record<string, {
  targetModel: string; targetColumn: string; targetType: string;
  reportingName: string; fallbacks: string[];
}> = {
  // Company / Client
  "CompanyIdentifier": { targetModel: "Client", targetColumn: "groupId", targetType: "string", reportingName: "Group ID", fallbacks: ["Identifier", "GroupID", "groupId", "GroupId"] },
  "EntityName": { targetModel: "Client", targetColumn: "groupName", targetType: "string", reportingName: "Client Name", fallbacks: ["Name", "GroupName", "groupName"] },
  "SitusState": { targetModel: "Client", targetColumn: "state", targetType: "string", reportingName: "State", fallbacks: ["State", "StateAbbreviation"] },
  "SICCode": { targetModel: "Client", targetColumn: "sicCode", targetType: "string", reportingName: "SIC Code", fallbacks: ["SIC"] },
  "FederalTaxId": { targetModel: "Client", targetColumn: "metadata.ein", targetType: "string", reportingName: "EIN", fallbacks: ["TaxID", "EIN"] },

  // Plan / BenefitPlan
  "PlanName": { targetModel: "BenefitPlan", targetColumn: "planName", targetType: "string", reportingName: "Plan Name", fallbacks: ["Name"] },
  "Carrier": { targetModel: "BenefitPlan", targetColumn: "carrier", targetType: "string", reportingName: "Carrier", fallbacks: [] },
  "PlanIdentifier": { targetModel: "BenefitPlan", targetColumn: "metadata.planIdentifier", targetType: "string", reportingName: "Plan ID", fallbacks: ["PlanId", "PlanID"] },
  "CarrierPlanTypeCode": { targetModel: "BenefitPlan", targetColumn: "planType", targetType: "string", reportingName: "Plan Type", fallbacks: ["PlanType", "Type"] },
  "PlanCost": { targetModel: "BenefitPlan", targetColumn: "premium", targetType: "number", reportingName: "Premium", fallbacks: ["MonthlyPlanCost", "TotalPremium", "Premium", "MonthlyPremium", "TotalMonthlyPremium", "Cost", "Rate"] },
  "PolicyNumber": { targetModel: "BenefitPlan", targetColumn: "metadata.policyNumber", targetType: "string", reportingName: "Policy Number", fallbacks: ["GroupPolicyNumber", "GroupNumber", "ContractNumber", "PlanNumber"] },
  "PlanStarts": { targetModel: "ClientSnapshot", targetColumn: "effectiveDate", targetType: "date", reportingName: "Effective Date", fallbacks: ["EffectiveDate", "StartDate"] },
  "PlanEnds": { targetModel: "ClientSnapshot", targetColumn: "renewalDate", targetType: "date", reportingName: "Renewal Date", fallbacks: ["RenewalDate", "EndDate"] },

  // Employee / EmployeeSnapshot
  "EmployeeGUID": { targetModel: "EmployeeSnapshot", targetColumn: "employeeId", targetType: "string", reportingName: "Employee ID", fallbacks: ["EmployeeNumber", "ExternalEmployeeId"] },
  "FirstName": { targetModel: "EmployeeSnapshot", targetColumn: "firstName", targetType: "string", reportingName: "First Name", fallbacks: ["firstName"] },
  "LastName": { targetModel: "EmployeeSnapshot", targetColumn: "lastName", targetType: "string", reportingName: "Last Name", fallbacks: ["lastName"] },
  "DOB": { targetModel: "EmployeeSnapshot", targetColumn: "dateOfBirth", targetType: "date", reportingName: "Date of Birth", fallbacks: ["DateOfBirth", "dateOfBirth"] },
  "HireDate": { targetModel: "EmployeeSnapshot", targetColumn: "hireDate", targetType: "date", reportingName: "Hire Date", fallbacks: ["HiredOn", "OriginalHireDate"] },
  "TerminationDate": { targetModel: "EmployeeSnapshot", targetColumn: "termDate", targetType: "date", reportingName: "Termination Date", fallbacks: ["TerminatedOn", "TermDate"] },
  "EmploymentStatus": { targetModel: "EmployeeSnapshot", targetColumn: "status", targetType: "string", reportingName: "Status", fallbacks: ["Status"] },
  "SSN": { targetModel: "EmployeeSnapshot", targetColumn: "metadata.ssn", targetType: "string", reportingName: "SSN (masked)", fallbacks: ["ssn"] },
  "Gender": { targetModel: "EmployeeSnapshot", targetColumn: "metadata.gender", targetType: "string", reportingName: "Gender", fallbacks: ["gender"] },

  // Enrollment
  "EnrollmentType": { targetModel: "Enrollment", targetColumn: "enrollmentType", targetType: "string", reportingName: "Enrollment Type", fallbacks: ["Type"] },
  "CoverageLevel": { targetModel: "Enrollment", targetColumn: "coverageLevel", targetType: "string", reportingName: "Coverage Level / Grouping", fallbacks: ["Tier", "CoverageTier"] },
  "DeclineReason": { targetModel: "Enrollment", targetColumn: "declineReason", targetType: "string", reportingName: "Decline Reason", fallbacks: ["declineReason"] },
  "CoverageEndDate": { targetModel: "Enrollment", targetColumn: "coverageEndDate", targetType: "date", reportingName: "Coverage End Date", fallbacks: ["EndDate", "EndedOn"] },
  "BenefitAmount": { targetModel: "Enrollment", targetColumn: "benefitAmount", targetType: "number", reportingName: "Benefit Amount", fallbacks: ["CoverageAmount", "Volume", "Amount", "FaceAmount", "BenefitVolume", "ApprovedAmount"] },
  "Rate": { targetModel: "Enrollment", targetColumn: "rate", targetType: "number", reportingName: "Rate", fallbacks: ["EmployeeRate", "MonthlyRate", "PlanRate", "TierRate"] },
};

// ─── Auto-Map ───────────────────────────────────────────────────────────────

export function autoMapFields(fields: ParsedField[]): SuggestedMapping[] {
  return fields.map(f => {
    const name = f.elementName.replace(/^@/, "");
    const known = KNOWN_MAPPINGS[name];

    if (known) {
      return {
        xmlPath: f.xmlPath,
        elementName: f.elementName,
        targetModel: known.targetModel,
        targetColumn: known.targetColumn,
        reportingName: known.reportingName,
        targetType: known.targetType,
        fallbackFields: known.fallbacks,
        confidence: "exact" as const,
      };
    }

    // Fuzzy match: check if field name is a known fallback
    for (const [, mapping] of Object.entries(KNOWN_MAPPINGS)) {
      if (mapping.fallbacks.includes(name)) {
        return {
          xmlPath: f.xmlPath,
          elementName: f.elementName,
          targetModel: mapping.targetModel,
          targetColumn: mapping.targetColumn,
          reportingName: mapping.reportingName,
          targetType: mapping.targetType,
          fallbackFields: [],
          confidence: "fuzzy" as const,
        };
      }
    }

    // No match
    return {
      xmlPath: f.xmlPath,
      elementName: f.elementName,
      targetModel: null,
      targetColumn: null,
      reportingName: null,
      targetType: xsdTypeToTarget(f.xmlType),
      fallbackFields: [],
      confidence: "none" as const,
    };
  });
}

// ─── Guardrails ─────────────────────────────────────────────────────────────

interface MappingInput {
  xmlPath: string;
  elementName: string;
  isRequired: boolean;
  included: boolean;
  targetModel: string | null;
  targetColumn: string | null;
  targetType: string | null;
  active: boolean;
}

export function validateMappings(
  mappings: MappingInput[],
  fields: { xmlPath: string; isRequired: boolean }[]
): MappingWarning[] {
  const warnings: MappingWarning[] = [];
  const fieldMap = new Map(fields.map(f => [f.xmlPath, f]));
  const targetKeys = new Set<string>();

  for (const m of mappings) {
    const field = fieldMap.get(m.xmlPath);

    // Unmapped active fields (no target set)
    if (m.included && m.active && !m.targetColumn) {
      warnings.push({
        type: "unmapped",
        severity: "info",
        fieldPath: m.xmlPath,
        message: `Field "${m.elementName}" is included but has no target mapping`,
      });
    }

    // Excluded required field
    if (!m.included && field?.isRequired) {
      warnings.push({
        type: "excluded_required",
        severity: "warning",
        fieldPath: m.xmlPath,
        message: `Required field "${m.elementName}" is excluded`,
      });
    }

    // Duplicate target
    if (m.targetModel && m.targetColumn && m.included) {
      const key = `${m.targetModel}.${m.targetColumn}`;
      if (targetKeys.has(key)) {
        warnings.push({
          type: "duplicate_target",
          severity: "error",
          fieldPath: m.xmlPath,
          message: `Duplicate target mapping: ${key}`,
        });
      }
      targetKeys.add(key);
    }
  }

  // Unmapped required fields (no mapping record at all)
  const mappedPaths = new Set(mappings.map(m => m.xmlPath));
  for (const f of fields) {
    if (f.isRequired && !mappedPaths.has(f.xmlPath)) {
      warnings.push({
        type: "unmapped_required",
        severity: "warning",
        fieldPath: f.xmlPath,
        message: `Required field "${f.xmlPath}" has no mapping`,
      });
    }
  }

  return warnings;
}

// ─── Apply Mappings ─────────────────────────────────────────────────────────

interface ActiveMapping {
  xmlPath: string;
  elementName: string;
  targetModel: string;
  targetColumn: string;
  targetType: string;
  fallbackFields: string[];
  transformRule: string | null;
}

/**
 * Extract a value from a parsed XML object using a mapping's field name + fallbacks.
 * Replaces the hardcoded extractField() chains in xml-import.ts.
 */
export function extractMappedValue(obj: any, mapping: ActiveMapping): any {
  const fieldNames = [mapping.elementName, ...mapping.fallbackFields];

  for (const name of fieldNames) {
    // Direct property
    if (obj[name] !== undefined && obj[name] !== null && obj[name] !== "") {
      return coerceType(obj[name], mapping.targetType);
    }
    // XML attribute notation
    if (obj[`@_${name}`] !== undefined && obj[`@_${name}`] !== null) {
      return coerceType(obj[`@_${name}`], mapping.targetType);
    }
  }

  return null;
}

function coerceType(value: any, targetType: string): any {
  if (value === null || value === undefined) return null;
  switch (targetType) {
    case "number": {
      const n = parseFloat(String(value));
      return isNaN(n) ? null : n;
    }
    case "boolean":
      return String(value).toLowerCase() === "true" || value === 1;
    case "date":
      return String(value); // Keep as string for safe storage
    default:
      return String(value);
  }
}

function xsdTypeToTarget(xsdType: string): string {
  const t = xsdType.toLowerCase();
  if (t.includes("int") || t.includes("decimal") || t.includes("float") || t.includes("double")) return "number";
  if (t.includes("date") || t.includes("time")) return "date";
  if (t.includes("boolean")) return "boolean";
  return "string";
}
