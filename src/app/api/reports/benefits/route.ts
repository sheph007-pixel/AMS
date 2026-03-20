import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getExclusionRules, isExcluded } from "@/lib/exclusions";

/**
 * Benefits Report: aggregates benefit plan data by carrier across the latest snapshot
 * for each client. Only counts actively enrolled employees from the most recent upload.
 * Returns per-carrier totals for enrolled employees, companies, plans, and total premium.
 */
export async function GET() {
  try {
    const exclusionRules = await getExclusionRules();

    // Find the latest snapshot per client (max year, then max month)
    const clients = await prisma.client.findMany({
      include: {
        snapshots: {
          include: {
            benefitPlans: true,
            employees: { select: { status: true } },
          },
          orderBy: [{ year: "desc" }, { month: "desc" }],
          take: 1,
        },
      },
    });

    // Filter out excluded clients
    const filteredClients = clients.filter(
      (c) => !isExcluded({ groupName: c.groupName }, exclusionRules)
    );

    // Track the most recent import date across all snapshots
    let latestImportDate: Date | null = null;

    // Aggregate by carrier
    const carrierMap = new Map<
      string,
      {
        carrier: string;
        enrolled: number;
        companies: Set<string>;
        plans: number;
        totalPremium: number;
      }
    >();

    for (const client of filteredClients) {
      const snapshot = client.snapshots[0];
      if (!snapshot) continue;

      // Track latest import date
      if (!latestImportDate || snapshot.importedAt > latestImportDate) {
        latestImportDate = snapshot.importedAt;
      }

      // Count active employees in this snapshot
      const activeEmployeeCount = snapshot.employees.filter(
        (e) => !e.status || e.status.toLowerCase() === "active"
      ).length;

      for (const plan of snapshot.benefitPlans) {
        // Apply exclusion rules to plans
        if (
          isExcluded(
            { carrier: plan.carrier, planName: plan.planName, planType: plan.planType },
            exclusionRules
          )
        ) {
          continue;
        }

        const carrierName = plan.carrier || "Unknown";
        let entry = carrierMap.get(carrierName);
        if (!entry) {
          entry = {
            carrier: carrierName,
            enrolled: 0,
            companies: new Set(),
            plans: 0,
            totalPremium: 0,
          };
          carrierMap.set(carrierName, entry);
        }

        // Use enrollees count from plan (computed at import from active enrollments)
        entry.enrolled += plan.enrollees ?? 0;
        entry.companies.add(client.id);
        entry.plans += 1;
        entry.totalPremium += plan.premium ?? 0;
      }
    }

    // Convert to array, serialize Sets as counts, sort by carrier name
    const rows = Array.from(carrierMap.values())
      .map((entry) => ({
        carrier: entry.carrier,
        enrolled: entry.enrolled,
        companies: entry.companies.size,
        plans: entry.plans,
        totalPremium: entry.totalPremium,
      }))
      .sort((a, b) => a.carrier.localeCompare(b.carrier));

    // Compute totals
    const totals = rows.reduce(
      (acc, r) => ({
        enrolled: acc.enrolled + r.enrolled,
        companies: acc.companies,
        plans: acc.plans + r.plans,
        totalPremium: acc.totalPremium + r.totalPremium,
      }),
      { enrolled: 0, companies: filteredClients.length, plans: 0, totalPremium: 0 }
    );

    return NextResponse.json({
      rows,
      totals,
      lastUpload: latestImportDate?.toISOString() || null,
    });
  } catch (error) {
    console.error("Benefits report error:", error);
    return NextResponse.json({ error: "Failed to generate report" }, { status: 500 });
  }
}
