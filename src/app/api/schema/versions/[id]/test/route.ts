import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateStructure, validateBusinessRules } from "@/lib/schema-validator";
import { extractXmlPaths } from "@/lib/xsd-parser";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * POST — Upload test XML, validate against schema + mappings, return results.
 *
 * Coverage is based on DISCOVERED XML fields (runtime), not SchemaField (XSD).
 * All counts are persisted as a snapshot so they remain accurate historically.
 *
 * Invariants:
 *   mappedFields + unmappedFields == totalDiscoveredFields
 *   includedFields + excludedFields == mappedFields
 *
 * GET — List past test results.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "File is required" }, { status: 400 });
    }

    const xmlContent = await file.text();

    // Load schema fields, mappings, and business rules
    const [schemaFields, mappings, rules] = await Promise.all([
      prisma.schemaField.findMany({ where: { schemaVersionId: id } }),
      prisma.fieldMapping.findMany({ where: { schemaVersionId: id } }),
      prisma.validationRule.findMany({ where: { enabled: true } }),
    ]);

    // A. Structural validation
    const structural = validateStructure(xmlContent, schemaFields);

    // B. Business-rule validation
    const business = validateBusinessRules(
      xmlContent,
      rules.map(r => ({
        name: r.name, category: r.category,
        expression: r.expression,
        severity: r.severity as "error" | "warning" | "info",
      }))
    );

    // C. Coverage analysis — based on DISCOVERED XML fields (not XSD fields)
    const discoveredPaths = extractXmlPaths(xmlContent);
    const totalDiscoveredFields = discoveredPaths.length;

    // Build mapping lookup by xmlPath
    const mappingByPath = new Map(mappings.map(m => [m.xmlPath, m]));

    let mappedFields = 0;
    let unmappedFields = 0;
    let includedFields = 0;
    let excludedFields = 0;

    // Per-field detail for parsedPreview
    const fieldDetails: {
      xmlPath: string;
      mappingStatus: "mapped" | "unmapped" | "excluded";
      targetColumn: string | null;
      value: string | null;
      sourceUsed: string | null;
    }[] = [];

    // Record discovered fields
    for (const path of discoveredPaths) {
      const mapping = mappingByPath.get(path);

      if (mapping) {
        mappedFields++;
        if (mapping.included) {
          includedFields++;
          fieldDetails.push({
            xmlPath: path,
            mappingStatus: "mapped",
            targetColumn: mapping.targetColumn,
            value: null, // Will be populated below for sample
            sourceUsed: path,
          });
        } else {
          excludedFields++;
          fieldDetails.push({
            xmlPath: path,
            mappingStatus: "excluded",
            targetColumn: null,
            value: null,
            sourceUsed: null,
          });
        }
      } else {
        unmappedFields++;
        fieldDetails.push({
          xmlPath: path,
          mappingStatus: "unmapped",
          targetColumn: null,
          value: null,
          sourceUsed: null,
        });
      }

      // Upsert discovered field record
      await prisma.discoveredField.upsert({
        where: {
          xmlPath_schemaVersionId: {
            xmlPath: path,
            schemaVersionId: id,
          },
        },
        update: { lastSeenAt: new Date(), seenInTest: true },
        create: {
          xmlPath: path,
          schemaVersionId: id,
          seenInTest: true,
        },
      }).catch(() => {
        // Ignore constraint errors for concurrent writes
      });
    }

    // Validate invariants
    if (mappedFields + unmappedFields !== totalDiscoveredFields) {
      console.error(`Coverage invariant violated: mapped(${mappedFields}) + unmapped(${unmappedFields}) != total(${totalDiscoveredFields})`);
    }
    if (includedFields + excludedFields !== mappedFields) {
      console.error(`Coverage invariant violated: included(${includedFields}) + excluded(${excludedFields}) != mapped(${mappedFields})`);
    }

    // Combine validation results
    const allErrors = [...structural.errors, ...business.errors];
    const allWarnings = [...structural.warnings, ...business.warnings];
    const status = allErrors.length > 0 ? "fail" : allWarnings.length > 0 ? "warnings" : "pass";

    // Persist result (snapshot — historically accurate even if mappings change later)
    const result = await prisma.schemaTestResult.create({
      data: {
        schemaVersionId: id,
        fileName: file.name,
        fileSize: file.size,
        status,
        totalDiscoveredFields,
        mappedFields,
        unmappedFields,
        includedFields,
        excludedFields,
        errors: JSON.stringify(allErrors),
        warnings: JSON.stringify(allWarnings),
        parsedPreview: JSON.stringify(fieldDetails.slice(0, 200)), // Cap preview size
      },
    });

    return NextResponse.json({
      id: result.id,
      status,
      coverage: {
        totalDiscoveredFields,
        mappedFields,
        unmappedFields,
        includedFields,
        excludedFields,
      },
      errors: allErrors,
      warnings: allWarnings,
      info: [...structural.info, ...business.info],
      fieldDetails: fieldDetails.slice(0, 200),
    });
  } catch (error) {
    console.error("Schema test error:", error);
    return NextResponse.json({ error: "Failed to test file" }, { status: 500 });
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const results = await prisma.schemaTestResult.findMany({
      where: { schemaVersionId: id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return NextResponse.json(results);
  } catch (error) {
    console.error("Test results GET error:", error);
    return NextResponse.json({ error: "Failed to load test results" }, { status: 500 });
  }
}
