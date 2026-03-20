#!/usr/bin/env npx tsx
/**
 * Standalone XML validation script for Employee Navigator Broker Data Exchange files.
 *
 * Usage:
 *   npx tsx scripts/validate-xml.ts <path-to-xml-file>
 *
 * Produces:
 *   1. Main carrier summary table (Carrier | Eligible | Enrolled | Monthly Premium)
 *   2. Full debug/reconciliation section for auditing against broker reports
 */

import { readFileSync } from "fs";
import { XMLParser } from "fast-xml-parser";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── XML Parser ───────────────────────────────────────────────────────────────

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) =>
    [
      "Company", "Plan", "Employee", "Dependent", "Enrollment", "Enrollee",
      "Address", "Phone", "Contact", "Class", "Department", "Division",
      "Office", "BusinessUnit", "PayrollGroup", "Beneficiary", "Election",
      "EmailAddress", "Salary", "FutureSalaries", "Group", "Member",
      "Benefit", "Coverage",
    ].includes(name),
});

// ─── Field extraction helpers ─────────────────────────────────────────────────

function extractField(obj: any, ...keys: string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "") return String(obj[key]);
    if (obj[`@_${key}`] !== undefined && obj[`@_${key}`] !== null) return String(obj[`@_${key}`]);
  }
  return null;
}

function findCompanies(parsed: any): any[] {
  const data = parsed.Data || parsed.data || parsed;
  const container = data.Companies || data.companies || data;
  const companies = container.Company || container.company;
  if (Array.isArray(companies)) return companies;
  if (companies && typeof companies === "object") return [companies];
  return [];
}

function findPlans(company: any): any[] {
  const container = company.Plans || company.plans;
  if (!container) return [];
  if (Array.isArray(container)) return container;
  const plans = container.Plan || container.plan;
  if (Array.isArray(plans)) return plans;
  if (plans && typeof plans === "object") return [plans];
  return [];
}

function findEmployees(company: any): any[] {
  const container = company.Employees || company.employees;
  if (!container) return [];
  if (Array.isArray(container)) return container;
  const employees = container.Employee || container.employee;
  if (Array.isArray(employees)) return employees;
  if (employees && typeof employees === "object") return [employees];
  return [];
}

function findEnrollments(employee: any): any[] {
  const container = employee.Enrollments || employee.enrollments;
  if (!container) return [];
  if (Array.isArray(container)) return container;
  const enrollments = container.Enrollment || container.enrollment;
  if (Array.isArray(enrollments)) return enrollments;
  if (enrollments && typeof enrollments === "object") return [enrollments];
  return [];
}

function getEmployeeKey(emp: any): string {
  return String(
    emp.EmployeeGUID || emp["@_EmployeeGUID"] ||
    emp.ExternalEmployeeId || emp["@_ExternalEmployeeId"] ||
    extractField(emp.Person || emp, "SSN", "ssn") ||
    `unknown-${Math.random()}`
  );
}

