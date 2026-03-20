import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getExclusionRules, isExcluded } from "@/lib/exclusions";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Benefits Report — uses the latest data period across all snapshots.
 *
 * Logic:
 * 1. Find the latest period (max year+month) across all snapshots
 * 2. Only include snapshots from that exact period
 * 3. Build carrier lookup from BenefitPlan records
 * 4. For each active employee, scan enrollments from metadata:
 *    - Eligible: has any enrollment record for a carrier (even if declined)
 *    - Enrolled: has an active enrollment (not declined, coverage not ended)
 *    - Monthly Premium: sum of PlanCost from active enrollments
 * 5. All counts are unique employees per carrier (deduplicated)
 */
export async function GET() {
  try {
    const exclusionRules = await getExclusionRules();

    // ---- Step 1: Find the latest data period ----
    const latestSnapshot = await prisma.clientSnapshot.findFirst({
      orderBy: [{ year: "desc" }, { month: "desc" }],
      select: { year: true, month: true },
    });

    if (!latestSnapshot) {
      return NextResponse.json({
        rows: [],
        totals: { eligible: 0, enrolled: 0, monthlyPremium: 0 },
        lastUpload: null,
        dataPeriod: null,
      });
    }

    const { year: latestYear, month: latestMonth } = latestSnapshot;

    // ---- Step 2: Load all snapshots from the latest period ----
    const snapshots = await prisma.clientSnapshot.findMany({
      where: { year: latestYear, month: latestMonth },
      include: {
        client: true,
        benefitPlans: true,
        employees: true,
      },
    });

    let latestImportDate: Date | null = null;

    const carrierMap = new Map<
      string,
      {
        carrier: string;
        eligibleEmployees: Set<string>;
        enrolledEmployees: Set<string>;
        monthlyPremium: number;
      }
    >();

    function getOrCreateCarrier(carrier: string) {
      let entry = carrierMap.get(carrier);
      if (!entry) {
        entry = {
          carrier,
          eligibleEmployees: new Set(),
          enrolledEmployees: new Set(),
          monthlyPremium: 0,
        };
        carrierMap.set(carrier, entry);
      }
      return entry;
    }

    for (const snapshot of snapshots) {
      // Skip excluded groups
      if (isExcluded({ groupName: snapshot.client.groupName }, exclusionRules)) {
        continue;
      }

      // Track latest import date
      if (!latestImportDate || snapshot.importedAt > latestImportDate) {
        latestImportDate = snapshot.importedAt;
      }

      // ---- Step 3: Build plan lookup for this snapshot ----
      // Maps PlanIdentifier (or PlanName) → carrier name
      const planKeyToCarrier = new Map<string, string>();

      for (const bp of snapshot.benefitPlans) {
        if (
          isExcluded(
            { carrier: bp.carrier, planName: bp.planName, planType: bp.planType },
            exclusionRules
          )
        ) {
          continue;
        }

        const carrier = bp.carrier || "Unspecified Carrier";

        // Register by PlanIdentifier from metadata
        if (bp.metadata) {
          try {
            const meta = JSON.parse(bp.metadata);
            const planId = meta.PlanIdentifier || meta.planIdentifier;
            if (planId) planKeyToCarrier.set(String(planId), carrier);
          } catch {
            /* ignore parse errors */
          }
        }

        // Register by PlanName
        if (bp.planName) planKeyToCarrier.set(bp.planName, carrier);
      }

      if (planKeyToCarrier.size === 0) continue;

      // ---- Step 4: Process each active employee's enrollments ----
      for (const emp of snapshot.employees) {
        const status = (emp.status || "Active").toLowerCase();
        if (status !== "active") continue;

        if (!emp.metadata) continue;
        let meta: any;
        try {
          meta = JSON.parse(emp.metadata);
        } catch {
          continue;
        }

        const enrollments = findEnrollmentsFromMeta(meta);
        // Unique key for this employee (scoped to client to avoid collisions)
        const empKey = `${snapshot.clientId}::${emp.employeeId}`;

        // Track per-carrier deduplication within this employee
        const eligibleCarriers = new Set<string>();
        const enrolledCarriers = new Set<string>();

        for (const enrollment of enrollments) {
          // Resolve which carrier this enrollment belongs to
          const planKey = String(
            enrollment.PlanIdentifier ||
              enrollment.PlanId ||
              enrollment.PlanID ||
              enrollment.PlanName ||
              enrollment.Name ||
              ""
          );
          if (!planKey) continue;

          const carrier = planKeyToCarrier.get(planKey);
          if (!carrier) continue;

          // ---- ELIGIBLE: any enrollment record = eligible for this carrier ----
          if (!eligibleCarriers.has(carrier)) {
            eligibleCarriers.add(carrier);
            getOrCreateCarrier(carrier).eligibleEmployees.add(empKey);
          }

          // ---- ENROLLED: not declined AND coverage not ended ----
          const declineReason =
            enrollment.DeclineReason || enrollment.declineReason;
          if (declineReason) continue;

          const endDate =
            enrollment.CoverageEndDate || enrollment.EndDate || enrollment.EndedOn;
          if (endDate && new Date(String(endDate)) <= new Date()) continue;

          // This is an active enrollment
          if (!enrolledCarriers.has(carrier)) {
            enrolledCarriers.add(carrier);
            getOrCreateCarrier(carrier).enrolledEmployees.add(empKey);
          }

          // ---- PREMIUM: PlanCost = total monthly premium as billed by carrier ----
          const planCost = parseFloat(
            String(
              enrollment.PlanCost ||
                enrollment.MonthlyPlanCost ||
                enrollment.TotalPremium ||
                enrollment.Premium ||
                enrollment.MonthlyPremium ||
                enrollment.TotalMonthlyPremium ||
                "0"
            )
          );

          if (!isNaN(planCost) && planCost > 0) {
            getOrCreateCarrier(carrier).monthlyPremium += planCost;
          }
        }
      }
    }

    // ---- Step 5: Build response ----
    const rows = Array.from(carrierMap.values())
      .filter((entry) => entry.eligibleEmployees.size > 0)
      .map((entry) => ({
        carrier: entry.carrier,
        eligible: entry.eligibleEmployees.size,
        enrolled: entry.enrolledEmployees.size,
        monthlyPremium: Math.round(entry.monthlyPremium * 100) / 100,
      }))
      .sort((a, b) => a.carrier.localeCompare(b.carrier));

    const totals = {
      eligible: rows.reduce((sum, r) => sum + r.eligible, 0),
      enrolled: rows.reduce((sum, r) => sum + r.enrolled, 0),
      monthlyPremium:
        Math.round(rows.reduce((sum, r) => sum + r.monthlyPremium, 0) * 100) /
        100,
    };

    const dataPeriod = `${latestYear}-${String(latestMonth).padStart(2, "0")}`;

    return NextResponse.json({
      rows,
      totals,
      lastUpload: latestImportDate?.toISOString() || null,
      dataPeriod,
    });
  } catch (error) {
    console.error("Benefits report error:", error);
    return NextResponse.json(
      { error: "Failed to generate report" },
      { status: 500 }
    );
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
