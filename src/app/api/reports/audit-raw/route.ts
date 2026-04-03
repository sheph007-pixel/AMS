import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * GET — Raw monthly snapshot counts from database (before report-time filtering).
 * Returns one row per month with:
 *   - raw companies, raw employees, raw plans (total stored)
 *   - excluded plan count
 *   - active vs termed employee breakdown
 */
export async function GET() {
  try {
    const snapshots = await prisma.clientSnapshot.findMany({
      where: { year: { gte: 2022 } },
      select: {
        year: true, month: true,
        client: { select: { groupId: true } },
        _count: { select: { employees: true, benefitPlans: true } },
        employees: { select: { status: true } },
        benefitPlans: { select: { excluded: true, carrier: true } },
      },
      orderBy: [{ year: "desc" }, { month: "desc" }],
    });

    const monthMap = new Map<string, {
      year: number; month: number;
      companies: Set<string>;
      rawEmployees: number;
      activeEmployees: number;
      termedEmployees: number;
      rawPlans: number;
      excludedPlans: number;
      carriers: Map<string, { rawPlans: number; excludedPlans: number }>;
    }>();

    for (const s of snapshots) {
      if (s.month < 1 || s.month > 12) continue;
      const period = `${s.year}-${String(s.month).padStart(2, "0")}`;
      let m = monthMap.get(period);
      if (!m) {
        m = { year: s.year, month: s.month, companies: new Set(), rawEmployees: 0, activeEmployees: 0, termedEmployees: 0, rawPlans: 0, excludedPlans: 0, carriers: new Map() };
        monthMap.set(period, m);
      }
      m.companies.add(s.client.groupId);
      m.rawEmployees += s._count.employees;
      m.rawPlans += s._count.benefitPlans;
      for (const e of s.employees) {
        if ((e.status || "Active").toLowerCase() === "active") m.activeEmployees++;
        else m.termedEmployees++;
      }
      for (const bp of s.benefitPlans) {
        const carrierName = bp.carrier || "Unknown";
        let cs = m.carriers.get(carrierName);
        if (!cs) { cs = { rawPlans: 0, excludedPlans: 0 }; m.carriers.set(carrierName, cs); }
        cs.rawPlans++;
        if (bp.excluded) { m.excludedPlans++; cs.excludedPlans++; }
      }
    }

    const months = Array.from(monthMap.entries()).map(([period, m]) => ({
      period,
      year: m.year,
      month: m.month,
      rawCompanies: m.companies.size,
      rawEmployees: m.rawEmployees,
      activeEmployees: m.activeEmployees,
      termedEmployees: m.termedEmployees,
      rawPlans: m.rawPlans,
      excludedPlans: m.excludedPlans,
      carriers: Array.from(m.carriers.entries()).map(([name, stats]) => ({
        carrier: name, rawPlans: stats.rawPlans, excludedPlans: stats.excludedPlans,
      })).sort((a, b) => b.rawPlans - a.rawPlans),
    }));

    return NextResponse.json(months);
  } catch (error) {
    console.error("Audit raw error:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
