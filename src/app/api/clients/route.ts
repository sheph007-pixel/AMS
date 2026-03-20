import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deriveLifecycleStatus } from "@/lib/lifecycle";
import { getExclusionRules, isExcluded } from "@/lib/exclusions";

/**
 * Helper: count active employees from a snapshot.
 * Uses individual employee records if available, falls back to totalEmployees.
 */
function countActiveEmployees(snapshot: {
  totalEmployees: number | null;
  employees: { status: string | null }[];
}): number {
  if (snapshot.employees.length > 0) {
    return snapshot.employees.filter(
      (e) => !e.status || e.status.toLowerCase() === "active"
    ).length;
  }
  return snapshot.totalEmployees ?? 0;
}

/**
 * Helper: sum premium from benefit plans in a snapshot.
 */
function sumPremium(plans: { premium: number | null }[]): number {
  return plans.reduce((sum, p) => sum + (p.premium ?? 0), 0);
}

export async function GET() {
  try {
    const clients = await prisma.client.findMany({
      include: {
        snapshots: {
          select: {
            id: true,
            year: true,
            month: true,
            totalEmployees: true,
            totalMembers: true,
            effectiveDate: true,
            renewalDate: true,
            benefitPlans: {
              select: {
                planType: true,
                carrier: true,
                enrollees: true,
                premium: true,
              },
            },
            employees: {
              select: {
                status: true,
              },
            },
          },
          orderBy: [{ year: "asc" }, { month: "asc" }],
        },
      },
      orderBy: { groupName: "asc" },
    });

    // Get all years in the system
    const allYearsResult = await prisma.clientSnapshot.findMany({
      select: { year: true },
      distinct: ["year"],
      orderBy: { year: "asc" },
    });
    const allSystemYears = allYearsResult.map((r) => r.year);
    const currentYear =
      allSystemYears.length > 0
        ? Math.max(...allSystemYears)
        : new Date().getFullYear();
    // Use the actual previous data year (not currentYear - 1)
    // to handle non-consecutive years like [2022, 2024, 2026]
    const previousYears = allSystemYears.filter((y) => y < currentYear);
    const lastYear =
      previousYears.length > 0
        ? Math.max(...previousYears)
        : currentYear - 1;

    // Apply exclusion rules
    const exclusionRules = await getExclusionRules();
    const filteredClients = clients.filter(
      (client) => !isExcluded({ groupName: client.groupName }, exclusionRules)
    );

    // Track YoY summary metrics
    let currentYearActiveGroups = 0;
    let lastYearActiveGroups = 0;
    let currentYearEnrolled = 0;
    let lastYearEnrolled = 0;
    let currentYearPremium = 0;
    let lastYearPremium = 0;

    const enriched = filteredClients.map((client) => {
      const years = client.snapshots.map((s) => s.year);
      const uniqueYears = [...new Set(years)];
      const status = deriveLifecycleStatus(uniqueYears, allSystemYears);

      // Use the current-year snapshot for active groups (consistent with cards)
      const currentYearSnapshots = client.snapshots.filter(
        (s) => s.year === currentYear
      );
      const lastYearSnapshots = client.snapshots.filter(
        (s) => s.year === lastYear
      );
      const cySnap =
        currentYearSnapshots.length > 0
          ? currentYearSnapshots[currentYearSnapshots.length - 1]
          : null;
      const lySnap =
        lastYearSnapshots.length > 0
          ? lastYearSnapshots[lastYearSnapshots.length - 1]
          : null;

      // Active employee count from the current year snapshot
      const activeEmployeeCount = cySnap ? countActiveEmployees(cySnap) : null;

      // Determine benefit types from the current year snapshot
      const planTypes = new Set<string>();
      if (cySnap) {
        for (const plan of cySnap.benefitPlans) {
          const t = plan.planType?.toLowerCase() || "";
          if (t.includes("medical") || t.includes("health"))
            planTypes.add("Medical");
          else if (t.includes("dental")) planTypes.add("Dental");
          else if (t.includes("vision")) planTypes.add("Vision");
          else planTypes.add("Supplemental");
        }
      }

      // Accumulate YoY metrics
      if (cySnap) {
        currentYearActiveGroups++;
        currentYearEnrolled += countActiveEmployees(cySnap);
        currentYearPremium += sumPremium(cySnap.benefitPlans);
      }

      if (lySnap) {
        lastYearActiveGroups++;
        lastYearEnrolled += countActiveEmployees(lySnap);
        lastYearPremium += sumPremium(lySnap.benefitPlans);
      }

      return {
        id: client.id,
        groupId: client.groupId,
        groupName: client.groupName,
        sicCode: client.sicCode,
        state: client.state,
        years: uniqueYears,
        status,
        activeEmployees: activeEmployeeCount,
        hasMedical: planTypes.has("Medical"),
        hasDental: planTypes.has("Dental"),
        hasVision: planTypes.has("Vision"),
        hasSupplemental: planTypes.has("Supplemental"),
      };
    });

    // Cross-check: active clients in enriched should match currentYearActiveGroups
    const activeInList = enriched.filter(
      (c) => c.status === "Active" || c.status === "New" || c.status === "Returned"
    );
    const enrolledFromList = activeInList.reduce(
      (sum, c) => sum + (c.activeEmployees ?? 0),
      0
    );

    // Log audit for verification
    console.log("[Groups API Audit]", {
      systemYears: allSystemYears,
      currentYear,
      lastYear,
      activeGroupsCard: currentYearActiveGroups,
      activeGroupsInList: activeInList.length,
      enrolledCard: currentYearEnrolled,
      enrolledFromList,
      premiumCurrent: currentYearPremium,
      premiumPrevious: lastYearPremium,
      match:
        currentYearActiveGroups === activeInList.length &&
        currentYearEnrolled === enrolledFromList,
    });

    const summary = {
      currentYear,
      lastYear,
      activeGroups: {
        current: currentYearActiveGroups,
        previous: lastYearActiveGroups,
      },
      enrolled: { current: currentYearEnrolled, previous: lastYearEnrolled },
      premium: { current: currentYearPremium, previous: lastYearPremium },
    };

    return NextResponse.json({
      clients: enriched,
      systemYears: allSystemYears,
      summary,
    });
  } catch (error) {
    console.error("Error fetching clients:", error);
    return NextResponse.json(
      { error: "Failed to fetch clients" },
      { status: 500 }
    );
  }
}
