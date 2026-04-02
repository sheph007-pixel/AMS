import { prisma } from "@/lib/db";
import { getExclusionRules, isExcluded } from "@/lib/exclusions";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Report Audit — Deterministic verification + independent recomputation.
 *
 * This is the PRIMARY audit system. AI review is optional and advisory only.
 *
 * Two layers:
 * 1. Rule-based checks: structural consistency, exclusion enforcement, data quality
 * 2. Independent recomputation: rebuilds totals from raw DB data, compares to report cache
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AuditCheck {
  name: string;
  status: "pass" | "fail" | "warning" | "needs_review";
  message: string;
  expected?: string | number;
  actual?: string | number;
}

export interface MonthSubtotal {
  rows: number;
  lives: number;
  premium: number;
  income: number;
}

export interface EntitySubtotal {
  name: string;
  rows: number;
  lives: number;
  premium: number;
  income: number;
}

export interface AuditResult {
  status: "verified" | "warning" | "needs_review";
  checks: AuditCheck[];
  checksRun: number;
  checksPassed: number;
  checksFailed: number;

  reportTotals: { rows: number; lives: number; premium: number; income: number };
  auditTotals: { rows: number; lives: number; premium: number; income: number };
  variances: { rows: number; lives: number; premium: number; income: number };

  monthSubtotals: Record<string, MonthSubtotal>;
  clientSubtotals: EntitySubtotal[];
  carrierSubtotals: EntitySubtotal[];
}

// ─── Tolerance ──────────────────────────────────────────────────────────────

const PREMIUM_TOLERANCE = 0.01; // $0.01 rounding tolerance
const INCOME_TOLERANCE = 0.01;

// ─── Main Audit Runner ──────────────────────────────────────────────────────

