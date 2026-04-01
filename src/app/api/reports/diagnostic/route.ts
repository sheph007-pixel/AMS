import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * GET /api/reports/diagnostic?year=2026&month=2
 *
 * Returns per-client premium breakdown for a given period.
 * Compares enrollment-level recalculation against BenefitPlan.premium.
 * Used to validate against actual carrier invoices.
 */

function getField(obj: any, ...keys: string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "") return String(obj[key]);
    if (obj[`@_${key}`] !== undefined && obj[`@_${key}`] !== null) return String(obj[`@_${key}`]);
  }
  return null;
}

function findEnrollments(meta: any): any[] {
  const container = meta.Enrollments || meta.enrollments;
  if (!container) return [];
  if (Array.isArray(container)) return container;
  const e = container.Enrollment || container.enrollment;
  if (Array.isArray(e)) return e;
  if (e && typeof e === "object") return [e];
  return [];
}

function qualifyEnrollment(enrollment: any): boolean {
  const enrollmentType = getField(enrollment, "EnrollmentType", "enrollmentType", "Type");
  if (enrollmentType) return enrollmentType.toLowerCase() === "current";
  const declineReason = getField(enrollment, "DeclineReason", "declineReason");
  const endDate = getField(enrollment, "CoverageEndDate", "EndDate", "EndedOn");
  const isEnded = endDate && new Date(endDate) <= new Date();
  return !declineReason && !isEnded;
}

function getPremium(enrollment: any): number {
  const raw = getField(enrollment,
    "PlanCost", "MonthlyPlanCost", "TotalPremium", "Premium",
    "MonthlyPremium", "TotalMonthlyPremium", "Cost", "Rate"
  );
  if (!raw) return 0;
  const v = parseFloat(raw);
  return isNaN(v) || v <= 0 ? 0 : v;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const year = parseInt(searchParams.get("year") || "2026", 10);
    const month = parseInt(searchParams.get("month") || "2", 10);

    // Get all snapshots for this period
    const snapshots = await prisma.clientSnapshot.findMany({
      where: { year, month },
      select: {
        id: true,
        client: { select: { groupId: true, groupName: true } },
        benefitPlans: {
          select: { carrier: true, planType: true, planName: true, premium: true, enrollees: true, metadata: true },
        },
      },
    });

    const clients: any[] = [];

    for (const snap of snapshots) {
      // 1. Sum BenefitPlan.premium (set during import with full field extraction)
      const benefitPlanTotal = snap.benefitPlans.reduce((s, bp) => s + (bp.premium || 0), 0);
      const benefitPlanDetail = snap.benefitPlans.map(bp => ({
        carrier: bp.carrier,
        planType: bp.planType,
        planName: bp.planName,
        storedPremium: bp.premium,
        storedEnrollees: bp.enrollees,
      }));

      // 2. Recalculate from employee enrollment metadata (what report-cache.ts does)
      const employees = await prisma.employeeSnapshot.findMany({
        where: { clientSnapshotId: snap.id },
        select: { employeeId: true, status: true, metadata: true },
      });

      // Build plan maps
      const planIdMap = new Map<string, { carrier: string; planType: string; planName: string }>();
      const planNameMap = new Map<string, { carrier: string; planType: string; planName: string }>();
      for (const bp of snap.benefitPlans) {
        const carrier = bp.carrier || "Unspecified";
        const info = { carrier, planType: bp.planType, planName: bp.planName || "" };
        if (bp.metadata) {
          try {
            const meta = JSON.parse(bp.metadata);
            const planId = meta.PlanIdentifier || meta.planIdentifier || meta["@_PlanIdentifier"];
            if (planId) planIdMap.set(String(planId), info);
          } catch { /* */ }
        }
        if (bp.planName) planNameMap.set(bp.planName, info);
      }

      let recalcTotal = 0;
      let totalEmployees = 0;
      let activeEmployees = 0;
      let totalEnrollments = 0;
      let qualifiedEnrollments = 0;
      let resolvedEnrollments = 0;
      let premiumEnrollments = 0;
      const carrierBreakdown = new Map<string, number>();

      for (const emp of employees) {
        totalEmployees++;
        if ((emp.status || "Active").toLowerCase() !== "active") continue;
        activeEmployees++;
        if (!emp.metadata) continue;
        let meta: any;
        try { meta = JSON.parse(emp.metadata); } catch { continue; }

        for (const enrollment of findEnrollments(meta)) {
          totalEnrollments++;

          // Try to resolve plan
          const enrollPlanId = getField(enrollment, "PlanIdentifier", "PlanId", "PlanID") || "";
          const enrollPlanName = getField(enrollment, "PlanName", "Plan", "Name") || "";
          let info: { carrier: string; planType: string; planName: string } | undefined;
          if (enrollPlanId) {
            info = planIdMap.get(enrollPlanId);
            if (!info && enrollPlanName) info = planNameMap.get(enrollPlanName);
          } else if (enrollPlanName) {
            info = planNameMap.get(enrollPlanName);
          }

          if (!info) continue;
          resolvedEnrollments++;

          if (qualifyEnrollment(enrollment)) {
            qualifiedEnrollments++;
            const prem = getPremium(enrollment);
            if (prem > 0) {
              premiumEnrollments++;
              recalcTotal += prem;
              carrierBreakdown.set(info.carrier, (carrierBreakdown.get(info.carrier) || 0) + prem);
            }
          }
        }
      }

      clients.push({
        name: snap.client.groupName,
        groupId: snap.client.groupId,
        benefitPlanTotal: Math.round(benefitPlanTotal * 100) / 100,
        recalcTotal: Math.round(recalcTotal * 100) / 100,
        delta: Math.round((recalcTotal - benefitPlanTotal) * 100) / 100,
        stats: {
          totalEmployees,
          activeEmployees,
          totalEnrollments,
          resolvedEnrollments,
          qualifiedEnrollments,
          premiumEnrollments,
        },
        carrierBreakdown: Object.fromEntries(
          Array.from(carrierBreakdown.entries()).map(([k, v]) => [k, Math.round(v * 100) / 100])
        ),
        benefitPlanDetail,
      });
    }

    // Sort by recalcTotal descending
    clients.sort((a, b) => b.recalcTotal - a.recalcTotal);

    const grandTotal = Math.round(clients.reduce((s, c) => s + c.recalcTotal, 0) * 100) / 100;
    const bpGrandTotal = Math.round(clients.reduce((s, c) => s + c.benefitPlanTotal, 0) * 100) / 100;

    return NextResponse.json({
      period: `${year}-${String(month).padStart(2, "0")}`,
      clientCount: clients.length,
      grandTotal,
      benefitPlanGrandTotal: bpGrandTotal,
      clients,
    });
  } catch (error) {
    console.error("Diagnostic report error:", error);
    return NextResponse.json({ error: "Diagnostic report failed" }, { status: 500 });
  }
}
