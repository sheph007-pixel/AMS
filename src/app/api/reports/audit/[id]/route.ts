import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * GET — Full audit detail for a specific run.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const audit = await prisma.reportAudit.findUnique({ where: { id } });
    if (!audit) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({
      ...audit,
      checksDetail: audit.checksDetail ? JSON.parse(audit.checksDetail) : [],
      monthSubtotals: audit.monthSubtotals ? JSON.parse(audit.monthSubtotals) : {},
      clientSubtotals: audit.clientSubtotals ? JSON.parse(audit.clientSubtotals) : [],
      carrierSubtotals: audit.carrierSubtotals ? JSON.parse(audit.carrierSubtotals) : [],
    });
  } catch (error) {
    console.error("Audit detail error:", error);
    return NextResponse.json({ error: "Failed to load audit" }, { status: 500 });
  }
}
