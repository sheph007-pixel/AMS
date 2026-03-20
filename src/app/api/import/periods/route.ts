import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * GET /api/import/periods
 *
 * Returns a list of all uploaded data periods with stats.
 * Used by the import page to show the year/month grid.
 */
export async function GET() {
  try {
    // Get all distinct year+month combos with counts
    const snapshots = await prisma.clientSnapshot.groupBy({
      by: ["year", "month"],
      _count: { id: true },
      orderBy: [{ year: "asc" }, { month: "asc" }],
    });

    // For each period, get additional stats
    const periods = await Promise.all(
      snapshots.map(async (s) => {
        const [benefitCount, employeeCount, latestImport] = await Promise.all([
          prisma.benefitPlan.count({
            where: { clientSnapshot: { year: s.year, month: s.month } },
          }),
          prisma.employeeSnapshot.count({
            where: { clientSnapshot: { year: s.year, month: s.month } },
          }),
          prisma.clientSnapshot.findFirst({
            where: { year: s.year, month: s.month },
            orderBy: { importedAt: "desc" },
            select: { importedAt: true },
          }),
        ]);

        return {
          year: s.year,
          month: s.month,
          groups: s._count.id,
          benefitPlans: benefitCount,
          employees: employeeCount,
          importedAt: latestImport?.importedAt?.toISOString() || null,
        };
      })
    );

    return NextResponse.json({ periods });
  } catch (error) {
    console.error("Error fetching periods:", error);
    return NextResponse.json(
      { error: "Failed to fetch periods" },
      { status: 500 }
    );
  }
}
