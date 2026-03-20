import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deriveLifecycleStatus } from "@/lib/lifecycle";
import { getExclusionRules, isExcluded } from "@/lib/exclusions";

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
    const currentYear = allSystemYears.length > 0 ? Math.max(...allSystemYears) : new Date().getFullYear();
    const lastYear = currentYear - 1;

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

      // Get the latest snapshot
      const latestSnapshot = client.snapshots[client.snapshots.length - 1] || null;

      // Count only active employees from the latest snapshot
      let activeEmployeeCount: number | null = null;
      if (latestSnapshot) {
        if (latestSnapshot.employees.length > 0) {
          activeEmployeeCount = latestSnapshot.employees.filter(
            (e) => !e.status || e.status.toLowerCase() === "active"
          ).length;
        } else {
          activeEmployeeCount = latestSnapshot.totalEmployees;
        }
      }

      // Determine benefit types from the latest snapshot
      const planTypes = new Set<string>();
      if (latestSnapshot) {
        for (const plan of latestSnapshot.benefitPlans) {
          const t = plan.planType?.toLowerCase() || "";
          if (t.includes("medical") || t.includes("health")) planTypes.add("Medical");
          else if (t.includes("dental")) planTypes.add("Dental");
          else if (t.includes("vision")) planTypes.add("Vision");
          else planTypes.add("Supplemental");
        }
      }

      // Accumulate YoY metrics
      const currentYearSnapshots = client.snapshots.filter((s) => s.year === currentYear);
      const lastYearSnapshots = client.snapshots.filter((s) => s.year === lastYear);

      if (currentYearSnapshots.length > 0) {
        currentYearActiveGroups++;
        const cySnap = currentYearSnapshots[currentYearSnapshots.length - 1];
        currentYearEnrolled += cySnap.totalEmployees ?? 0;
        for (const plan of cySnap.benefitPlans) {
          currentYearPremium += plan.premium ?? 0;
        }
      }

      if (lastYearSnapshots.length > 0) {
        lastYearActiveGroups++;
        const lySnap = lastYearSnapshots[lastYearSnapshots.length - 1];
        lastYearEnrolled += lySnap.totalEmployees ?? 0;
        for (const plan of lySnap.benefitPlans) {
          lastYearPremium += plan.premium ?? 0;
        }
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

    const summary = {
      currentYear,
      lastYear,
      activeGroups: { current: currentYearActiveGroups, previous: lastYearActiveGroups },
      enrolled: { current: currentYearEnrolled, previous: lastYearEnrolled },
      premium: { current: currentYearPremium, previous: lastYearPremium },
    };

    return NextResponse.json({ clients: enriched, systemYears: allSystemYears, summary });
  } catch (error) {
    console.error("Error fetching clients:", error);
    return NextResponse.json({ error: "Failed to fetch clients" }, { status: 500 });
  }
}
