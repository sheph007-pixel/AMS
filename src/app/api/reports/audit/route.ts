import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { runProductionAudit } from "@/lib/report-audit";

/**
 * POST — Run a new deterministic audit for a report type.
 * GET  — List recent audit runs.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const reportType = body.reportType || "production-dashboard";

    const result = await runProductionAudit(reportType);

    // Persist the audit run
    const audit = await prisma.reportAudit.create({
      data: {
        reportType,
        scope: JSON.stringify(body.scope || {}),
        status: result.status,
        checksRun: result.checksRun,
        checksPassed: result.checksPassed,
        checksFailed: result.checksFailed,
        checksDetail: JSON.stringify(result.checks),
        reportTotalRows: result.reportTotals.rows,
        reportTotalLives: result.reportTotals.lives,
        reportTotalPremium: result.reportTotals.premium,
        reportTotalIncome: result.reportTotals.income,
        auditTotalRows: result.auditTotals.rows,
        auditTotalLives: result.auditTotals.lives,
        auditTotalPremium: result.auditTotals.premium,
        auditTotalIncome: result.auditTotals.income,
        varianceRows: result.variances.rows,
        varianceLives: result.variances.lives,
        variancePremium: result.variances.premium,
        varianceIncome: result.variances.income,
        monthSubtotals: JSON.stringify(result.monthSubtotals),
        clientSubtotals: JSON.stringify(result.clientSubtotals),
        carrierSubtotals: JSON.stringify(result.carrierSubtotals),
      },
    });

    return NextResponse.json({
      id: audit.id,
      reportType: audit.reportType,
      status: result.status,
      checksRun: result.checksRun,
      checksPassed: result.checksPassed,
      checksFailed: result.checksFailed,
      checks: result.checks,
      reportTotalRows: result.reportTotals.rows,
      reportTotalLives: result.reportTotals.lives,
      reportTotalPremium: result.reportTotals.premium,
      reportTotalIncome: result.reportTotals.income,
      auditTotalRows: result.auditTotals.rows,
      auditTotalLives: result.auditTotals.lives,
      auditTotalPremium: result.auditTotals.premium,
      auditTotalIncome: result.auditTotals.income,
      varianceRows: result.variances.rows,
      varianceLives: result.variances.lives,
      variancePremium: result.variances.premium,
      varianceIncome: result.variances.income,
      aiReviewCompleted: false,
      createdAt: audit.createdAt,
    });
  } catch (error) {
    console.error("Audit run error:", error);
    return NextResponse.json({ error: "Failed to run audit" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const audits = await prisma.reportAudit.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true, reportType: true, status: true,
        checksRun: true, checksPassed: true, checksFailed: true,
        reportTotalRows: true, reportTotalPremium: true, reportTotalIncome: true,
        auditTotalRows: true, auditTotalPremium: true, auditTotalIncome: true,
        varianceRows: true, variancePremium: true, varianceIncome: true,
        aiReviewCompleted: true,
        createdAt: true,
      },
    });
    return NextResponse.json(audits);
  } catch (error) {
    console.error("Audit list error:", error);
    return NextResponse.json({ error: "Failed to list audits" }, { status: 500 });
  }
}
