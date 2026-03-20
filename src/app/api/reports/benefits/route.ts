import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getExclusionRules, isExcluded } from "@/lib/exclusions";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Benefits Report — carrier-level summary from the latest data period.
 *
 * RULES (matching the standalone validate-xml.ts script):
 *
 * 1. Uses only the latest data period (max year+month) across all snapshots
 * 2. Carrier resolved via: Enrollment.PlanIdentifier → Plan.PlanIdentifier → Plan.Carrier
 * 3. Enrolled = distinct active employees per carrier with EnrollmentType = "Current"
 *    - Do NOT exclude rows just because EndDate is populated
 * 4. Eligible = distinct active employees per carrier, company-specific:
 *    - Employee is eligible for a carrier if their company has at least one plan with that carrier
 * 5. Monthly Premium = sum of PlanCost from ALL qualifying enrollment rows (row-level, not deduped)
 *    - PlanCost = total monthly premium as billed by carrier (employee + dependents)
 * 6. All counts deduplicated by employee key (scoped per client to avoid collisions)
 */
export async function GET() {
  try {
    const exclusionRules = await getExclusionRules();

    // ── Step 1: Find the latest data period ──────────────────────────────

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

    // ── Step 2: Load all snapshots from the latest period ────────────────

    const snapshots = await prisma.clientSnapshot.findMany({
      where: { year: latestYear, month: latestMonth },
      include: {
        client: true,
        benefitPlans: true,
        employees: true,
      },
    });

    let latestImportDate: Date | null = null;

    // Carrier → aggregated data
    const carrierMap = new Map<
      string,
      {
        carrier: string;
        eligibleEmployees: Set<string>;
        enrolledEmployees: Set<string>;
        monthlyPremium: number;
      }
    >();

    // Carrier → Set of companyIdentifiers that have plans with this carrier
    const carrierCompanies = new Map<string, Set<string>>();

    // CompanyIdentifier → Set of active employee keys
    const companyActiveEmployees = new Map<string, Set<string>>();

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

      if (!latestImportDate || snapshot.importedAt > latestImportDate) {
        latestImportDate = snapshot.importedAt;
      }

      const clientKey = snapshot.clientId;

      // ── Step 3: Build plan lookup for this snapshot ──────────────────
      // PlanIdentifier (or PlanName) → carrier
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
            /* ignore */
          }
        }
        // Register by PlanName
        if (bp.planName) planKeyToCarrier.set(bp.planName, carrier);

        // Track carrier → company mapping for eligibility
        if (!carrierCompanies.has(carrier)) carrierCompanies.set(carrier, new Set());
        carrierCompanies.get(carrier)!.add(clientKey);
      }

      if (planKeyToCarrier.size === 0) continue;

      // Initialize active employee set for this company
      if (!companyActiveEmployees.has(clientKey)) {
        companyActiveEmployees.set(clientKey, new Set());
      }

      // ── Step 4: Process each active employee's enrollments ──────────

      for (const emp of snapshot.employees) {
        const status = (emp.status || "Active").toLowerCase();
        if (status !== "active") continue;

        const empKey = `${clientKey}::${emp.employeeId}`;
        companyActiveEmployees.get(clientKey)!.add(empKey);

        if (!emp.metadata) continue;
        let meta: any;
        try {
          meta = JSON.parse(emp.metadata);
        } catch {
          continue;
        }

        const enrollments = findEnrollmentsFromMeta(meta);
        const enrolledCarriersThisEmp = new Set<string>();

        for (const enrollment of enrollments) {
          // ── Filter: EnrollmentType must be "Current" ──
          const enrollmentType =
            enrollment.EnrollmentType || enrollment.enrollmentType || enrollment.Type;
          const isCurrent =
            enrollmentType && String(enrollmentType).toLowerCase() === "current";

          // Fallback: if EnrollmentType not present, use old decline/end logic
          let isQualifying = false;
          if (enrollmentType) {
            isQualifying = !!isCurrent;
          } else {
            const declineReason =
              enrollment.DeclineReason || enrollment.declineReason;
            const endDate =
              enrollment.CoverageEndDate || enrollment.EndDate || enrollment.EndedOn;
            const isEnded = endDate && new Date(String(endDate)) <= new Date();
            isQualifying = !declineReason && !isEnded;
          }

          if (!isQualifying) continue;

          // ── Resolve carrier via PlanIdentifier ──
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

          // ── Enrolled: distinct employee per carrier ──
          if (!enrolledCarriersThisEmp.has(carrier)) {
            enrolledCarriersThisEmp.add(carrier);
            getOrCreateCarrier(carrier).enrolledEmployees.add(empKey);
          }

          // ── Premium: PlanCost at enrollment-row level (not deduped) ──
          const rawCost = String(
            enrollment.PlanCost ||
              enrollment.MonthlyPlanCost ||
              enrollment.TotalPremium ||
              enrollment.Premium ||
              enrollment.MonthlyPremium ||
              enrollment.TotalMonthlyPremium ||
              "0"
          );
          const cost = parseFloat(rawCost);
          if (!isNaN(cost) && cost > 0) {
            getOrCreateCarrier(carrier).monthlyPremium += cost;
          }
        }
      }
    }

    // ── Step 5: Compute carrier-specific eligibility ─────────────────────
    // An active employee is eligible for a carrier if their company has
    // at least one plan with that carrier.

    for (const [carrier, companyIds] of carrierCompanies) {
      const entry = getOrCreateCarrier(carrier);
      for (const companyId of companyIds) {
        const activeSet = companyActiveEmployees.get(companyId);
        if (activeSet) {
          for (const empKey of activeSet) {
            entry.eligibleEmployees.add(empKey);
          }
        }
      }
    }

    // ── Step 6: Build response ───────────────────────────────────────────

    const rows = Array.from(carrierMap.values())
      .filter((entry) => entry.eligibleEmployees.size > 0)
      .map((entry) => ({
        carrier: entry.carrier,
        eligible: entry.eligibleEmployees.size,
        enrolled: entry.enrolledEmployees.size,
        monthlyPremium: Math.round(entry.monthlyPremium * 100) / 100,
      }))
      .sort((a, b) => b.monthlyPremium - a.monthlyPremium);

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
