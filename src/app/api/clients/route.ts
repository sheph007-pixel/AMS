import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deriveLifecycleStatus } from "@/lib/lifecycle";
import { getExclusionRules, isExcluded } from "@/lib/exclusions";

export async function GET() {
  try {
    const clients = await prisma.client.findMany({
      include: {
        snapshots: {
          select: { year: true, totalEmployees: true, totalMembers: true },
          orderBy: { year: "asc" },
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

    // Apply exclusion rules — filter out clients matching groupName rules
    const exclusionRules = await getExclusionRules();
    const filteredClients = clients.filter(
      (client) => !isExcluded({ groupName: client.groupName }, exclusionRules)
    );

    const enriched = filteredClients.map((client) => {
      const years = client.snapshots.map((s) => s.year);
      const status = deriveLifecycleStatus(years, allSystemYears);
      const firstYear = years.length > 0 ? Math.min(...years) : null;
      const lastYear = years.length > 0 ? Math.max(...years) : null;

      return {
        id: client.id,
        groupId: client.groupId,
        groupName: client.groupName,
        sicCode: client.sicCode,
        state: client.state,
        years,
        firstYear,
        lastYear,
        status,
      };
    });

    return NextResponse.json({ clients: enriched, systemYears: allSystemYears });
  } catch (error) {
    console.error("Error fetching clients:", error);
    return NextResponse.json({ error: "Failed to fetch clients" }, { status: 500 });
  }
}
