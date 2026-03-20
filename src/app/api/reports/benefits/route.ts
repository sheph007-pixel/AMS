import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getExclusionRules, isExcluded } from "@/lib/exclusions";

/**
 * Benefits Report: aggregates benefit plan data by carrier across the latest snapshot
 * for each client. Returns per-carrier totals for eligible, enrolled, companies, plans,
 * employee costs, and plan costs.
 */
export async function GET() {
  try {
    const exclusionRules = await getExclusionRules();

    // Find the latest snapshot per client (max year, then max month)
    const clients = await prisma.client.findMany({
      include: {
        snapshots: {
          include: { benefitPlans: true },
          orderBy: [{ year: "desc" }, { month: "desc" }],
          take: 1,
        },
      },
    });

    // Filter out excluded clients
    const filteredClients = clients.filter(
      (c) => !isExcluded({ groupName: c.groupName }, exclusionRules)
    );

    // Aggregate by carrier
    const carrierMap = new Map<
      string,
      {
        carrier: string;
        eligible: number;
        enrolled: number;
        companies: Set<string>;
        plans: number;
        employeeCosts: number;
        planCosts: number;
      }
    >();

    for (const client of filteredClients) {
      const snapshot = client.snapshots[0];
      if (!snapshot) continue;

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
            eligible: 0,
            enrolled: 0,
            companies: new Set(),
            plans: 0,
            employeeCosts: 0,
            planCosts: 0,
          };
          carrierMap.set(carrierName, entry);
        }

        entry.eligible += plan.eligible ?? 0;
        entry.enrolled += plan.enrollees ?? 0;
        entry.companies.add(client.id);
        entry.plans += 1;
        entry.planCosts += plan.premium ?? 0;
      }
    }

    // Convert to array, serialize Sets as counts, sort by carrier name
    const rows = Array.from(carrierMap.values())
      .map((entry) => ({
        carrier: entry.carrier,
        eligible: entry.eligible,
        enrolled: entry.enrolled,
        companies: entry.companies.size,
        plans: entry.plans,
        employeeCosts: entry.employeeCosts,
        planCosts: entry.planCosts,
      }))
      .sort((a, b) => a.carrier.localeCompare(b.carrier));

    // Compute totals
    const totals = rows.reduce(
      (acc, r) => ({
        eligible: acc.eligible + r.eligible,
        enrolled: acc.enrolled + r.enrolled,
        companies: acc.companies,
        plans: acc.plans + r.plans,
        employeeCosts: acc.employeeCosts + r.employeeCosts,
        planCosts: acc.planCosts + r.planCosts,
      }),
      { eligible: 0, enrolled: 0, companies: filteredClients.length, plans: 0, employeeCosts: 0, planCosts: 0 }
    );

    return NextResponse.json({ rows, totals });
  } catch (error) {
    console.error("Benefits report error:", error);
    return NextResponse.json({ error: "Failed to generate report" }, { status: 500 });
  }
}
