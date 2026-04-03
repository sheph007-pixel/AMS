import { prisma } from "@/lib/db";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Report Audit — Monthly Snapshot Integrity
 *
 * Primary output: one row per month with summary metrics.
 * Secondary: deterministic integrity checks (drill-down per month).
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AuditMonthRow {
  period: string;       // "2023-07"
  year: number;
  month: number;
  fileUploaded: boolean;
  uploadedAt: string | null;
  companies: number;
  activeEmployees: number;
  premium: number;
  estimatedIncome: number;
  checks: AuditCheck[];
  status: "pass" | "fail";
}

export interface AuditCheck {
  name: string;
  status: "pass" | "fail" | "info";
  message: string;
}

export interface AuditResult {
  status: "verified" | "needs_review";
  months: AuditMonthRow[];
  totals: {
    companies: number;
    activeEmployees: number;
    premium: number;
    estimatedIncome: number;
  };
  checksRun: number;
  checksPassed: number;
  checksFailed: number;
}

// ─── Main ───────────────────────────────────────────────────────────────────

export async function runProductionAudit(): Promise<AuditResult> {
  // Load carrier settings for exclusion + income
  const carrierSettings = await prisma.carrierSetting.findMany();
  const excludedCarriers = new Set(
    carrierSettings.filter(cs => cs.excluded).map(cs => cs.carrierName.toLowerCase())
  );
  const csMap = new Map(
    carrierSettings.map(cs => [cs.carrierName.toLowerCase(), { incomeMethod: cs.incomeMethod, rate: cs.rate }])
  );

  // Load all snapshots
  const snapshots = await prisma.clientSnapshot.findMany({
    where: { year: { gte: 2022 } },
    select: {
      id: true, year: true, month: true, importedAt: true,
      client: { select: { groupId: true, groupName: true } },
      employees: { select: { employeeId: true, status: true } },
      benefitPlans: { select: { planType: true, carrier: true, planName: true, enrollees: true, premium: true } },
    },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });

  // Group by period
  const periodMap = new Map<string, typeof snapshots>();
  for (const s of snapshots) {
    if (s.month < 1 || s.month > 12) continue;
    const period = `${s.year}-${String(s.month).padStart(2, "0")}`;
    if (!periodMap.has(period)) periodMap.set(period, []);
    periodMap.get(period)!.push(s);
  }

  const months: AuditMonthRow[] = [];
  let totalChecks = 0, totalPassed = 0, totalFailed = 0;
  const allCompanies = new Set<string>();

  for (const [period, snaps] of periodMap) {
    const checks: AuditCheck[] = [];
    const year = snaps[0].year;
    const month = snaps[0].month;

    // Latest upload date for this period
    const latestUpload = snaps.reduce((latest, s) =>
      s.importedAt > latest ? s.importedAt : latest, snaps[0].importedAt
    );

    // ── Check 1: One snapshot per company ──
    const companyIds = new Set(snaps.map(s => s.client.groupId));
    const dupeCheck = snaps.length > companyIds.size;
    checks.push({
      name: "snapshot-uniqueness",
      status: dupeCheck ? "fail" : "pass",
      message: dupeCheck
        ? `${snaps.length} snapshots for ${companyIds.size} companies (duplicates exist)`
        : `${companyIds.size} companies, one snapshot each`,
    });

    // ── Check 2: Employee uniqueness within month ──
    let dupeEmployees = 0;
    let activeCount = 0;
    let termedCount = 0;
    for (const s of snaps) {
      const empIds = new Set<string>();
      for (const e of s.employees) {
        if (empIds.has(e.employeeId)) dupeEmployees++;
        else empIds.add(e.employeeId);
        const st = (e.status || "Active").toLowerCase();
        if (st === "active") activeCount++;
        else termedCount++;
      }
    }
    checks.push({
      name: "employee-uniqueness",
      status: dupeEmployees === 0 ? "pass" : "fail",
      message: dupeEmployees === 0
        ? `${activeCount + termedCount} employees, no duplicates`
        : `${dupeEmployees} duplicate employee records`,
    });

    // ── Check 3: Active/termed breakdown ──
    checks.push({
      name: "employee-inclusion",
      status: "info",
      message: `${activeCount} active, ${termedCount} termed/inactive`,
    });

    // ── Check 4: COBRA exclusion ──
    let cobraCount = 0;
    let totalPlanCount = 0;
    for (const s of snaps) {
      for (const bp of s.benefitPlans) {
        totalPlanCount++;
        if (bp.planType?.toLowerCase() === "cobra") cobraCount++;
      }
    }
    if (cobraCount > 0) {
      checks.push({
        name: "cobra-excluded",
        status: "info",
        message: `${cobraCount} COBRA plans excluded from ${totalPlanCount} total`,
      });
    }

    // ── Check 5: No negative values ──
    let negatives = 0;
    for (const s of snaps) {
      for (const bp of s.benefitPlans) {
        if ((bp.premium || 0) < 0 || (bp.enrollees || 0) < 0) negatives++;
      }
    }
    if (negatives > 0) {
      checks.push({
        name: "no-negatives",
        status: "fail",
        message: `${negatives} records with negative premium or enrollees`,
      });
    }

    // ── Compute totals (qualifying data only) ──
    let monthPremium = 0;
    let monthIncome = 0;
    for (const s of snaps) {
      allCompanies.add(s.client.groupId);
      for (const bp of s.benefitPlans) {
        if (bp.planType?.toLowerCase() === "cobra") continue;
        if (bp.carrier && excludedCarriers.has(bp.carrier.toLowerCase())) continue;
        const prem = Math.round((bp.premium || 0) * 100) / 100;
        monthPremium += prem;
        // Income from carrier settings
        const carrier = (bp.carrier || "").toLowerCase();
        const setting = csMap.get(carrier);
        if (setting) {
          const lives = bp.enrollees || 0;
          if (setting.incomeMethod === "PEPM") monthIncome += Math.round(lives * setting.rate * 100) / 100;
          else if (setting.incomeMethod === "PERCENT_PREMIUM") monthIncome += Math.round(prem * (setting.rate / 100) * 100) / 100;
        }
      }
    }

    const hasFail = checks.some(c => c.status === "fail");
    totalChecks += checks.length;
    totalPassed += checks.filter(c => c.status === "pass").length;
    totalFailed += checks.filter(c => c.status === "fail").length;

    months.push({
      period, year, month,
      fileUploaded: true,
      uploadedAt: latestUpload.toISOString(),
      companies: companyIds.size,
      activeEmployees: activeCount,
      premium: Math.round(monthPremium * 100) / 100,
      estimatedIncome: Math.round(monthIncome * 100) / 100,
      checks,
      status: hasFail ? "fail" : "pass",
    });
  }

  // Sort newest first
  months.sort((a, b) => b.period.localeCompare(a.period));

  const overallStatus = months.some(m => m.status === "fail") ? "needs_review" : "verified";

  return {
    status: overallStatus,
    months,
    totals: {
      companies: allCompanies.size,
      activeEmployees: months.reduce((s, m) => s + m.activeEmployees, 0),
      premium: Math.round(months.reduce((s, m) => s + m.premium, 0) * 100) / 100,
      estimatedIncome: Math.round(months.reduce((s, m) => s + m.estimatedIncome, 0) * 100) / 100,
    },
    checksRun: totalChecks,
    checksPassed: totalPassed,
    checksFailed: totalFailed,
  };
}
