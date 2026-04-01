import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getExclusionRules, isExcluded } from "@/lib/exclusions";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Production Dashboard API — returns row-level BenefitPlan data
 * with carrier settings applied for income calculation.
 *
 * Each row = one BenefitPlan record (preserves source detail).
 * Excludes COBRA plan types and termed employees.
 * Lives = enrollees (active enrolled employees only).
 */

function getMetaField(metadata: string | null, ...keys: string[]): string {
  if (!metadata) return "";
  try {
    const meta = JSON.parse(metadata);
    for (const key of keys) {
      if (meta[key] !== undefined && meta[key] !== null && meta[key] !== "") return String(meta[key]);
      if (meta[`@_${key}`] !== undefined && meta[`@_${key}`] !== null) return String(meta[`@_${key}`]);
    }
  } catch { /* ignore */ }
  return "";
}

export async function GET() {
  try {
    const [exclusionRules, carrierSettings, snapshots] = await Promise.all([
      getExclusionRules(),
      prisma.carrierSetting.findMany(),
      prisma.clientSnapshot.findMany({
        where: { year: { gte: 2022 } },
        select: {
          id: true,
          year: true,
          month: true,
          importedAt: true,
          metadata: true,
          client: { select: { groupId: true, groupName: true } },
          benefitPlans: {
            select: {
              id: true,
              planType: true,
              carrier: true,
              planName: true,
              eligible: true,
              enrollees: true,
              premium: true,
              metadata: true,
            },
          },
        },
        orderBy: [{ year: "asc" }, { month: "asc" }],
      }),
    ]);

    // Build carrier settings lookup (case-insensitive)
    const carrierSettingsMap = new Map<string, { incomeMethod: string; rate: number }>();
    for (const cs of carrierSettings) {
      carrierSettingsMap.set(cs.carrierName.toLowerCase(), {
        incomeMethod: cs.incomeMethod,
        rate: cs.rate,
      });
    }

    const rows: any[] = [];
    const carriers = new Set<string>();
    const clients = new Set<string>();
    const coverageTypes = new Set<string>();
    const periods = new Set<string>();

    for (const snap of snapshots) {
      if (isExcluded({ groupName: snap.client.groupName }, exclusionRules)) continue;

      for (const bp of snap.benefitPlans) {
        if (isExcluded({ carrier: bp.carrier, planName: bp.planName, planType: bp.planType }, exclusionRules)) continue;

        // Exclude COBRA plans
        if (bp.planType?.toLowerCase() === "cobra") continue;

        const carrier = bp.carrier || "Unspecified";
        const lives = bp.enrollees || 0;
        const monthlyPremium = Math.round((bp.premium || 0) * 100) / 100;

        // Extract metadata fields
        const policyNumber = getMetaField(bp.metadata,
          "PlanIdentifier", "PolicyNumber", "GroupPolicyNumber",
          "ContractNumber", "GroupNumber", "PlanNumber", "PlanId", "PlanID"
        );
        const grouping = getMetaField(bp.metadata,
          "CarrierPlanTypeCode", "PlanTypeCode", "BenefitClass",
          "Class", "Division", "SubGroup"
        );
        const planRate = getMetaField(bp.metadata,
          "Rate", "EmployeeRate", "MonthlyRate", "PlanRate", "TierRate"
        );
        const coverageType = bp.planType || "Group";

        // Determine income from carrier settings
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

        const period = `${snap.year}-${String(snap.month).padStart(2, "0")}`;
        periods.add(period);
        carriers.add(carrier);
        clients.add(snap.client.groupName);
        coverageTypes.add(coverageType);

        // Source file info from snapshot metadata
        const sourceFile = getMetaField(snap.metadata, "SourceFile", "FileName", "sourceFile");

        rows.push({
          // Table columns
          month: period,
          year: snap.year,
          monthNum: snap.month,
          clientName: snap.client.groupName,
          clientCode: snap.client.groupId,
          carrier,
          policyNumber,
          planName: bp.planName || "",
          grouping,
          rate: planRate,
          lives,
          monthlyPremium,
          incomeMethod,
          feeRate: incomeMethod === "PEPM" ? `$${feeRate}` : incomeMethod === "PERCENT_PREMIUM" ? `${feeRate}%` : "",
          income,
          coverageType,
          // Extended export fields
          transactionDate: `${snap.year}-${String(snap.month).padStart(2, "0")}-01`,
          lineOfBusiness: bp.planType || "",
          eligible: bp.eligible || 0,
          configuredRate: feeRate,
          sourceFile,
          sourceMonth: period,
          planType: bp.planType || "",
          // Code fields from metadata
          codes: getMetaField(bp.metadata, "CarrierPlanTypeCode", "PlanTypeCode", "BenefitCode"),
          codeDescriptions: getMetaField(bp.metadata, "CarrierPlanTypeDescription", "PlanTypeDescription", "BenefitDescription"),
        });
      }
    }

    // Build filter options
    const sortedPeriods = Array.from(periods).sort();
    const fiscalYears = Array.from(new Set(sortedPeriods.map(p => parseInt(p.split("-")[0])))).sort();

    // Summary
    const totalPremium = Math.round(rows.reduce((s, r) => s + r.monthlyPremium, 0) * 100) / 100;
    const totalIncome = Math.round(rows.reduce((s, r) => s + r.income, 0) * 100) / 100;
    const totalLives = rows.reduce((s: number, r: any) => s + r.lives, 0);

    return NextResponse.json({
      rows,
      summary: {
        totalRows: rows.length,
        totalPremium,
        totalIncome,
        totalLives,
        totalClients: clients.size,
        totalCarriers: carriers.size,
        periods: sortedPeriods.length,
      },
      filters: {
        carriers: Array.from(carriers).sort(),
        clients: Array.from(clients).sort(),
        coverageTypes: Array.from(coverageTypes).sort(),
        periods: sortedPeriods,
        fiscalYears,
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
