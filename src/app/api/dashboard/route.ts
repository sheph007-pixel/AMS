import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getExclusionRules, isExcluded } from "@/lib/exclusions";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Dashboard API — MEMORY-OPTIMIZED.
 * Processes snapshots one at a time, fetching employees in batches.
 */

const PEPM_RATE = 20;
const COMMISSION_RATE = 0.10;
const PEPM_CARRIERS = ["EBPA", "HealthEZ"];
const COMMISSION_CARRIERS = ["Guardian", "VSP"];

export async function GET() {
  try {
    const exclusionRules = await getExclusionRules();

    // Step 1: Get snapshot IDs + client info only (NO employees)
    const snapshotList = await prisma.clientSnapshot.findMany({
      where: { year: { gte: 2022 } },
      select: {
        id: true,
        year: true,
        month: true,
        clientId: true,
        client: { select: { groupId: true, groupName: true } },
      },
      orderBy: [{ year: "asc" }, { month: "asc" }],
    });

    let latestYear = 2022;
    for (const s of snapshotList) {
      if (s.year > latestYear) latestYear = s.year;
    }
    const previousYear = latestYear - 1;

    // Period aggregation
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

    // Step 2: Process each snapshot individually
    for (const snap of snapshotList) {
      if (isExcluded({ groupName: snap.client.groupName }, exclusionRules)) continue;

      const pd = getPeriod(snap.year, snap.month);
      pd.clients.add(snap.clientId);

      // Fetch benefit plans for this snapshot
      const benefitPlans = await prisma.benefitPlan.findMany({
        where: { clientSnapshotId: snap.id },
        select: { carrier: true, planType: true, planName: true, metadata: true },
      });

      const planIdToInfo = new Map<string, { carrier: string; planType: string }>();
      const planNameToInfo = new Map<string, { carrier: string; planType: string }>();

      for (const bp of benefitPlans) {
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

      // Fetch employees in batches
      const BATCH_SIZE = 500;
      let skip = 0;
      let hasMore = true;

      while (hasMore) {
        const employees = await prisma.employeeSnapshot.findMany({
          where: { clientSnapshotId: snap.id },
          select: { employeeId: true, status: true, metadata: true },
          take: BATCH_SIZE,
          skip,
        });

        if (employees.length < BATCH_SIZE) hasMore = false;
        skip += BATCH_SIZE;

        for (const emp of employees) {
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

          const empKey = `${snap.clientId}::${emp.employeeId}`;
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

            const rawCost = String(enrollment.PlanCost || enrollment.MonthlyPlanCost || "");
            let cost = 0;
            if (rawCost) {
              const parsed = parseFloat(rawCost);
              if (!isNaN(parsed)) cost = parsed;
            }

            pd.premium += cost;
            pd.carrierPremium.set(info.carrier, (pd.carrierPremium.get(info.carrier) || 0) + cost);
            pd.lobPremium.set(info.planType, (pd.lobPremium.get(info.planType) || 0) + cost);

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

    function getYearMetrics(year: number) {
      const yearPeriods = premiumTrend.filter(p => p.year === year);
      if (yearPeriods.length === 0) return { clients: 0, employees: 0, premium: 0, estIncome: 0 };
      const latest = yearPeriods[yearPeriods.length - 1];
      return { clients: latest.clients, employees: latest.employees, premium: latest.premium, estIncome: latest.estIncome };
    }

    const currentMetrics = getYearMetrics(latestYear);
    const previousMetrics = getYearMetrics(previousYear);

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

    const latestPeriod = premiumTrend[premiumTrend.length - 1];
    const latestPd = latestPeriod ? periodData.get(latestPeriod.period) : null;
    const lobBreakdown = latestPd
      ? Array.from(latestPd.lobPremium.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([lob, premium]) => ({ lob, premium: Math.round(premium * 100) / 100 }))
      : [];

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
