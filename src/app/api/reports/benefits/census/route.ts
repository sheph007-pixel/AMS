import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getExclusionRules, isExcluded } from "@/lib/exclusions";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Census-level enrollment detail for a specific carrier.
 *
 * GET /api/reports/benefits/census?carrier=Guardian
 *
 * Returns every qualifying enrollment row for that carrier from the latest
 * data period, with: group name, employee name, plan name, tier, PlanCost.
 * The sum of PlanCost across all rows equals the carrier's Monthly Premium
 * in the main Benefits Report.
 */
export async function GET(request: NextRequest) {
  try {
    const carrier = request.nextUrl.searchParams.get("carrier");
    if (!carrier) {
      return NextResponse.json({ error: "carrier parameter required" }, { status: 400 });
    }

    const exclusionRules = await getExclusionRules();

    // Latest data period
    const latestSnapshot = await prisma.clientSnapshot.findFirst({
      orderBy: [{ year: "desc" }, { month: "desc" }],
      select: { year: true, month: true },
    });

    if (!latestSnapshot) {
      return NextResponse.json({ rows: [] });
    }

    const snapshots = await prisma.clientSnapshot.findMany({
      where: { year: latestSnapshot.year, month: latestSnapshot.month },
      include: {
        client: true,
        benefitPlans: true,
      },
    });

    const rows: {
      groupName: string;
      employeeName: string;
      carrier: string;
      planName: string;
      planType: string;
      coverageTier: string;
      planCost: number;
    }[] = [];

    for (const snapshot of snapshots) {
      if (isExcluded({ groupName: snapshot.client.groupName }, exclusionRules)) continue;

      const groupName = snapshot.client.groupName;

      // Build plan lookup: PlanIdentifier → { carrier, planName, planType }
      const planIdLookup = new Map<string, { carrier: string; planName: string; planType: string }>();
      const planNameLookup = new Map<string, { carrier: string; planName: string; planType: string }>();

      for (const bp of snapshot.benefitPlans) {
        if (isExcluded({ carrier: bp.carrier, planName: bp.planName, planType: bp.planType }, exclusionRules)) continue;

        const info = {
          carrier: bp.carrier || "Unspecified Carrier",
          planName: bp.planName || "",
          planType: bp.planType || "",
        };

        if (bp.metadata) {
          try {
            const meta = JSON.parse(bp.metadata);
            const planId = meta.PlanIdentifier || meta.planIdentifier;
            if (planId) planIdLookup.set(String(planId), info);
          } catch { /* ignore */ }
        }
        if (bp.planName) planNameLookup.set(bp.planName, info);
      }

      // Process active employees in batches to avoid loading all into memory
      const BATCH_SIZE = 500;
      let skip = 0;
      let hasMore = true;
      while (hasMore) {
        const employeeBatch = await prisma.employeeSnapshot.findMany({
          where: { clientSnapshotId: snapshot.id },
          select: { employeeId: true, status: true, metadata: true, lastName: true, firstName: true },
          take: BATCH_SIZE,
          skip,
        });
        if (employeeBatch.length < BATCH_SIZE) hasMore = false;
        skip += BATCH_SIZE;

        for (const emp of employeeBatch) {
          if ((emp.status || "Active").toLowerCase() !== "active") continue;

          if (!emp.metadata) continue;
          let meta: any;
          try { meta = JSON.parse(emp.metadata); } catch { continue; }

          const enrollments = findEnrollmentsFromMeta(meta);
          const employeeName = `${emp.lastName}, ${emp.firstName}`.trim();

          for (const enrollment of enrollments) {
            // EnrollmentType = "Current" filter
            const enrollmentType = enrollment.EnrollmentType || enrollment.enrollmentType || enrollment.Type;
            let isQualifying = false;
            if (enrollmentType) {
              isQualifying = String(enrollmentType).toLowerCase() === "current";
            } else {
              const declineReason = enrollment.DeclineReason || enrollment.declineReason;
              const endDate = enrollment.CoverageEndDate || enrollment.EndDate || enrollment.EndedOn;
              const isEnded = endDate && new Date(String(endDate)) <= new Date();
              isQualifying = !declineReason && !isEnded;
            }
            if (!isQualifying) continue;

            // Resolve carrier
            const enrollPlanId = String(enrollment.PlanIdentifier || enrollment.PlanId || enrollment.PlanID || "");
            const enrollPlanName = String(enrollment.PlanName || enrollment.Plan || enrollment.Name || "");

            let resolved: { carrier: string; planName: string; planType: string } | undefined;
            if (enrollPlanId) {
              resolved = planIdLookup.get(enrollPlanId);
              if (!resolved && enrollPlanName) resolved = planNameLookup.get(enrollPlanName);
            } else if (enrollPlanName) {
              resolved = planNameLookup.get(enrollPlanName);
            }

            if (!resolved || resolved.carrier !== carrier) continue;

            // PlanCost
            const rawCost = String(enrollment.PlanCost || enrollment.MonthlyPlanCost || "");
            const cost = rawCost ? parseFloat(rawCost) : 0;
            const planCost = !isNaN(cost) ? Math.round(cost * 100) / 100 : 0;

            // Coverage tier
            const tier = String(
              enrollment.CoverageLevel || enrollment.Tier || enrollment.CoverageTier ||
              enrollment.coverageLevel || enrollment.tier || ""
            );

            rows.push({
              groupName,
              employeeName,
              carrier: resolved.carrier,
              planName: resolved.planName || enrollPlanName,
              planType: resolved.planType,
              coverageTier: tier,
              planCost,
            });
          }
        }
      }
    }

    // Sort by group name, then employee name
    rows.sort((a, b) => a.groupName.localeCompare(b.groupName) || a.employeeName.localeCompare(b.employeeName));

    return NextResponse.json({ rows });
  } catch (error) {
    console.error("Census detail error:", error);
    return NextResponse.json({ error: "Failed to generate census detail" }, { status: 500 });
  }
}

function findEnrollmentsFromMeta(meta: any): any[] {
  const container = meta.Enrollments || meta.enrollments;
  if (!container) return [];
  if (Array.isArray(container)) return container;
  const enrollments = container.Enrollment || container.enrollment;
  if (Array.isArray(enrollments)) return enrollments;
  if (enrollments && typeof enrollments === "object") return [enrollments];
  return [];
}
