import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getExclusionRules, isExcluded } from "@/lib/exclusions";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Income Report — Estimated fee income based on Benefits Report data.
 *
 * Fee model:
 *   PEPM carriers (EBPA, HealthEZ): enrolled employees × $20/mo
 *   Commission carriers (Guardian, VSP): monthly premium × 10%
 *
 * Uses the same data source as the Benefits Report (latest XML period).
 * Numbers cross-reference: enrolled counts and premiums match Benefits Report exactly.
 */

const PEPM_RATE = 20; // $ per enrolled employee per month
const COMMISSION_RATE = 0.10; // 10% of premium
const PEPM_CARRIERS = ["EBPA", "HealthEZ"];
const COMMISSION_CARRIERS = ["Guardian", "VSP"];

export async function GET() {
  try {
    const exclusionRules = await getExclusionRules();

    // Latest data period
    const latestSnapshot = await prisma.clientSnapshot.findFirst({
      orderBy: [{ year: "desc" }, { month: "desc" }],
      select: { year: true, month: true },
    });

    if (!latestSnapshot) {
      return NextResponse.json({
        rows: [],
        totals: null,
        dataPeriod: null,
        lastUpload: null,
        audit: null,
      });
    }

    const { year: latestYear, month: latestMonth } = latestSnapshot;

    const snapshots = await prisma.clientSnapshot.findMany({
      where: { year: latestYear, month: latestMonth },
      include: {
        client: true,
        benefitPlans: true,
        employees: true,
      },
    });

    let latestImportDate: Date | null = null;

    // Carrier → aggregated data (mirrors Benefits Report logic exactly)
    const carrierMap = new Map<
      string,
      {
        enrolledEmployees: Set<string>;
        monthlyPremium: number;
      }
    >();

    function getOrCreateCarrier(carrier: string) {
      let entry = carrierMap.get(carrier);
      if (!entry) {
        entry = { enrolledEmployees: new Set(), monthlyPremium: 0 };
        carrierMap.set(carrier, entry);
      }
      return entry;
    }

    // Process snapshots — same logic as Benefits Report
    for (const snapshot of snapshots) {
      if (isExcluded({ groupName: snapshot.client.groupName }, exclusionRules)) continue;

      if (!latestImportDate || snapshot.importedAt > latestImportDate) {
        latestImportDate = snapshot.importedAt;
      }

      const clientId = snapshot.clientId;

      // Build plan lookup
      const planIdToCarrier = new Map<string, string>();
      const planNameToCarrier = new Map<string, string>();

      for (const bp of snapshot.benefitPlans) {
        if (isExcluded({ carrier: bp.carrier, planName: bp.planName, planType: bp.planType }, exclusionRules)) continue;

        const carrier = bp.carrier || "Unspecified Carrier";

        if (bp.metadata) {
          try {
            const meta = JSON.parse(bp.metadata);
            const planId = meta.PlanIdentifier || meta.planIdentifier;
            if (planId) planIdToCarrier.set(String(planId), carrier);
          } catch { /* ignore */ }
        }
        if (bp.planName) planNameToCarrier.set(bp.planName, carrier);
      }

      if (planIdToCarrier.size === 0 && planNameToCarrier.size === 0) continue;

      // Process employees
      for (const emp of snapshot.employees) {
        if ((emp.status || "Active").toLowerCase() !== "active") continue;

        if (!emp.metadata) continue;
        let meta: any;
        try { meta = JSON.parse(emp.metadata); } catch { continue; }

        const enrollments = findEnrollmentsFromMeta(meta);
        const empKey = `${clientId}::${emp.employeeId}`;
        const enrolledCarriersThisEmp = new Set<string>();

        for (const enrollment of enrollments) {
          // EnrollmentType filter
          const enrollmentType = enrollment.EnrollmentType || enrollment.enrollmentType || enrollment.Type;
          let isQualifying = false;
          if (enrollmentType) {
            isQualifying = String(enrollmentType).toLowerCase() === "current";
          } else {
            const declineReason = enrollment.DeclineReason || enrollment.declineReason;
            const endDate = enrollment.CoverageEndDate || enrollment.EndDate || enrollment.EndedOn;
            const isEnded = endDate && new Date(String(endDate)) <= new Date();
            isQualifying = !declineReason && !isEnded;
          }
          if (!isQualifying) continue;

          // Resolve carrier
          const enrollPlanId = String(enrollment.PlanIdentifier || enrollment.PlanId || enrollment.PlanID || "");
          const enrollPlanName = String(enrollment.PlanName || enrollment.Plan || enrollment.Name || "");

          let carrier: string | undefined;
          if (enrollPlanId) {
            carrier = planIdToCarrier.get(enrollPlanId);
            if (!carrier && enrollPlanName) carrier = planNameToCarrier.get(enrollPlanName);
          } else if (enrollPlanName) {
            carrier = planNameToCarrier.get(enrollPlanName);
          }
          if (!carrier) continue;

          // PlanCost
          const rawCost = String(enrollment.PlanCost || enrollment.MonthlyPlanCost || "");
          let cost = 0;
          if (rawCost) {
            const parsed = parseFloat(rawCost);
            if (!isNaN(parsed)) cost = parsed;
          }

          const cd = getOrCreateCarrier(carrier);
          cd.monthlyPremium += cost;

          if (!enrolledCarriersThisEmp.has(carrier)) {
            enrolledCarriersThisEmp.add(carrier);
            cd.enrolledEmployees.add(empKey);
          }
        }
      }
    }

    // Build income rows
    const incomeRows: {
      carrier: string;
      feeType: "PEPM" | "Commission";
      enrolled: number;
      monthlyPremium: number;
      rate: string;
      monthlyIncome: number;
      annualIncome: number;
    }[] = [];

    // Only include the 4 known carriers
    const allTargetCarriers = [...PEPM_CARRIERS, ...COMMISSION_CARRIERS];

    for (const carrierName of allTargetCarriers) {
      const data = carrierMap.get(carrierName);
      if (!data) continue;

      const isPEPM = PEPM_CARRIERS.includes(carrierName);
      const enrolled = data.enrolledEmployees.size;
      const premium = Math.round(data.monthlyPremium * 100) / 100;

      let monthlyIncome: number;
      if (isPEPM) {
        monthlyIncome = enrolled * PEPM_RATE;
      } else {
        monthlyIncome = premium * COMMISSION_RATE;
      }
      monthlyIncome = Math.round(monthlyIncome * 100) / 100;

      incomeRows.push({
        carrier: carrierName,
        feeType: isPEPM ? "PEPM" : "Commission",
        enrolled,
        monthlyPremium: premium,
        rate: isPEPM ? `$${PEPM_RATE} PEPM` : `${COMMISSION_RATE * 100}%`,
        monthlyIncome,
        annualIncome: Math.round(monthlyIncome * 12 * 100) / 100,
      });
    }

    const totalMonthlyIncome = Math.round(incomeRows.reduce((s, r) => s + r.monthlyIncome, 0) * 100) / 100;
    const totalAnnualIncome = Math.round(totalMonthlyIncome * 12 * 100) / 100;

    const dataPeriod = `${latestYear}-${String(latestMonth).padStart(2, "0")}`;

    return NextResponse.json({
      rows: incomeRows,
      totals: {
        monthlyIncome: totalMonthlyIncome,
        annualIncome: totalAnnualIncome,
      },
      dataPeriod,
      lastUpload: latestImportDate?.toISOString() || null,
      audit: {
        pepmRate: PEPM_RATE,
        commissionRate: COMMISSION_RATE,
        pepmCarriers: PEPM_CARRIERS,
        commissionCarriers: COMMISSION_CARRIERS,
        note: "Enrolled counts and premiums match Benefits Report. PEPM income = enrolled × $20/mo. Commission income = monthly premium × 10%.",
      },
    });
  } catch (error) {
    console.error("Income report error:", error);
    return NextResponse.json({ error: "Failed to generate report" }, { status: 500 });
  }
}

function findEnrollmentsFromMeta(meta: any): any[] {
  const container = meta.Enrollments || meta.enrollments;
  if (!container) return [];
  if (Array.isArray(container)) return container;
  const enrollments = container.Enrollment || container.enrollment;
  if (Array.isArray(enrollments)) return enrollments;
  if (enrollments && typeof enrollments === "object") return [enrollments];
  return [];
}
