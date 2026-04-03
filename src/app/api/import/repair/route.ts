import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rebuildAllCaches } from "@/lib/report-cache";

/**
 * POST /api/import/repair
 *
 * Scans all EmployeeSnapshot metadata to discover plan references that have no
 * corresponding BenefitPlan record. This recovers plans that were dropped during
 * historical imports due to the old exclusion bug (plans were skipped instead of
 * stored with excluded=true).
 *
 * For each snapshot:
 *   1. Load existing BenefitPlan records (keyed by planIdentifier/planName)
 *   2. Scan employee enrollment metadata for plan references
 *   3. Create missing BenefitPlan records with recovered data
 *   4. Re-count enrolled/eligible/premium from enrollment data
 *   5. Rebuild report cache
 */
export async function POST() {
  try {
    const startTime = Date.now();

    // Load all snapshots with their existing benefit plans
    const snapshots = await prisma.clientSnapshot.findMany({
      where: { year: { gte: 2022 } },
      select: {
        id: true,
        year: true,
        month: true,
        client: { select: { groupId: true, groupName: true } },
        benefitPlans: {
          select: {
            id: true,
            carrier: true,
            planName: true,
            planType: true,
            metadata: true,
          },
        },
      },
      orderBy: [{ year: "asc" }, { month: "asc" }],
    });

    let totalRecovered = 0;
    let totalUpdated = 0;
    let snapshotsProcessed = 0;
    const recoveredPlans: { period: string; carrier: string | null; planName: string | null; planType: string; enrollees: number }[] = [];

    for (const snap of snapshots) {
      if (snap.month < 1 || snap.month > 12) continue;
      const period = `${snap.year}-${String(snap.month).padStart(2, "0")}`;

      // Build set of known plan keys (plans that DO exist in BenefitPlan)
      const knownPlanIds = new Set<string>();
      const knownPlanNames = new Set<string>();
      const planMetadataById = new Map<string, any>();

      for (const bp of snap.benefitPlans) {
        if (bp.planName) knownPlanNames.add(bp.planName);
        // Parse metadata for PlanIdentifier
        let meta: any = {};
        try { meta = bp.metadata ? JSON.parse(bp.metadata) : {}; } catch { /* */ }
        const planId = meta.PlanIdentifier || meta.PlanId || meta.PlanID || meta["@_PlanIdentifier"];
        if (planId) {
          knownPlanIds.add(String(planId));
          planMetadataById.set(String(planId), bp);
        }
      }

      // Load employee snapshots with metadata
      const employees = await prisma.employeeSnapshot.findMany({
        where: { clientSnapshotId: snap.id },
        select: { employeeId: true, status: true, metadata: true },
      });

      // Scan enrollments to discover plan references
      const discoveredPlans = new Map<string, {
        planIdentifier: string | null;
        planName: string | null;
        carrier: string | null;
        planType: string;
        enrolledCount: number;
        eligibleCount: number;
        premiumSum: number;
        enrollmentSamples: any[];
      }>();

      for (const emp of employees) {
        let empMeta: any;
        try { empMeta = emp.metadata ? JSON.parse(emp.metadata) : null; } catch { continue; }
        if (!empMeta) continue;

        const enrollments = findEnrollments(empMeta);
        const isActive = (emp.status || "Active").toLowerCase() === "active";

        for (const enrollment of enrollments) {
          const planId = getField(enrollment, "PlanIdentifier", "PlanId", "PlanID");
          const planName = getField(enrollment, "PlanName", "Plan", "Name");
          const planKey = planId || planName;
          if (!planKey) continue;

          // Check if this plan already exists
          const existsById = planId && knownPlanIds.has(planId);
          const existsByName = planName && knownPlanNames.has(planName);
          if (existsById || existsByName) continue;

          // This is a missing plan — discover it
          let info = discoveredPlans.get(planKey);
          if (!info) {
            // Try to extract carrier from enrollment (some XML formats include it)
            const carrier = getField(enrollment, "Carrier", "CarrierName", "InsuranceCarrier")
              || getField(enrollment, "CompanyName")  // Sometimes carrier is in CompanyName at enrollment level
              || null;

            // Try to determine plan type
            const effectivePlanName = planName || planId;
            const planType = derivePlanTypeFromEnrollment(enrollment, effectivePlanName);

            info = {
              planIdentifier: planId,
              planName: effectivePlanName,
              carrier,
              planType,
              enrolledCount: 0,
              eligibleCount: 0,
              premiumSum: 0,
              enrollmentSamples: [],
            };
            discoveredPlans.set(planKey, info);
          }

          // Update planName if we discover it from a later enrollment
          if (!info.planName && planName) info.planName = planName;
          if (!info.carrier) {
            const foundCarrier = getField(enrollment, "Carrier", "CarrierName", "InsuranceCarrier");
            if (foundCarrier) info.carrier = foundCarrier;
          }

          // Count eligible (any enrollment reference)
          info.eligibleCount++;

          // Count enrolled (active employees with current enrollment)
          if (isActive) {
            const enrollmentType = getField(enrollment, "EnrollmentType", "Type");
            const isQualifying = enrollmentType
              ? ["current", "active", "enrolled"].includes(enrollmentType.toLowerCase())
              : !getField(enrollment, "DeclineReason");

            if (isQualifying) {
              info.enrolledCount++;
              const cost = parseFloat(
                getField(enrollment, "PlanCost", "MonthlyPlanCost", "TotalPremium",
                  "Premium", "MonthlyPremium", "TotalMonthlyPremium", "Cost") || "0"
              );
              if (!isNaN(cost) && cost > 0) info.premiumSum += cost;
            }
          }

          // Keep a sample enrollment for metadata (up to 3)
          if (info.enrollmentSamples.length < 3) {
            info.enrollmentSamples.push(enrollment);
          }
        }
      }

      // Create BenefitPlan records for all discovered missing plans
      for (const [planKey, info] of discoveredPlans) {
        if (info.enrolledCount === 0 && info.eligibleCount === 0) continue; // No real data

        await prisma.benefitPlan.create({
          data: {
            clientSnapshotId: snap.id,
            planType: info.planType,
            carrier: info.carrier,
            planName: info.planName,
            eligible: info.eligibleCount,
            enrollees: info.enrolledCount,
            premium: info.premiumSum > 0 ? Math.round(info.premiumSum * 100) / 100 : null,
            metadata: JSON.stringify({
              _recovered: true,
              _recoveredAt: new Date().toISOString(),
              _source: "enrollment_metadata_scan",
              planIdentifier: info.planIdentifier,
              sample: info.enrollmentSamples[0] || null,
            }),
            excluded: false,
            excludeReason: null,
          },
        });

        totalRecovered++;
        recoveredPlans.push({
          period,
          carrier: info.carrier,
          planName: info.planName,
          planType: info.planType,
          enrollees: info.enrolledCount,
        });
      }

      snapshotsProcessed++;
    }

    // Rebuild cache if we recovered anything
    if (totalRecovered > 0) {
      await rebuildAllCaches();
    }

    const elapsed = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      snapshotsProcessed,
      plansRecovered: totalRecovered,
      plansUpdated: totalUpdated,
      recoveredPlans,
      elapsedMs: elapsed,
      message: totalRecovered > 0
        ? `Recovered ${totalRecovered} missing plan(s) across ${snapshotsProcessed} snapshots. Cache rebuilt.`
        : `No missing plans found across ${snapshotsProcessed} snapshots. All plan references have matching BenefitPlan records.`,
    });
  } catch (error) {
    console.error("Repair error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Repair failed" },
      { status: 500 }
    );
  }
}

