import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { autoMapFields } from "@/lib/schema-mapper";
import type { ParsedField } from "@/lib/xsd-parser";

/**
 * POST — Run auto-map on a schema version's fields, return suggestions.
 * Does NOT save mappings. Admin must review and then POST to /mappings.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const fields = await prisma.schemaField.findMany({
      where: { schemaVersionId: id },
      orderBy: { sortOrder: "asc" },
    });

    if (fields.length === 0) {
      return NextResponse.json({ error: "No fields found for this schema version" }, { status: 404 });
    }

    const parsedFields: ParsedField[] = fields.map(f => ({
      xmlPath: f.xmlPath,
      elementName: f.elementName,
      xmlType: f.xmlType,
      isRequired: f.isRequired,
      isRepeating: f.isRepeating,
      isNillable: f.isNillable,
      isAttribute: f.isAttribute,
      parentPath: f.parentPath,
      depth: f.depth,
      sortOrder: f.sortOrder,
    }));

    const suggestions = autoMapFields(parsedFields);

    const exact = suggestions.filter(s => s.confidence === "exact").length;
    const fuzzy = suggestions.filter(s => s.confidence === "fuzzy").length;
    const none = suggestions.filter(s => s.confidence === "none").length;

    return NextResponse.json({
      suggestions,
      summary: { total: suggestions.length, exact, fuzzy, unmapped: none },
    });
  } catch (error) {
    console.error("Auto-map error:", error);
    return NextResponse.json({ error: "Failed to auto-map" }, { status: 500 });
  }
}
