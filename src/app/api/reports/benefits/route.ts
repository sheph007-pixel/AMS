import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getExclusionRules, isExcluded } from "@/lib/exclusions";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Benefits Report — based on the most current data period (highest year+month).
 *
 * 1. Find the highest year+month across all snapshots → most current data period
 * 2. Pull ALL snapshots from that data period
 * 3. For each snapshot: only active employees → their active enrollments
 * 4. Aggregate by carrier: enrolled count + sum of MonthlyPlanCost
 * 5. Hide any carrier row where enrolled = 0 or premium = 0
 */
export async function GET() {
  try {
    const exclusionRules = await getExclusionRules();

    // Step 1: Find the most current data period that actually has employee data.
    // Get distinct year+month combos ordered by most recent first, then check which
    // one has actual employees.
    const allPeriods = await prisma.clientSnapshot.findMany({
      select: { year: true, month: true },
      distinct: ["year", "month"],
      orderBy: [{ year: "desc" }, { month: "desc" }],
    });

    if (allPeriods.length === 0) {
      return NextResponse.json({ rows: [], totals: null, lastUpload: null });
    }

    // Find the first period that has snapshots with employees
    let chosenPeriod: { year: number; month: number } | null = null;
    for (const period of allPeriods) {
      const count = await prisma.employeeSnapshot.count({
        where: {
          clientSnapshot: { year: period.year, month: period.month },
        },
      });
      if (count > 0) {
        chosenPeriod = period;
        break;
      }
    }

    if (!chosenPeriod) {
      return NextResponse.json({ rows: [], totals: null, lastUpload: null });
    }

    // Step 2: Get ALL snapshots from that data period
    const snapshots = await prisma.clientSnapshot.findMany({
      where: {
        year: chosenPeriod.year,
        month: chosenPeriod.month,
      },
      include: {
        client: { select: { id: true, groupName: true } },
        benefitPlans: true,
        employees: true,
      },
    });

    // Get the importedAt for display
    const periodMeta = await prisma.clientSnapshot.findFirst({
      where: { year: chosenPeriod.year, month: chosenPeriod.month },
      orderBy: { importedAt: "desc" },
      select: { importedAt: true },
    });

    const carrierMap = new Map<
      string,
      {
        carrier: string;
        enrolled: number;
        companies: Set<string>;
        plans: Set<string>;
        totalPremium: number;
      }
    >();

    let activeCompanies = 0;

    for (const snapshot of snapshots) {
      // Skip excluded clients
      if (isExcluded({ groupName: snapshot.client.groupName }, exclusionRules)) {
        continue;
      }

      // Build plan lookup from BenefitPlan records: planIdentifier/planName → carrier
      const planLookup = new Map<string, { carrier: string; planName: string }>();
      for (const bp of snapshot.benefitPlans) {
        if (isExcluded({ carrier: bp.carrier, planName: bp.planName, planType: bp.planType }, exclusionRules)) {
          continue;
        }
        const carrier = bp.carrier || "Unknown";
        const info = { carrier, planName: bp.planName || "" };

        // Extract PlanIdentifier from metadata
        if (bp.metadata) {
          try {
            const meta = JSON.parse(bp.metadata);
            const planId = meta.PlanIdentifier || meta.planIdentifier;
            if (planId) planLookup.set(String(planId), info);
          } catch { /* ignore */ }
        }
        if (bp.planName) planLookup.set(bp.planName, info);
      }

      if (planLookup.size === 0) continue;

      let companyHasData = false;

      // Walk only active employees
      for (const emp of snapshot.employees) {
        const status = (emp.status || "Active").toLowerCase();
        if (status !== "active") continue;

        // Parse enrollments from employee metadata
        if (!emp.metadata) continue;
        let meta: any;
        try {
          meta = JSON.parse(emp.metadata);
        } catch { continue; }

        const enrollments = findEnrollmentsFromMeta(meta);

        for (const enrollment of enrollments) {
          // Skip declined
          if (enrollment.DeclineReason || enrollment.declineReason) continue;

          // Skip ended coverage
          const endDate = enrollment.CoverageEndDate || enrollment.EndDate || enrollment.EndedOn;
          if (endDate && new Date(String(endDate)) <= new Date()) continue;

          // Match enrollment to a plan → carrier
          const planKey = String(
            enrollment.PlanIdentifier || enrollment.PlanId || enrollment.PlanID ||
            enrollment.PlanName || enrollment.Name || ""
          );
          if (!planKey) continue;

          const planInfo = planLookup.get(planKey);
          if (!planInfo) continue; // excluded or unrecognized plan

          // Get MonthlyPlanCost from the enrollment
          const cost = parseFloat(String(
            enrollment.MonthlyPlanCost || enrollment.PlanCost || enrollment.TotalPremium ||
            enrollment.Premium || enrollment.MonthlyPremium || enrollment.EmployeePremium ||
            enrollment.TotalMonthlyPremium || enrollment.Cost || enrollment.Rate || "0"
          ));

          const carrierName = planInfo.carrier;
          let entry = carrierMap.get(carrierName);
          if (!entry) {
            entry = {
              carrier: carrierName,
              enrolled: 0,
              companies: new Set(),
              plans: new Set(),
              totalPremium: 0,
            };
            carrierMap.set(carrierName, entry);
          }

          entry.enrolled += 1;
          entry.companies.add(snapshot.client.id);
          entry.plans.add(`${carrierName}::${planInfo.planName}`);
          if (!isNaN(cost)) {
            entry.totalPremium += cost;
          }
          companyHasData = true;
        }
      }

      if (companyHasData) activeCompanies++;
    }

    // Convert to array — EXCLUDE rows where enrolled = 0 or premium = 0
    const rows = Array.from(carrierMap.values())
      .filter((entry) => entry.enrolled > 0 && entry.totalPremium > 0)
      .map((entry) => ({
        carrier: entry.carrier,
        enrolled: entry.enrolled,
        companies: entry.companies.size,
        plans: entry.plans.size,
        totalPremium: Math.round(entry.totalPremium * 100) / 100,
      }))
      .sort((a, b) => a.carrier.localeCompare(b.carrier));

    const totals = rows.reduce(
      (acc, r) => ({
        enrolled: acc.enrolled + r.enrolled,
        companies: acc.companies + r.companies,
        plans: acc.plans + r.plans,
        totalPremium: Math.round((acc.totalPremium + r.totalPremium) * 100) / 100,
      }),
      { enrolled: 0, companies: 0, plans: 0, totalPremium: 0 }
    );
    // Use deduplicated company count
    totals.companies = activeCompanies;

    return NextResponse.json({
      rows,
      totals,
      lastUpload: periodMeta?.importedAt.toISOString() || null,
      dataPeriod: `${chosenPeriod.year}-${String(chosenPeriod.month).padStart(2, "0")}`,
    });
  } catch (error) {
    console.error("Benefits report error:", error);
    return NextResponse.json({ error: "Failed to generate report" }, { status: 500 });
  }
}

/** Extract enrollment records from parsed employee metadata */
function findEnrollmentsFromMeta(meta: any): any[] {
  const container = meta.Enrollments || meta.enrollments;
  if (!container) return [];
  if (Array.isArray(container)) return container;
  const enrollments = container.Enrollment || container.enrollment;
  if (Array.isArray(enrollments)) return enrollments;
  if (enrollments && typeof enrollments === "object") return [enrollments];
  return [];
}
