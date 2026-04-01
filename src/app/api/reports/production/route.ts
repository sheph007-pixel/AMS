import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getExclusionRules, isExcluded } from "@/lib/exclusions";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Production Report — Full detail for Reagan Consulting.
 *
 * Outputs one row per client × carrier × planType × month
 * for fiscal years 2022–2025 (all uploaded periods).
 *
 * Fee model (same as Income Report):
 *   PEPM carriers (EBPA, HealthEZ): enrolled × $20/mo
 *   Commission carriers (Guardian, VSP): premium × 10%
 */

const PEPM_RATE = 20;
const COMMISSION_RATE = 0.10;
const PEPM_CARRIERS = ["EBPA", "HealthEZ"];
const COMMISSION_CARRIERS = ["Guardian", "VSP"];

interface ProductionRow {
  year: number;
  month: number;
  transactionDate: string;
  clientName: string;
  clientCode: string;
  sicCode: string;
  state: string;
  carrier: string;
  lineOfBusiness: string;
  planName: string;
  coverageType: string;
  eligible: number;
  enrolled: number;
  monthlyPremium: number;
  feeType: string;
  rate: string;
  estMonthlyFee: number;
  estAnnualFee: number;
  agencyCode: string;
  billType: string;
  producer: string;
  department: string;
}

