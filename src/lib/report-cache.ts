import { prisma } from "@/lib/db";
import { getExclusionRules, isExcluded } from "@/lib/exclusions";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Report Cache — Pre-computes all report data and stores as JSON in the database.
 *
 * This replaces the expensive per-request processing of employee metadata.
 * Called once after each XML import, results are served instantly from cache.
 */

const PEPM_RATE = 20;
const COMMISSION_RATE = 0.10;
const PEPM_CARRIERS = ["EBPA", "HealthEZ"];
const COMMISSION_CARRIERS = ["Guardian", "VSP"];
const BATCH_SIZE = 500;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function findEnrollments(meta: any): any[] {
  const container = meta.Enrollments || meta.enrollments;
  if (!container) return [];
  if (Array.isArray(container)) return container;
  const e = container.Enrollment || container.enrollment;
  if (Array.isArray(e)) return e;
  if (e && typeof e === "object") return [e];
  return [];
}

function qualifyEnrollment(enrollment: any): boolean {
  const enrollmentType = enrollment.EnrollmentType || enrollment.enrollmentType || enrollment.Type;
  if (enrollmentType) return String(enrollmentType).toLowerCase() === "current";
  const declineReason = enrollment.DeclineReason || enrollment.declineReason;
  const endDate = enrollment.CoverageEndDate || enrollment.EndDate || enrollment.EndedOn;
  const isEnded = endDate && new Date(String(endDate)) <= new Date();
  return !declineReason && !isEnded;
}

function resolvePlan(
  enrollment: any,
  planIdMap: Map<string, { carrier: string; planType: string; planName: string }>,
  planNameMap: Map<string, { carrier: string; planType: string; planName: string }>
) {
  const enrollPlanId = String(enrollment.PlanIdentifier || enrollment.PlanId || enrollment.PlanID || "");
  const enrollPlanName = String(enrollment.PlanName || enrollment.Plan || enrollment.Name || "");
  if (enrollPlanId) {
    const info = planIdMap.get(enrollPlanId);
    if (info) return info;
    if (enrollPlanName) return planNameMap.get(enrollPlanName);
  } else if (enrollPlanName) {
    return planNameMap.get(enrollPlanName);
  }
  return undefined;
}

function getPremium(enrollment: any): number {
  const raw = String(enrollment.PlanCost || enrollment.MonthlyPlanCost || "");
  if (!raw) return 0;
  const v = parseFloat(raw);
  return isNaN(v) ? 0 : v;
}

// ─── Core Data Processing ────────────────────────────────────────────────────

interface ProcessedSnapshot {
  year: number;
  month: number;
  clientName: string;
  clientCode: string;
  sicCode: string;
  state: string;
  importedAt: Date;
  agg: Map<string, {
    carrier: string;
    planType: string;
    planName: string;
    eligibleSet: Set<string>;
    enrolledSet: Set<string>;
    premium: number;
  }>;
}

