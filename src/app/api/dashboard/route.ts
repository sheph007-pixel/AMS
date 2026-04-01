import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getExclusionRules, isExcluded } from "@/lib/exclusions";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Dashboard API — Aggregates enrollment data across all periods for executive charts.
 *
 * Returns:
 *   - KPI metrics (current year vs previous year)
 *   - Monthly premium trend (all years)
 *   - Client count trend (all years)
 *   - Carrier breakdown (top carriers by premium)
 *   - LOB (line of business) breakdown
 *   - Year-over-year summary table
 */

const PEPM_RATE = 20;
const COMMISSION_RATE = 0.10;
const PEPM_CARRIERS = ["EBPA", "HealthEZ"];
const COMMISSION_CARRIERS = ["Guardian", "VSP"];

export async function GET() {
  try {
    const exclusionRules = await getExclusionRules();

    // Get all snapshots
    const snapshots = await prisma.clientSnapshot.findMany({
      where: { year: { gte: 2022 } },
      include: {
        client: true,
        benefitPlans: true,
        employees: true,
      },
      orderBy: [{ year: "asc" }, { month: "asc" }],
    });

    // Find latest year
    let latestYear = 2022;
    for (const s of snapshots) {
      if (s.year > latestYear) latestYear = s.year;
    }
    const previousYear = latestYear - 1;

    // Aggregate by period (year-month)
    const periodData = new Map<string, {
      year: number;
      month: number;
      clients: Set<string>;
      activeEmployees: Set<string>;
      premium: number;
      estIncome: number;
      carrierPremium: Map<string, number>;
      lobPremium: Map<string, number>;
    }>();

    function getPeriod(year: number, month: number) {
      const key = `${year}-${String(month).padStart(2, "0")}`;
      let pd = periodData.get(key);
      if (!pd) {
        pd = {
          year, month,
          clients: new Set(),
          activeEmployees: new Set(),
          premium: 0,
          estIncome: 0,
          carrierPremium: new Map(),
          lobPremium: new Map(),
        };
        periodData.set(key, pd);
      }
      return pd;
    }

    for (const snapshot of snapshots) {
      if (isExcluded({ groupName: snapshot.client.groupName }, exclusionRules)) continue;

      const pd = getPeriod(snapshot.year, snapshot.month);
      pd.clients.add(snapshot.clientId);

      // Build plan lookup
      const planIdToInfo = new Map<string, { carrier: string; planType: string }>();
      const planNameToInfo = new Map<string, { carrier: string; planType: string }>();

      for (const bp of snapshot.benefitPlans) {
        if (isExcluded({ carrier: bp.carrier, planName: bp.planName, planType: bp.planType }, exclusionRules)) continue;
        const carrier = bp.carrier || "Unspecified";
        const info = { carrier, planType: bp.planType };

        if (bp.metadata) {
          try {
            const meta = JSON.parse(bp.metadata);
            const planId = meta.PlanIdentifier || meta.planIdentifier;
            if (planId) planIdToInfo.set(String(planId), info);
          } catch { /* ignore */ }
        }
        if (bp.planName) planNameToInfo.set(bp.planName, info);
      }

      // Process employees
      for (const emp of snapshot.employees) {
        if ((emp.status || "Active").toLowerCase() !== "active") continue;
        if (!emp.metadata) continue;

        let meta: any;
        try { meta = JSON.parse(emp.metadata); } catch { continue; }

        const container = meta.Enrollments || meta.enrollments;
        if (!container) continue;
        let enrollments: any[];
        if (Array.isArray(container)) { enrollments = container; }
        else {
          const e = container.Enrollment || container.enrollment;
          if (Array.isArray(e)) enrollments = e;
          else if (e && typeof e === "object") enrollments = [e];
          else continue;
        }

        const empKey = `${snapshot.clientId}::${emp.employeeId}`;
        const countedCarriers = new Set<string>();

        for (const enrollment of enrollments) {
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

          const enrollPlanId = String(enrollment.PlanIdentifier || enrollment.PlanId || enrollment.PlanID || "");
          const enrollPlanName = String(enrollment.PlanName || enrollment.Plan || enrollment.Name || "");

          let info: { carrier: string; planType: string } | undefined;
          if (enrollPlanId) {
            info = planIdToInfo.get(enrollPlanId);
            if (!info && enrollPlanName) info = planNameToInfo.get(enrollPlanName);
          } else if (enrollPlanName) {
            info = planNameToInfo.get(enrollPlanName);
          }
          if (!info) continue;

          // Premium
          const rawCost = String(enrollment.PlanCost || enrollment.MonthlyPlanCost || "");
          let cost = 0;
          if (rawCost) {
            const parsed = parseFloat(rawCost);
            if (!isNaN(parsed)) cost = parsed;
          }

          pd.premium += cost;

          // Carrier premium
          pd.carrierPremium.set(info.carrier, (pd.carrierPremium.get(info.carrier) || 0) + cost);

          // LOB premium
          pd.lobPremium.set(info.planType, (pd.lobPremium.get(info.planType) || 0) + cost);

          // Est income
          const isPEPM = PEPM_CARRIERS.some(c => info!.carrier.toLowerCase().includes(c.toLowerCase()));
          const isComm = COMMISSION_CARRIERS.some(c => info!.carrier.toLowerCase().includes(c.toLowerCase()));

          if (!countedCarriers.has(info.carrier)) {
            countedCarriers.add(info.carrier);
            if (isPEPM) pd.estIncome += PEPM_RATE;
          }
          if (isComm) pd.estIncome += cost * COMMISSION_RATE;

          pd.activeEmployees.add(empKey);
        }
      }
    }

    // Build monthly trend
    const premiumTrend: { period: string; year: number; month: number; premium: number; clients: number; employees: number; estIncome: number }[] = [];
    for (const [key, pd] of Array.from(periodData.entries()).sort()) {
      premiumTrend.push({
        period: key,
        year: pd.year,
        month: pd.month,
        premium: Math.round(pd.premium * 100) / 100,
        clients: pd.clients.size,
        employees: pd.activeEmployees.size,
        estIncome: Math.round(pd.estIncome * 100) / 100,
      });
    }

    // Current year vs previous year KPIs (use December or latest month of each year)
    function getYearMetrics(year: number) {
      const yearPeriods = premiumTrend.filter(p => p.year === year);
      if (yearPeriods.length === 0) return { clients: 0, employees: 0, premium: 0, estIncome: 0 };
      const latest = yearPeriods[yearPeriods.length - 1];
      return {
        clients: latest.clients,
        employees: latest.employees,
        premium: latest.premium,
        estIncome: latest.estIncome,
      };
    }

    const currentMetrics = getYearMetrics(latestYear);
    const previousMetrics = getYearMetrics(previousYear);

    // Top carriers by premium (aggregate across all periods)
    const carrierTotals = new Map<string, number>();
    for (const pd of periodData.values()) {
      for (const [carrier, prem] of pd.carrierPremium) {
        carrierTotals.set(carrier, (carrierTotals.get(carrier) || 0) + prem);
      }
    }
    const topCarriers = Array.from(carrierTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([carrier, premium]) => ({ carrier, premium: Math.round(premium * 100) / 100 }));

    // LOB breakdown (latest period)
    const latestPeriod = premiumTrend[premiumTrend.length - 1];
    const latestPd = latestPeriod ? periodData.get(latestPeriod.period) : null;
    const lobBreakdown = latestPd
      ? Array.from(latestPd.lobPremium.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([lob, premium]) => ({ lob, premium: Math.round(premium * 100) / 100 }))
      : [];

    // Year-over-year summary
    const years = Array.from(new Set(premiumTrend.map(p => p.year))).sort();
    const yoySummary = years.map(year => {
      const yearPeriods = premiumTrend.filter(p => p.year === year);
      const totalPremium = yearPeriods.reduce((s, p) => s + p.premium, 0);
      const totalIncome = yearPeriods.reduce((s, p) => s + p.estIncome, 0);
      const avgClients = Math.round(yearPeriods.reduce((s, p) => s + p.clients, 0) / yearPeriods.length);
      const avgEmployees = Math.round(yearPeriods.reduce((s, p) => s + p.employees, 0) / yearPeriods.length);
      return {
        year,
        months: yearPeriods.length,
        avgClients,
        avgEmployees,
        totalPremium: Math.round(totalPremium * 100) / 100,
        totalEstIncome: Math.round(totalIncome * 100) / 100,
      };
    });

    return NextResponse.json({
      kpi: {
        currentYear: latestYear,
        previousYear,
        current: currentMetrics,
        previous: previousMetrics,
      },
      premiumTrend,
      topCarriers,
      lobBreakdown,
      yoySummary,
      totalPeriods: premiumTrend.length,
    });
  } catch (error) {
    console.error("Dashboard API error:", error);
    return NextResponse.json({ error: "Failed to generate dashboard data" }, { status: 500 });
  }
}
