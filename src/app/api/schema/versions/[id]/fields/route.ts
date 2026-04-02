import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * GET — Parsed field inventory for a schema version.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const fields = await prisma.schemaField.findMany({
      where: { schemaVersionId: id },
      orderBy: { sortOrder: "asc" },
      include: { mappings: true },
    });
    return NextResponse.json(fields);
  } catch (error) {
    console.error("Schema fields GET error:", error);
    return NextResponse.json({ error: "Failed to load schema fields" }, { status: 500 });
  }
}
