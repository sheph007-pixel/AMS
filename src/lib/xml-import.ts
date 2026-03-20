import { XMLParser } from "fast-xml-parser";
import { prisma } from "./db";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => {
    // Ensure these are always arrays even with single elements
    return ["Group", "Employee", "Plan", "Member", "Benefit", "Coverage"].includes(name);
  },
});

interface ImportResult {
  year: number;
  clientsProcessed: number;
  clientsCreated: number;
  clientsUpdated: number;
  benefitPlansCreated: number;
  employeesProcessed: number;
  debugStructure?: unknown;
}

/**
 * Import an annual XML snapshot. Each XML represents one complete year.
 * - Deduplicates clients by groupId
 * - Creates or updates ClientSnapshot for the year
 * - For 2026, replaces the existing snapshot if re-uploaded
 * - For 2022–2025, treats as fixed historical snapshots
 */
export async function importAnnualXml(
  xmlContent: string,
  year: number
): Promise<ImportResult> {
  const parsed = parser.parse(xmlContent);

  // Try to find the groups array - support multiple XML structures
  const groups = findGroups(parsed);

  // Debug: capture the XML structure so we can see what tags are used
  const debugStructure = describeStructure(parsed, 3);

  const result: ImportResult = {
    year,
    clientsProcessed: 0,
    clientsCreated: 0,
    clientsUpdated: 0,
    benefitPlansCreated: 0,
    employeesProcessed: 0,
    debugStructure,
  };

  for (const group of groups) {
    const groupId = String(
      group["@_GroupID"] || group["@_groupId"] || group["@_id"] ||
      group.GroupID || group.groupId || group.GroupId || group.ID || group.Id ||
      `unknown-${result.clientsProcessed}`
    );
    const groupName = String(
      group["@_GroupName"] || group["@_groupName"] || group["@_name"] ||
      group.GroupName || group.groupName || group.Name || group.name || groupId
    );

    // Upsert the canonical Client record
    let client = await prisma.client.findUnique({ where: { groupId } });
    if (!client) {
      client = await prisma.client.create({
        data: {
          groupId,
          groupName,
          sicCode: extractField(group, "SICCode", "sicCode", "SIC"),
          state: extractField(group, "State", "state"),
          metadata: JSON.stringify(group),
        },
      });
      result.clientsCreated++;
    } else {
      await prisma.client.update({
        where: { id: client.id },
        data: {
          groupName,
          sicCode: extractField(group, "SICCode", "sicCode", "SIC") || client.sicCode,
          state: extractField(group, "State", "state") || client.state,
          updatedAt: new Date(),
        },
      });
      result.clientsUpdated++;
    }

    // For 2026 (active year), allow replacement. For historical years, skip if exists.
    const existingSnapshot = await prisma.clientSnapshot.findUnique({
      where: { clientId_year: { clientId: client.id, year } },
    });

    if (existingSnapshot && year < 2026) {
      result.clientsProcessed++;
      continue; // Historical snapshot already exists, skip
    }

    if (existingSnapshot && year >= 2026) {
      // Delete existing snapshot (cascade deletes plans + employees)
      await prisma.clientSnapshot.delete({ where: { id: existingSnapshot.id } });
    }

    // Create the snapshot
    const snapshot = await prisma.clientSnapshot.create({
      data: {
        clientId: client.id,
        year,
        groupName,
        totalEmployees: parseIntSafe(extractField(group, "TotalEmployees", "totalEmployees", "EmployeeCount")),
        totalMembers: parseIntSafe(extractField(group, "TotalMembers", "totalMembers", "MemberCount")),
        effectiveDate: extractField(group, "EffectiveDate", "effectiveDate"),
        renewalDate: extractField(group, "RenewalDate", "renewalDate"),
        sicCode: extractField(group, "SICCode", "sicCode", "SIC"),
        state: extractField(group, "State", "state"),
        metadata: JSON.stringify(group),
      },
    });

    // Import benefit plans
    const plans = findPlans(group);
    for (const plan of plans) {
      await prisma.benefitPlan.create({
        data: {
          clientSnapshotId: snapshot.id,
          planType: String(
            plan.PlanType || plan.planType || plan.Type || plan.type ||
            plan["@_PlanType"] || plan["@_type"] || "Unknown"
          ),
          carrier: extractField(plan, "Carrier", "carrier", "CarrierName"),
          planName: extractField(plan, "PlanName", "planName", "Name", "name"),
          enrollees: parseIntSafe(extractField(plan, "Enrollees", "enrollees", "EnrolledCount")),
          premium: parseFloatSafe(extractField(plan, "Premium", "premium", "TotalPremium")),
          metadata: JSON.stringify(plan),
        },
      });
      result.benefitPlansCreated++;
    }

    // Import employees
    const employees = findEmployees(group);
    for (const emp of employees) {
      const employeeId = String(
        emp["@_EmployeeID"] || emp["@_employeeId"] || emp["@_id"] ||
        emp.EmployeeID || emp.employeeId || emp.EmployeeId || emp.ID ||
        `emp-${result.employeesProcessed}`
      );
      await prisma.employeeSnapshot.create({
        data: {
          clientSnapshotId: snapshot.id,
          employeeId,
          firstName: String(emp.FirstName || emp.firstName || emp.first || ""),
          lastName: String(emp.LastName || emp.lastName || emp.last || ""),
          dateOfBirth: extractField(emp, "DateOfBirth", "dateOfBirth", "DOB", "dob"),
          hireDate: extractField(emp, "HireDate", "hireDate"),
          termDate: extractField(emp, "TermDate", "termDate", "TerminationDate"),
          status: extractField(emp, "Status", "status"),
          coverageTier: extractField(emp, "CoverageTier", "coverageTier", "Tier", "tier"),
          metadata: JSON.stringify(emp),
        },
      });
      result.employeesProcessed++;
    }

    result.clientsProcessed++;
  }

  return result;
}

