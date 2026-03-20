import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getExclusionRules, isExcluded } from "@/lib/exclusions";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Benefits Report — latest snapshot per client.
 *
 * 1. For each client, take the latest snapshot (highest year+month)
 * 2. Only active employees → their active enrollments
 * 3. Aggregate by carrier: enrolled count + sum of MonthlyPlanCost
 * 4. Hide any carrier row where enrolled = 0 or premium = 0
 */
export async function GET() {
  try {
    const exclusionRules = await getExclusionRules();

    // Get latest snapshot per client
    const clients = await prisma.client.findMany({
      include: {
        snapshots: {
          include: {
            benefitPlans: true,
            employees: true,
          },
          orderBy: [{ year: "desc" }, { month: "desc" }],
          take: 1,
        },
      },
    });

    const filteredClients = clients.filter(
      (c) => !isExcluded({ groupName: c.groupName }, exclusionRules)
    );

    let latestImportDate: Date | null = null;
    let latestYear = 0;
    let latestMonth = 0;

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

    for (const client of filteredClients) {
      const snapshot = client.snapshots[0];
      if (!snapshot) continue;

      if (!latestImportDate || snapshot.importedAt > latestImportDate) {
        latestImportDate = snapshot.importedAt;
      }
      if (
        snapshot.year > latestYear ||
        (snapshot.year === latestYear && snapshot.month > latestMonth)
      ) {
        latestYear = snapshot.year;
        latestMonth = snapshot.month;
      }

      // Build plan lookup from BenefitPlan records
      const planLookup = new Map<string, { carrier: string; planName: string }>();
      for (const bp of snapshot.benefitPlans) {
        if (isExcluded({ carrier: bp.carrier, planName: bp.planName, planType: bp.planType }, exclusionRules)) {
          continue;
        }
        const carrier = bp.carrier || "Unknown";
        const info = { carrier, planName: bp.planName || "" };

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

      for (const emp of snapshot.employees) {
        const status = (emp.status || "Active").toLowerCase();
        if (status !== "active") continue;

        if (!emp.metadata) continue;
        let meta: any;
        try {
          meta = JSON.parse(emp.metadata);
        } catch { continue; }

        const enrollments = findEnrollmentsFromMeta(meta);

        for (const enrollment of enrollments) {
          if (enrollment.DeclineReason || enrollment.declineReason) continue;

          const endDate = enrollment.CoverageEndDate || enrollment.EndDate || enrollment.EndedOn;
          if (endDate && new Date(String(endDate)) <= new Date()) continue;

          const planKey = String(
            enrollment.PlanIdentifier || enrollment.PlanId || enrollment.PlanID ||
            enrollment.PlanName || enrollment.Name || ""
          );
          if (!planKey) continue;

          const planInfo = planLookup.get(planKey);
          if (!planInfo) continue;

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
          entry.companies.add(client.id);
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
    totals.companies = activeCompanies;

    const dataPeriod = latestYear > 0
      ? `${latestYear}-${String(latestMonth).padStart(2, "0")}`
      : null;

    return NextResponse.json({
      rows,
      totals,
      lastUpload: latestImportDate?.toISOString() || null,
      dataPeriod,
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
