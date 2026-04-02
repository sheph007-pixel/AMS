import { prisma } from "@/lib/db";
import { getExclusionRules, isExcluded } from "@/lib/exclusions";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Report Cache — Pre-computes all report data and stores as JSON in the database.
 *
 * This replaces the expensive per-request processing of employee metadata.
 * Called once after each XML import, results are served instantly from cache.
 *
 * Mapping-driven resolution: If an active schema with field mappings exists,
 * getMappedField() uses mapping fallback chains. Otherwise falls back to
 * hardcoded getField() calls. Historical data continues to work either way
 * because metadata stores raw XML field values under their original names.
 */

const PEPM_RATE = 20;
const COMMISSION_RATE = 0.10;
const PEPM_CARRIERS = ["EBPA", "HealthEZ"];
const COMMISSION_CARRIERS = ["Guardian", "VSP"];
const BATCH_SIZE = 500;

// ─── Active Schema Resolution ───────────────────────────────────────────────

interface ActiveMappingLookup {
  byFieldName: Map<string, string[]>; // elementName → [primaryField, ...fallbacks]
}

async function loadActiveMappings(): Promise<ActiveMappingLookup | null> {
  const activeSchema = await prisma.schemaVersion.findFirst({
    where: { status: "active" },
    select: {
      mappings: {
        where: { active: true, included: true },
        select: { xmlPath: true, fallbackFields: true },
      },
    },
  });

  if (!activeSchema || activeSchema.mappings.length === 0) return null;

  const byFieldName = new Map<string, string[]>();
  for (const m of activeSchema.mappings) {
    const name = m.xmlPath.split(".").pop() || m.xmlPath;
    let fallbacks: string[] = [];
    try { fallbacks = m.fallbackFields ? JSON.parse(m.fallbackFields) : []; } catch { /* */ }
    byFieldName.set(name, [name, ...fallbacks]);
  }

  return { byFieldName };
}

/**
 * Mapping-aware field resolver. Tries active mapping's fallback chain first,
 * then falls back to the provided hardcoded keys.
 * Works for both historical data (hardcoded finds the value) and new data
 * (mapping chain may resolve to different/new field names).
 */
function getMappedField(
  obj: any,
  mappings: ActiveMappingLookup | null,
  primaryField: string,
  ...hardcodedFallbacks: string[]
): string | null {
  if (mappings) {
    const chain = mappings.byFieldName.get(primaryField);
    if (chain) {
      const result = getField(obj, ...chain);
      if (result) return result;
    }
  }
  // Fall back to hardcoded chain (works for historical data)
  return getField(obj, primaryField, ...hardcodedFallbacks);
}

// ─── Exported Helpers (used by report-audit.ts) ─────────────────────────────

export { findEnrollments, getField, qualifyEnrollment, getMappedField, loadActiveMappings };

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

function getField(obj: any, ...keys: string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "") return String(obj[key]);
    if (obj[`@_${key}`] !== undefined && obj[`@_${key}`] !== null) return String(obj[`@_${key}`]);
  }
  return null;
}

/**
 * Monthly Snapshot Enrollment Qualification.
 *
 * Each XML file is an as-of snapshot for a given month. The exact RunDate
 * (e.g. 15th or last day) is not preserved — we only store year + month.
 * Therefore we treat the snapshot as representing the FULL calendar month
 * and include any enrollment that was active at any point during that month.
 *
 * Date logic:
 *   monthStart = 1st of snapshot month (e.g. 2023-07-01)
 *   monthEnd   = last day of snapshot month (e.g. 2023-07-31)
 *
 *   An enrollment is active during the month if:
 *     CoverageStartDate <= monthEnd   (started before or during the month)
 *     CoverageEndDate   >= monthStart (hasn't ended before the month began)
 *
 * Example: July 2023 snapshot (monthStart=Jul 1, monthEnd=Jul 31)
 *   Starts Jul 10, no end     → include (10 <= 31 ✓, null ✓)
 *   Starts Jul 10, ends Jul 20 → include (10 <= 31 ✓, 20 >= 1 ✓)
 *   Starts Jul 10, ends Jun 30 → exclude (10 <= 31 ✓, 30 >= 1? Jun 30 < Jul 1 ✗)
 *   Starts Aug 5, no end      → exclude (Aug 5 <= Jul 31? ✗)
 *   Starts Jan 1, ends Jul 15 → include (1 <= 31 ✓, 15 >= 1 ✓)
 *
 * Other checks:
 * - EnrollmentType must be "current"/"active"/"enrolled" (if field exists)
 * - No DeclineReason
 * - No COBRA flag
 */