function parsePlanCost(enrollment: any): number {
  const raw = extractField(enrollment, "PlanCost", "MonthlyPlanCost");
  if (!raw) return 0;
  const n = parseFloat(raw);
  return isNaN(n) ? 0 : n;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlanInfo {
  carrier: string;
  companyIdentifier: string;
  planName: string;
  planIdentifier: string;
}

interface CarrierData {
  eligibleEmployees: Set<string>;
  enrolledEmployees: Set<string>;
  enrollmentRows: number;
  monthlyPremium: number;
}

interface CompanyCarrierData {
  distinctEnrolled: Set<string>;
  enrollmentRows: number;
  premium: number;
}

interface ExceptionCounts {
  missingPlanIdentifier: number;
  unmatchedPlanIdentifier: number;
  fallbackPlanNameMatch: number;
  currentEnrollmentsWithEndDate: number;
  blankOrInvalidPlanCost: number;
}

// ─── Main logic ───────────────────────────────────────────────────────────────

function run(xmlPath: string) {
  console.log(`\nParsing: ${xmlPath}\n`);
  const xmlContent = readFileSync(xmlPath, "utf-8");
  const parsed = parser.parse(xmlContent);
  const companies = findCompanies(parsed);

  console.log(`Found ${companies.length} companies in XML.\n`);

  // ── Step 1: Build plan map ──────────────────────────────────────────────

  // PlanIdentifier → PlanInfo
  const planMap = new Map<string, PlanInfo>();
  // PlanName → PlanInfo (fallback, only if no PlanIdentifier collision)
  const planNameMap = new Map<string, PlanInfo>();
  // Carrier → Set of CompanyIdentifiers that have plans with this carrier
  const carrierCompanies = new Map<string, Set<string>>();
  // CompanyIdentifier → Set of active employee keys
  const companyActiveEmployees = new Map<string, Set<string>>();

  for (const company of companies) {
    const companyId = String(
      company.CompanyIdentifier || company.Identifier ||
      company["@_CompanyIdentifier"] || company["@_Identifier"] ||
      company.GroupID || company.groupId || "unknown"
    );

    const plans = findPlans(company);
    for (const plan of plans) {
      const planIdentifier = extractField(plan, "PlanIdentifier", "PlanId", "PlanID") || "";
      const carrier = extractField(plan, "Carrier") || "Unspecified Carrier";
      const planName = extractField(plan, "PlanName", "Name") || "";

      const info: PlanInfo = {
        carrier,
        companyIdentifier: companyId,
        planName,
        planIdentifier,
      };

      if (planIdentifier) {
        planMap.set(planIdentifier, info);
      }
      if (planName) {
        planNameMap.set(planName, info);
      }

      // Track which companies have plans with this carrier
      if (!carrierCompanies.has(carrier)) carrierCompanies.set(carrier, new Set());
      carrierCompanies.get(carrier)!.add(companyId);
    }
  }

  // ── Step 2: Process employees ───────────────────────────────────────────

  const carrierData = new Map<string, CarrierData>();
  const companyCarrierData = new Map<string, CompanyCarrierData>(); // key: `${carrier}::${companyId}`
  const exceptions: ExceptionCounts = {
    missingPlanIdentifier: 0,
    unmatchedPlanIdentifier: 0,
    fallbackPlanNameMatch: 0,
    currentEnrollmentsWithEndDate: 0,
    blankOrInvalidPlanCost: 0,
  };

  let totalActiveEmployees = 0;

  function getCarrierData(carrier: string): CarrierData {
    let d = carrierData.get(carrier);
    if (!d) {
      d = { eligibleEmployees: new Set(), enrolledEmployees: new Set(), enrollmentRows: 0, monthlyPremium: 0 };
      carrierData.set(carrier, d);
    }
    return d;
  }

  function getCompanyCarrierKey(carrier: string, companyId: string): string {
    return `${carrier}::${companyId}`;
  }

  function getCompanyCarrierData(carrier: string, companyId: string): CompanyCarrierData {
    const key = getCompanyCarrierKey(carrier, companyId);
    let d = companyCarrierData.get(key);
    if (!d) {
      d = { distinctEnrolled: new Set(), enrollmentRows: 0, premium: 0 };
      companyCarrierData.set(key, d);
    }
    return d;
  }

  for (const company of companies) {
    const companyId = String(
      company.CompanyIdentifier || company.Identifier ||
      company["@_CompanyIdentifier"] || company["@_Identifier"] ||
      company.GroupID || company.groupId || "unknown"
    );

    const employees = findEmployees(company);
    if (!companyActiveEmployees.has(companyId)) {
      companyActiveEmployees.set(companyId, new Set());
    }

    for (const emp of employees) {
      const status = extractField(emp, "EmploymentStatus", "Status") || "Active";
      if (status.toLowerCase() !== "active") continue;

      totalActiveEmployees++;
      const empKey = getEmployeeKey(emp);
      companyActiveEmployees.get(companyId)!.add(empKey);

      // Also set employee's CompanyIdentifier for eligibility
      const empCompanyId = extractField(emp, "CompanyIdentifier") || companyId;

      const enrollments = findEnrollments(emp);
      // Track which carriers this employee has been counted for (dedup enrolled per carrier)
      const enrolledCarriersThisEmp = new Set<string>();

      for (const enrollment of enrollments) {
        // ── Filter: EnrollmentType must be "Current" ──
        const enrollmentType = extractField(enrollment, "EnrollmentType", "Type");
        if (!enrollmentType || enrollmentType.toLowerCase() !== "current") continue;

        // ── Resolve carrier via PlanIdentifier ──
        const enrollPlanId = extractField(enrollment, "PlanIdentifier", "PlanId", "PlanID");
        const enrollPlanName = extractField(enrollment, "PlanName", "Plan", "Name");

        let resolvedPlan: PlanInfo | undefined;
        let matchMethod = "PlanIdentifier";

        if (enrollPlanId) {
          resolvedPlan = planMap.get(enrollPlanId);
          if (!resolvedPlan) {
            exceptions.unmatchedPlanIdentifier++;
            // Fallback to plan name
            if (enrollPlanName) {
              resolvedPlan = planNameMap.get(enrollPlanName);
              if (resolvedPlan) {
                matchMethod = "FallbackPlanName";
                exceptions.fallbackPlanNameMatch++;
              }
            }
          }
        } else {
          exceptions.missingPlanIdentifier++;
          // No PlanIdentifier at all — fall back to plan name
          if (enrollPlanName) {
            resolvedPlan = planNameMap.get(enrollPlanName);
            if (resolvedPlan) {
              matchMethod = "FallbackPlanName";
              exceptions.fallbackPlanNameMatch++;
            }
          }
        }

        if (!resolvedPlan) continue; // Cannot determine carrier

        const carrier = resolvedPlan.carrier;

        // ── Track EndDate exception ──
        const endDate = extractField(enrollment, "EndDate", "CoverageEndDate", "EndedOn");
        if (endDate) {
          exceptions.currentEnrollmentsWithEndDate++;
        }

        // ── PlanCost (premium) ──
        const cost = parsePlanCost(enrollment);
        if (cost === 0) {
          // Check if the field was actually blank/invalid vs genuinely 0
          const rawCost = extractField(enrollment, "PlanCost", "MonthlyPlanCost");
          if (!rawCost || isNaN(parseFloat(rawCost))) {
            exceptions.blankOrInvalidPlanCost++;
          }
        }

        // ── Aggregate ──
        const cd = getCarrierData(carrier);
        cd.enrollmentRows++;
        cd.monthlyPremium += cost;

        // Distinct enrolled employee per carrier
        if (!enrolledCarriersThisEmp.has(carrier)) {
          enrolledCarriersThisEmp.add(carrier);
          cd.enrolledEmployees.add(empKey);
        }

        // Company-carrier breakdown
        const ccd = getCompanyCarrierData(carrier, empCompanyId);
        ccd.enrollmentRows++;
        ccd.premium += cost;
        ccd.distinctEnrolled.add(empKey);
      }
    }
  }

  // ── Step 3: Compute carrier-specific eligibility ────────────────────────

  for (const [carrier, companyIds] of carrierCompanies) {
    const cd = getCarrierData(carrier);
    for (const companyId of companyIds) {
      const activeSet = companyActiveEmployees.get(companyId);
      if (activeSet) {
        for (const empKey of activeSet) {
          cd.eligibleEmployees.add(empKey);
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // OUTPUT
  // ═══════════════════════════════════════════════════════════════════════════

  const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pad = (s: string, w: number) => s.padEnd(w);
  const rpad = (s: string, w: number) => s.padStart(w);

  // Sort carriers by monthly premium descending
  const sortedCarriers = Array.from(carrierData.entries())
    .sort((a, b) => b[1].monthlyPremium - a[1].monthlyPremium);

  // ── 1. MAIN TABLE ──────────────────────────────────────────────────────

  console.log("═".repeat(100));
  console.log("  MAIN CARRIER SUMMARY TABLE");
  console.log("═".repeat(100));
  console.log("");

  const cw = [50, 18, 18, 20]; // column widths
  console.log(
    pad("Carrier", cw[0]) +
    rpad("Eligible Emps", cw[1]) +
    rpad("Enrolled Emps", cw[2]) +
    rpad("Monthly Premium", cw[3])
  );
  console.log("─".repeat(cw.reduce((a, b) => a + b, 0)));

  let totEligible = 0, totEnrolled = 0, totPremium = 0;

  for (const [carrier, data] of sortedCarriers) {
    const elig = data.eligibleEmployees.size;
    const enrl = data.enrolledEmployees.size;
    const prem = data.monthlyPremium;
    totEligible += elig;
    totEnrolled += enrl;
    totPremium += prem;

    console.log(
      pad(carrier.substring(0, cw[0] - 2), cw[0]) +
      rpad(elig.toLocaleString(), cw[1]) +
      rpad(enrl.toLocaleString(), cw[2]) +
      rpad("$" + fmt(prem), cw[3])
    );
  }

  console.log("─".repeat(cw.reduce((a, b) => a + b, 0)));
  console.log(
    pad("TOTAL", cw[0]) +
    rpad(totEligible.toLocaleString(), cw[1]) +
    rpad(totEnrolled.toLocaleString(), cw[2]) +
    rpad("$" + fmt(totPremium), cw[3])
  );

  // ── 2. DEBUG / RECONCILIATION ──────────────────────────────────────────

  console.log("\n\n");
  console.log("═".repeat(100));
  console.log("  DEBUG / RECONCILIATION SECTION");
  console.log("═".repeat(100));

  // A. Total active employees
  console.log(`\n(A) Total active employees in file: ${totalActiveEmployees.toLocaleString()}`);
  console.log(`    Total companies: ${companies.length}`);
  console.log(`    Total plans in plan map: ${planMap.size}`);

  // B. Carrier summary audit table
  console.log("\n(B) Carrier Summary Audit Table:");
  const bw = [45, 15, 15, 16, 20];
  console.log(
    pad("Carrier", bw[0]) +
    rpad("Eligible", bw[1]) +
    rpad("Enrolled", bw[2]) +
    rpad("Enroll Rows", bw[3]) +
    rpad("Monthly Premium", bw[4])
  );
  console.log("─".repeat(bw.reduce((a, b) => a + b, 0)));

  let totRows = 0;
  for (const [carrier, data] of sortedCarriers) {
    totRows += data.enrollmentRows;
    console.log(
      pad(carrier.substring(0, bw[0] - 2), bw[0]) +
      rpad(data.eligibleEmployees.size.toLocaleString(), bw[1]) +
      rpad(data.enrolledEmployees.size.toLocaleString(), bw[2]) +
      rpad(data.enrollmentRows.toLocaleString(), bw[3]) +
      rpad("$" + fmt(data.monthlyPremium), bw[4])
    );
  }
  console.log("─".repeat(bw.reduce((a, b) => a + b, 0)));
  console.log(
    pad("TOTAL", bw[0]) +
    rpad(totEligible.toLocaleString(), bw[1]) +
    rpad(totEnrolled.toLocaleString(), bw[2]) +
    rpad(totRows.toLocaleString(), bw[3]) +
    rpad("$" + fmt(totPremium), bw[4])
  );

  // C. Company-level eligibility breakdown by carrier
  console.log("\n(C) Company-Level Eligibility Breakdown by Carrier:");
  const ccw = [40, 22, 18, 16, 18];
  console.log(
    pad("Carrier", ccw[0]) +
    pad("CompanyIdentifier", ccw[1]) +
    rpad("Active Emps", ccw[2]) +
    rpad("Has Plan?", ccw[3]) +
    rpad("Eligible Contrib", ccw[4])
  );
  console.log("─".repeat(ccw.reduce((a, b) => a + b, 0)));

  for (const [carrier, companyIds] of Array.from(carrierCompanies.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    for (const companyId of Array.from(companyIds).sort()) {
      const activeSet = companyActiveEmployees.get(companyId);
      const activeCount = activeSet ? activeSet.size : 0;
      console.log(
        pad(carrier.substring(0, ccw[0] - 2), ccw[0]) +
        pad(companyId.substring(0, ccw[1] - 2), ccw[1]) +
        rpad(activeCount.toLocaleString(), ccw[2]) +
        rpad("Yes", ccw[3]) +
        rpad(activeCount.toLocaleString(), ccw[4])
      );
    }
  }

  // D. Company-level enrollment breakdown by carrier
  console.log("\n(D) Company-Level Enrollment Breakdown by Carrier:");
  const dcw = [40, 22, 16, 14, 20];
  console.log(
    pad("Carrier", dcw[0]) +
    pad("CompanyIdentifier", dcw[1]) +
    rpad("Enrolled", dcw[2]) +
    rpad("Rows", dcw[3]) +
    rpad("Premium", dcw[4])
  );
  console.log("─".repeat(dcw.reduce((a, b) => a + b, 0)));

  for (const [key, data] of Array.from(companyCarrierData.entries()).sort()) {
    const [carrier, companyId] = key.split("::");
    console.log(
      pad(carrier.substring(0, dcw[0] - 2), dcw[0]) +
      pad(companyId.substring(0, dcw[1] - 2), dcw[1]) +
      rpad(data.distinctEnrolled.size.toLocaleString(), dcw[2]) +
      rpad(data.enrollmentRows.toLocaleString(), dcw[3]) +
      rpad("$" + fmt(data.premium), dcw[4])
    );
  }

  // E. Exception / audit counts
  console.log("\n(E) Exception / Audit Counts:");
  console.log(`    Enrollments missing PlanIdentifier:               ${exceptions.missingPlanIdentifier}`);
  console.log(`    Enrollments with unmatched PlanIdentifier:        ${exceptions.unmatchedPlanIdentifier}`);
  console.log(`    Enrollments matched by fallback PlanName:         ${exceptions.fallbackPlanNameMatch}`);
  console.log(`    Current enrollments with EndDate populated:       ${exceptions.currentEnrollmentsWithEndDate}`);
  console.log(`    Premium rows with blank/invalid PlanCost (→ $0):  ${exceptions.blankOrInvalidPlanCost}`);

  // F. Comparison note
  console.log("\n(F) Reconciliation Note:");
  console.log("    If eligible counts appear materially higher than an external broker report,");
  console.log("    the likely cause is carrier-specific company exclusions, billing filters,");
  console.log("    or plan-availability rules that are NOT encoded in the Employee Navigator XML.");
  console.log("    Use section (C) and (D) above to identify which companies/carriers may be");
  console.log("    contributing to the delta.");
  console.log("");
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

const xmlPath = process.argv[2];
if (!xmlPath) {
  console.error("Usage: npx tsx scripts/validate-xml.ts <path-to-xml-file>");
  process.exit(1);
}

run(xmlPath);
