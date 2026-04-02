import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * GET — Mapping audit history (filterable by schema version).
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const schemaVersionId = searchParams.get("schemaVersionId");
    const limit = Math.min(parseInt(searchParams.get("limit") || "100"), 500);

    const where = schemaVersionId
      ? { fieldMapping: { schemaVersionId } }
      : {};

    const entries = await prisma.mappingAudit.findMany({
      where,
      include: {
        fieldMapping: {
          include: { schemaField: { select: { xmlPath: true, elementName: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return NextResponse.json(entries);
  } catch (error) {
    console.error("Audit GET error:", error);
    return NextResponse.json({ error: "Failed to load audit history" }, { status: 500 });
  }
}
