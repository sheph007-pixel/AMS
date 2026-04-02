/**
 * Targeted tests for the Schema Management system.
 *
 * Tests cover:
 * - XSD parsing and field extraction
 * - XML path discovery
 * - Auto-mapping from known EN patterns
 * - Mapping guardrails
 * - getMappedField resolution (deterministic, fallback, no-active-schema)
 * - extractMappedValue from schema-mapper
 */

import { parseXsdToFields, inferFieldsFromXml, extractXmlPaths } from "../xsd-parser";
import { autoMapFields, validateMappings, extractMappedValue } from "../schema-mapper";

// ─── XSD Parser Tests ───────────────────────────────────────────────────────

describe("XSD Parser", () => {
  const sampleXsd = `<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="Data">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="Header" minOccurs="0">
          <xs:complexType>
            <xs:sequence>
              <xs:element name="RunDate" type="xs:dateTime" minOccurs="0"/>
            </xs:sequence>
          </xs:complexType>
        </xs:element>
        <xs:element name="Companies">
          <xs:complexType>
            <xs:sequence>
              <xs:element name="Company" maxOccurs="unbounded">
                <xs:complexType>
                  <xs:sequence>
                    <xs:element name="CompanyIdentifier" type="xs:string"/>
                    <xs:element name="EntityName" type="xs:string"/>
                    <xs:element name="SICCode" type="xs:string" minOccurs="0"/>
                  </xs:sequence>
                  <xs:attribute name="id" type="xs:string" use="required"/>
                </xs:complexType>
              </xs:element>
            </xs:sequence>
          </xs:complexType>
        </xs:element>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

  test("parses XSD to field inventory", () => {
    const fields = parseXsdToFields(sampleXsd);
    expect(fields.length).toBeGreaterThan(0);

    const dataField = fields.find(f => f.elementName === "Data");
    expect(dataField).toBeDefined();

    const companyId = fields.find(f => f.elementName === "CompanyIdentifier");
    expect(companyId).toBeDefined();
    expect(companyId!.xmlType).toBe("xs:string");
    expect(companyId!.isRequired).toBe(true);

    const sicCode = fields.find(f => f.elementName === "SICCode");
    expect(sicCode).toBeDefined();
    expect(sicCode!.isRequired).toBe(false);

    const companyEl = fields.find(f => f.elementName === "Company");
    expect(companyEl).toBeDefined();
    expect(companyEl!.isRepeating).toBe(true);
  });

  test("parses attributes", () => {
    const fields = parseXsdToFields(sampleXsd);
    const idAttr = fields.find(f => f.elementName === "@id");
    expect(idAttr).toBeDefined();
    expect(idAttr!.isAttribute).toBe(true);
    expect(idAttr!.isRequired).toBe(true);
  });

  test("handles empty/malformed XSD gracefully", () => {
    const fields = parseXsdToFields("<xs:schema/>");
    expect(fields).toEqual([]);
  });
});

// ─── XML Inference Tests ────────────────────────────────────────────────────

describe("XML Inference", () => {
  test("infers fields from sample XML", () => {
    const xml = `<Data>
      <Header><RunDate>2026-01-15</RunDate></Header>
      <Companies>
        <Company>
          <CompanyIdentifier>ABC123</CompanyIdentifier>
          <EntityName>Test Corp</EntityName>
        </Company>
      </Companies>
    </Data>`;
    const fields = inferFieldsFromXml(xml);
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.some(f => f.elementName === "CompanyIdentifier")).toBe(true);
    expect(fields.some(f => f.elementName === "RunDate")).toBe(true);
  });

  test("infers types correctly", () => {
    const xml = `<Root><Amount>123.45</Amount><Count>42</Count><Active>true</Active><Name>test</Name></Root>`;
    const fields = inferFieldsFromXml(xml);
    expect(fields.find(f => f.elementName === "Amount")?.xmlType).toBe("xs:decimal");
    expect(fields.find(f => f.elementName === "Count")?.xmlType).toBe("xs:integer");
    expect(fields.find(f => f.elementName === "Name")?.xmlType).toBe("xs:string");
  });
});

// ─── XML Path Discovery Tests ───────────────────────────────────────────────

describe("extractXmlPaths", () => {
  test("discovers all paths from XML", () => {
    const xml = `<Data><Companies><Company><Name>Test</Name><Plans><Plan><PlanCost>100</PlanCost></Plan></Plans></Company></Companies></Data>`;
    const paths = extractXmlPaths(xml);
    expect(paths).toContain("Data");
    expect(paths).toContain("Data.Companies");
    expect(paths).toContain("Data.Companies.Company");
    expect(paths).toContain("Data.Companies.Company.Name");
    expect(paths).toContain("Data.Companies.Company.Plans.Plan.PlanCost");
  });
});

// ─── Auto-Map Tests ─────────────────────────────────────────────────────────

describe("autoMapFields", () => {
  test("maps known EN fields with exact confidence", () => {
    const fields = [
      { xmlPath: "Data.Companies.Company.CompanyIdentifier", elementName: "CompanyIdentifier", xmlType: "xs:string", isRequired: true, isRepeating: false, isNillable: false, isAttribute: false, parentPath: null, depth: 3, sortOrder: 0 },
      { xmlPath: "Data.Companies.Company.EntityName", elementName: "EntityName", xmlType: "xs:string", isRequired: true, isRepeating: false, isNillable: false, isAttribute: false, parentPath: null, depth: 3, sortOrder: 1 },
      { xmlPath: "Data.Companies.Company.Plans.Plan.PlanCost", elementName: "PlanCost", xmlType: "xs:decimal", isRequired: false, isRepeating: false, isNillable: false, isAttribute: false, parentPath: null, depth: 5, sortOrder: 2 },
    ];

    const suggestions = autoMapFields(fields);

    const compId = suggestions.find(s => s.elementName === "CompanyIdentifier");
    expect(compId?.confidence).toBe("exact");
    expect(compId?.targetModel).toBe("Client");
    expect(compId?.targetColumn).toBe("groupId");

    const planCost = suggestions.find(s => s.elementName === "PlanCost");
    expect(planCost?.confidence).toBe("exact");
    expect(planCost?.targetModel).toBe("BenefitPlan");
    expect(planCost?.fallbackFields).toContain("MonthlyPlanCost");
  });

  test("matches fallback fields with fuzzy confidence", () => {
    const fields = [
      { xmlPath: "Data.MonthlyPlanCost", elementName: "MonthlyPlanCost", xmlType: "xs:decimal", isRequired: false, isRepeating: false, isNillable: false, isAttribute: false, parentPath: null, depth: 1, sortOrder: 0 },
    ];
    const suggestions = autoMapFields(fields);
    expect(suggestions[0].confidence).toBe("fuzzy");
    expect(suggestions[0].targetModel).toBe("BenefitPlan");
  });

  test("returns none confidence for unknown fields", () => {
    const fields = [
      { xmlPath: "Data.CustomField", elementName: "CustomField", xmlType: "xs:string", isRequired: false, isRepeating: false, isNillable: false, isAttribute: false, parentPath: null, depth: 1, sortOrder: 0 },
    ];
    const suggestions = autoMapFields(fields);
    expect(suggestions[0].confidence).toBe("none");
    expect(suggestions[0].targetModel).toBeNull();
  });
});

// ─── Guardrails Tests ───────────────────────────────────────────────────────

describe("validateMappings", () => {
  test("detects unmapped required fields", () => {
    const mappings = [{ xmlPath: "a", elementName: "a", isRequired: false, included: true, targetModel: null, targetColumn: null, targetType: null, active: true }];
    const fields = [{ xmlPath: "a", isRequired: false }, { xmlPath: "b", isRequired: true }];
    const warnings = validateMappings(mappings, fields);
    expect(warnings.some(w => w.type === "unmapped_required" && w.fieldPath === "b")).toBe(true);
  });

  test("detects duplicate target mappings", () => {
    const mappings = [
      { xmlPath: "a", elementName: "a", isRequired: false, included: true, targetModel: "Client", targetColumn: "name", targetType: "string", active: true },
      { xmlPath: "b", elementName: "b", isRequired: false, included: true, targetModel: "Client", targetColumn: "name", targetType: "string", active: true },
    ];
    const warnings = validateMappings(mappings, []);
    expect(warnings.some(w => w.type === "duplicate_target")).toBe(true);
  });

  test("warns on excluded required fields", () => {
    const mappings = [{ xmlPath: "a", elementName: "a", isRequired: true, included: false, targetModel: "Client", targetColumn: "id", targetType: "string", active: true }];
    const fields = [{ xmlPath: "a", isRequired: true }];
    const warnings = validateMappings(mappings, fields);
    expect(warnings.some(w => w.type === "excluded_required")).toBe(true);
  });
});

// ─── extractMappedValue Tests ───────────────────────────────────────────────

describe("extractMappedValue", () => {
  test("resolves primary field", () => {
    const obj = { PlanCost: "123.45" };
    const mapping = { xmlPath: "PlanCost", elementName: "PlanCost", targetModel: "BenefitPlan", targetColumn: "premium", targetType: "number", fallbackFields: ["MonthlyPlanCost"], transformRule: null };
    expect(extractMappedValue(obj, mapping)).toBe(123.45);
  });

  test("resolves via fallback", () => {
    const obj = { MonthlyPlanCost: "99.99" };
    const mapping = { xmlPath: "PlanCost", elementName: "PlanCost", targetModel: "BenefitPlan", targetColumn: "premium", targetType: "number", fallbackFields: ["MonthlyPlanCost", "TotalPremium"], transformRule: null };
    expect(extractMappedValue(obj, mapping)).toBe(99.99);
  });

  test("returns null when no field matches", () => {
    const obj = { SomethingElse: "hello" };
    const mapping = { xmlPath: "PlanCost", elementName: "PlanCost", targetModel: "BenefitPlan", targetColumn: "premium", targetType: "number", fallbackFields: ["MonthlyPlanCost"], transformRule: null };
    expect(extractMappedValue(obj, mapping)).toBeNull();
  });

  test("coerces types correctly", () => {
    const obj = { Active: "true" };
    const mapping = { xmlPath: "Active", elementName: "Active", targetModel: "Test", targetColumn: "active", targetType: "boolean", fallbackFields: [], transformRule: null };
    expect(extractMappedValue(obj, mapping)).toBe(true);
  });

  test("resolves via @_ attribute notation", () => {
    const obj = { "@_PlanCost": "50.00" };
    const mapping = { xmlPath: "PlanCost", elementName: "PlanCost", targetModel: "BenefitPlan", targetColumn: "premium", targetType: "number", fallbackFields: [], transformRule: null };
    expect(extractMappedValue(obj, mapping)).toBe(50);
  });

  test("stops at first valid value (deterministic)", () => {
    const obj = { PlanCost: "100", MonthlyPlanCost: "200" };
    const mapping = { xmlPath: "PlanCost", elementName: "PlanCost", targetModel: "BenefitPlan", targetColumn: "premium", targetType: "number", fallbackFields: ["MonthlyPlanCost"], transformRule: null };
    // Must return 100 (primary), not 200 (fallback)
    expect(extractMappedValue(obj, mapping)).toBe(100);
  });
});

// ─── getMappedField Behavior Tests (Integration-Level) ──────────────────────

describe("getMappedField behavior", () => {
  // Simulate the getMappedField logic since we can't import it directly (it's a private function in report-cache.ts)
  // This tests the same algorithm independently.

  function getField(obj: any, ...keys: string[]): string | null {
    if (!obj || typeof obj !== "object") return null;
    for (const key of keys) {
      if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "") return String(obj[key]);
      if (obj[`@_${key}`] !== undefined && obj[`@_${key}`] !== null) return String(obj[`@_${key}`]);
    }
    return null;
  }

  interface MappingLookup { byFieldName: Map<string, string[]> }

  function getMappedField(obj: any, mappings: MappingLookup | null, primaryField: string, ...hardcodedFallbacks: string[]): string | null {
    if (mappings) {
      const chain = mappings.byFieldName.get(primaryField);
      if (chain) {
        const result = getField(obj, ...chain);
        if (result) return result;
      }
    }
    return getField(obj, primaryField, ...hardcodedFallbacks);
  }

  test("no active schema → falls back to hardcoded chain", () => {
    const obj = { MonthlyPlanCost: "500" };
    const result = getMappedField(obj, null, "PlanCost", "MonthlyPlanCost", "TotalPremium");
    expect(result).toBe("500");
  });

  test("active schema with mapping → uses mapping chain first", () => {
    const obj = { CustomCost: "300" };
    const mappings: MappingLookup = {
      byFieldName: new Map([["PlanCost", ["PlanCost", "CustomCost"]]]),
    };
    // PlanCost not found, CustomCost found via mapping fallback
    const result = getMappedField(obj, mappings, "PlanCost", "MonthlyPlanCost");
    expect(result).toBe("300");
  });

  test("mapping chain fails → falls back to hardcoded", () => {
    const obj = { MonthlyPlanCost: "999" };
    const mappings: MappingLookup = {
      byFieldName: new Map([["PlanCost", ["PlanCost", "CustomCost"]]]),
    };
    // Mapping chain finds nothing, hardcoded chain finds MonthlyPlanCost
    const result = getMappedField(obj, mappings, "PlanCost", "MonthlyPlanCost");
    expect(result).toBe("999");
  });

  test("deterministic: stops at first match in mapping chain", () => {
    const obj = { PlanCost: "100", CustomCost: "200" };
    const mappings: MappingLookup = {
      byFieldName: new Map([["PlanCost", ["PlanCost", "CustomCost"]]]),
    };
    expect(getMappedField(obj, mappings, "PlanCost")).toBe("100");
  });

  test("no multi-value ambiguity", () => {
    const obj = { A: "1", B: "2" };
    const mappings: MappingLookup = {
      byFieldName: new Map([["A", ["A", "B"]]]),
    };
    // Returns "1" only, never merges or returns both
    expect(getMappedField(obj, mappings, "A")).toBe("1");
  });
});
