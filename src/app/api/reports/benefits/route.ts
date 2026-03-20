import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getExclusionRules, isExcluded } from "@/lib/exclusions";

/**
 * Benefits Report: For each client, takes the latest snapshot, then counts only
 * ACTIVE employees and sums their enrollment-level MonthlyPlanCost by carrier.
 *
 * Data flow:
 *   1. Latest snapshot per client
 *   2. Only active employees (status = Active, no term date in the past)
 *   3. Each active employee's enrollments → plan carrier + MonthlyPlanCost
 *   4. Aggregate by carrier
 */
export async function GET() {
  try {
    const exclusionRules = await getExclusionRules();

    // Get latest snapshot per client with employees (including metadata for enrollment details)
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

    // Filter out excluded clients
    const filteredClients = clients.filter(
      (c) => !isExcluded({ groupName: c.groupName }, exclusionRules)
    );

    // Track the most recent import date
    let latestImportDate: Date | null = null;

    // Build a plan lookup per snapshot: planIdentifier/planName → { carrier, planType }
    // Then walk active employees' enrollments to get actual counts and costs

    const carrierMap = new Map<
      string,
      {
        carrier: string;
        enrolled: number;
        companies: Set<string>;
        plans: Set<string>; // unique plan names per carrier
        totalPremium: number;
      }
    >();

    for (const client of filteredClients) {
      const snapshot = client.snapshots[0];
      if (!snapshot) continue;

      if (!latestImportDate || snapshot.importedAt > latestImportDate) {
        latestImportDate = snapshot.importedAt;
      }

      // Build plan lookup: planIdentifier or planName → { carrier, planType, planName }
      const planLookup = new Map<string, { carrier: string; planType: string; planName: string }>();
      for (const bp of snapshot.benefitPlans) {
        if (isExcluded({ carrier: bp.carrier, planName: bp.planName, planType: bp.planType }, exclusionRules)) {
          continue;
        }

        const carrier = bp.carrier || "Unknown";
        // Try to extract PlanIdentifier from metadata
        let planId: string | null = null;
        if (bp.metadata) {
          try {
            const meta = JSON.parse(bp.metadata);
            planId = meta.PlanIdentifier || meta.planIdentifier || null;
          } catch { /* ignore */ }
        }

        const info = { carrier, planType: bp.planType, planName: bp.planName || "" };
        if (planId) planLookup.set(planId, info);
        if (bp.planName) planLookup.set(bp.planName, info);
      }

      // If no plans after exclusion, check if BenefitPlan has premium data directly
      // (for cases where enrollment-level data isn't available, fall back to plan-level)
      let hasEnrollmentData = false;

      // Walk active employees and their enrollments
      for (const emp of snapshot.employees) {
        // Only active employees
        const status = (emp.status || "Active").toLowerCase();
        if (status !== "active") continue;

        // Parse enrollment data from employee metadata
        if (!emp.metadata) continue;
        let meta: any;
        try {
          meta = JSON.parse(emp.metadata);
        } catch { continue; }

        // Find enrollments in metadata
        const enrollments = findEnrollmentsFromMeta(meta);
        if (enrollments.length === 0) continue;

        for (const enrollment of enrollments) {
          // Skip declined or ended enrollments
          const declineReason = enrollment.DeclineReason || enrollment.declineReason;
          if (declineReason) continue;
          const endDate = enrollment.CoverageEndDate || enrollment.EndDate || enrollment.EndedOn;
          if (endDate && new Date(String(endDate)) <= new Date()) continue;

          // Match to a plan
          const planKey =
            enrollment.PlanIdentifier || enrollment.PlanId || enrollment.PlanID ||
            enrollment.PlanName || enrollment.Name;
          if (!planKey) continue;

          const planInfo = planLookup.get(String(planKey));
          if (!planInfo) continue; // plan was excluded or not found

          hasEnrollmentData = true;
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

          // Sum MonthlyPlanCost from enrollment
          const cost = parseFloat(String(
            enrollment.MonthlyPlanCost || enrollment.PlanCost || enrollment.TotalPremium ||
            enrollment.Premium || enrollment.MonthlyPremium || enrollment.EmployeePremium ||
            enrollment.TotalMonthlyPremium || enrollment.Cost || enrollment.Rate || "0"
          ));
          if (!isNaN(cost)) {
            entry.totalPremium += cost;
          }
        }
      }

      // Fallback: if no enrollment-level data found, use BenefitPlan records directly
      if (!hasEnrollmentData) {
        for (const bp of snapshot.benefitPlans) {
          if (isExcluded({ carrier: bp.carrier, planName: bp.planName, planType: bp.planType }, exclusionRules)) {
            continue;
          }
          const carrierName = bp.carrier || "Unknown";
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

          entry.enrolled += bp.enrollees ?? 0;
          entry.companies.add(client.id);
          entry.plans.add(`${carrierName}::${bp.planName}`);
          entry.totalPremium += bp.premium ?? 0;
        }
      }
    }

    // Convert to array
    const rows = Array.from(carrierMap.values())
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
        companies: acc.companies,
        plans: acc.plans + r.plans,
        totalPremium: Math.round((acc.totalPremium + r.totalPremium) * 100) / 100,
      }),
      { enrolled: 0, companies: filteredClients.length, plans: 0, totalPremium: 0 }
    );

    return NextResponse.json({
      rows,
      totals,
      lastUpload: latestImportDate?.toISOString() || null,
    });
  } catch (error) {
    console.error("Benefits report error:", error);
    return NextResponse.json({ error: "Failed to generate report" }, { status: 500 });
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */

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
