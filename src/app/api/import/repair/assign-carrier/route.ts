import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rebuildAllCaches } from "@/lib/report-cache";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * POST /api/import/repair/assign-carrier
 *
 * Manually assigns a carrier name to recovered plans that have null carriers.
 * Matches by planName or PlanIdentifier in metadata.
 *
 * Body: { planName?: string, planIdentifier?: string, carrier: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { planName, planIdentifier, carrier } = body;

    if (!carrier || typeof carrier !== "string") {
      return NextResponse.json({ error: "carrier is required" }, { status: 400 });
    }
    if (!planName && !planIdentifier) {
      return NextResponse.json({ error: "planName or planIdentifier is required" }, { status: 400 });
    }

    let updated = 0;

    // Update by planName
    if (planName) {
      const result = await prisma.benefitPlan.updateMany({
        where: {
          planName: planName,
          OR: [{ carrier: null }, { carrier: "" }],
        },
        data: { carrier },
      });
      updated += result.count;
    }

    // Update by PlanIdentifier in metadata
    if (planIdentifier) {
      // Find plans with this identifier in metadata
      const candidates = await prisma.benefitPlan.findMany({
        where: {
          OR: [{ carrier: null }, { carrier: "" }],
          metadata: { contains: planIdentifier },
        },
        select: { id: true, metadata: true },
      });

      for (const bp of candidates) {
        let meta: any = {};
        try { meta = bp.metadata ? JSON.parse(bp.metadata) : {}; } catch { continue; }
        const metaPlanId = meta.PlanIdentifier || meta.PlanId || meta.planIdentifier;
        if (metaPlanId === planIdentifier) {
          await prisma.benefitPlan.update({
            where: { id: bp.id },
            data: { carrier },
          });
          updated++;
        }
      }
    }

    if (updated > 0) {
      await rebuildAllCaches();
    }

    return NextResponse.json({
      success: true,
      updated,
      message: updated > 0
        ? `Assigned carrier "${carrier}" to ${updated} plan(s). Cache rebuilt.`
        : "No matching plans found with null carrier.",
    });
  } catch (error) {
    console.error("Assign carrier error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/import/repair/assign-carrier
 *
 * Lists all distinct plans that have null/empty carriers (unresolved).
 */
export async function GET() {
  try {
    const plans = await prisma.benefitPlan.findMany({
      where: {
        OR: [{ carrier: null }, { carrier: "" }],
      },
      select: { id: true, planName: true, planType: true, metadata: true, enrollees: true, premium: true },
    });

    // Group by planName/planIdentifier
    const grouped = new Map<string, {
      planName: string | null;
      planIdentifier: string | null;
      planType: string;
      count: number;
      totalEnrollees: number;
      totalPremium: number;
    }>();

    for (const bp of plans) {
      let meta: any = {};
      try { meta = bp.metadata ? JSON.parse(bp.metadata) : {}; } catch { /* */ }
      const planId = meta.PlanIdentifier || meta.PlanId || meta.planIdentifier || null;
      const key = planId || bp.planName || bp.id;

      let entry = grouped.get(key);
      if (!entry) {
        entry = {
          planName: bp.planName,
          planIdentifier: planId,
          planType: bp.planType,
          count: 0,
          totalEnrollees: 0,
          totalPremium: 0,
        };
        grouped.set(key, entry);
      }
      entry.count++;
      entry.totalEnrollees += bp.enrollees || 0;
      entry.totalPremium += bp.premium || 0;
    }

    return NextResponse.json({
      total: plans.length,
      groups: Array.from(grouped.values()).sort((a, b) => b.count - a.count),
    });
  } catch (error) {
    console.error("List unresolved error:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