function qualifyEnrollment(enrollment: any, snapshotMonthStart?: Date): boolean {
  // Explicit type check — reject declined, cancelled, termed, waived
  const enrollmentType = getField(enrollment, "EnrollmentType", "enrollmentType", "Type");
  if (enrollmentType) {
    const t = enrollmentType.toLowerCase();
    if (t !== "current" && t !== "active" && t !== "enrolled") return false;
  }

  // Reject if decline reason is present
  const declineReason = getField(enrollment, "DeclineReason", "declineReason");
  if (declineReason) return false;

  // Reject enrollment-level COBRA
  const cobraFlag = getField(enrollment, "COBRAStatus", "IsCOBRA", "CobraIndicator");
  if (cobraFlag && cobraFlag.toLowerCase() !== "false" && cobraFlag !== "0") return false;

  // Date window: full calendar month
  const monthStart = snapshotMonthStart || new Date();
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0); // Last day of month

  // CoverageStartDate must be <= monthEnd (started before or during the month)
  const startDate = getField(enrollment, "CoverageStartDate", "EffectiveDate", "CoverageBeginDate", "StartDate");
  if (startDate) {
    const start = new Date(startDate);
    if (!isNaN(start.getTime()) && start > monthEnd) return false;
  }

  // CoverageEndDate must be null or >= monthStart (hasn't ended before the month)
  const endDate = getField(enrollment, "CoverageEndDate", "EndDate", "EndedOn", "TerminationDate");
  if (endDate) {
    const end = new Date(endDate);
    if (!isNaN(end.getTime()) && end < monthStart) return false;
  }

  return true;
}

function resolvePlan(
  enrollment: any,
  planIdMap: Map<string, { carrier: string; planType: string; planName: string }>,
  planNameMap: Map<string, { carrier: string; planType: string; planName: string }>
) {
  const enrollPlanId = getField(enrollment, "PlanIdentifier", "PlanId", "PlanID") || "";
  const enrollPlanName = getField(enrollment, "PlanName", "Plan", "Name") || "";
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
  const raw = getField(enrollment,
    "PlanCost", "MonthlyPlanCost", "TotalPremium", "Premium",
    "MonthlyPremium", "TotalMonthlyPremium", "Cost", "Rate"
  );
  if (!raw) return 0;
  const v = parseFloat(raw);
  return isNaN(v) || v <= 0 ? 0 : v;
}

// ─── Core Data Processing ────────────────────────────────────────────────────

interface AggEntry {
  carrier: string;
  planType: string;
  planName: string;
  eligible: number;
  enrolled: number;
  premium: number;
}

interface ProcessedSnapshot {
  year: number;
  month: number;
  clientName: string;
  clientCode: string;
  sicCode: string;
  state: string;
  importedAt: Date;
  agg: Map<string, AggEntry>;
}

/**
 * Core processing: reads BenefitPlan records directly for premium/enrollment data.
 *
 * BenefitPlan.premium, .enrollees, .eligible are computed during XML import using
 * full 8-field extraction (PlanCost, MonthlyPlanCost, TotalPremium, Premium, etc.)
 * and are the authoritative source of truth.
 *
 * This eliminates the need to re-parse employee enrollment metadata on every
 * cache rebuild — faster, simpler, and guaranteed to match import numbers.
 */
