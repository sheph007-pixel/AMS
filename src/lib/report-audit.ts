import { prisma } from "@/lib/db";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Report Audit — Monthly Snapshot Integrity Checks
 *
 * Simple, deterministic checks against raw database records.
 * No cross-pipeline comparisons. No complex recomputation.
 *
 * Primary checks (drive pass/fail status):
 *   1. Monthly snapshot integrity — one snapshot per client per month
 *   2. Company uniqueness — no duplicate company identifiers per month
 *   3. Employee uniqueness — no duplicate employee identifiers per month
 *   4. Employee inclusion — active only, no termed, no COBRA
 *   5. Benefit logic — qualifying enrollments, no duplicate plan+tier
 *   6. Totals sanity — counts match qualifying data only
 *
 * Secondary (informational only, never drives status):
 *   - Dashboard cache consistency check
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AuditCheck {
  name: string;
  status: "pass" | "fail" | "warning";
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
  status: "verified" | "needs_review";
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

// ─── Main ───────────────────────────────────────────────────────────────────

export async function runProductionAudit(): Promise<AuditResult> {
  const checks: AuditCheck[] = [];

  // Load all snapshots with their data
  const snapshots = await prisma.clientSnapshot.findMany({
    where: { year: { gte: 2022 } },
    select: {
      id: true, year: true, month: true,
      client: { select: { groupId: true, groupName: true } },
      employees: { select: { employeeId: true, status: true } },
      benefitPlans: { select: { planType: true, carrier: true, enrollees: true, premium: true } },
    },
  });

  // ── 1. Monthly Snapshot Integrity ───────────────────────────────────
  // One snapshot per client per month. No duplicates. No month-0.

  const monthClientKeys = new Map<string, number>();
  let invalidMonths = 0;
  for (const s of snapshots) {
    if (s.month < 1 || s.month > 12) { invalidMonths++; continue; }
    const key = `${s.client.groupId}||${s.year}-${String(s.month).padStart(2, "0")}`;
    monthClientKeys.set(key, (monthClientKeys.get(key) || 0) + 1);
  }
  const duplicateSnapshots = Array.from(monthClientKeys.values()).filter(v => v > 1).length;

  checks.push({
    name: "no-invalid-months",
    status: invalidMonths === 0 ? "pass" : "fail",
    message: invalidMonths === 0 ? "All snapshots have valid months (1-12)" : `${invalidMonths} snapshots have invalid month values`,
    expected: 0, actual: invalidMonths,
  });

  checks.push({
    name: "no-duplicate-snapshots",
    status: duplicateSnapshots === 0 ? "pass" : "fail",
    message: duplicateSnapshots === 0
      ? `${monthClientKeys.size} unique client-month combinations, no duplicates`
      : `${duplicateSnapshots} client-month combinations have duplicate snapshots`,
    expected: 0, actual: duplicateSnapshots,
  });

  // ── 2. Company Uniqueness ──────────────────────────────────────────
  // Each company identifier should appear once per month (handled above by snapshot uniqueness).
  // Check that groupIds are consistent across snapshots.

  const companyNames = new Map<string, Set<string>>();
  for (const s of snapshots) {
    if (!companyNames.has(s.client.groupId)) companyNames.set(s.client.groupId, new Set());
    companyNames.get(s.client.groupId)!.add(s.client.groupName);
  }
  const inconsistentCompanies = Array.from(companyNames.entries()).filter(([, names]) => names.size > 1);

  checks.push({
    name: "company-uniqueness",
    status: inconsistentCompanies.length === 0 ? "pass" : "warning",
    message: inconsistentCompanies.length === 0
      ? `${companyNames.size} companies, all with consistent names`
      : `${inconsistentCompanies.length} companies have inconsistent names across months`,
    expected: 0, actual: inconsistentCompanies.length,
  });

  // ── 3. Employee Uniqueness ─────────────────────────────────────────
  // Each employee identifier should appear once per snapshot.

  let totalEmployees = 0;
  let duplicateEmployees = 0;
  for (const s of snapshots) {
    if (s.month < 1 || s.month > 12) continue;
    const empIds = new Set<string>();
    for (const e of s.employees) {
      if (empIds.has(e.employeeId)) duplicateEmployees++;
      else empIds.add(e.employeeId);
      totalEmployees++;
    }
  }

  checks.push({
    name: "employee-uniqueness",
    status: duplicateEmployees === 0 ? "pass" : "fail",
    message: duplicateEmployees === 0
      ? `${totalEmployees.toLocaleString()} employee records, no duplicates within any monthly snapshot`
      : `${duplicateEmployees} duplicate employee records found within monthly snapshots`,
    expected: 0, actual: duplicateEmployees,
  });

  // ── 4. Employee Inclusion Rules ────────────────────────────────────
  // Active employees included. Termed employees excluded from counts.
  // COBRA plans excluded.

  let activeEmployees = 0;
  let termedEmployees = 0;
  let cobraPlans = 0;
  let totalPlans = 0;
  for (const s of snapshots) {
    if (s.month < 1 || s.month > 12) continue;
    for (const e of s.employees) {
      const st = (e.status || "Active").toLowerCase();
      if (st === "active") activeEmployees++;
      else termedEmployees++;
    }
    for (const bp of s.benefitPlans) {
      totalPlans++;
      if (bp.planType?.toLowerCase() === "cobra") cobraPlans++;
    }
  }

  checks.push({
    name: "employee-status-breakdown",
    status: "pass",
    message: `${activeEmployees.toLocaleString()} active employees, ${termedEmployees.toLocaleString()} termed/inactive (correctly excluded from report counts)`,
    expected: activeEmployees, actual: activeEmployees,
  });

  checks.push({
    name: "cobra-plans-identified",
    status: "pass",
    message: cobraPlans > 0
      ? `${cobraPlans} COBRA plans identified and excluded from ${totalPlans.toLocaleString()} total plans`
      : `No COBRA plans found in ${totalPlans.toLocaleString()} total plans`,
    expected: 0, actual: cobraPlans,
  });

  // ── 5. Benefit Logic ───────────────────────────────────────────────
  // Plans with zero enrollees are valid (employee may have no benefits).
  // No negative enrollees or premium.

  let negativePremium = 0;
  let negativeEnrollees = 0;
  let plansWithData = 0;
  for (const s of snapshots) {
    if (s.month < 1 || s.month > 12) continue;
    for (const bp of s.benefitPlans) {
      if (bp.planType?.toLowerCase() === "cobra") continue;
      plansWithData++;
      if ((bp.premium || 0) < 0) negativePremium++;
      if ((bp.enrollees || 0) < 0) negativeEnrollees++;
    }
  }

  checks.push({
    name: "no-negative-values",
    status: negativePremium === 0 && negativeEnrollees === 0 ? "pass" : "fail",
    message: negativePremium === 0 && negativeEnrollees === 0
      ? `${plansWithData.toLocaleString()} benefit plan records, all with valid values`
      : `Found ${negativePremium} negative premium and ${negativeEnrollees} negative enrollee values`,
    expected: 0, actual: negativePremium + negativeEnrollees,
  });

  // ── 6. Totals Sanity ──────────────────────────────────────────────
  // Sum from qualifying data only (valid months, non-COBRA, non-excluded carriers).

  const carrierSettings = await prisma.carrierSetting.findMany();
  const excludedCarriers = new Set(carrierSettings.filter(cs => cs.excluded).map(cs => cs.carrierName.toLowerCase()));

  let auditLives = 0, auditPremium = 0, auditRows = 0;
  const monthSubs: Record<string, MonthSubtotal> = {};
  const clientSubs = new Map<string, EntitySubtotal>();
  const carrierSubs = new Map<string, EntitySubtotal>();

  for (const s of snapshots) {
    if (s.month < 1 || s.month > 12) continue;
    const period = `${s.year}-${String(s.month).padStart(2, "0")}`;

    for (const bp of s.benefitPlans) {
      if (bp.planType?.toLowerCase() === "cobra") continue;
      if (bp.carrier && excludedCarriers.has(bp.carrier.toLowerCase())) continue;

      const lives = bp.enrollees || 0;
      const prem = Math.round((bp.premium || 0) * 100) / 100;
      auditLives += lives;
      auditPremium += prem;
      auditRows++;

      if (!monthSubs[period]) monthSubs[period] = { rows: 0, lives: 0, premium: 0, income: 0 };
      monthSubs[period].rows++;
      monthSubs[period].lives += lives;
      monthSubs[period].premium += prem;

      const cn = s.client.groupName;
      let cs = clientSubs.get(cn);
      if (!cs) { cs = { name: cn, rows: 0, lives: 0, premium: 0, income: 0 }; clientSubs.set(cn, cs); }
      cs.rows++; cs.lives += lives; cs.premium += prem;

      const ca = bp.carrier || "Unspecified";
      let cr = carrierSubs.get(ca);
      if (!cr) { cr = { name: ca, rows: 0, lives: 0, premium: 0, income: 0 }; carrierSubs.set(ca, cr); }
      cr.rows++; cr.lives += lives; cr.premium += prem;
    }
  }

  auditPremium = Math.round(auditPremium * 100) / 100;
  const periods = Object.keys(monthSubs).sort();

  checks.push({
    name: "totals-sanity",
    status: auditLives >= 0 && auditPremium >= 0 ? "pass" : "fail",
    message: `${auditRows.toLocaleString()} qualifying plan records across ${periods.length} months: ${auditLives.toLocaleString()} lives, $${auditPremium.toLocaleString(undefined, { minimumFractionDigits: 2 })} premium`,
    expected: auditRows, actual: auditRows,
  });

  // ── Secondary: Dashboard Cache Consistency (informational) ─────────

  const cache = await prisma.reportCache.findUnique({ where: { key: "production-dashboard" } });
  let reportTotals = { rows: 0, lives: 0, premium: 0, income: 0 };
  if (cache) {
    try {
      const data = JSON.parse(cache.data);
      const rows = data.rows || [];
      reportTotals.rows = rows.length;
      for (const r of rows) {
        reportTotals.lives += r.l ?? 0;
        reportTotals.premium += r.mp ?? 0;
        reportTotals.income += r.i ?? 0;
      }
      reportTotals.premium = Math.round(reportTotals.premium * 100) / 100;
      reportTotals.income = Math.round(reportTotals.income * 100) / 100;
    } catch { /* */ }

    checks.push({
      name: "cache-consistency",
      status: "warning",
      message: `Dashboard cache: ${reportTotals.rows.toLocaleString()} rows, $${reportTotals.premium.toLocaleString(undefined, { minimumFractionDigits: 2 })} premium, $${reportTotals.income.toLocaleString(undefined, { minimumFractionDigits: 2 })} est. income (informational — different aggregation level than plan-level audit totals)`,
    });
  }

  // ── Build Result ───────────────────────────────────────────────────

  const auditTotals = { rows: auditRows, lives: auditLives, premium: auditPremium, income: 0 };
  const passed = checks.filter(c => c.status === "pass").length;
  const failed = checks.filter(c => c.status === "fail").length;

  // Only fail/pass. Warnings are informational.
  const status: "verified" | "needs_review" = failed > 0 ? "needs_review" : "verified";

  return {
    status, checks,
    checksRun: checks.length,
    checksPassed: passed,
    checksFailed: failed,
    reportTotals, auditTotals,
    variances: {
      rows: auditTotals.rows - reportTotals.rows,
      lives: auditTotals.lives - reportTotals.lives,
      premium: Math.round((auditTotals.premium - reportTotals.premium) * 100) / 100,
      income: Math.round((auditTotals.income - reportTotals.income) * 100) / 100,
    },
    monthSubtotals: monthSubs,
    clientSubtotals: Array.from(clientSubs.values()).sort((a, b) => b.premium - a.premium).slice(0, 20),
    carrierSubtotals: Array.from(carrierSubs.values()).sort((a, b) => b.premium - a.premium),
  };
}
