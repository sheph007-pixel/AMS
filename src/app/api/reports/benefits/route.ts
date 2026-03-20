import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getExclusionRules, isExcluded } from "@/lib/exclusions";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Benefits Report — latest snapshot per client.
 *
 * 1. For each client, take the latest snapshot (highest year+month)
 * 2. Use BenefitPlan records (pre-computed during import) for premium & plan counts
 * 3. Count unique employees per carrier from enrollment metadata
 * 4. Aggregate by carrier
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
        enrolledEmployees: Set<string>;
        companies: Set<string>;
        plans: Set<string>;
        totalPremium: number;
      }
    >();

    const companiesWithData = new Set<string>();

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

      // ---- Step 1: Build plan lookup from BenefitPlan records ----
      // Maps PlanIdentifier (or PlanName) → carrier
      const planKeyToCarrier = new Map<string, string>();
      const nonExcludedPlans = snapshot.benefitPlans.filter(
        (bp) =>
          !isExcluded(
            { carrier: bp.carrier, planName: bp.planName, planType: bp.planType },
            exclusionRules
          )
      );

      for (const bp of nonExcludedPlans) {
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
      }

      if (nonExcludedPlans.length === 0) continue;

      // ---- Step 2: Aggregate premium & plan counts from BenefitPlan records ----
      for (const bp of nonExcludedPlans) {
        const carrier = bp.carrier || "Unspecified Carrier";

        let entry = carrierMap.get(carrier);
        if (!entry) {
          entry = {
            carrier,
            enrolledEmployees: new Set(),
            companies: new Set(),
            plans: new Set(),
            totalPremium: 0,
          };
          carrierMap.set(carrier, entry);
        }

        // Use premium from the BenefitPlan record (computed correctly during import)
        if (bp.premium != null) {
          entry.totalPremium += bp.premium;
        }

        // Count this as a distinct plan
        const planLabel = `${carrier}::${bp.planName || bp.planType || bp.id}`;
        entry.plans.add(planLabel);

        // Track company
        entry.companies.add(client.id);
      }

      // ---- Step 3: Count unique employees per carrier from enrollments ----
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
        // Track which carriers this employee is enrolled in (deduplicate per employee)
        const employeeCarriers = new Set<string>();

        for (const enrollment of enrollments) {
          if (enrollment.DeclineReason || enrollment.declineReason) continue;

          const endDate =
            enrollment.CoverageEndDate || enrollment.EndDate || enrollment.EndedOn;
          if (endDate && new Date(String(endDate)) <= new Date()) continue;

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

          employeeCarriers.add(carrier);
        }

        // Add this employee (once) to each carrier they're enrolled in
        for (const carrier of employeeCarriers) {
          const entry = carrierMap.get(carrier);
          if (entry) {
            // Use a unique key: clientId + employeeId to avoid cross-company collisions
            entry.enrolledEmployees.add(`${client.id}::${emp.employeeId}`);
            companiesWithData.add(client.id);
          }
        }
      }
    }

    // Convert to array — only include carriers with enrolled employees
    const rows = Array.from(carrierMap.values())
      .filter((entry) => entry.enrolledEmployees.size > 0)
      .map((entry) => ({
        carrier: entry.carrier,
        enrolled: entry.enrolledEmployees.size,
        companies: entry.companies.size,
        plans: entry.plans.size,
        totalPremium: Math.round(entry.totalPremium * 100) / 100,
      }))
      .sort((a, b) => a.carrier.localeCompare(b.carrier));

    const totals = {
      enrolled: rows.reduce((sum, r) => sum + r.enrolled, 0),
      companies: companiesWithData.size,
      plans: rows.reduce((sum, r) => sum + r.plans, 0),
      totalPremium:
        Math.round(
          rows.reduce((sum, r) => sum + r.totalPremium, 0) * 100
        ) / 100,
    };

    const dataPeriod =
      latestYear > 0
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