async function processAllSnapshots(): Promise<ProcessedSnapshot[]> {
  const exclusionRules = await getExclusionRules();
  // Carrier exclusion is managed via CarrierSetting (user UI), not ExclusionRule
  const nonCarrierRules = exclusionRules.filter(r => r.field !== "carrier");

  const snapshotList = await prisma.clientSnapshot.findMany({
    where: { year: { gte: 2022 } },
    select: {
      id: true, year: true, month: true, sicCode: true, state: true, importedAt: true,
      client: { select: { groupId: true, groupName: true } },
      benefitPlans: {
        select: { carrier: true, planType: true, planName: true, premium: true, enrollees: true, eligible: true },
      },
    },
    orderBy: [{ year: "asc" }, { month: "asc" }],
  });

  const results: ProcessedSnapshot[] = [];

  for (const snap of snapshotList) {
    if (isExcluded({ groupName: snap.client.groupName }, exclusionRules)) continue;

    const agg = new Map<string, AggEntry>();

    for (const bp of snap.benefitPlans) {
      if (isExcluded({ planName: bp.planName, planType: bp.planType }, nonCarrierRules)) continue;
      // Explicit COBRA exclusion — matches dashboard behavior
      if (bp.planType?.toLowerCase() === "cobra") continue;

      const carrier = bp.carrier || "Unspecified Carrier";
      const key = `${carrier}||${bp.planType}`;
      let entry = agg.get(key);
      if (!entry) {
        entry = { carrier, planType: bp.planType, planName: bp.planName || "", eligible: 0, enrolled: 0, premium: 0 };
        agg.set(key, entry);
      }

      entry.premium += bp.premium || 0;
      entry.enrolled += bp.enrollees || 0;
      entry.eligible += bp.eligible || 0;
    }

    if (agg.size === 0) continue;

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

function buildProductionReport(
  snapshots: ProcessedSnapshot[],
  csMap: Map<string, { incomeMethod: string; rate: number; excluded: boolean }>
) {
  const rows: any[] = [];
  const clientsSet = new Set<string>();
  const periodsSet = new Set<string>();
  let totalPremium = 0;
  let totalEstIncome = 0;
  let snapshotsProcessed = snapshots.length;

  for (const snap of snapshots) {
    // Skip invalid month-0 snapshots
    if (snap.month < 1 || snap.month > 12) continue;
    periodsSet.add(`${snap.year}-${String(snap.month).padStart(2, "0")}`);
    clientsSet.add(snap.clientCode);

    for (const entry of snap.agg.values()) {
      const enrolled = entry.enrolled;
      const premium = Math.round(entry.premium * 100) / 100;

      // Estimated Income from CarrierSetting table — matches dashboard/audit logic.
      // PEPM: enrolled x configured rate. PERCENT_PREMIUM: premium x configured rate.
      const setting = csMap.get(entry.carrier.toLowerCase());
      let feeType = "", rate = "", estMonthlyFee = 0;
      if (setting && setting.incomeMethod === "PEPM") {
        feeType = "PEPM"; rate = `$${setting.rate} PEPM`; estMonthlyFee = enrolled * setting.rate;
      } else if (setting && setting.incomeMethod === "PERCENT_PREMIUM") {
        feeType = "Commission"; rate = `${setting.rate}%`; estMonthlyFee = premium * (setting.rate / 100);
      }
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
        eligible: entry.eligible, enrolled,
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
      incomeSource: "CarrierSetting table (PEPM / PERCENT_PREMIUM / NONE per carrier)",
      note: "Premiums reflect monthly billing amounts from Employee Navigator. Estimated income uses carrier-specific rates from the CarrierSetting table. Actual collected revenue is tracked in Kennion/NIA financial statements and may differ due to timing, retro adjustments, and billing cycles.",
    },
  };
}

// ─── Build Dashboard ─────────────────────────────────────────────────────────

function buildDashboard(snapshots: ProcessedSnapshot[]) {
  const periodData = new Map<string, {
    year: number; month: number; clients: Set<string>;
    activeEmployees: number; premium: number; estIncome: number;
    carrierPremium: Map<string, number>; lobPremium: Map<string, number>;
  }>();

  let latestYear = 2022;
  for (const snap of snapshots) {
    // Skip invalid month-0 snapshots
    if (snap.month < 1 || snap.month > 12) continue;
    if (snap.year > latestYear) latestYear = snap.year;

    const key = `${snap.year}-${String(snap.month).padStart(2, "0")}`;
    let pd = periodData.get(key);
    if (!pd) {
      pd = { year: snap.year, month: snap.month, clients: new Set(), activeEmployees: 0, premium: 0, estIncome: 0, carrierPremium: new Map(), lobPremium: new Map() };
      periodData.set(key, pd);
    }
    pd.clients.add(snap.clientCode);

    // Track max enrolled per snapshot (best proxy for unique employees without double-counting across plans)
    let maxEnrolledThisSnap = 0;
    for (const entry of snap.agg.values()) {
      const enrolled = entry.enrolled;
      const premium = entry.premium;
      pd.premium += premium;
      pd.carrierPremium.set(entry.carrier, (pd.carrierPremium.get(entry.carrier) || 0) + premium);
      pd.lobPremium.set(entry.planType, (pd.lobPremium.get(entry.planType) || 0) + premium);

      const isPEPM = PEPM_CARRIERS.some(c => entry.carrier.toLowerCase().includes(c.toLowerCase()));
      const isComm = COMMISSION_CARRIERS.some(c => entry.carrier.toLowerCase().includes(c.toLowerCase()));
      if (isPEPM) pd.estIncome += enrolled * PEPM_RATE;
      else if (isComm) pd.estIncome += premium * COMMISSION_RATE;

      if (enrolled > maxEnrolledThisSnap) maxEnrolledThisSnap = enrolled;
    }
    pd.activeEmployees += maxEnrolledThisSnap;
  }

  const previousYear = latestYear - 1;

  const premiumTrend = Array.from(periodData.entries()).sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, pd]) => ({
      period, year: pd.year, month: pd.month,
      premium: Math.round(pd.premium * 100) / 100,
      clients: pd.clients.size,
      employees: pd.activeEmployees,
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

  const carrierMap = new Map<string, { enrolledCount: number; monthlyPremium: number }>();

  for (const snap of latestSnaps) {
    for (const entry of snap.agg.values()) {
      let cm = carrierMap.get(entry.carrier);
      if (!cm) { cm = { enrolledCount: 0, monthlyPremium: 0 }; carrierMap.set(entry.carrier, cm); }
      cm.monthlyPremium += entry.premium;
      cm.enrolledCount += entry.enrolled;
    }
  }

  const incomeRows: any[] = [];
  for (const cn of [...PEPM_CARRIERS, ...COMMISSION_CARRIERS]) {
    const data = carrierMap.get(cn);
    if (!data) continue;
    const isPEPM = PEPM_CARRIERS.includes(cn);
    const enrolled = data.enrolledCount;
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

// ─── Build Benefits Report ──────────────────────────────────────────────────

function classifyPlanType(planType: string): string {
  const t = planType.toLowerCase();
  if (t.includes("medical") || t.includes("health")) return "Medical";
  if (t.includes("dental")) return "Dental";
  if (t.includes("vision")) return "Vision";
  return "Supplemental";
}

function buildBenefitsReport(snapshots: ProcessedSnapshot[]) {
  // Find latest and previous periods
  let latestYear = 0, latestMonth = 0;
  for (const s of snapshots) {
    if (s.year > latestYear || (s.year === latestYear && s.month > latestMonth)) {
      latestYear = s.year; latestMonth = s.month;
    }
  }

  let prevYear = 0, prevMonth = 0;
  for (const s of snapshots) {
    if (s.year < latestYear || (s.year === latestYear && s.month < latestMonth)) {
      if (s.year > prevYear || (s.year === prevYear && s.month > prevMonth)) {
        prevYear = s.year; prevMonth = s.month;
      }
    }
  }

  const latestSnaps = snapshots.filter(s => s.year === latestYear && s.month === latestMonth);
  const prevSnaps = snapshots.filter(s => s.year === prevYear && s.month === prevMonth);

  let latestImportDate: Date | null = null;
  for (const s of latestSnaps) {
    if (!latestImportDate || s.importedAt > latestImportDate) latestImportDate = s.importedAt;
  }

  // Carrier-level aggregation
  const carrierMap = new Map<string, {
    carrier: string;
    eligibleCount: number;
    enrolledCount: number;
    monthlyPremium: number;
  }>();

  // Carrier → Set of clientCodes
  const carrierCompanies = new Map<string, Set<string>>();

  // Company info: groupName + max enrolled (best proxy for active employees)
  const companyInfo = new Map<string, { groupName: string; maxEnrolled: number; totalPremium: number }>();

  // Company-carrier detail
  const companyCarrierData = new Map<string, { enrolledCount: number; premium: number }>();

  // Company plan-type enrollment counts
  const companyPlanTypeCounts = new Map<string, Record<string, number>>();

  let totalCompanies = 0;

  for (const snap of latestSnaps) {
    totalCompanies++;
    const clientId = snap.clientCode;

    if (!companyInfo.has(clientId)) {
      companyInfo.set(clientId, { groupName: snap.clientName, maxEnrolled: 0, totalPremium: 0 });
    }

    for (const [, entry] of snap.agg) {
      const carrier = entry.carrier;
      const category = classifyPlanType(entry.planType);

      // Carrier companies
      if (!carrierCompanies.has(carrier)) carrierCompanies.set(carrier, new Set());
      carrierCompanies.get(carrier)!.add(clientId);

      // Carrier-level aggregation
      let cd = carrierMap.get(carrier);
      if (!cd) {
        cd = { carrier, eligibleCount: 0, enrolledCount: 0, monthlyPremium: 0 };
        carrierMap.set(carrier, cd);
      }
      cd.monthlyPremium += entry.premium;
      cd.enrolledCount += entry.enrolled;
      cd.eligibleCount += entry.eligible;

      // Track max enrolled per company (best proxy for active employee count)
      const ci = companyInfo.get(clientId)!;
      if (entry.enrolled > ci.maxEnrolled) ci.maxEnrolled = entry.enrolled;
      ci.totalPremium += entry.premium;

      // Company-carrier detail
      const ccKey = `${carrier}::${clientId}`;
      let ccd = companyCarrierData.get(ccKey);
      if (!ccd) { ccd = { enrolledCount: 0, premium: 0 }; companyCarrierData.set(ccKey, ccd); }
      ccd.premium += entry.premium;
      ccd.enrolledCount += entry.enrolled;

      // Company plan-type counts
      let cpt = companyPlanTypeCounts.get(clientId);
      if (!cpt) {
        cpt = { Medical: 0, Dental: 0, Vision: 0, Supplemental: 0 };
        companyPlanTypeCounts.set(clientId, cpt);
      }
      if (entry.enrolled > (cpt[category] || 0)) cpt[category] = entry.enrolled;
    }
  }

  // Build rows
  const rows = Array.from(carrierMap.values())
    .filter(e => e.eligibleCount > 0 || e.enrolledCount > 0)
    .map(e => ({
      carrier: e.carrier,
      groups: carrierCompanies.get(e.carrier)?.size || 0,
      eligible: e.eligibleCount,
      enrolled: e.enrolledCount,
      monthlyPremium: Math.round(e.monthlyPremium * 100) / 100,
    }))
    .sort((a, b) => b.monthlyPremium - a.monthlyPremium);

  const totals = {
    groups: totalCompanies,
    eligible: rows.reduce((s, r) => s + r.eligible, 0),
    enrolled: rows.reduce((s, r) => s + r.enrolled, 0),
    monthlyPremium: Math.round(rows.reduce((s, r) => s + r.monthlyPremium, 0) * 100) / 100,
  };

  // Reconciliation
  const carrierAudit = Array.from(carrierMap.values())
    .filter(e => e.eligibleCount > 0 || e.enrolledCount > 0)
    .map(e => ({
      carrier: e.carrier,
      eligible: e.eligibleCount,
      enrolled: e.enrolledCount,
      enrollmentRows: e.enrolledCount,
      monthlyPremium: Math.round(e.monthlyPremium * 100) / 100,
    }))
    .sort((a, b) => b.monthlyPremium - a.monthlyPremium);

  const companyEligibility: any[] = [];
  for (const [carrier, clientIds] of carrierCompanies) {
    for (const clientId of clientIds) {
      const info = companyInfo.get(clientId);
      if (!info) continue;
      companyEligibility.push({
        carrier, companyId: clientId, companyName: info.groupName,
        activeEmployees: info.maxEnrolled, hasCarrierPlan: true,
        eligibleContributed: info.maxEnrolled,
      });
    }
  }
  companyEligibility.sort((a: any, b: any) => a.carrier.localeCompare(b.carrier) || a.companyName.localeCompare(b.companyName));

  const companyEnrollment: any[] = [];
  for (const [key, data] of companyCarrierData) {
    const [carrier, clientId] = key.split("::");
    const info = companyInfo.get(clientId);
    companyEnrollment.push({
      carrier, companyId: clientId, companyName: info?.groupName || clientId,
      enrolled: data.enrolledCount, enrollmentRows: data.enrolledCount,
      premium: Math.round(data.premium * 100) / 100,
    });
  }
  companyEnrollment.sort((a: any, b: any) => b.premium - a.premium);

  // Company plan types
  const companyPlanTypes: Record<string, any> = {};
  for (const [clientId, info] of companyInfo) {
    const planTypes = companyPlanTypeCounts.get(clientId);
    companyPlanTypes[clientId] = {
      activeEmployees: info.maxEnrolled,
      medical: planTypes?.Medical ?? 0,
      dental: planTypes?.Dental ?? 0,
      vision: planTypes?.Vision ?? 0,
      supplemental: planTypes?.Supplemental ?? 0,
      premium: Math.round(info.totalPremium * 100) / 100,
    };
  }

  // YoY from previous period
  let prevTotalCompanies = 0, prevTotalActiveEmployees = 0, prevTotalPremium = 0;
  for (const snap of prevSnaps) {
    prevTotalCompanies++;
    let maxEnrolled = 0;
    for (const entry of snap.agg.values()) {
      prevTotalPremium += entry.premium;
      if (entry.enrolled > maxEnrolled) maxEnrolled = entry.enrolled;
    }
    prevTotalActiveEmployees += maxEnrolled;
  }

  const totalActiveEmployees = Array.from(companyInfo.values()).reduce((s, c) => s + c.maxEnrolled, 0);
  const dataPeriod = `${latestYear}-${String(latestMonth).padStart(2, "0")}`;
  const prevPeriod = prevYear > 0 ? `${prevYear}-${String(prevMonth).padStart(2, "0")}` : null;

  return {
    rows, totals,
    lastUpload: latestImportDate?.toISOString() || null,
    dataPeriod,
    reconciliation: {
      totalActiveEmployees, totalCompanies,
      totalPlansInMap: 0,
      carrierAudit, companyEligibility, companyEnrollment,
      exceptions: { missingPlanIdentifier: 0, unmatchedPlanIdentifier: 0, fallbackPlanNameMatch: 0, currentEnrollmentsWithEndDate: 0, blankOrInvalidPlanCost: 0 },
    },
    companyPlanTypes,
    yoy: {
      currentYear: latestYear, previousYear: prevYear || null,
      currentPeriod: dataPeriod, previousPeriod: prevPeriod,
      current: { activeGroups: totalCompanies, activeEmployees: totalActiveEmployees, premium: totals.monthlyPremium },
      previous: { activeGroups: prevTotalCompanies, activeEmployees: prevTotalActiveEmployees, premium: Math.round(prevTotalPremium * 100) / 100 },
    },
  };
}

// ─── Build Production Dashboard (Tier-Level Detail) ─────────────────────────

/**
 * Processes employee enrollment metadata ONE snapshot at a time to build
 * per-plan, per-coverage-tier rows. This is memory-safe because we only
 * load one snapshot's employees at a time, then discard before the next.
 */
async function buildProductionDashboard(): Promise<any> {
  const exclusionRules = await getExclusionRules();
  // Carrier exclusion is handled by CarrierSetting.excluded (user-managed UI toggle).
  // Filter out carrier-field ExclusionRules so they don't override CarrierSetting.
  const nonCarrierRules = exclusionRules.filter(r => r.field !== "carrier");

  // Load active schema mappings (null if no active schema)
  const activeMappings = await loadActiveMappings();

  // Load carrier settings (includes exclusion flag)
  const carrierSettings = await prisma.carrierSetting.findMany();
  const csMap = new Map<string, { incomeMethod: string; rate: number; excluded: boolean }>();
  for (const cs of carrierSettings) {
    csMap.set(cs.carrierName.toLowerCase(), { incomeMethod: cs.incomeMethod, rate: cs.rate, excluded: cs.excluded });
  }

  // Load lightweight snapshot list (NO employee data yet)
  const snapshotList = await prisma.clientSnapshot.findMany({
    where: { year: { gte: 2022 } },
    select: {
      id: true, year: true, month: true,
      client: { select: { groupId: true, groupName: true } },
      benefitPlans: {
        select: { planType: true, carrier: true, planName: true, metadata: true },
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

  // Process each snapshot individually
  for (const snap of snapshotList) {
    if (isExcluded({ groupName: snap.client.groupName }, exclusionRules)) continue;
    // Skip invalid month-0 snapshots (month not detected during import)
    if (snap.month < 1 || snap.month > 12) continue;

    const period = `${snap.year}-${String(snap.month).padStart(2, "0")}`;
    const snapshotMonthStart = new Date(snap.year, snap.month - 1, 1);

    // Build plan lookup
    const planIdMap = new Map<string, { carrier: string; planType: string; planName: string; policyNumber: string }>();
    const planNameMap = new Map<string, { carrier: string; planType: string; planName: string; policyNumber: string }>();
    let hasPlans = false;

    for (const bp of snap.benefitPlans) {
      if (isExcluded({ planName: bp.planName, planType: bp.planType }, nonCarrierRules)) continue;
      if (bp.planType?.toLowerCase() === "cobra") continue;
      // Carrier exclusion from CarrierSetting (single source of truth for carriers)
      if (bp.carrier && csMap.get(bp.carrier.toLowerCase())?.excluded) continue;

      let planMeta: any = {};
      try { planMeta = bp.metadata ? JSON.parse(bp.metadata) : {}; } catch { /* */ }

      const policyNumber = getMappedField(planMeta, activeMappings,
        "PolicyNumber", "GroupPolicyNumber", "GroupNumber",
        "ContractNumber", "PlanNumber", "CertificateNumber",
        "CarrierPlanNumber", "CarrierGroupNumber", "InsurancePolicyNumber"
      ) || "";

      const info = { carrier: bp.carrier || "Unspecified", planType: bp.planType || "Unknown", planName: bp.planName || "", policyNumber };
      const planIdentifier = getMappedField(planMeta, activeMappings, "PlanIdentifier", "PlanId", "PlanID") || "";
      if (planIdentifier) planIdMap.set(planIdentifier, info);
      if (bp.planName) planNameMap.set(bp.planName, info);
      hasPlans = true;

      // Register carrier in filters even before enrollment matching —
      // ensures all non-excluded carriers with plan data show in the dropdown
      carriersSet.add(info.carrier);
      if (info.planType) coverageTypesSet.add(info.planType);
    }

    if (!hasPlans) continue;

    // Load employees for THIS snapshot only (memory-safe batch)
    const employees = await prisma.employeeSnapshot.findMany({
      where: { clientSnapshotId: snap.id },
      select: { employeeId: true, status: true, metadata: true },
    });

    // ── Monthly Snapshot Enrollment Aggregation ──
    // This is a point-in-time snapshot: each month is independent.
    // The same employee appearing in Jan and Feb is two separate monthly counts.
    // We do NOT deduplicate across months — multi-month totals reflect enrollment-months.
    //
    // Within a single monthly snapshot, dedupe on:
    //   employee (outer loop) + plan + coverage tier (dedupeKey)
    // This prevents double-counting if the same employee has duplicate enrollment
    // records for the same plan+tier within one month.

    const tierAgg = new Map<string, {
      carrier: string; planType: string; planName: string; policyNumber: string;
      grouping: string; rates: number[]; benefitAmounts: number[];
      lives: number; totalPremium: number;
    }>();

    for (const emp of employees) {
      // Exclude termed employees — only active employees in this snapshot
      if ((emp.status || "Active").toLowerCase() !== "active") continue;

      let empMeta: any;
      try { empMeta = emp.metadata ? JSON.parse(emp.metadata) : null; } catch { continue; }
      if (!empMeta) continue;

      const enrollments = findEnrollments(empMeta);
      // Per-employee dedupe set: prevents counting same employee twice
      // for the same plan+tier within this monthly snapshot
      const seen = new Set<string>();

      for (const enrollment of enrollments) {
        // Active enrollment filter: checks type, decline, COBRA, effective date, end date
        if (!qualifyEnrollment(enrollment, snapshotMonthStart)) continue;

        // Resolve plan from enrollment fields
        const enrollPlanId = getMappedField(enrollment, activeMappings, "PlanIdentifier", "PlanId", "PlanID") || "";
        const enrollPlanName = getMappedField(enrollment, activeMappings, "PlanName", "Plan", "Name") || "";
        const planKey = enrollPlanId || enrollPlanName;
        if (!planKey) continue;

        const planInfo = (enrollPlanId && planIdMap.get(enrollPlanId))
          || (enrollPlanName && planNameMap.get(enrollPlanName))
          || null;
        if (!planInfo) continue;

        // CoverageLevel / Grouping from enrollment
        const coverageLevel = getMappedField(enrollment, activeMappings, "CoverageLevel") || "Employee";

        // Dedupe: employee + plan + tier within this monthly snapshot
        const dedupeKey = `${planKey}||${coverageLevel}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        const parseAmt = (raw: string | null) => {
          if (!raw) return 0;
          const v = parseFloat(raw);
          return isNaN(v) || v <= 0 ? 0 : v;
        };

        const planCost = parseAmt(getMappedField(enrollment, activeMappings,
          "PlanCost", "MonthlyPlanCost", "TotalPremium", "Premium",
          "MonthlyPremium", "TotalMonthlyPremium", "Cost"));

        const rate = parseAmt(getMappedField(enrollment, activeMappings,
          "Rate", "EmployeeRate", "MonthlyRate", "PlanRate", "TierRate",
          "PlanCost", "MonthlyPlanCost", "Premium"));

        const benefitAmt = parseAmt(getMappedField(enrollment, activeMappings,
          "BenefitAmount", "CoverageAmount", "Volume", "Amount",
          "FaceAmount", "BenefitVolume", "ApprovedAmount"));

        const aggKey = `${planInfo.policyNumber || planKey}||${planInfo.planName}||${coverageLevel}`;
        let agg = tierAgg.get(aggKey);
        if (!agg) {
          agg = {
            carrier: planInfo.carrier, planType: planInfo.planType,
            planName: planInfo.planName, policyNumber: planInfo.policyNumber,
            grouping: coverageLevel, rates: [], benefitAmounts: [],
            lives: 0, totalPremium: 0,
          };
          tierAgg.set(aggKey, agg);
        }
        agg.lives += 1;
        agg.totalPremium += planCost;
        if (rate > 0) agg.rates.push(rate);
        if (benefitAmt > 0) agg.benefitAmounts.push(benefitAmt);
      }
    }

    // Convert to rows
    for (const agg of tierAgg.values()) {
      // Mode of rates
      let tierRate = 0;
      if (agg.rates.length > 0) {
        const freq = new Map<number, number>();
        for (const r of agg.rates) { const rd = Math.round(r * 1000) / 1000; freq.set(rd, (freq.get(rd) || 0) + 1); }
        let mf = 0; for (const [r, f] of freq) { if (f > mf) { mf = f; tierRate = r; } }
      }

      let benefitAmount = 0;
      if (agg.benefitAmounts.length > 0) {
        const freq = new Map<number, number>();
        for (const a of agg.benefitAmounts) { freq.set(a, (freq.get(a) || 0) + 1); }
        let mf = 0; for (const [a, f] of freq) { if (f > mf) { mf = f; benefitAmount = a; } }
      }

      const monthlyPremium = Math.round(agg.totalPremium * 100) / 100;
      const lives = agg.lives;
      const carrier = agg.carrier;

      // Estimated Income is calculated from enrollment-derived premium and carrier settings.
      // PEPM: lives x configured rate. PERCENT_PREMIUM: premium x configured rate.
      // This is an operational estimate and may not reconcile to accounting systems.
      const setting = csMap.get(carrier.toLowerCase());
      let incomeMethod = "NONE", feeRate = 0, income = 0;
      if (setting) {
        incomeMethod = setting.incomeMethod;
        feeRate = setting.rate;
        if (incomeMethod === "PEPM") income = Math.round(lives * feeRate * 100) / 100;
        else if (incomeMethod === "PERCENT_PREMIUM") income = Math.round(monthlyPremium * (feeRate / 100) * 100) / 100;
      }

      periodsSet.add(period);
      carriersSet.add(carrier);
      clientsSet.add(snap.client.groupName);
      coverageTypesSet.add(agg.planType);
      if (agg.policyNumber) policyNumbersSet.add(agg.policyNumber);

      rows.push({
        m: period, y: snap.year, mn: snap.month,
        cn: snap.client.groupName, cc: snap.client.groupId,
        ca: carrier, pn: agg.policyNumber, pl: agg.planName,
        g: agg.grouping, r: tierRate, l: lives, ba: benefitAmount,
        mp: monthlyPremium, im: incomeMethod, fr: feeRate,
        i: income, ct: agg.planType,
      });
    }
  }

  const sortedPeriods = Array.from(periodsSet).sort().reverse(); // New → old for dropdown
  const fiscalYears = Array.from(new Set(sortedPeriods.map(p => parseInt(p.split("-")[0])))).sort((a, b) => b - a);

  return {
    rows,
    summary: {
      totalRows: rows.length,
      totalPremium: Math.round(rows.reduce((s: number, r: any) => s + r.monthlyPremium, 0) * 100) / 100,
      totalIncome: Math.round(rows.reduce((s: number, r: any) => s + r.income, 0) * 100) / 100,
      totalLives: rows.reduce((s: number, r: any) => s + r.lives, 0),
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
      id: cs.id, carrierName: cs.carrierName,
      incomeMethod: cs.incomeMethod, rate: cs.rate,
      excluded: cs.excluded,
    })),
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function rebuildAllCaches(): Promise<{ timings: Record<string, number> }> {
  const t0 = Date.now();
  const snapshots = await processAllSnapshots();
  const processTime = Date.now() - t0;

  // Load carrier settings for income calculation (used by production report)
  const carrierSettings = await prisma.carrierSetting.findMany();
  const csMap = new Map<string, { incomeMethod: string; rate: number; excluded: boolean }>();
  for (const cs of carrierSettings) {
    csMap.set(cs.carrierName.toLowerCase(), { incomeMethod: cs.incomeMethod, rate: cs.rate, excluded: cs.excluded });
  }

  const timings: Record<string, number> = { processSnapshots: processTime };

  // Build lightweight reports from pre-aggregated data (CPU-bound, no I/O)
  const builders: [string, () => any][] = [
    ["production", () => buildProductionReport(snapshots, csMap)],
    ["dashboard", () => buildDashboard(snapshots)],
    ["income", () => buildIncomeReport(snapshots)],
    ["benefits", () => buildBenefitsReport(snapshots)],
  ];

  const built = builders.map(([key, builder]) => {
    const start = Date.now();
    const data = builder();
    timings[key] = Date.now() - start;
    return { key, data };
  });

  // Build production dashboard separately (requires I/O for employee metadata)
  const pdStart = Date.now();
  const pdData = await buildProductionDashboard();
  timings["production-dashboard"] = Date.now() - pdStart;
  built.push({ key: "production-dashboard", data: pdData });

  // Store all reports in parallel (I/O-bound)
  await Promise.all(
    built.map(({ key, data }) =>
      prisma.reportCache.upsert({
        where: { key },
        create: { key, data: JSON.stringify(data), buildTimeMs: processTime + (timings[key] || 0) },
        update: { data: JSON.stringify(data), builtAt: new Date(), buildTimeMs: processTime + (timings[key] || 0) },
      })
    )
  );

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