export async function runProductionAudit(reportType: string = "production-dashboard"): Promise<AuditResult> {
  const checks: AuditCheck[] = [];

  // Load the cached report
  const cache = await prisma.reportCache.findUnique({ where: { key: reportType } });
  if (!cache) {
    checks.push({ name: "cache-exists", status: "fail", message: "Report cache not found" });
    return buildResult(checks, zeroes(), zeroes(), {}, [], []);
  }

  let reportData: any;
  try {
    reportData = JSON.parse(cache.data);
  } catch {
    checks.push({ name: "cache-parse", status: "fail", message: "Report cache data is not valid JSON" });
    return buildResult(checks, zeroes(), zeroes(), {}, [], []);
  }

  checks.push({ name: "cache-exists", status: "pass", message: "Report cache found and parseable" });

  // Extract report-side totals
  const reportRows: any[] = reportData.rows || [];
  const reportTotals = computeTotalsFromRows(reportRows, reportType);

  // ── Layer 1: Deterministic Rule Checks ──────────────────────────────

  // Check 1: Row count consistency
  const reportedRowCount = reportData.summary?.totalRows ?? reportRows.length;
  checks.push({
    name: "row-count-consistency",
    status: reportedRowCount === reportRows.length ? "pass" : "fail",
    message: reportedRowCount === reportRows.length
      ? `Row count matches: ${reportRows.length}`
      : `Summary says ${reportedRowCount} rows but data has ${reportRows.length}`,
    expected: reportedRowCount,
    actual: reportRows.length,
  });

  // Check 2: No month-0 rows
  const month0Rows = reportRows.filter((r: any) => {
    const m = r.mn ?? r.month;
    return m === 0 || m === undefined || m === null;
  });
  checks.push({
    name: "no-month-zero",
    status: month0Rows.length === 0 ? "pass" : "fail",
    message: month0Rows.length === 0
      ? "No month-0 rows found"
      : `Found ${month0Rows.length} rows with month=0 (invalid)`,
    expected: 0,
    actual: month0Rows.length,
  });

  // Check 3: No COBRA rows
  const cobraRows = reportRows.filter((r: any) => {
    const ct = (r.ct || r.coverageType || r.planType || r.lineOfBusiness || "").toLowerCase();
    return ct === "cobra";
  });
  checks.push({
    name: "no-cobra-rows",
    status: cobraRows.length === 0 ? "pass" : "fail",
    message: cobraRows.length === 0
      ? "No COBRA rows in report"
      : `Found ${cobraRows.length} COBRA rows that should have been excluded`,
    expected: 0,
    actual: cobraRows.length,
  });

  // Check 4: No negative premiums
  const negPremiums = reportRows.filter((r: any) => (r.mp ?? r.monthlyPremium ?? 0) < 0);
  checks.push({
    name: "no-negative-premium",
    status: negPremiums.length === 0 ? "pass" : "warning",
    message: negPremiums.length === 0
      ? "No negative premium values"
      : `Found ${negPremiums.length} rows with negative premium`,
    expected: 0,
    actual: negPremiums.length,
  });

  // Check 5: No negative lives
  const negLives = reportRows.filter((r: any) => (r.l ?? r.lives ?? r.enrolled ?? 0) < 0);
  checks.push({
    name: "no-negative-lives",
    status: negLives.length === 0 ? "pass" : "fail",
    message: negLives.length === 0
      ? "No negative lives counts"
      : `Found ${negLives.length} rows with negative lives`,
    expected: 0,
    actual: negLives.length,
  });

  // Check 6: No null/zero rate where income > 0
  const badRateRows = reportRows.filter((r: any) => {
    const income = r.i ?? r.income ?? r.estMonthlyFee ?? 0;
    const rate = r.fr ?? r.rate ?? 0;
    return income > 0 && (rate === 0 || rate === null || rate === undefined);
  });
  checks.push({
    name: "rate-income-consistency",
    status: badRateRows.length === 0 ? "pass" : "warning",
    message: badRateRows.length === 0
      ? "All income rows have a configured rate"
      : `${badRateRows.length} rows have income > 0 but rate = 0 or null`,
    expected: 0,
    actual: badRateRows.length,
  });

  // Check 7: Required fields present
  const missingCarrier = reportRows.filter((r: any) => !(r.ca || r.carrier));
  const missingClient = reportRows.filter((r: any) => !(r.cn || r.clientName));
  const missingFieldCount = missingCarrier.length + missingClient.length;
  checks.push({
    name: "required-fields-present",
    status: missingFieldCount === 0 ? "pass" : "warning",
    message: missingFieldCount === 0
      ? "All rows have carrier and client name"
      : `Missing: ${missingCarrier.length} carrier, ${missingClient.length} client name`,
    expected: 0,
    actual: missingFieldCount,
  });

  // Check 8: Duplicate detection (same client+month+plan+tier)
  const dupeSet = new Set<string>();
  let dupeCount = 0;
  for (const r of reportRows) {
    const key = [
      r.cn || r.clientName, r.m || r.transactionDate,
      r.pl || r.planName, r.g || r.grouping || r.coverageType,
      r.pn || r.policyNumber,
    ].join("||");
    if (dupeSet.has(key)) dupeCount++;
    else dupeSet.add(key);
  }
  checks.push({
    name: "no-duplicate-rows",
    status: dupeCount === 0 ? "pass" : "warning",
    message: dupeCount === 0
      ? "No duplicate client+month+plan+tier rows"
      : `Found ${dupeCount} potential duplicate rows`,
    expected: 0,
    actual: dupeCount,
  });

  // Check 9: Carrier exclusion enforcement
  const carrierSettings = await prisma.carrierSetting.findMany({ where: { excluded: true } });
  const excludedCarriers = new Set(carrierSettings.map(cs => cs.carrierName.toLowerCase()));
  const excludedInReport = reportRows.filter((r: any) => {
    const carrier = (r.ca || r.carrier || "").toLowerCase();
    return excludedCarriers.has(carrier);
  });
  checks.push({
    name: "excluded-carriers-absent",
    status: excludedInReport.length === 0 ? "pass" : "fail",
    message: excludedInReport.length === 0
      ? `All ${excludedCarriers.size} excluded carriers correctly absent`
      : `Found ${excludedInReport.length} rows from excluded carriers`,
    expected: 0,
    actual: excludedInReport.length,
  });

  // Check 10: Exclusion rules enforcement
  const exclusionRules = await getExclusionRules();
  let exclusionViolations = 0;
  for (const r of reportRows) {
    if (isExcluded({
      carrier: r.ca || r.carrier,
      planName: r.pl || r.planName,
      planType: r.ct || r.planType || r.lineOfBusiness,
    }, exclusionRules)) {
      exclusionViolations++;
    }
  }
  checks.push({
    name: "exclusion-rules-enforced",
    status: exclusionViolations === 0 ? "pass" : "fail",
    message: exclusionViolations === 0
      ? "All exclusion rules properly enforced"
      : `Found ${exclusionViolations} rows violating exclusion rules`,
    expected: 0,
    actual: exclusionViolations,
  });

  // ── Layer 2: Independent Recomputation ──────────────────────────────
  //
  // The production-dashboard cache uses tier-level enrollment aggregation
  // (employee metadata → per plan+tier). Independent recomputation uses
  // plan-level BenefitPlan records. These are different aggregation levels:
  // - Dashboard: one row per plan+tier per client per month
  // - BenefitPlan: one row per plan per client per month
  //
  // We compare against the "production" cache (plan-level) for exact match,
  // and cross-check dashboard totals at the aggregate level (premium/income
  // should be close but rows/lives will differ due to tier breakdown).

  // Load the production (plan-level) cache for exact comparison
  const prodCache = await prisma.reportCache.findUnique({ where: { key: "production" } });
  let prodRows: any[] = [];
  if (prodCache) {
    try {
      const prodData = JSON.parse(prodCache.data);
      prodRows = prodData.rows || [];
    } catch { /* */ }
  }

  const { auditTotals, monthSubtotals, clientSubtotals, carrierSubtotals } =
    await recomputeTotals();

  // For comparison, use plan-level production cache totals if available,
  // otherwise fall back to the dashboard report totals
  const comparisonTotals = prodRows.length > 0
    ? computeTotalsFromRows(prodRows, "production")
    : reportTotals;
  const comparisonLabel = prodRows.length > 0 ? "plan-level" : "report";

  // Check 11: Row count
  checks.push({
    name: "recompute-row-count",
    status: auditTotals.rows === comparisonTotals.rows ? "pass" : "warning",
    message: auditTotals.rows === comparisonTotals.rows
      ? `Plan-level row count matches: ${auditTotals.rows}`
      : `${comparisonLabel} has ${comparisonTotals.rows} rows, recomputation found ${auditTotals.rows}`,
    expected: comparisonTotals.rows,
    actual: auditTotals.rows,
  });

  // Check 12: Lives
  checks.push({
    name: "recompute-lives",
    status: auditTotals.lives === comparisonTotals.lives ? "pass" : "warning",
    message: auditTotals.lives === comparisonTotals.lives
      ? `Lives match: ${auditTotals.lives}`
      : `${comparisonLabel} lives ${comparisonTotals.lives}, recomputed ${auditTotals.lives}`,
    expected: comparisonTotals.lives,
    actual: auditTotals.lives,
  });

  // Check 13: Premium within tolerance
  const premVariance = Math.abs(auditTotals.premium - comparisonTotals.premium);
  checks.push({
    name: "recompute-premium",
    status: premVariance <= PREMIUM_TOLERANCE ? "pass" : "needs_review",
    message: premVariance <= PREMIUM_TOLERANCE
      ? `Premium matches within $${PREMIUM_TOLERANCE} tolerance`
      : `Premium variance: $${premVariance.toFixed(2)} (${comparisonLabel} $${comparisonTotals.premium.toFixed(2)}, audit $${auditTotals.premium.toFixed(2)})`,
    expected: comparisonTotals.premium,
    actual: auditTotals.premium,
  });

  // Check 14: Income within tolerance
  const incVariance = Math.abs(auditTotals.income - comparisonTotals.income);
  checks.push({
    name: "recompute-income",
    status: incVariance <= INCOME_TOLERANCE ? "pass" : "needs_review",
    message: incVariance <= INCOME_TOLERANCE
      ? `Estimated income matches within $${INCOME_TOLERANCE} tolerance`
      : `Income variance: $${incVariance.toFixed(2)} (${comparisonLabel} $${comparisonTotals.income.toFixed(2)}, audit $${auditTotals.income.toFixed(2)})`,
    expected: comparisonTotals.income,
    actual: auditTotals.income,
  });

  // Check 15: Month coverage
  const reportMonths = new Set<string>();
  for (const r of reportRows) {
    const m = r.m || r.transactionDate || "";
    if (m) reportMonths.add(typeof m === "string" ? m.substring(0, 7) : m);
  }
  const auditMonths = Object.keys(monthSubtotals);
  const missingMonths = auditMonths.filter(m => !reportMonths.has(m));
  checks.push({
    name: "month-coverage",
    status: missingMonths.length === 0 ? "pass" : "warning",
    message: missingMonths.length === 0
      ? `All ${auditMonths.length} months present in report`
      : `${missingMonths.length} months in data but not in report: ${missingMonths.join(", ")}`,
    expected: auditMonths.length,
    actual: reportMonths.size,
  });

  // Check 16: Cross-check dashboard premium against plan-level premium
  // These should be close (same underlying data, different aggregation)
  if (prodRows.length > 0 && reportType === "production-dashboard") {
    const dashPremium = reportTotals.premium;
    const planPremium = comparisonTotals.premium;
    const crossVariance = Math.abs(dashPremium - planPremium);
    const pctVariance = planPremium > 0 ? (crossVariance / planPremium) * 100 : 0;
    checks.push({
      name: "cross-check-premium",
      status: pctVariance <= 5 ? "pass" : pctVariance <= 15 ? "warning" : "needs_review",
      message: pctVariance <= 5
        ? `Dashboard vs plan-level premium within ${pctVariance.toFixed(1)}%`
        : `Dashboard premium $${dashPremium.toFixed(2)} vs plan-level $${planPremium.toFixed(2)} (${pctVariance.toFixed(1)}% variance)`,
      expected: planPremium,
      actual: dashPremium,
    });
  }

  return buildResult(checks, reportTotals, auditTotals, monthSubtotals, clientSubtotals, carrierSubtotals);
}