export async function GET() {
  try {
    const exclusionRules = await getExclusionRules();

    // Fetch ALL snapshots for fiscal years 2022-2025 (plus 2026 if available)
    const snapshots = await prisma.clientSnapshot.findMany({
      where: { year: { gte: 2022 } },
      include: {
        client: true,
        benefitPlans: true,
        employees: true,
      },
      orderBy: [{ year: "asc" }, { month: "asc" }],
    });

    const rows: ProductionRow[] = [];
    const clientsSet = new Set<string>();
    const periodsSet = new Set<string>();
    let totalPremium = 0;
    let totalEstIncome = 0;

    for (const snapshot of snapshots) {
      if (isExcluded({ groupName: snapshot.client.groupName }, exclusionRules)) continue;

      const { year, month } = snapshot;
      const periodKey = `${year}-${String(month).padStart(2, "0")}`;
      periodsSet.add(periodKey);
      clientsSet.add(snapshot.client.groupId);

      // Build plan lookup maps (PlanIdentifier → carrier, planName → carrier)
      const planIdToInfo = new Map<string, { carrier: string; planType: string; planName: string }>();
      const planNameToInfo = new Map<string, { carrier: string; planType: string; planName: string }>();

      for (const bp of snapshot.benefitPlans) {
        if (isExcluded({ carrier: bp.carrier, planName: bp.planName, planType: bp.planType }, exclusionRules)) continue;

        const carrier = bp.carrier || "Unspecified Carrier";
        const info = { carrier, planType: bp.planType, planName: bp.planName || "" };

        if (bp.metadata) {
          try {
            const meta = JSON.parse(bp.metadata);
            const planId = meta.PlanIdentifier || meta.planIdentifier;
            if (planId) planIdToInfo.set(String(planId), info);
          } catch { /* ignore */ }
        }
        if (bp.planName) planNameToInfo.set(bp.planName, info);
      }

      if (planIdToInfo.size === 0 && planNameToInfo.size === 0) continue;

      // Aggregate: client × carrier × planType → { eligible, enrolled, premium }
      type AggKey = string;
      const agg = new Map<AggKey, {
        carrier: string;
        planType: string;
        planName: string;
        eligibleSet: Set<string>;
        enrolledSet: Set<string>;
        premium: number;
      }>();

      function getAgg(carrier: string, planType: string, planName: string) {
        const key = `${carrier}||${planType}`;
        let entry = agg.get(key);
        if (!entry) {
          entry = { carrier, planType, planName, eligibleSet: new Set(), enrolledSet: new Set(), premium: 0 };
          agg.set(key, entry);
        }
        return entry;
      }

      // Process employees
      for (const emp of snapshot.employees) {
        if ((emp.status || "Active").toLowerCase() !== "active") continue;
        if (!emp.metadata) continue;

        let meta: any;
        try { meta = JSON.parse(emp.metadata); } catch { continue; }

        const enrollments = findEnrollmentsFromMeta(meta);
        const empKey = emp.employeeId;

        for (const enrollment of enrollments) {
          // Enrollment qualification (same logic as income report)
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

          // Resolve carrier + plan info
          const enrollPlanId = String(enrollment.PlanIdentifier || enrollment.PlanId || enrollment.PlanID || "");
          const enrollPlanName = String(enrollment.PlanName || enrollment.Plan || enrollment.Name || "");

          let info: { carrier: string; planType: string; planName: string } | undefined;
          if (enrollPlanId) {
            info = planIdToInfo.get(enrollPlanId);
            if (!info && enrollPlanName) info = planNameToInfo.get(enrollPlanName);
          } else if (enrollPlanName) {
            info = planNameToInfo.get(enrollPlanName);
          }
          if (!info) continue;

          const entry = getAgg(info.carrier, info.planType, info.planName);

          // Every employee with an enrollment is eligible
          entry.eligibleSet.add(empKey);

          if (isQualifying) {
            entry.enrolledSet.add(empKey);

            // PlanCost
            const rawCost = String(enrollment.PlanCost || enrollment.MonthlyPlanCost || "");
            if (rawCost) {
              const parsed = parseFloat(rawCost);
              if (!isNaN(parsed)) entry.premium += parsed;
            }
          }
        }
      }

      // Convert aggregates to rows
      for (const entry of agg.values()) {
        const enrolled = entry.enrolledSet.size;
        const premium = Math.round(entry.premium * 100) / 100;

        const isPEPM = PEPM_CARRIERS.some(c => entry.carrier.toLowerCase().includes(c.toLowerCase()));
        const isCommission = COMMISSION_CARRIERS.some(c => entry.carrier.toLowerCase().includes(c.toLowerCase()));

        let feeType = "";
        let rate = "";
        let estMonthlyFee = 0;

        if (isPEPM) {
          feeType = "PEPM";
          rate = `$${PEPM_RATE} PEPM`;
          estMonthlyFee = enrolled * PEPM_RATE;
        } else if (isCommission) {
          feeType = "Commission";
          rate = `${COMMISSION_RATE * 100}%`;
          estMonthlyFee = premium * COMMISSION_RATE;
        }
        estMonthlyFee = Math.round(estMonthlyFee * 100) / 100;

        totalPremium += premium;
        totalEstIncome += estMonthlyFee;

        rows.push({
          year,
          month,
          transactionDate: `${year}-${String(month).padStart(2, "0")}-01`,
          clientName: snapshot.client.groupName,
          clientCode: snapshot.client.groupId,
          sicCode: snapshot.sicCode || "",
          state: snapshot.state || "",
          carrier: entry.carrier,
          lineOfBusiness: entry.planType,
          planName: entry.planName,
          coverageType: "Group",
          eligible: entry.eligibleSet.size,
          enrolled,
          monthlyPremium: premium,
          feeType,
          rate,
          estMonthlyFee,
          estAnnualFee: Math.round(estMonthlyFee * 12 * 100) / 100,
          agencyCode: "KENNION",
          billType: "Direct",
          producer: "Kennion Benefits",
          department: "",
        });
      }
    }

    return NextResponse.json({
      rows,
      summary: {
        totalClients: clientsSet.size,
        totalPeriods: periodsSet.size,
        totalRows: rows.length,
        totalPremium: Math.round(totalPremium * 100) / 100,
        totalEstIncome: Math.round(totalEstIncome * 100) / 100,
      },
      periods: Array.from(periodsSet).sort(),
      methodology: {
        dataSource: "Employee Navigator XML enrollment data",
        pepmCarriers: PEPM_CARRIERS,
        commissionCarriers: COMMISSION_CARRIERS,
        pepmRate: PEPM_RATE,
        commissionRate: COMMISSION_RATE,
        note: "Premiums reflect monthly billing amounts from Employee Navigator. Estimated fees use the same model as the Income Report. Actual collected revenue is tracked in Kennion/NIA financial statements and may differ due to timing, retro adjustments, and billing cycles.",
      },
    });
  } catch (error) {
    console.error("Production report error:", error);
    return NextResponse.json({ error: "Failed to generate production report" }, { status: 500 });
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
