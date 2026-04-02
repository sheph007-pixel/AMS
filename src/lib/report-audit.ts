import { prisma } from "@/lib/db";
import { getExclusionRules, isExcluded } from "@/lib/exclusions";
import {
  findEnrollments, getField, qualifyEnrollment,
  getMappedField, loadActiveMappings,
} from "@/lib/report-cache";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Report Audit — Deterministic verification + independent recomputation.
 *
 * PRIMARY audit: Dashboard Reconciliation
 *   Mirrors buildProductionDashboard() exactly:
 *   - EmployeeSnapshot.metadata enrollment walk
 *   - qualifyEnrollment() active-month filter
 *   - Plan-level + enrollment-level COBRA exclusion
 *   - Dedupe by employee + plan + coverageLevel
 *   - Aggregate by policyNumber||planName||coverageLevel
 *   - Income from CarrierSetting table
 *
 * SECONDARY audit (informational): Plan-Level Cross-Check
 *   Compares BenefitPlan-level totals as an independent sanity check.
 *   Does NOT drive the status badge.
 *
 * AI review is optional and advisory only.
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

const PREMIUM_TOLERANCE = 0.01;
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
    expected: reportedRowCount, actual: reportRows.length,
  });

  // Check 2: No month-0 rows
  const month0Rows = reportRows.filter((r: any) => {
    const m = r.mn ?? r.month;
    return m === 0 || m === undefined || m === null;
  });
  checks.push({
    name: "no-month-zero",
    status: month0Rows.length === 0 ? "pass" : "fail",
    message: month0Rows.length === 0 ? "No month-0 rows found" : `Found ${month0Rows.length} rows with month=0`,
    expected: 0, actual: month0Rows.length,
  });

  // Check 3: No COBRA rows
  const cobraRows = reportRows.filter((r: any) => (r.ct || r.coverageType || r.planType || "").toLowerCase() === "cobra");
  checks.push({
    name: "no-cobra-rows",
    status: cobraRows.length === 0 ? "pass" : "fail",
    message: cobraRows.length === 0 ? "No COBRA rows in report" : `Found ${cobraRows.length} COBRA rows`,
    expected: 0, actual: cobraRows.length,
  });

  // Check 4: No negative premiums
  const negPremiums = reportRows.filter((r: any) => (r.mp ?? r.monthlyPremium ?? 0) < 0);
  checks.push({
    name: "no-negative-premium",
    status: negPremiums.length === 0 ? "pass" : "warning",
    message: negPremiums.length === 0 ? "No negative premium values" : `Found ${negPremiums.length} rows with negative premium`,
    expected: 0, actual: negPremiums.length,
  });

  // Check 5: No negative lives
  const negLives = reportRows.filter((r: any) => (r.l ?? r.lives ?? r.enrolled ?? 0) < 0);
  checks.push({
    name: "no-negative-lives",
    status: negLives.length === 0 ? "pass" : "fail",
    message: negLives.length === 0 ? "No negative lives counts" : `Found ${negLives.length} rows with negative lives`,
    expected: 0, actual: negLives.length,
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
    expected: 0, actual: badRateRows.length,
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
    expected: 0, actual: missingFieldCount,
  });

  // Check 8: Duplicate detection (same client+month+plan+tier)
  const dupeSet = new Set<string>();
  let dupeCount = 0;
  for (const r of reportRows) {
    const key = [r.cn || r.clientName, r.m || r.transactionDate, r.pl || r.planName, r.g || r.grouping || r.coverageType, r.pn || r.policyNumber].join("||");
    if (dupeSet.has(key)) dupeCount++;
    else dupeSet.add(key);
  }
  checks.push({
    name: "no-duplicate-rows",
    status: dupeCount === 0 ? "pass" : "warning",
    message: dupeCount === 0 ? "No duplicate client+month+plan+tier rows" : `Found ${dupeCount} potential duplicate rows`,
    expected: 0, actual: dupeCount,
  });

  // Check 9: Carrier exclusion enforcement
  const allCarrierSettings = await prisma.carrierSetting.findMany();
  const excludedCarriers = new Set(allCarrierSettings.filter(cs => cs.excluded).map(cs => cs.carrierName.toLowerCase()));
  const excludedInReport = reportRows.filter((r: any) => excludedCarriers.has((r.ca || r.carrier || "").toLowerCase()));
  checks.push({
    name: "excluded-carriers-absent",
    status: excludedInReport.length === 0 ? "pass" : "fail",
    message: excludedInReport.length === 0
      ? `All ${excludedCarriers.size} excluded carriers correctly absent`
      : `Found ${excludedInReport.length} rows from excluded carriers`,
    expected: 0, actual: excludedInReport.length,
  });

  // Check 10: Exclusion rules enforcement
  const exclusionRules = await getExclusionRules();
  let exclusionViolations = 0;
  for (const r of reportRows) {
    if (isExcluded({ carrier: r.ca || r.carrier, planName: r.pl || r.planName, planType: r.ct || r.planType }, exclusionRules)) {
      exclusionViolations++;
    }
  }
  checks.push({
    name: "exclusion-rules-enforced",
    status: exclusionViolations === 0 ? "pass" : "fail",
    message: exclusionViolations === 0 ? "All exclusion rules properly enforced" : `Found ${exclusionViolations} rows violating exclusion rules`,
    expected: 0, actual: exclusionViolations,
  });

  // ── Layer 2: Dashboard Reconciliation (PRIMARY) ─────────────────────
  //
  // Mirrors buildProductionDashboard() exactly:
  // Same data source, same filters, same aggregation, same income logic.
  // This is the reconciliation that drives the status badge.

  const { auditTotals, monthSubtotals, clientSubtotals, carrierSubtotals, monthsWithPlansNoEnrollments } =
    await recomputeDashboard(exclusionRules);

  // Check 11: Row count
  checks.push({
    name: "dashboard-recompute-rows",
    status: auditTotals.rows === reportTotals.rows ? "pass" : "needs_review",
    message: auditTotals.rows === reportTotals.rows
      ? `Dashboard row count matches: ${auditTotals.rows}`
      : `Dashboard cache has ${reportTotals.rows} rows, recomputation found ${auditTotals.rows}`,
    expected: reportTotals.rows, actual: auditTotals.rows,
  });

  // Check 12: Lives
  checks.push({
    name: "dashboard-recompute-lives",
    status: auditTotals.lives === reportTotals.lives ? "pass" : "needs_review",
    message: auditTotals.lives === reportTotals.lives
      ? `Lives match: ${auditTotals.lives}`
      : `Dashboard lives ${reportTotals.lives}, recomputed ${auditTotals.lives}`,
    expected: reportTotals.lives, actual: auditTotals.lives,
  });

  // Check 13: Premium
  const premVariance = Math.abs(auditTotals.premium - reportTotals.premium);
  checks.push({
    name: "dashboard-recompute-premium",
    status: premVariance <= PREMIUM_TOLERANCE ? "pass" : "needs_review",
    message: premVariance <= PREMIUM_TOLERANCE
      ? `Premium matches within $${PREMIUM_TOLERANCE} tolerance`
      : `Premium variance: $${premVariance.toFixed(2)} (cache $${reportTotals.premium.toFixed(2)}, audit $${auditTotals.premium.toFixed(2)})`,
    expected: reportTotals.premium, actual: auditTotals.premium,
  });

  // Check 14: Income
  const incVariance = Math.abs(auditTotals.income - reportTotals.income);
  checks.push({
    name: "dashboard-recompute-income",
    status: incVariance <= INCOME_TOLERANCE ? "pass" : "needs_review",
    message: incVariance <= INCOME_TOLERANCE
      ? `Estimated income matches within $${INCOME_TOLERANCE} tolerance`
      : `Income variance: $${incVariance.toFixed(2)} (cache $${reportTotals.income.toFixed(2)}, audit $${auditTotals.income.toFixed(2)})`,
    expected: reportTotals.income, actual: auditTotals.income,
  });

  // Check 15: Month coverage
  const reportMonths = new Set<string>();
  for (const r of reportRows) {
    const m = r.m || r.transactionDate || "";
    if (m) reportMonths.add(typeof m === "string" ? m.substring(0, 7) : m);
  }
  const auditMonths = Object.keys(monthSubtotals);
  const missingFromReport = auditMonths.filter(m => !reportMonths.has(m));
  const missingFromAudit = Array.from(reportMonths).filter(m => !monthSubtotals[m]);
  const monthIssues = missingFromReport.length + missingFromAudit.length;
  checks.push({
    name: "month-coverage",
    status: monthIssues === 0 ? "pass" : "warning",
    message: monthIssues === 0
      ? `All ${auditMonths.length} months match between cache and audit`
      : `Month mismatch: ${missingFromReport.length} in audit only (${missingFromReport.join(", ")}), ${missingFromAudit.length} in cache only`,
    expected: auditMonths.length, actual: reportMonths.size,
  });

  // Check 16: Months with plans but zero qualifying enrollments (informational)
  if (monthsWithPlansNoEnrollments.size > 0) {
    const sortedEmpty = Array.from(monthsWithPlansNoEnrollments).sort();
    checks.push({
      name: "months-plans-no-enrollments",
      status: "warning",
      message: `${sortedEmpty.length} distinct month(s) have snapshots with plans but zero qualifying enrollments: ${sortedEmpty.join(", ")}. This is acceptable if all employees in those snapshots are termed/inactive.`,
      expected: 0, actual: sortedEmpty.length,
    });
  }

  // ── Layer 3: Plan-Level Cross-Check (INFORMATIONAL ONLY) ────────────
  // Does NOT drive the status badge.

  const planLevel = await recomputePlanLevel(exclusionRules);
  if (planLevel) {
    const planPremDelta = Math.abs(reportTotals.premium - planLevel.premium);
    const pctVariance = planLevel.premium > 0 ? (planPremDelta / planLevel.premium) * 100 : 0;
    checks.push({
      name: "plan-level-cross-check",
      status: "warning", // Always warning — informational only, never drives status
      message: `Plan-level cross-check: ${planLevel.rows} plan rows, $${planLevel.premium.toFixed(2)} premium (${pctVariance.toFixed(1)}% vs dashboard). This is expected: different aggregation levels.`,
      expected: planLevel.premium, actual: reportTotals.premium,
    });
  }

  return buildResult(checks, reportTotals, auditTotals, monthSubtotals, clientSubtotals, carrierSubtotals);
}