async function processAllSnapshots(): Promise<ProcessedSnapshot[]> {
  const exclusionRules = await getExclusionRules();

  const snapshotList = await prisma.clientSnapshot.findMany({
    where: { year: { gte: 2022 } },
    select: {
      id: true, year: true, month: true, sicCode: true, state: true, importedAt: true,
      client: { select: { groupId: true, groupName: true } },
    },
    orderBy: [{ year: "asc" }, { month: "asc" }],
  });

  const results: ProcessedSnapshot[] = [];

  for (const snap of snapshotList) {
    if (isExcluded({ groupName: snap.client.groupName }, exclusionRules)) continue;

    // Fetch benefit plans
    const benefitPlans = await prisma.benefitPlan.findMany({
      where: { clientSnapshotId: snap.id },
      select: { carrier: true, planType: true, planName: true, metadata: true },
    });

    const planIdMap = new Map<string, { carrier: string; planType: string; planName: string }>();
    const planNameMap = new Map<string, { carrier: string; planType: string; planName: string }>();

    for (const bp of benefitPlans) {
      if (isExcluded({ carrier: bp.carrier, planName: bp.planName, planType: bp.planType }, exclusionRules)) continue;
      const carrier = bp.carrier || "Unspecified Carrier";
      const info = { carrier, planType: bp.planType, planName: bp.planName || "" };
      if (bp.metadata) {
        try {
          const meta = JSON.parse(bp.metadata);
          const planId = meta.PlanIdentifier || meta.planIdentifier;
          if (planId) planIdMap.set(String(planId), info);
        } catch { /* */ }
      }
      if (bp.planName) planNameMap.set(bp.planName, info);
    }

    if (planIdMap.size === 0 && planNameMap.size === 0) continue;

    const agg = new Map<string, {
      carrier: string; planType: string; planName: string;
      eligibleSet: Set<string>; enrolledSet: Set<string>; premium: number;
    }>();

    // Fetch employees in batches
    let skip = 0;
    let hasMore = true;
    while (hasMore) {
      const emps = await prisma.employeeSnapshot.findMany({
        where: { clientSnapshotId: snap.id },
        select: { employeeId: true, status: true, metadata: true },
        take: BATCH_SIZE,
        skip,
      });
      if (emps.length < BATCH_SIZE) hasMore = false;
      skip += BATCH_SIZE;

      for (const emp of emps) {
        if ((emp.status || "Active").toLowerCase() !== "active") continue;
        if (!emp.metadata) continue;
        let meta: any;
        try { meta = JSON.parse(emp.metadata); } catch { continue; }

        for (const enrollment of findEnrollments(meta)) {
          const info = resolvePlan(enrollment, planIdMap, planNameMap);
          if (!info) continue;

          const key = `${info.carrier}||${info.planType}`;
          let entry = agg.get(key);
          if (!entry) {
            entry = { carrier: info.carrier, planType: info.planType, planName: info.planName, eligibleSet: new Set(), enrolledSet: new Set(), premium: 0 };
            agg.set(key, entry);
          }

          entry.eligibleSet.add(emp.employeeId);

          if (qualifyEnrollment(enrollment)) {
            entry.enrolledSet.add(emp.employeeId);
            entry.premium += getPremium(enrollment);
          }
        }
      }
    }

    results.push({
      year: snap.year, month: snap.month,
      clientName: snap.client.groupName, clientCode: snap.client.groupId,
      sicCode: snap.sicCode || "", state: snap.state || "",
      importedAt: snap.importedAt,
      agg,
    });
  }

  return results;
}

// ─── Build Production Report ─────────────────────────────────────────────────

