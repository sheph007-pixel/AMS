import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getExclusionRules, isExcluded } from "@/lib/exclusions";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Production Dashboard API — returns enrollment-level detail rows.
 *
 * Each row = one plan + one coverage tier (grouping) for one client in one month.
 * This preserves the granularity shown in EN carrier billing:
 *   Plan × CoverageTier → Rate, Lives, BenefitAmount, MonthlyPremium
 *
 * Excludes COBRA plan types and terminated employees.
 * Lives = distinct active enrolled employees at that plan+tier.
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

function getField(obj: any, ...keys: string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "") return String(obj[key]);
    if (obj[`@_${key}`] !== undefined && obj[`@_${key}`] !== null) return String(obj[`@_${key}`]);
  }
  return null;
}

function parseNum(val: string | null): number {
  if (!val) return 0;
  const v = parseFloat(val);
  return isNaN(v) ? 0 : v;
}

function findEnrollments(meta: any): any[] {
  if (!meta) return [];
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
  const isEnded = endDate ? new Date(endDate) <= new Date() : false;
  return !declineReason && !isEnded;
}

function getMetaField(metadata: string | null, ...keys: string[]): string {
  if (!metadata) return "";
  try {
    const meta = JSON.parse(metadata);
    return getField(meta, ...keys) || "";
  } catch { return ""; }
}

// ─── Main Handler ───────────────────────────────────────────────────────────

