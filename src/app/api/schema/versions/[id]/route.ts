import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * GET — Single schema version detail.
 * PATCH — Update status (activate/deactivate), name, notes.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sv = await prisma.schemaVersion.findUnique({
      where: { id },
      include: {
        _count: { select: { fields: true, mappings: true, testResults: true } },
      },
    });
    if (!sv) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(sv);
  } catch (error) {
    console.error("Schema version GET error:", error);
    return NextResponse.json({ error: "Failed to load schema version" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { status, name, notes } = body;

    // If activating, deactivate all others first
    if (status === "active") {
      await prisma.schemaVersion.updateMany({
        where: { status: "active" },
        data: { status: "inactive" },
      });
    }

    const data: Record<string, string> = {};
    if (status) data.status = status;
    if (name !== undefined) data.name = name;
    if (notes !== undefined) data.notes = notes;

    const sv = await prisma.schemaVersion.update({
      where: { id },
      data,
    });

    return NextResponse.json(sv);
  } catch (error) {
    console.error("Schema version PATCH error:", error);
    return NextResponse.json({ error: "Failed to update schema version" }, { status: 500 });
  }
}