// --- Helper functions to navigate varied XML structures ---

function findGroups(parsed: Record<string, unknown>): Record<string, unknown>[] {
  // Try common root structures
  const root = parsed.Root || parsed.root || parsed.Data || parsed.data ||
    parsed.Groups || parsed.groups || parsed.Census || parsed.census || parsed;

  if (Array.isArray(root)) return root;

  const inner = (root as Record<string, unknown>);
  const groups = inner.Group || inner.group || inner.Groups || inner.groups ||
    inner.Client || inner.client || inner.Clients || inner.clients;

  if (Array.isArray(groups)) return groups;
  if (groups && typeof groups === "object") return [groups as Record<string, unknown>];

  return [];
}

function findPlans(group: Record<string, unknown>): Record<string, unknown>[] {
  const container = group.Plans || group.plans || group.Benefits || group.benefits ||
    group.Coverages || group.coverages || group;
  if (Array.isArray(container)) return container;

  const inner = container as Record<string, unknown>;
  const plans = inner.Plan || inner.plan || inner.Benefit || inner.benefit ||
    inner.Coverage || inner.coverage;

  if (Array.isArray(plans)) return plans;
  if (plans && typeof plans === "object") return [plans as Record<string, unknown>];
  return [];
}

function findEmployees(group: Record<string, unknown>): Record<string, unknown>[] {
  const container = group.Employees || group.employees || group.Members || group.members ||
    group.Census || group.census;
  if (Array.isArray(container)) return container;

  const inner = container as Record<string, unknown>;
  const employees = inner.Employee || inner.employee || inner.Member || inner.member;

  if (Array.isArray(employees)) return employees;
  if (employees && typeof employees === "object") return [employees as Record<string, unknown>];
  return [];
}

function extractField(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return String(obj[key]);
    if (obj[`@_${key}`] !== undefined && obj[`@_${key}`] !== null) return String(obj[`@_${key}`]);
  }
  return null;
}

function parseIntSafe(val: string | null): number | null {
  if (!val) return null;
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

function parseFloatSafe(val: string | null): number | null {
  if (!val) return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

/** Recursively describe the structure of a parsed XML object (keys + types) up to maxDepth */
function describeStructure(obj: unknown, maxDepth: number, depth = 0): unknown {
  if (depth >= maxDepth) return typeof obj === "object" && obj !== null ? `{...${Object.keys(obj).length} keys}` : typeof obj;
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
  return typeof obj === "string" && obj.length > 60 ? obj.substring(0, 60) + "..." : obj;
}
