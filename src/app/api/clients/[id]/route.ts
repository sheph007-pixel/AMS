import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deriveLifecycleStatus } from "@/lib/lifecycle";
import { getExclusionRules, filterBenefitPlans } from "@/lib/exclusions";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const client = await prisma.client.findUnique({
      where: { id },
      include: {
        snapshots: {
          include: {
            benefitPlans: true,
            employees: true,
          },
          orderBy: [{ year: "asc" }, { month: "asc" }],
        },
      },
    });

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    // Apply exclusion rules to filter out excluded benefit plans
    const exclusionRules = await getExclusionRules();
    for (const snapshot of client.snapshots) {
      snapshot.benefitPlans = filterBenefitPlans(snapshot.benefitPlans, exclusionRules);
    }

    const allYearsResult = await prisma.clientSnapshot.findMany({
      select: { year: true },
      distinct: ["year"],
      orderBy: { year: "asc" },
    });
    const allSystemYears = allYearsResult.map((r) => r.year);
    const clientYears = client.snapshots.map((s) => s.year);
    const status = deriveLifecycleStatus(clientYears, allSystemYears);

    // Derive employee change status across years
    const snapshotsWithDerivedEmployees = client.snapshots.map((snapshot, idx) => {
      const prevSnapshot = idx > 0 ? client.snapshots[idx - 1] : null;
      const prevEmployeeIds = prevSnapshot
        ? new Set(prevSnapshot.employees.map((e) => e.employeeId))
        : null;

      const employees = snapshot.employees.map((emp) => {
        let changeStatus: "added" | "termed" | "continued" | null = null;
        if (prevEmployeeIds) {
          changeStatus = prevEmployeeIds.has(emp.employeeId) ? "continued" : "added";
        }
        return { ...emp, changeStatus };
      });

      // Find termed employees (in prev year but not this year)
      const currentIds = new Set(snapshot.employees.map((e) => e.employeeId));
      const termedEmployees = prevSnapshot
        ? prevSnapshot.employees
            .filter((e) => !currentIds.has(e.employeeId))
            .map((e) => ({ ...e, changeStatus: "termed" as const }))
        : [];

      return {
        ...snapshot,
        employees,
        termedEmployees,
      };
    });

    return NextResponse.json({
      id: client.id,
      groupId: client.groupId,
      groupName: client.groupName,
      sicCode: client.sicCode,
      state: client.state,
      status,
      years: clientYears,
      firstYear: clientYears.length > 0 ? Math.min(...clientYears) : null,
      lastYear: clientYears.length > 0 ? Math.max(...clientYears) : null,
      systemYears: allSystemYears,
      snapshots: snapshotsWithDerivedEmployees,
    });
  } catch (error) {
    console.error("Error fetching client:", error);
    return NextResponse.json({ error: "Failed to fetch client" }, { status: 500 });
  }
}