function buildProductionReport(snapshots: ProcessedSnapshot[]) {
  const rows: any[] = [];
  const clientsSet = new Set<string>();
  const periodsSet = new Set<string>();
  let totalPremium = 0;
  let totalEstIncome = 0;
  let snapshotsProcessed = snapshots.length;

  for (const snap of snapshots) {
    periodsSet.add(`${snap.year}-${String(snap.month).padStart(2, "0")}`);
    clientsSet.add(snap.clientCode);

    for (const entry of snap.agg.values()) {
      const enrolled = entry.enrolledSet.size;
      const premium = Math.round(entry.premium * 100) / 100;
      const isPEPM = PEPM_CARRIERS.some(c => entry.carrier.toLowerCase().includes(c.toLowerCase()));
      const isComm = COMMISSION_CARRIERS.some(c => entry.carrier.toLowerCase().includes(c.toLowerCase()));

      let feeType = "", rate = "", estMonthlyFee = 0;
      if (isPEPM) { feeType = "PEPM"; rate = `$${PEPM_RATE} PEPM`; estMonthlyFee = enrolled * PEPM_RATE; }
      else if (isComm) { feeType = "Commission"; rate = `${COMMISSION_RATE * 100}%`; estMonthlyFee = premium * COMMISSION_RATE; }
      estMonthlyFee = Math.round(estMonthlyFee * 100) / 100;

      totalPremium += premium;
      totalEstIncome += estMonthlyFee;

      rows.push({
        year: snap.year, month: snap.month,
        transactionDate: `${snap.year}-${String(snap.month).padStart(2, "0")}-01`,
        clientName: snap.clientName, clientCode: snap.clientCode,
        sicCode: snap.sicCode, state: snap.state,
        carrier: entry.carrier, lineOfBusiness: entry.planType,
        planName: entry.planName, coverageType: "Group",
        eligible: entry.eligibleSet.size, enrolled,
        monthlyPremium: premium, feeType, rate,
        estMonthlyFee, estAnnualFee: Math.round(estMonthlyFee * 12 * 100) / 100,
        agencyCode: "KENNION", billType: "Direct",
        producer: "Kennion Benefits", broker: "Kennion", department: "",
      });
    }
  }

  const sortedPeriods = Array.from(periodsSet).sort();
  const periodGaps: string[] = [];
  for (let i = 1; i < sortedPeriods.length; i++) {
    const [pY, pM] = sortedPeriods[i - 1].split("-").map(Number);
    const [cY, cM] = sortedPeriods[i].split("-").map(Number);
    const pT = pY * 12 + pM, cT = cY * 12 + cM;
    if (cT - pT > 1) {
      for (let t = pT + 1; t < cT; t++) {
        periodGaps.push(`${Math.floor((t - 1) / 12)}-${String(((t - 1) % 12) + 1).padStart(2, "0")}`);
      }
    }
  }

  const rowPremiumSum = Math.round(rows.reduce((s: number, r: any) => s + r.monthlyPremium, 0) * 100) / 100;
  const rowFeeSum = Math.round(rows.reduce((s: number, r: any) => s + r.estMonthlyFee, 0) * 100) / 100;

  return {
    rows,
    summary: {
      totalClients: clientsSet.size, totalPeriods: periodsSet.size,
      totalRows: rows.length,
      totalPremium: Math.round(totalPremium * 100) / 100,
      totalEstIncome: Math.round(totalEstIncome * 100) / 100,
    },
    audit: {
      generatedAt: new Date().toISOString(),
      snapshotsQueried: snapshotsProcessed, snapshotsProcessed, snapshotsSkipped: 0,
      employeesProcessed: 0, enrollmentsProcessed: 0,
      premiumCrossCheck: { summaryTotal: Math.round(totalPremium * 100) / 100, rowDetailTotal: rowPremiumSum, match: Math.round(totalPremium * 100) / 100 === rowPremiumSum },
      feeCrossCheck: { summaryTotal: Math.round(totalEstIncome * 100) / 100, rowDetailTotal: rowFeeSum, match: Math.round(totalEstIncome * 100) / 100 === rowFeeSum },
      periodCoverage: { first: sortedPeriods[0] || null, last: sortedPeriods[sortedPeriods.length - 1] || null, totalMonths: sortedPeriods.length, gaps: periodGaps },
    },
    periods: sortedPeriods,
    methodology: {
      dataSource: "Employee Navigator XML enrollment data",
      pepmCarriers: PEPM_CARRIERS, commissionCarriers: COMMISSION_CARRIERS,
      pepmRate: PEPM_RATE, commissionRate: COMMISSION_RATE,
      note: "Premiums reflect monthly billing amounts from Employee Navigator. Estimated fees use the same model as the Income Report. Actual collected revenue is tracked in Kennion/NIA financial statements and may differ due to timing, retro adjustments, and billing cycles.",
    },
  };
}

// ─── Build Dashboard ─────────────────────────────────────────────────────────

