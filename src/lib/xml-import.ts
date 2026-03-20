import { XMLParser } from "fast-xml-parser";
import { prisma } from "./db";

// Employee Navigator Broker Data Exchange XML parser
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => {
    // These elements can appear multiple times; force them to always be arrays
    return [
      "Company", "Plan", "Employee", "Dependent", "Enrollment", "Enrollee",
      "Address", "Phone", "Contact", "Class", "Department", "Division",
      "Office", "BusinessUnit", "PayrollGroup", "Beneficiary", "Election",
      "EmailAddress", "Salary", "FutureSalaries",
      // Also support generic names for non-EN formats
      "Group", "Member", "Benefit", "Coverage",
    ].includes(name);
  },
});

interface ImportResult {
  year: number;
  month: number | null;
  detectedDate: string | null;
  clientsProcessed: number;
  clientsCreated: number;
  clientsUpdated: number;
  benefitPlansCreated: number;
  employeesProcessed: number;
  debugStructure?: unknown;
  rawPreview?: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Import an annual XML snapshot from Employee Navigator's Broker Data Exchange format.
 *
 * Expected XML hierarchy:
 *   <Data>
 *     <Header>...</Header>
 *     <Companies>
 *       <Company>
 *         <CompanyIdentifier>...</CompanyIdentifier>
 *         <EntityName>...</EntityName>
 *         <Plans><Plan>...</Plan></Plans>
 *         <Employees><Employee>...</Employee></Employees>
 *       </Company>
 *     </Companies>
 *   </Data>
 */
/**
 * Auto-detect date from XML Header (RunDate, Created, etc.)
 */
function detectDateFromXml(parsed: any): { year: number; month: number } | null {
  const data = parsed.Data || parsed.data || parsed;
  const header = data.Header || data.header;

  // Try RunDate from header first
  const dateStr =
    (header && (header.RunDate || header.Created || header.Date)) ||
    data.RunDate || data.Created;

  if (dateStr) {
    const d = new Date(String(dateStr));
    if (!isNaN(d.getTime())) {
      return { year: d.getFullYear(), month: d.getMonth() + 1 };
    }
  }
  return null;
}

export async function importAnnualXml(
  xmlContent: string,
  year?: number,
  month?: number
): Promise<ImportResult> {
  const parsed = parser.parse(xmlContent);

  // Auto-detect date from XML if not provided
  const detected = detectDateFromXml(parsed);
  const resolvedYear = year || detected?.year || new Date().getFullYear();
  const resolvedMonth = month || detected?.month || null;

  // Load exclusion rules from the database
  const exclusionRules = await prisma.exclusionRule.findMany();

  const companies = findCompanies(parsed);
  const debugStructure = describeStructure(parsed, 4);
  const rawPreview = xmlContent.substring(0, 2000);

  const result: ImportResult = {
    year: resolvedYear,
    month: resolvedMonth,
    detectedDate: detected ? `${detected.year}-${String(detected.month).padStart(2, "0")}` : null,
    clientsProcessed: 0,
    clientsCreated: 0,
    clientsUpdated: 0,
    benefitPlansCreated: 0,
    employeesProcessed: 0,
    debugStructure,
    rawPreview,
  };

  for (const company of companies) {
    // --- Extract company/group identity ---
    const groupId = String(
      company.CompanyIdentifier || company.Identifier ||
      company["@_CompanyIdentifier"] || company["@_Identifier"] ||
      // Fallback to generic names
      company.GroupID || company.groupId || company.GroupId ||
      company["@_GroupID"] || company["@_groupId"] ||
      `unknown-${result.clientsProcessed}`
    );

    const groupName = String(
      company.EntityName || company.Name ||
      company["@_EntityName"] || company["@_Name"] ||
      // Fallback to generic names
      company.GroupName || company.groupName || groupId
    );

    const ein = extractField(company, "FederalTaxId", "TaxID", "EIN");
    const sicCode = extractField(company, "SICCode", "SIC");
    const situsState = extractField(company, "SitusState", "State", "StateAbbreviation");

    // --- Upsert canonical Client record ---
    let client = await prisma.client.findUnique({ where: { groupId } });
    if (!client) {
      client = await prisma.client.create({
        data: {
          groupId,
          groupName,
          sicCode,
          state: situsState,
          metadata: JSON.stringify(collectAllFields(company)),
        },
      });
      result.clientsCreated++;
    } else {
      await prisma.client.update({
        where: { id: client.id },
        data: {
          groupName,
          sicCode: sicCode || client.sicCode,
          state: situsState || client.state,
          updatedAt: new Date(),
        },
      });
      result.clientsUpdated++;
    }

    // --- Handle snapshot (delete existing for same year+month, then recreate) ---
    const existingSnapshot = await prisma.clientSnapshot.findUnique({
      where: { clientId_year_month: { clientId: client.id, year: resolvedYear, month: resolvedMonth ?? 0 } },
    });

    if (existingSnapshot) {
      await prisma.clientSnapshot.delete({ where: { id: existingSnapshot.id } });
    }

    // --- Count employees for snapshot totals ---
    const employees = findEmployees(company);
    const totalEmployees = employees.length;
    const totalMembers = countTotalMembers(employees);

    // --- Extract effective/renewal dates from plans ---
    const plans = findPlans(company);
    const { effectiveDate, renewalDate } = extractPlanDates(plans);

    const snapshot = await prisma.clientSnapshot.create({
      data: {
        clientId: client.id,
        year: resolvedYear,
        month: resolvedMonth ?? 0,
        groupName,
        totalEmployees: totalEmployees || null,
        totalMembers: totalMembers || null,
        effectiveDate,
        renewalDate,
        sicCode,
        state: situsState,
        metadata: JSON.stringify(collectAllFields(company)),
      },
    });

    // --- Count active enrolled per plan + sum enrollment-level MonthlyPlanCost ---
    const { enrolled: enrolledByPlan, eligible: eligibleByPlan, premiumByPlan } = countByPlan(employees);

    // --- Import benefit plans (filtered by exclusion rules) ---
    for (const plan of plans) {
      const planType = derivePlanType(plan);
      const carrier = extractField(plan, "Carrier");
      const planName = extractField(plan, "PlanName", "Name");

      // Check exclusion rules — skip if any rule matches
      if (isExcluded({ carrier, planName, planType, groupName }, exclusionRules)) {
        continue;
      }
      const planIdentifier = extractField(plan, "PlanIdentifier");

      // Plan-level cost (fallback)
      const planLevelCost = parseFloatSafe(
        extractField(plan, "MonthlyPlanCost", "PlanCost", "TotalPremium",
          "Premium", "MonthlyPremium", "Cost", "Rate")
      );

      // Enrollment-level cost (summed from active employee enrollments — preferred)
      const enrollmentCost = (planIdentifier && premiumByPlan.get(planIdentifier))
        || (planName && premiumByPlan.get(planName))
        || null;

      // Use enrollment-level premium if available, otherwise fall back to plan-level
      const premium = enrollmentCost ?? planLevelCost;

      // Match eligible/enrolled: try PlanIdentifier, then fall back to PlanName
      const enrolleeCount = (planIdentifier && enrolledByPlan.get(planIdentifier))
        || (planName && enrolledByPlan.get(planName))
        || null;
      const eligibleCount = (planIdentifier && eligibleByPlan.get(planIdentifier))
        || (planName && eligibleByPlan.get(planName))
        || null;

      await prisma.benefitPlan.create({
        data: {
          clientSnapshotId: snapshot.id,
          planType,
          carrier,
          planName,
          eligible: eligibleCount,
          enrollees: enrolleeCount,
          premium,
          metadata: JSON.stringify(collectAllFields(plan)),
        },
      });
      result.benefitPlansCreated++;
    }

    // --- Import employees ---
    for (const emp of employees) {
      const employeeId = String(
        emp.EmployeeGUID || emp.EmployeeNumber || emp.ExternalEmployeeId ||
        emp["@_EmployeeGUID"] || emp["@_EmployeeNumber"] ||
        `emp-${result.employeesProcessed}`
      );

      // Person data is nested under <Person> element
      const person: any = emp.Person || emp;
      const firstName = String(person.FirstName || person.firstName || "");
      const lastName = String(person.LastName || person.lastName || "");
      const dob = extractField(person, "DOB", "DateOfBirth", "dateOfBirth");
      const gender = extractField(person, "Gender", "gender");
      const ssn = extractField(person, "SSN", "ssn");

      const hireDate = extractField(emp, "HireDate", "HiredOn", "OriginalHireDate");
      const termDate = extractField(emp, "TerminationDate", "TerminatedOn", "TermDate");
      const status = extractField(emp, "EmploymentStatus", "Status") || deriveStatus(termDate);

      // Derive coverage tier from enrollments
      const enrollments = findEnrollments(emp);
      const coverageTier = deriveCoverageTier(enrollments);

      await prisma.employeeSnapshot.create({
        data: {
          clientSnapshotId: snapshot.id,
          employeeId,
          firstName,
          lastName,
          dateOfBirth: dob,
          hireDate,
          termDate: termDate,
          status,
          coverageTier,
          metadata: JSON.stringify(collectAllFields(emp)),
        },
      });
      result.employeesProcessed++;
    }

    result.clientsProcessed++;
  }

  return result;
}

// ===== Navigation helpers for Employee Navigator XML structure =====

function findCompanies(parsed: any): any[] {
  // Employee Navigator: Data > Companies > Company
  const data = parsed.Data || parsed.data || parsed;
  const companiesContainer = data.Companies || data.companies || data;
  const companies = companiesContainer.Company || companiesContainer.company;

  if (Array.isArray(companies)) return companies;
  if (companies && typeof companies === "object") return [companies];

  // Fallback: try generic Group-based structure
  const root = parsed.Root || parsed.root || parsed.Data || parsed.data ||
    parsed.Groups || parsed.groups || parsed;
  if (Array.isArray(root)) return root;
  const inner = root as any;
  const groups = inner.Group || inner.group || inner.Groups || inner.groups ||
    inner.Client || inner.client || inner.Clients || inner.clients ||
    inner.Company || inner.company;
  if (Array.isArray(groups)) return groups;
  if (groups && typeof groups === "object") return [groups];

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

function findDependents(employee: any): any[] {
  const container = employee.Dependents || employee.dependents;
  if (!container) return [];
  if (Array.isArray(container)) return container;
  const deps = container.Dependent || container.dependent;
  if (Array.isArray(deps)) return deps;
  if (deps && typeof deps === "object") return [deps];
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

// ===== Field extraction helpers =====

function extractField(obj: any, ...keys: string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "") return String(obj[key]);
    if (obj[`@_${key}`] !== undefined && obj[`@_${key}`] !== null) return String(obj[`@_${key}`]);
  }
  return null;
}

function extractAddress(company: any): any {
  const addresses = company.Addresses || company.addresses;
  if (!addresses) return null;
  const addrList = addresses.Address || addresses.address;
  const addr = Array.isArray(addrList) ? addrList[0] : addrList;
  if (!addr) return null;
  return {
    address1: extractField(addr, "Address1", "Address"),
    address2: extractField(addr, "Address2"),
    city: extractField(addr, "City"),
    state: extractField(addr, "State", "StateAbbreviation"),
    zip: extractField(addr, "ZIP", "Zip"),
    county: extractField(addr, "County"),
    country: extractField(addr, "Country"),
  };
}

function extractPhone(company: any): string | null {
  const contacts = company.Contacts || company.contacts;
  if (!contacts) return null;
  const contactList = contacts.Contact || contacts.contact;
  const contact = Array.isArray(contactList) ? contactList[0] : contactList;
  if (!contact) return null;
  const phones = contact.Phones || contact.phones;
  if (!phones) return null;
  const phoneList = phones.Phone || phones.phone;
  const phone = Array.isArray(phoneList) ? phoneList[0] : phoneList;
  if (!phone) return null;
  return extractField(phone, "VoiceNumber", "Number", "PhoneNumber");
}

function extractNames(company: any, containerKey: string, itemKey: string): string[] {
  const container = company[containerKey];
  if (!container) return [];
  const items = container[itemKey];
  if (!items) return [];
  const list = Array.isArray(items) ? items : [items];
  return list.map((item: any) =>
    typeof item === "string" ? item : (item.Name || item.name || item.Description || "")
  ).filter(Boolean);
}

// ===== Derived fields =====

function derivePlanType(plan: any): string {
  // Try explicit plan type code first
  const typeCode = extractField(plan, "CarrierPlanTypeCode", "PlanType", "Type");
  if (typeCode) {
    const code = typeCode.toUpperCase();
    if (code.startsWith("MED")) return "Medical";
    if (code.startsWith("DEN")) return "Dental";
    if (code.startsWith("VIS")) return "Vision";
    if (code.startsWith("LIF") || code === "LIFE") return "Life";
    if (code === "ADD" || code.startsWith("AD&D") || code.startsWith("ADD")) return "AD&D";
    if (code.startsWith("STD") || code.includes("SHORT")) return "Short-Term Disability";
    if (code.startsWith("LTD") || code.includes("LONG")) return "Long-Term Disability";
    if (code.includes("HSA")) return "HSA";
    if (code.includes("FSA")) return "FSA";
    if (code.includes("HRA")) return "HRA";
    if (code.includes("EAP")) return "EAP";
    if (code.includes("COBRA")) return "COBRA";
    if (code.includes("VOL")) return `Voluntary ${typeCode}`;
    return typeCode; // Use as-is if no mapping
  }

  // Try to infer from plan name
  const planName = (extractField(plan, "PlanName", "Name") || "").toLowerCase();
  if (planName.includes("medical") || planName.includes("health")) return "Medical";
  if (planName.includes("dental")) return "Dental";
  if (planName.includes("vision")) return "Vision";
  if (planName.includes("life")) return "Life";
  if (planName.includes("disability")) return "Disability";

  return "Unknown";
}

function deriveStatus(termDate: string | null): string {
  if (!termDate) return "Active";
  const term = new Date(termDate);
  return term <= new Date() ? "Terminated" : "Active";
}

function deriveCoverageTier(enrollments: any[]): string | null {
  if (enrollments.length === 0) return null;
  // Look for coverage level on the first enrollment (usually medical)
  for (const enrollment of enrollments) {
    const level = extractField(enrollment, "CoverageLevel", "Tier", "CoverageTier");
    if (level) return level;
  }
  return null;
}

/**
 * Count how many employees are enrolled in each plan by scanning all employee enrollments.
 * Returns a Map keyed by PlanIdentifier (or PlanName) → count.
 */
/**
 * Check if a plan should be excluded based on exclusion rules.
 * Matches are case-insensitive and support partial "contains" matching.
 */
function isExcluded(
  fields: Record<string, string | null>,
  rules: { field: string; value: string }[]
): boolean {
  for (const rule of rules) {
    const fieldValue = fields[rule.field];
    if (fieldValue && fieldValue.toLowerCase().includes(rule.value.toLowerCase())) {
      return true;
    }
  }
  return false;
}

/**
 * Count active enrolled employees and sum PlanCost per plan from enrollment data.
 *
 * Rules:
 * - Only processes employees whose EmploymentStatus = "Active"
 * - Enrolled: active employee has an enrollment with EnrollmentType = "Current"
 *   (Do NOT exclude rows just because EndDate is populated)
 * - Eligible: active employee has any enrollment record for that plan (even declined)
 * - Premium: sum of PlanCost from ALL qualifying enrollment rows (row-level, not deduped)
 * - PlanCost = total monthly premium as billed by carrier (employee + dependents)
 */
function countByPlan(employees: any[]): {
  enrolled: Map<string, number>;
  eligible: Map<string, number>;
  premiumByPlan: Map<string, number>;
} {
  const enrolled = new Map<string, number>();
  const eligible = new Map<string, number>();
  const premiumByPlan = new Map<string, number>();

  for (const emp of employees) {
    // Only count active employees
    const termDate = extractField(emp, "TerminationDate", "TerminatedOn", "TermDate");
    const status = extractField(emp, "EmploymentStatus", "Status") || deriveStatus(termDate);
    if (status.toLowerCase() !== "active") continue;

    const enrollments = findEnrollments(emp);
    const seenEnrolled = new Set<string>();
    const seenEligible = new Set<string>();

    for (const enrollment of enrollments) {
      const planKey =
        extractField(enrollment, "PlanIdentifier", "PlanId", "PlanID") ||
        extractField(enrollment, "PlanName", "Name") ||
        null;
      if (!planKey) continue;

      // Every enrollment record means the employee is eligible for this plan
      if (!seenEligible.has(planKey)) {
        seenEligible.add(planKey);
        eligible.set(planKey, (eligible.get(planKey) || 0) + 1);
      }

      // Only count "Current" enrollments for enrolled + premium
      const enrollmentType = extractField(enrollment, "EnrollmentType", "Type");
      const isCurrent = enrollmentType && enrollmentType.toLowerCase() === "current";

      // Fallback: if EnrollmentType is not present in the XML, use the old logic
      // (no DeclineReason and coverage not ended)
      let isQualifying = false;
      if (enrollmentType) {
        // EnrollmentType field exists — use it strictly
        isQualifying = !!isCurrent;
      } else {
        // EnrollmentType not present — fall back to decline/end check
        const declineReason = extractField(enrollment, "DeclineReason");
        const endDate = extractField(enrollment, "CoverageEndDate", "EndDate", "EndedOn");
        const isEnded = endDate && new Date(endDate) <= new Date();
        isQualifying = !declineReason && !isEnded;
      }

      if (isQualifying) {
        // Distinct enrolled employee per plan
        if (!seenEnrolled.has(planKey)) {
          seenEnrolled.add(planKey);
          enrolled.set(planKey, (enrolled.get(planKey) || 0) + 1);
        }

        // Sum PlanCost at the enrollment-row level (NOT deduped per employee)
        const cost = parseFloatSafe(
          extractField(enrollment, "PlanCost", "MonthlyPlanCost", "TotalPremium",
            "Premium", "MonthlyPremium", "TotalMonthlyPremium",
            "Cost", "Rate")
        );
        if (cost) {
          premiumByPlan.set(planKey, (premiumByPlan.get(planKey) || 0) + cost);
        }
      }
    }
  }

  return { enrolled, eligible, premiumByPlan };
}

function extractPlanDates(plans: any[]): { effectiveDate: string | null; renewalDate: string | null } {
  for (const plan of plans) {
    const starts = extractField(plan, "PlanStarts", "EffectiveDate", "StartDate");
    const ends = extractField(plan, "PlanEnds", "RenewalDate", "EndDate");
    if (starts) return { effectiveDate: starts, renewalDate: ends };
  }
  return { effectiveDate: null, renewalDate: null };
}

function countTotalMembers(employees: any[]): number {
  let total = 0;
  for (const emp of employees) {
    total++; // Employee themselves
    total += findDependents(emp).length;
  }
  return total;
}

// ===== Full-field capture =====

/** Recursively collect all fields from a parsed XML object into a flat-ish JSON structure.
 *  Skips large nested containers (Employees, Plans, Companies) to avoid duplication.
 *  Masks SSN values for privacy. */
const SKIP_CONTAINERS = new Set([
  "Companies", "companies", "Employees", "employees", "Plans", "plans",
  "Company", "company", "Employee", "employee", "Plan", "plan",
]);

function collectAllFields(obj: any, depth = 0): any {
  if (depth > 6 || !obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => collectAllFields(item, depth + 1));
  }
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    // Skip large containers that are stored separately
    if (depth === 0 && SKIP_CONTAINERS.has(key)) continue;
    // Mask SSN values
    if ((key === "SSN" || key === "ssn") && typeof value === "string" && value.length >= 4) {
      result[key] = `***-**-${value.slice(-4)}`;
      continue;
    }
    result[key] = collectAllFields(value, depth + 1);
  }
  return result;
}

// ===== Utility =====

function parseFloatSafe(val: string | null): number | null {
  if (!val) return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

/** Recursively describe the structure of a parsed XML object (keys + types) up to maxDepth */
function describeStructure(obj: unknown, maxDepth: number, depth = 0): unknown {
  if (depth >= maxDepth) return typeof obj === "object" && obj !== null ? `{...${Object.keys(obj as Record<string, unknown>).length} keys}` : typeof obj;
  if (Array.isArray(obj)) {
    return { _type: `Array[${obj.length}]`, _first: obj.length > 0 ? describeStructure(obj[0], maxDepth, depth + 1) : null };
  }
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = describeStructure(value, maxDepth, depth + 1);
    }
    return result;
  }
  return typeof obj === "string" && (obj as string).length > 60 ? (obj as string).substring(0, 60) + "..." : obj;
}