// ─── Helpers (duplicated from report-cache.ts to avoid circular deps) ───────

function findEnrollments(meta: any): any[] {
  const container = meta.Enrollments || meta.enrollments;
  if (!container) return [];
  if (Array.isArray(container)) return container;
  const e = container.Enrollment || container.enrollment;
  if (Array.isArray(e)) return e;
  if (e && typeof e === "object") return [e];
  return [];
}

function getField(obj: any, ...keys: string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "") return String(obj[key]);
    if (obj[`@_${key}`] !== undefined && obj[`@_${key}`] !== null) return String(obj[`@_${key}`]);
  }
  return null;
}

function derivePlanTypeFromEnrollment(enrollment: any, planName: string | null): string {
  // Check direct type fields
  const typeCode = getField(enrollment, "PlanTypeCode", "CoverageType", "BenefitType",
    "InsuranceType", "LineOfCoverage", "ProductType");
  if (typeCode) {
    const code = typeCode.toUpperCase();
    if (code.includes("MED") || code.includes("HEALTH") || code.includes("PPO") || code.includes("HMO")) return "Medical";
    if (code.includes("DEN")) return "Dental";
    if (code.includes("VIS")) return "Vision";
    if (code.includes("LIF") || code === "LIFE") return "Life";
    if (code === "ADD" || code.includes("AD&D")) return "AD&D";
    if (code.includes("STD") || code.includes("SHORT")) return "Short-Term Disability";
    if (code.includes("LTD") || code.includes("LONG")) return "Long-Term Disability";
    if (code.includes("COBRA")) return "COBRA";
    return typeCode;
  }

  // Infer from plan name
  if (planName) {
    const name = planName.toLowerCase();
    if (name.includes("medical") || name.includes("health") || name.includes("ppo") || name.includes("hmo")) return "Medical";
    if (name.includes("dental")) return "Dental";
    if (name.includes("vision")) return "Vision";
    if (name.includes("life")) return "Life";
    if (name.includes("disability")) return "Disability";
  }

  return "Unknown";
}