export async function GET() {
  try {
    const [exclusionRules, carrierSettings] = await Promise.all([
      getExclusionRules(),
      prisma.carrierSetting.findMany(),
    ]);

    // Build carrier settings lookup (case-insensitive)
    const carrierSettingsMap = new Map<string, { incomeMethod: string; rate: number }>();
    for (const cs of carrierSettings) {
      carrierSettingsMap.set(cs.carrierName.toLowerCase(), {
        incomeMethod: cs.incomeMethod,
        rate: cs.rate,
      });
    }

    // Load all snapshots with benefit plans and employee snapshots
    const snapshots = await prisma.clientSnapshot.findMany({
      where: { year: { gte: 2022 } },
      select: {
        id: true,
        year: true,
        month: true,
        importedAt: true,
        client: { select: { groupId: true, groupName: true } },
        benefitPlans: {
          select: {
            id: true,
            planType: true,
            carrier: true,
            planName: true,
            metadata: true,
          },
        },
        employees: {
          select: {
            status: true,
            termDate: true,
            metadata: true,
          },
        },
      },
      orderBy: [{ year: "asc" }, { month: "asc" }],
    });

    const rows: any[] = [];
    const carriersSet = new Set<string>();
    const clientsSet = new Set<string>();
    const coverageTypesSet = new Set<string>();
    const periodsSet = new Set<string>();
    const policyNumbersSet = new Set<string>();

    for (const snap of snapshots) {
      if (isExcluded({ groupName: snap.client.groupName }, exclusionRules)) continue;

      const period = `${snap.year}-${String(snap.month).padStart(2, "0")}`;

      // Build plan lookup from BenefitPlan records: planId/planName → plan info
      const planIdMap = new Map<string, {
        carrier: string; planType: string; planName: string;
        policyNumber: string; planMeta: any;
      }>();
      const planNameMap = new Map<string, {
        carrier: string; planType: string; planName: string;
        policyNumber: string; planMeta: any;
      }>();

      for (const bp of snap.benefitPlans) {
        if (isExcluded({ carrier: bp.carrier, planName: bp.planName, planType: bp.planType }, exclusionRules)) continue;
        if (bp.planType?.toLowerCase() === "cobra") continue;

        let planMeta: any = {};
        try { planMeta = bp.metadata ? JSON.parse(bp.metadata) : {}; } catch { /* ignore */ }

        const policyNumber = getField(planMeta,
          "PlanIdentifier", "PolicyNumber", "GroupPolicyNumber",
          "ContractNumber", "GroupNumber", "PlanNumber", "PlanId", "PlanID"
        ) || "";

        const info = {
          carrier: bp.carrier || "Unspecified",
          planType: bp.planType || "Unknown",
          planName: bp.planName || "",
          policyNumber,
          planMeta,
        };

        // Map by PlanIdentifier
        if (policyNumber) {
          planIdMap.set(policyNumber, info);
        }
        // Map by PlanName
        if (bp.planName) {
          planNameMap.set(bp.planName, info);
        }
      }

      // Process employee enrollments → group by plan + coverage tier
      // Key: `${planKey}||${coverageTier}` → aggregated data
      const tierAgg = new Map<string, {
        carrier: string;
        planType: string;
        planName: string;
        policyNumber: string;
        grouping: string; // coverage tier
        rates: number[];  // collect all rates to find common rate
        benefitAmounts: number[];
        lives: number;
        totalPremium: number;
      }>();

      for (const emp of snap.employees) {
        // Only active employees
        const status = (emp.status || "Active").toLowerCase();
        if (status !== "active") continue;

        let empMeta: any = {};
        try { empMeta = emp.metadata ? JSON.parse(emp.metadata) : {}; } catch { continue; }

        const enrollments = findEnrollments(empMeta);
        const seenPlans = new Set<string>(); // dedupe per employee per plan+tier

        for (const enrollment of enrollments) {
          if (!qualifyEnrollment(enrollment)) continue;

          // Resolve plan
          const enrollPlanId = getField(enrollment, "PlanIdentifier", "PlanId", "PlanID") || "";
          const enrollPlanName = getField(enrollment, "PlanName", "Plan", "Name") || "";
          const planKey = enrollPlanId || enrollPlanName;
          if (!planKey) continue;

          const planInfo = (enrollPlanId && planIdMap.get(enrollPlanId))
            || (enrollPlanName && planNameMap.get(enrollPlanName))
            || null;

          // Skip if plan is COBRA or excluded
          if (!planInfo) continue;

          // Coverage tier / grouping
          const coverageTier = getField(enrollment,
            "CoverageLevel", "Tier", "CoverageTier", "CoverageDescription",
            "TierName", "RateTier", "AgeBand"
          ) || "Employee";

          const dedupeKey = `${planKey}||${coverageTier}`;
          if (seenPlans.has(dedupeKey)) continue;
          seenPlans.add(dedupeKey);

          // Per-enrollment cost (this is the individual's monthly premium for this plan)
          const planCost = parseNum(getField(enrollment,
            "PlanCost", "MonthlyPlanCost", "TotalPremium", "Premium",
            "MonthlyPremium", "TotalMonthlyPremium", "Cost"
          ));

          // Rate (per-employee tier rate)
          const rate = parseNum(getField(enrollment,
            "Rate", "EmployeeRate", "MonthlyRate", "PlanRate", "TierRate",
            "PlanCost", "MonthlyPlanCost", "Premium"
          ));

          // Benefit amount (for life/AD&D plans)
          const benefitAmt = parseNum(getField(enrollment,
            "BenefitAmount", "CoverageAmount", "Volume", "Amount",
            "FaceAmount", "BenefitVolume", "ApprovedAmount"
          ));

          const aggKey = `${planInfo.policyNumber || planKey}||${planInfo.planName}||${coverageTier}`;
          let agg = tierAgg.get(aggKey);
          if (!agg) {
            agg = {
              carrier: planInfo.carrier,
              planType: planInfo.planType,
              planName: planInfo.planName,
              policyNumber: planInfo.policyNumber,
              grouping: coverageTier,
              rates: [],
              benefitAmounts: [],
              lives: 0,
              totalPremium: 0,
            };
            tierAgg.set(aggKey, agg);
          }

          agg.lives += 1;
          agg.totalPremium += planCost;
          if (rate > 0) agg.rates.push(rate);
          if (benefitAmt > 0) agg.benefitAmounts.push(benefitAmt);
        }
      }

      // Convert aggregated tier data to rows
      for (const agg of tierAgg.values()) {
        const carrier = agg.carrier;
        const coverageType = agg.planType;

        // Determine tier rate: most common rate (mode) or average
        let tierRate = 0;
        if (agg.rates.length > 0) {
          // Use mode (most frequent rate) for display
          const rateFreq = new Map<number, number>();
          for (const r of agg.rates) {
            const rounded = Math.round(r * 1000) / 1000;
            rateFreq.set(rounded, (rateFreq.get(rounded) || 0) + 1);
          }
          let maxFreq = 0;
          for (const [r, f] of rateFreq) {
            if (f > maxFreq) { maxFreq = f; tierRate = r; }
          }
        }

        // Benefit amount: show most common or representative
        let benefitAmount = 0;
        if (agg.benefitAmounts.length > 0) {
          const amtFreq = new Map<number, number>();
          for (const a of agg.benefitAmounts) {
            amtFreq.set(a, (amtFreq.get(a) || 0) + 1);
          }
          let maxFreq = 0;
          for (const [a, f] of amtFreq) {
            if (f > maxFreq) { maxFreq = f; benefitAmount = a; }
          }
        }

        const monthlyPremium = Math.round(agg.totalPremium * 100) / 100;
        const lives = agg.lives;

        // Carrier income calculation
        const setting = carrierSettingsMap.get(carrier.toLowerCase());
        let incomeMethod = "NONE";
        let feeRate = 0;
        let income = 0;

        if (setting) {
          incomeMethod = setting.incomeMethod;
          feeRate = setting.rate;
          if (incomeMethod === "PEPM") {
            income = Math.round(lives * feeRate * 100) / 100;
          } else if (incomeMethod === "PERCENT_PREMIUM") {
            income = Math.round(monthlyPremium * (feeRate / 100) * 100) / 100;
          }
        }

        periodsSet.add(period);
        carriersSet.add(carrier);
        clientsSet.add(snap.client.groupName);
        coverageTypesSet.add(coverageType);
        if (agg.policyNumber) policyNumbersSet.add(agg.policyNumber);

        rows.push({
          // Display columns
          month: period,
          year: snap.year,
          monthNum: snap.month,
          clientName: snap.client.groupName,
          clientCode: snap.client.groupId,
          carrier,
          policyNumber: agg.policyNumber,
          planName: agg.planName,
          grouping: agg.grouping,
          rate: tierRate,
          lives,
          benefitAmount,
          monthlyPremium,
          incomeMethod,
          feeRate,
          feeRateDisplay: incomeMethod === "PEPM" ? `$${feeRate}` : incomeMethod === "PERCENT_PREMIUM" ? `${feeRate}%` : "",
          income,
          coverageType,
          // Extended export fields
          transactionDate: `${snap.year}-${String(snap.month).padStart(2, "0")}-01`,
          lineOfBusiness: agg.planType,
          sourceMonth: period,
        });
      }
    }

    // Build filter options
    const sortedPeriods = Array.from(periodsSet).sort();
    const fiscalYears = Array.from(new Set(sortedPeriods.map(p => parseInt(p.split("-")[0])))).sort();

    const totalPremium = Math.round(rows.reduce((s: number, r: any) => s + r.monthlyPremium, 0) * 100) / 100;
    const totalIncome = Math.round(rows.reduce((s: number, r: any) => s + r.income, 0) * 100) / 100;
    const totalLives = rows.reduce((s: number, r: any) => s + r.lives, 0);

    return NextResponse.json({
      rows,
      summary: {
        totalRows: rows.length,
        totalPremium,
        totalIncome,
        totalLives,
        totalClients: clientsSet.size,
        totalCarriers: carriersSet.size,
        periods: sortedPeriods.length,
      },
      filters: {
        carriers: Array.from(carriersSet).sort(),
        clients: Array.from(clientsSet).sort(),
        coverageTypes: Array.from(coverageTypesSet).sort(),
        periods: sortedPeriods,
        fiscalYears,
        policyNumbers: Array.from(policyNumbersSet).sort(),
      },
      carrierSettings: carrierSettings.map(cs => ({
        id: cs.id,
        carrierName: cs.carrierName,
        incomeMethod: cs.incomeMethod,
        rate: cs.rate,
      })),
    }, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (error) {
    console.error("Production dashboard error:", error);
    return NextResponse.json({ error: "Failed to generate production dashboard" }, { status: 500 });
  }
}