// ─── Dashboard Recomputation (PRIMARY) ──────────────────────────────────────

/**
 * Mirrors buildProductionDashboard() exactly:
 * - Same Prisma query (ClientSnapshot + BenefitPlan metadata + EmployeeSnapshot)
 * - Same exclusion/COBRA/carrier filters
 * - Same qualifyEnrollment() active-month logic
 * - Same employee+plan+tier dedupe
 * - Same policyNumber||planName||coverageLevel aggregation
 * - Same CarrierSetting income calculation
 *
 * Outputs only totals and subtotals (no full row array).
 */
async function recomputeDashboard(exclusionRules: { field: string; value: string }[]) {
  const activeMappings = await loadActiveMappings();

  const carrierSettings = await prisma.carrierSetting.findMany();
  const csMap = new Map<string, { incomeMethod: string; rate: number; excluded: boolean }>();
  for (const cs of carrierSettings) {
    csMap.set(cs.carrierName.toLowerCase(), { incomeMethod: cs.incomeMethod, rate: cs.rate, excluded: cs.excluded });
  }

  // Same query as buildProductionDashboard line 746-756
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

  const monthSubtotals: Record<string, MonthSubtotal> = {};
  const clientMap = new Map<string, EntitySubtotal>();
  const carrierMap = new Map<string, EntitySubtotal>();
  let totalRows = 0, totalLives = 0, totalPremium = 0, totalIncome = 0;
  const monthsWithPlansNoEnrollments = new Set<string>();

  for (const snap of snapshotList) {
    // Same filters as dashboard lines 767-769
    if (isExcluded({ groupName: snap.client.groupName }, exclusionRules)) continue;
    if (snap.month < 1 || snap.month > 12) continue;

    const period = `${snap.year}-${String(snap.month).padStart(2, "0")}`;
    const snapshotMonthStart = new Date(snap.year, snap.month - 1, 1);

    // Build plan lookup — same as dashboard lines 774-804
    const planIdMap = new Map<string, { carrier: string; planType: string; planName: string; policyNumber: string }>();
    const planNameMap = new Map<string, { carrier: string; planType: string; planName: string; policyNumber: string }>();
    let hasPlans = false;

    for (const bp of snap.benefitPlans) {
      if (isExcluded({ carrier: bp.carrier, planName: bp.planName, planType: bp.planType }, exclusionRules)) continue;
      if (bp.planType?.toLowerCase() === "cobra") continue;
      if (bp.carrier && csMap.get(bp.carrier.toLowerCase())?.excluded) continue;

      let planMeta: any = {};
      try { planMeta = bp.metadata ? JSON.parse(bp.metadata) : {}; } catch { /* */ }

      const policyNumber = getMappedField(planMeta, null,
        "PolicyNumber", "GroupPolicyNumber", "GroupNumber",
        "ContractNumber", "PlanNumber", "CertificateNumber",
        "CarrierPlanNumber", "CarrierGroupNumber", "InsurancePolicyNumber"
      ) || "";

      const info = { carrier: bp.carrier || "Unspecified", planType: bp.planType || "Unknown", planName: bp.planName || "", policyNumber };
      const planIdentifier = getMappedField(planMeta, null, "PlanIdentifier", "PlanId", "PlanID") || "";
      if (planIdentifier) planIdMap.set(planIdentifier, info);
      if (bp.planName) planNameMap.set(bp.planName, info);
      hasPlans = true;
    }

    if (!hasPlans) continue;

    // Load employees — same as dashboard line 809-811
    const employees = await prisma.employeeSnapshot.findMany({
      where: { clientSnapshotId: snap.id },
      select: { employeeId: true, status: true, metadata: true },
    });

    // Tier aggregation — same as dashboard lines 824-899
    const tierAgg = new Map<string, {
      carrier: string; planType: string; planName: string; policyNumber: string;
      grouping: string; lives: number; totalPremium: number;
    }>();

    for (const emp of employees) {
      if ((emp.status || "Active").toLowerCase() !== "active") continue;

      let empMeta: any;
      try { empMeta = emp.metadata ? JSON.parse(emp.metadata) : null; } catch { continue; }
      if (!empMeta) continue;

      const enrollments = findEnrollments(empMeta);
      const seen = new Set<string>();

      for (const enrollment of enrollments) {
        if (!qualifyEnrollment(enrollment, snapshotMonthStart)) continue;

        const enrollPlanId = getMappedField(enrollment, activeMappings, "PlanIdentifier", "PlanId", "PlanID") || "";
        const enrollPlanName = getMappedField(enrollment, activeMappings, "PlanName", "Plan", "Name") || "";
        const planKey = enrollPlanId || enrollPlanName;
        if (!planKey) continue;

        const planInfo = (enrollPlanId && planIdMap.get(enrollPlanId))
          || (enrollPlanName && planNameMap.get(enrollPlanName))
          || null;
        if (!planInfo) continue;

        const coverageLevel = getMappedField(enrollment, activeMappings, "CoverageLevel") || "Employee";

        // Same dedupe as dashboard line 862
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

        // Same aggKey as dashboard line 884
        const aggKey = `${planInfo.policyNumber || planKey}||${planInfo.planName}||${coverageLevel}`;
        let agg = tierAgg.get(aggKey);
        if (!agg) {
          agg = {
            carrier: planInfo.carrier, planType: planInfo.planType,
            planName: planInfo.planName, policyNumber: planInfo.policyNumber,
            grouping: coverageLevel, lives: 0, totalPremium: 0,
          };
          tierAgg.set(aggKey, agg);
        }
        agg.lives += 1;
        agg.totalPremium += planCost;
      }
    }

    if (tierAgg.size === 0 && hasPlans) {
      monthsWithPlansNoEnrollments.add(period);
    }

    // Convert to totals — same as dashboard lines 902-947
    for (const agg of tierAgg.values()) {
      const monthlyPremium = Math.round(agg.totalPremium * 100) / 100;
      const lives = agg.lives;
      const carrier = agg.carrier;

      // Same income logic as dashboard lines 926-933
      const setting = csMap.get(carrier.toLowerCase());
      let income = 0;
      if (setting) {
        if (setting.incomeMethod === "PEPM") income = Math.round(lives * setting.rate * 100) / 100;
        else if (setting.incomeMethod === "PERCENT_PREMIUM") income = Math.round(monthlyPremium * (setting.rate / 100) * 100) / 100;
      }

      totalRows++;
      totalLives += lives;
      totalPremium += monthlyPremium;
      totalIncome += income;

      // Subtotals
      if (!monthSubtotals[period]) monthSubtotals[period] = { rows: 0, lives: 0, premium: 0, income: 0 };
      monthSubtotals[period].rows++;
      monthSubtotals[period].lives += lives;
      monthSubtotals[period].premium += monthlyPremium;
      monthSubtotals[period].income += income;

      const clientName = snap.client.groupName;
      let cs = clientMap.get(clientName);
      if (!cs) { cs = { name: clientName, rows: 0, lives: 0, premium: 0, income: 0 }; clientMap.set(clientName, cs); }
      cs.rows++; cs.lives += lives; cs.premium += monthlyPremium; cs.income += income;

      let cr = carrierMap.get(carrier);
      if (!cr) { cr = { name: carrier, rows: 0, lives: 0, premium: 0, income: 0 }; carrierMap.set(carrier, cr); }
      cr.rows++; cr.lives += lives; cr.premium += monthlyPremium; cr.income += income;
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
    monthsWithPlansNoEnrollments,
  };
}

// ─── Plan-Level Cross-Check (INFORMATIONAL) ─────────────────────────────────

async function recomputePlanLevel(exclusionRules: { field: string; value: string }[]) {
  const carrierSettings = await prisma.carrierSetting.findMany();
  const csMap = new Map(carrierSettings.map(cs => [
    cs.carrierName.toLowerCase(),
    { excluded: cs.excluded },
  ]));

  const snapshots = await prisma.clientSnapshot.findMany({
    where: { year: { gte: 2022 }, month: { gte: 1, lte: 12 } },
    select: {
      year: true, month: true,
      client: { select: { groupName: true } },
      benefitPlans: {
        select: { carrier: true, planType: true, planName: true, premium: true, enrollees: true },
      },
    },
  });

  let rows = 0, premium = 0;
  for (const snap of snapshots) {
    if (isExcluded({ groupName: snap.client.groupName }, exclusionRules)) continue;
    for (const bp of snap.benefitPlans) {
      if (isExcluded({ carrier: bp.carrier, planName: bp.planName, planType: bp.planType }, exclusionRules)) continue;
      if (bp.planType?.toLowerCase() === "cobra") continue;
      if (bp.carrier && csMap.get(bp.carrier.toLowerCase())?.excluded) continue;
      rows++;
      premium += bp.premium || 0;
    }
  }

  return { rows, premium: round2(premium) };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function computeTotalsFromRows(rows: any[], reportType: string) {
  const totalRows = rows.length;
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

  return { rows: totalRows, lives: totalLives, premium: round2(totalPremium), income: round2(totalIncome) };
}

function zeroes() { return { rows: 0, lives: 0, premium: 0, income: 0 }; }

function round2(n: number): number { return Math.round(n * 100) / 100; }

function buildResult(
  checks: AuditCheck[],
  reportTotals: { rows: number; lives: number; premium: number; income: number },
  auditTotals: { rows: number; lives: number; premium: number; income: number },
  monthSubtotals: Record<string, MonthSubtotal>,
  clientSubtotals: EntitySubtotal[],
  carrierSubtotals: EntitySubtotal[],
): AuditResult {
  const passed = checks.filter(c => c.status === "pass").length;
  const hardFails = checks.filter(c => c.status === "fail" || c.status === "needs_review").length;

  // Status determination:
  // - "verified" = no hard failures (fail/needs_review). Warnings are advisory only.
  // - "needs_review" = any fail or dashboard recomputation mismatch
  // Warnings (plan-level cross-check, empty months) do NOT prevent "verified".
  let status: "verified" | "warning" | "needs_review" = "verified";
  if (checks.some(c => c.status === "fail" || c.status === "needs_review")) status = "needs_review";

  return {
    status, checks,
    checksRun: checks.length,
    checksPassed: passed,
    checksFailed: hardFails,
    reportTotals, auditTotals,
    variances: {
      rows: auditTotals.rows - reportTotals.rows,
      lives: auditTotals.lives - reportTotals.lives,
      premium: round2(auditTotals.premium - reportTotals.premium),
      income: round2(auditTotals.income - reportTotals.income),
    },
    monthSubtotals, clientSubtotals, carrierSubtotals,
  };
}