function buildDashboard(snapshots: ProcessedSnapshot[]) {
  const periodData = new Map<string, {
    year: number; month: number; clients: Set<string>;
    activeEmployees: Set<string>; premium: number; estIncome: number;
    carrierPremium: Map<string, number>; lobPremium: Map<string, number>;
  }>();

  let latestYear = 2022;
  for (const snap of snapshots) {
    if (snap.year > latestYear) latestYear = snap.year;

    const key = `${snap.year}-${String(snap.month).padStart(2, "0")}`;
    let pd = periodData.get(key);
    if (!pd) {
      pd = { year: snap.year, month: snap.month, clients: new Set(), activeEmployees: new Set(), premium: 0, estIncome: 0, carrierPremium: new Map(), lobPremium: new Map() };
      periodData.set(key, pd);
    }
    pd.clients.add(snap.clientCode);

    for (const entry of snap.agg.values()) {
      const enrolled = entry.enrolledSet.size;
      const premium = entry.premium;
      pd.premium += premium;
      pd.carrierPremium.set(entry.carrier, (pd.carrierPremium.get(entry.carrier) || 0) + premium);
      pd.lobPremium.set(entry.planType, (pd.lobPremium.get(entry.planType) || 0) + premium);

      const isPEPM = PEPM_CARRIERS.some(c => entry.carrier.toLowerCase().includes(c.toLowerCase()));
      const isComm = COMMISSION_CARRIERS.some(c => entry.carrier.toLowerCase().includes(c.toLowerCase()));
      if (isPEPM) pd.estIncome += enrolled * PEPM_RATE;
      else if (isComm) pd.estIncome += premium * COMMISSION_RATE;

      for (const empId of entry.enrolledSet) {
        pd.activeEmployees.add(`${snap.clientCode}::${empId}`);
      }
    }
  }

  const previousYear = latestYear - 1;

  const premiumTrend = Array.from(periodData.entries()).sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, pd]) => ({
      period, year: pd.year, month: pd.month,
      premium: Math.round(pd.premium * 100) / 100,
      clients: pd.clients.size,
      employees: pd.activeEmployees.size,
      estIncome: Math.round(pd.estIncome * 100) / 100,
    }));

  function getYearMetrics(year: number) {
    const yp = premiumTrend.filter(p => p.year === year);
    if (!yp.length) return { clients: 0, employees: 0, premium: 0, estIncome: 0 };
    const l = yp[yp.length - 1];
    return { clients: l.clients, employees: l.employees, premium: l.premium, estIncome: l.estIncome };
  }

  const carrierTotals = new Map<string, number>();
  for (const pd of periodData.values()) {
    for (const [c, p] of pd.carrierPremium) carrierTotals.set(c, (carrierTotals.get(c) || 0) + p);
  }

  const topCarriers = Array.from(carrierTotals.entries())
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([carrier, premium]) => ({ carrier, premium: Math.round(premium * 100) / 100 }));

  const latestPeriod = premiumTrend[premiumTrend.length - 1];
  const latestPd = latestPeriod ? periodData.get(latestPeriod.period) : null;
  const lobBreakdown = latestPd
    ? Array.from(latestPd.lobPremium.entries()).sort((a, b) => b[1] - a[1])
        .map(([lob, premium]) => ({ lob, premium: Math.round(premium * 100) / 100 }))
    : [];

  const years = Array.from(new Set(premiumTrend.map(p => p.year))).sort();
  const yoySummary = years.map(year => {
    const yp = premiumTrend.filter(p => p.year === year);
    return {
      year, months: yp.length,
      avgClients: Math.round(yp.reduce((s, p) => s + p.clients, 0) / yp.length),
      avgEmployees: Math.round(yp.reduce((s, p) => s + p.employees, 0) / yp.length),
      totalPremium: Math.round(yp.reduce((s, p) => s + p.premium, 0) * 100) / 100,
      totalEstIncome: Math.round(yp.reduce((s, p) => s + p.estIncome, 0) * 100) / 100,
    };
  });

  return {
    kpi: { currentYear: latestYear, previousYear, current: getYearMetrics(latestYear), previous: getYearMetrics(previousYear) },
    premiumTrend, topCarriers, lobBreakdown, yoySummary, totalPeriods: premiumTrend.length,
  };
}

// ─── Build Income Report ─────────────────────────────────────────────────────

