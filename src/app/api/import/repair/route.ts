import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rebuildAllCaches } from "@/lib/report-cache";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * POST /api/import/repair
 *
 * Two-phase repair for BenefitPlan data:
 *
 * Phase 1 — Recovery: Scans EmployeeSnapshot metadata to discover plan
 * references that have no corresponding BenefitPlan record. Creates missing
 * records with enrollment-derived data.
 *
 * Phase 2 — Carrier Resolution: Cross-references ALL BenefitPlan records
 * across all snapshots to fill in null carrier names. If a plan with the same
 * PlanIdentifier or PlanName exists elsewhere with a known carrier, that
 * carrier is applied to the unresolved plans.
 */
export async function POST() {
  try {
    const startTime = Date.now();

    // ── Phase 1: Recover missing plans from enrollment metadata ─────────

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
    let snapshotsProcessed = 0;
    const recoveredPlanIds: string[] = [];
    const recoveredDetails: { period: string; carrier: string | null; planName: string | null; planType: string; enrollees: number }[] = [];

    for (const snap of snapshots) {
      if (snap.month < 1 || snap.month > 12) continue;
      const period = `${snap.year}-${String(snap.month).padStart(2, "0")}`;

      // Build set of known plan keys
      const knownPlanIds = new Set<string>();
      const knownPlanNames = new Set<string>();

      for (const bp of snap.benefitPlans) {
        if (bp.planName) knownPlanNames.add(bp.planName);
        let meta: any = {};
        try { meta = bp.metadata ? JSON.parse(bp.metadata) : {}; } catch { /* */ }
        const planId = meta.PlanIdentifier || meta.PlanId || meta.PlanID || meta["@_PlanIdentifier"] || meta.planIdentifier;
        if (planId) knownPlanIds.add(String(planId));
      }

      // Load employee snapshots
      const employees = await prisma.employeeSnapshot.findMany({
        where: { clientSnapshotId: snap.id },
        select: { employeeId: true, status: true, metadata: true },
      });

      // Scan enrollments to discover missing plan references
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

          const existsById = planId && knownPlanIds.has(planId);
          const existsByName = planName && knownPlanNames.has(planName);
          if (existsById || existsByName) continue;

          let info = discoveredPlans.get(planKey);
          if (!info) {
            const carrier = getField(enrollment, "Carrier", "CarrierName", "InsuranceCarrier")
              || getField(enrollment, "CompanyName")
              || null;

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

          if (!info.planName && planName) info.planName = planName;
          if (!info.carrier) {
            const foundCarrier = getField(enrollment, "Carrier", "CarrierName", "InsuranceCarrier");
            if (foundCarrier) info.carrier = foundCarrier;
          }

          info.eligibleCount++;

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

          if (info.enrollmentSamples.length < 3) {
            info.enrollmentSamples.push(enrollment);
          }
        }
      }

      // Create BenefitPlan records for discovered missing plans
      for (const [, info] of discoveredPlans) {
        if (info.enrolledCount === 0 && info.eligibleCount === 0) continue;

        const created = await prisma.benefitPlan.create({
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
              PlanIdentifier: info.planIdentifier,
              PlanName: info.planName,
              sample: info.enrollmentSamples[0] || null,
            }),
            excluded: false,
            excludeReason: null,
          },
        });

        recoveredPlanIds.push(created.id);
        totalRecovered++;
        recoveredDetails.push({
          period,
          carrier: info.carrier,
          planName: info.planName,
          planType: info.planType,
          enrollees: info.enrolledCount,
        });
      }

      snapshotsProcessed++;
    }

    // ── Phase 2: Cross-reference carrier names ──────────────────────────
    // For all plans with null carrier (recovered or pre-existing), try to
    // find the carrier from OTHER BenefitPlan records with the same
    // PlanIdentifier or PlanName that DO have a carrier.

    let carriersResolved = 0;
    const unresolvedPlans: { id: string; planName: string | null; planIdentifier: string | null }[] = [];

    // Find all plans with null/empty carrier
    const nullCarrierPlans = await prisma.benefitPlan.findMany({
      where: {
        OR: [{ carrier: null }, { carrier: "" }],
      },
      select: { id: true, planName: true, metadata: true },
    });

    if (nullCarrierPlans.length > 0) {
      // Build a lookup: planName → carrier, planIdentifier → carrier
      // from ALL plans that DO have a carrier
      const carrierByPlanName = new Map<string, string>();
      const carrierByPlanId = new Map<string, string>();

      const knownCarrierPlans = await prisma.benefitPlan.findMany({
        where: {
          carrier: { not: null },
          NOT: { carrier: "" },
        },
        select: { carrier: true, planName: true, metadata: true },
      });

      for (const bp of knownCarrierPlans) {
        if (bp.planName && bp.carrier) {
          carrierByPlanName.set(bp.planName.toLowerCase(), bp.carrier);
        }
        // Extract PlanIdentifier from metadata
        let meta: any = {};
        try { meta = bp.metadata ? JSON.parse(bp.metadata) : {}; } catch { /* */ }
        const planId = meta.PlanIdentifier || meta.PlanId || meta.PlanID || meta["@_PlanIdentifier"] || meta.planIdentifier;
        if (planId && bp.carrier) {
          carrierByPlanId.set(String(planId).toLowerCase(), bp.carrier);
        }
      }

      // Resolve null carriers
      for (const bp of nullCarrierPlans) {
        let resolvedCarrier: string | null = null;

        // Try by planName
        if (bp.planName) {
          resolvedCarrier = carrierByPlanName.get(bp.planName.toLowerCase()) || null;
        }

        // Try by PlanIdentifier from metadata
        if (!resolvedCarrier) {
          let meta: any = {};
          try { meta = bp.metadata ? JSON.parse(bp.metadata) : {}; } catch { /* */ }
          const planId = meta.PlanIdentifier || meta.PlanId || meta.planIdentifier;
          if (planId) {
            resolvedCarrier = carrierByPlanId.get(String(planId).toLowerCase()) || null;
          }
        }

        if (resolvedCarrier) {
          await prisma.benefitPlan.update({
            where: { id: bp.id },
            data: { carrier: resolvedCarrier },
          });
          carriersResolved++;
        } else {
          // Extract planIdentifier for the unresolved list
          let meta: any = {};
          try { meta = bp.metadata ? JSON.parse(bp.metadata) : {}; } catch { /* */ }
          const planId = meta.PlanIdentifier || meta.PlanId || meta.planIdentifier || null;
          unresolvedPlans.push({ id: bp.id, planName: bp.planName, planIdentifier: planId });
        }
      }
    }

    // Also fix metadata format for previously recovered plans (planIdentifier → PlanIdentifier)
    const oldRecovered = await prisma.benefitPlan.findMany({
      where: { metadata: { contains: '"planIdentifier"' } },
      select: { id: true, metadata: true },
    });
    let metadataFixed = 0;
    for (const bp of oldRecovered) {
      try {
        const meta = JSON.parse(bp.metadata!);
        if (meta.planIdentifier && !meta.PlanIdentifier) {
          meta.PlanIdentifier = meta.planIdentifier;
          if (meta.planName && !meta.PlanName) meta.PlanName = meta.planName;
          delete meta.planIdentifier;
          await prisma.benefitPlan.update({
            where: { id: bp.id },
            data: { metadata: JSON.stringify(meta) },
          });
          metadataFixed++;
        }
      } catch { /* */ }
    }

    // Rebuild cache
    if (totalRecovered > 0 || carriersResolved > 0 || metadataFixed > 0) {
      await rebuildAllCaches();
    }

    const elapsed = Date.now() - startTime;

    // Dedupe unresolved for summary
    const uniqueUnresolved = new Map<string, { planName: string | null; planIdentifier: string | null; count: number }>();
    for (const u of unresolvedPlans) {
      const key = u.planIdentifier || u.planName || u.id;
      const existing = uniqueUnresolved.get(key);
      if (existing) { existing.count++; } else {
        uniqueUnresolved.set(key, { planName: u.planName, planIdentifier: u.planIdentifier, count: 1 });
      }
    }

    return NextResponse.json({
      success: true,
      snapshotsProcessed,
      plansRecovered: totalRecovered,
      carriersResolved,
      metadataFixed,
      unresolvedCarriers: uniqueUnresolved.size,
      unresolvedPlans: Array.from(uniqueUnresolved.values()),
      elapsedMs: elapsed,
      message: [
        totalRecovered > 0 ? `Recovered ${totalRecovered} missing plan(s).` : "No new missing plans.",
        carriersResolved > 0 ? `Resolved ${carriersResolved} carrier name(s) via cross-reference.` : "",
        metadataFixed > 0 ? `Fixed ${metadataFixed} metadata format(s).` : "",
        uniqueUnresolved.size > 0 ? `${uniqueUnresolved.size} plan(s) still have unknown carriers.` : "",
        "Cache rebuilt.",
      ].filter(Boolean).join(" "),
    });
  } catch (error) {
    console.error("Repair error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Repair failed" },
      { status: 500 }
    );
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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