// ─── Independent Recomputation ──────────────────────────────────────────────

/**
 * Recompute report totals from raw database data, independent of cache.
 * Uses the same data source (ClientSnapshot + BenefitPlan) but a separate code path.
 */
async function recomputeTotals() {
  const exclusionRules = await getExclusionRules();
  const carrierSettings = await prisma.carrierSetting.findMany();
  const csMap = new Map(carrierSettings.map(cs => [
    cs.carrierName.toLowerCase(),
    { incomeMethod: cs.incomeMethod, rate: cs.rate, excluded: cs.excluded },
  ]));

  const snapshots = await prisma.clientSnapshot.findMany({
    where: { year: { gte: 2022 }, month: { gte: 1, lte: 12 } },
    select: {
      id: true, year: true, month: true,
      client: { select: { groupId: true, groupName: true } },
      benefitPlans: {
        select: { carrier: true, planType: true, planName: true, premium: true, enrollees: true, eligible: true },
      },
    },
    orderBy: [{ year: "asc" }, { month: "asc" }],
  });

  const monthSubtotals: Record<string, MonthSubtotal> = {};
  const clientMap = new Map<string, EntitySubtotal>();
  const carrierMap = new Map<string, EntitySubtotal>();
  let totalRows = 0, totalLives = 0, totalPremium = 0, totalIncome = 0;

  for (const snap of snapshots) {
    if (isExcluded({ groupName: snap.client.groupName }, exclusionRules)) continue;

    const period = `${snap.year}-${String(snap.month).padStart(2, "0")}`;

    for (const bp of snap.benefitPlans) {
      if (isExcluded({ carrier: bp.carrier, planName: bp.planName, planType: bp.planType }, exclusionRules)) continue;
      if (bp.planType?.toLowerCase() === "cobra") continue;
      if (bp.carrier && csMap.get(bp.carrier.toLowerCase())?.excluded) continue;

      const carrier = bp.carrier || "Unspecified";
      const lives = bp.enrollees || 0;
      const premium = round2(bp.premium || 0);

      // Compute income from carrier settings
      const setting = csMap.get(carrier.toLowerCase());
      let income = 0;
      if (setting) {
        if (setting.incomeMethod === "PEPM") income = round2(lives * setting.rate);
        else if (setting.incomeMethod === "PERCENT_PREMIUM") income = round2(premium * (setting.rate / 100));
      }

      totalRows++;
      totalLives += lives;
      totalPremium += premium;
      totalIncome += income;

      // Month subtotals
      if (!monthSubtotals[period]) monthSubtotals[period] = { rows: 0, lives: 0, premium: 0, income: 0 };
      monthSubtotals[period].rows++;
      monthSubtotals[period].lives += lives;
      monthSubtotals[period].premium += premium;
      monthSubtotals[period].income += income;

      // Client subtotals
      const clientName = snap.client.groupName;
      let cs = clientMap.get(clientName);
      if (!cs) { cs = { name: clientName, rows: 0, lives: 0, premium: 0, income: 0 }; clientMap.set(clientName, cs); }
      cs.rows++; cs.lives += lives; cs.premium += premium; cs.income += income;

      // Carrier subtotals
      let cr = carrierMap.get(carrier);
      if (!cr) { cr = { name: carrier, rows: 0, lives: 0, premium: 0, income: 0 }; carrierMap.set(carrier, cr); }
      cr.rows++; cr.lives += lives; cr.premium += premium; cr.income += income;
    }
  }

  return {
    auditTotals: {
      rows: totalRows,
      lives: totalLives,
      premium: round2(totalPremium),
      income: round2(totalIncome),
    },
    monthSubtotals,
    clientSubtotals: Array.from(clientMap.values()).sort((a, b) => b.premium - a.premium).slice(0, 20),
    carrierSubtotals: Array.from(carrierMap.values()).sort((a, b) => b.premium - a.premium),
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function computeTotalsFromRows(rows: any[], reportType: string) {
  let totalRows = rows.length;
  let totalLives = 0, totalPremium = 0, totalIncome = 0;

  for (const r of rows) {
    if (reportType === "production-dashboard") {
      totalLives += r.l ?? 0;
      totalPremium += r.mp ?? 0;
      totalIncome += r.i ?? 0;
    } else {
      totalLives += r.enrolled ?? r.lives ?? 0;
      totalPremium += r.monthlyPremium ?? 0;
      totalIncome += r.estMonthlyFee ?? r.income ?? 0;
    }
  }

  return {
    rows: totalRows,
    lives: totalLives,
    premium: round2(totalPremium),
    income: round2(totalIncome),
  };
}

function zeroes() {
  return { rows: 0, lives: 0, premium: 0, income: 0 };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function buildResult(
  checks: AuditCheck[],
  reportTotals: { rows: number; lives: number; premium: number; income: number },
  auditTotals: { rows: number; lives: number; premium: number; income: number },
  monthSubtotals: Record<string, MonthSubtotal>,
  clientSubtotals: EntitySubtotal[],
  carrierSubtotals: EntitySubtotal[],
): AuditResult {
  const passed = checks.filter(c => c.status === "pass").length;
  const failed = checks.filter(c => c.status === "fail" || c.status === "needs_review").length;
  const warnings = checks.filter(c => c.status === "warning").length;

  let status: "verified" | "warning" | "needs_review" = "verified";
  if (checks.some(c => c.status === "fail" || c.status === "needs_review")) status = "needs_review";
  else if (checks.some(c => c.status === "warning")) status = "warning";

  return {
    status,
    checks,
    checksRun: checks.length,
    checksPassed: passed,
    checksFailed: failed + warnings,
    reportTotals,
    auditTotals,
    variances: {
      rows: auditTotals.rows - reportTotals.rows,
      lives: auditTotals.lives - reportTotals.lives,
      premium: round2(auditTotals.premium - reportTotals.premium),
      income: round2(auditTotals.income - reportTotals.income),
    },
    monthSubtotals,
    clientSubtotals,
    carrierSubtotals,
  };
}