function buildIncomeReport(snapshots: ProcessedSnapshot[]) {
  // Find latest period
  let latestYear = 0, latestMonth = 0;
  let latestImport: Date | null = null;
  for (const s of snapshots) {
    if (s.year > latestYear || (s.year === latestYear && s.month > latestMonth)) {
      latestYear = s.year; latestMonth = s.month;
    }
  }

  const latestSnaps = snapshots.filter(s => s.year === latestYear && s.month === latestMonth);
  for (const s of latestSnaps) {
    if (!latestImport || s.importedAt > latestImport) latestImport = s.importedAt;
  }

  const carrierMap = new Map<string, { enrolledEmployees: Set<string>; monthlyPremium: number }>();

  for (const snap of latestSnaps) {
    for (const entry of snap.agg.values()) {
      let cm = carrierMap.get(entry.carrier);
      if (!cm) { cm = { enrolledEmployees: new Set(), monthlyPremium: 0 }; carrierMap.set(entry.carrier, cm); }
      cm.monthlyPremium += entry.premium;
      for (const empId of entry.enrolledSet) cm.enrolledEmployees.add(`${snap.clientCode}::${empId}`);
    }
  }

  const incomeRows: any[] = [];
  for (const cn of [...PEPM_CARRIERS, ...COMMISSION_CARRIERS]) {
    const data = carrierMap.get(cn);
    if (!data) continue;
    const isPEPM = PEPM_CARRIERS.includes(cn);
    const enrolled = data.enrolledEmployees.size;
    const premium = Math.round(data.monthlyPremium * 100) / 100;
    const monthlyIncome = Math.round((isPEPM ? enrolled * PEPM_RATE : premium * COMMISSION_RATE) * 100) / 100;
    incomeRows.push({
      carrier: cn, feeType: isPEPM ? "PEPM" : "Commission", enrolled, monthlyPremium: premium,
      rate: isPEPM ? `$${PEPM_RATE} PEPM` : `${COMMISSION_RATE * 100}%`,
      monthlyIncome, annualIncome: Math.round(monthlyIncome * 12 * 100) / 100,
    });
  }

  const totalMonthlyIncome = Math.round(incomeRows.reduce((s: number, r: any) => s + r.monthlyIncome, 0) * 100) / 100;

  return {
    rows: incomeRows,
    totals: { monthlyIncome: totalMonthlyIncome, annualIncome: Math.round(totalMonthlyIncome * 12 * 100) / 100 },
    dataPeriod: `${latestYear}-${String(latestMonth).padStart(2, "0")}`,
    lastUpload: latestImport?.toISOString() || null,
    audit: { pepmRate: PEPM_RATE, commissionRate: COMMISSION_RATE, pepmCarriers: PEPM_CARRIERS, commissionCarriers: COMMISSION_CARRIERS, note: "Enrolled counts and premiums match Benefits Report." },
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function rebuildAllCaches(): Promise<{ timings: Record<string, number> }> {
  const t0 = Date.now();
  const snapshots = await processAllSnapshots();
  const processTime = Date.now() - t0;

  const timings: Record<string, number> = { processSnapshots: processTime };

  // Build and store each report
  const reports: [string, () => any][] = [
    ["production", () => buildProductionReport(snapshots)],
    ["dashboard", () => buildDashboard(snapshots)],
    ["income", () => buildIncomeReport(snapshots)],
  ];

  for (const [key, builder] of reports) {
    const start = Date.now();
    const data = builder();
    const buildTime = Date.now() - start;
    timings[key] = buildTime;

    await prisma.reportCache.upsert({
      where: { key },
      create: { key, data: JSON.stringify(data), buildTimeMs: processTime + buildTime },
      update: { data: JSON.stringify(data), builtAt: new Date(), buildTimeMs: processTime + buildTime },
    });
  }

  return { timings };
}

export async function getCachedReport(key: string): Promise<any | null> {
  const cached = await prisma.reportCache.findUnique({ where: { key } });
  if (!cached) return null;
  try {
    return JSON.parse(cached.data);
  } catch {
    return null;
  }
}
