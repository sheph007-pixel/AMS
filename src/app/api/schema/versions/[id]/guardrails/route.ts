import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateMappings } from "@/lib/schema-mapper";

/**
 * GET — Run guardrail checks on current mappings for a schema version.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const [fields, mappings] = await Promise.all([
      prisma.schemaField.findMany({
        where: { schemaVersionId: id },
        select: { xmlPath: true, isRequired: true },
      }),
      prisma.fieldMapping.findMany({
        where: { schemaVersionId: id },
        include: { schemaField: { select: { xmlPath: true, elementName: true, isRequired: true } } },
      }),
    ]);

    const mappingInputs = mappings.map(m => ({
      xmlPath: m.xmlPath,
      elementName: m.schemaField?.elementName || m.xmlPath.split(".").pop() || m.xmlPath,
      isRequired: m.schemaField?.isRequired || false,
      included: m.included,
      targetModel: m.targetModel,
      targetColumn: m.targetColumn,
      targetType: m.targetType,
      active: m.active,
    }));

    const warnings = validateMappings(mappingInputs, fields);

    return NextResponse.json({
      warnings,
      summary: {
        total: warnings.length,
        errors: warnings.filter(w => w.severity === "error").length,
        warnings: warnings.filter(w => w.severity === "warning").length,
        info: warnings.filter(w => w.severity === "info").length,
      },
    });
  } catch (error) {
    console.error("Guardrails error:", error);
    return NextResponse.json({ error: "Failed to run guardrails" }, { status: 500 });
  }
}
