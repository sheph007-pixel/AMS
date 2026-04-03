import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { runProductionAudit } from "@/lib/report-audit";

/**
 * POST — Run audit. Returns monthly summary rows + overall status.
 * GET  — Return most recent persisted audit.
 */
export async function POST(req: NextRequest) {
  try {
    await req.json().catch(() => ({}));
    const result = await runProductionAudit();

    // Persist
    const audit = await prisma.reportAudit.create({
      data: {
        reportType: "production-dashboard",
        scope: "{}",
        status: result.status,
        checksRun: result.checksRun,
        checksPassed: result.checksPassed,
        checksFailed: result.checksFailed,
        checksDetail: JSON.stringify(result.months),
        reportTotalRows: result.months.length,
        reportTotalLives: result.totals.activeEmployees,
        reportTotalPremium: result.totals.premium,
        reportTotalIncome: result.totals.estimatedIncome,
        auditTotalRows: result.months.length,
        auditTotalLives: result.totals.activeEmployees,
        auditTotalPremium: result.totals.premium,
        auditTotalIncome: result.totals.estimatedIncome,
        varianceRows: 0,
        varianceLives: 0,
        variancePremium: 0,
        varianceIncome: 0,
      },
    });

    return NextResponse.json({ id: audit.id, createdAt: audit.createdAt, ...result });
  } catch (error) {
    console.error("Audit run error:", error);
    return NextResponse.json({ error: "Failed to run audit" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const latest = await prisma.reportAudit.findFirst({
      orderBy: { createdAt: "desc" },
    });
    if (!latest) return NextResponse.json(null);

    let months = [];
    try { months = JSON.parse(latest.checksDetail || "[]"); } catch { /* */ }

    return NextResponse.json({
      id: latest.id,
      status: latest.status,
      checksRun: latest.checksRun,
      checksPassed: latest.checksPassed,
      checksFailed: latest.checksFailed,
      months,
      totals: {
        companies: 0, // not stored, recalculated from months
        activeEmployees: latest.reportTotalLives,
        premium: latest.reportTotalPremium,
        estimatedIncome: latest.reportTotalIncome,
      },
      createdAt: latest.createdAt,
    });
  } catch (error) {
    console.error("Audit GET error:", error);
    return NextResponse.json({ error: "Failed to load audit" }, { status: 500 });
  }
}
