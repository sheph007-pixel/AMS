import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deriveLifecycleStatus } from "@/lib/lifecycle";
import { getExclusionRules, isExcluded } from "@/lib/exclusions";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Helper: count active employees from a snapshot.
 */
function countActiveEmployees(snapshot: {
  totalEmployees: number | null;
  employees: { status: string | null }[];
}): number {
  if (snapshot.employees.length > 0) {
    return snapshot.employees.filter(
      (e) => !e.status || e.status.toLowerCase() === "active"
    ).length;
  }
  return snapshot.totalEmployees ?? 0;
}

/**
 * Classify a plan type string into one of: Medical, Dental, Vision, Supplemental
 */
function classifyPlanType(planType: string | null): string {
  const t = (planType || "").toLowerCase();
  if (t.includes("medical") || t.includes("health")) return "Medical";
  if (t.includes("dental")) return "Dental";
  if (t.includes("vision")) return "Vision";
  return "Supplemental";
}

/**
 * Compute per-plan-type enrolled counts and premium from enrollment metadata.
 * Uses the same approach as the benefits report for consistency.
 */
function computePlanMetrics(snapshot: {
  benefitPlans: {
    planType: string | null;
    carrier: string | null;
    enrollees: number | null;
    premium: number | null;
    metadata: string | null;
  }[];
  employees: {
    status: string | null;
    metadata: string | null;
  }[];
}): {
  enrolledByType: Record<string, number>;
  totalPremium: number;
} {
  const enrolledByType: Record<string, number> = {
    Medical: 0,
    Dental: 0,
    Vision: 0,
    Supplemental: 0,
  };

  // Build plan lookup: PlanIdentifier/PlanName → planType
  const planIdToType = new Map<string, string>();
  const planNameToType = new Map<string, string>();
  const planIdToCarrier = new Map<string, string>();
  const planNameToCarrier = new Map<string, string>();

  for (const bp of snapshot.benefitPlans) {
    const category = classifyPlanType(bp.planType);
    const carrier = bp.carrier || "";

    if (bp.metadata) {
      try {
        const meta = JSON.parse(bp.metadata);
        const planId = meta.PlanIdentifier || meta.planIdentifier;
        if (planId) {
          planIdToType.set(String(planId), category);
          planIdToCarrier.set(String(planId), carrier);
        }
      } catch { /* ignore */ }
    }

    // Also map by planName for fallback matching
    if (bp.planType) {
      // Use planName from metadata if available
      let planName: string | null = null;
      if (bp.metadata) {
        try {
          const meta = JSON.parse(bp.metadata);
          planName = meta.PlanName || meta.Name || null;
        } catch { /* ignore */ }
      }
      if (planName) {
        planNameToType.set(planName, category);
        planNameToCarrier.set(planName, carrier);
      }
    }
  }

  let totalPremium = 0;

  // If we have employee enrollment metadata, use it (matches benefits report)
  const hasEnrollmentData = snapshot.employees.some((e) => e.metadata);

  if (hasEnrollmentData && (planIdToType.size > 0 || planNameToType.size > 0)) {
    // Track enrolled per type using sets to avoid double-counting
    const enrolledSets: Record<string, Set<number>> = {
      Medical: new Set(),
      Dental: new Set(),
      Vision: new Set(),
      Supplemental: new Set(),
    };

    for (let empIdx = 0; empIdx < snapshot.employees.length; empIdx++) {
      const emp = snapshot.employees[empIdx];
      const status = (emp.status || "Active").toLowerCase();
      if (status !== "active") continue;

      if (!emp.metadata) continue;
      let meta: any;
      try {
        meta = JSON.parse(emp.metadata);
      } catch {
        continue;
      }

      const enrollments = findEnrollments(meta);

      for (const enrollment of enrollments) {
        // Filter qualifying enrollments
        const enrollmentType =
          enrollment.EnrollmentType || enrollment.enrollmentType || enrollment.Type;
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

        // Resolve plan type
        const enrollPlanId = String(
          enrollment.PlanIdentifier || enrollment.PlanId || enrollment.PlanID || ""
        );
        const enrollPlanName = String(
          enrollment.PlanName || enrollment.Plan || enrollment.Name || ""
        );

        let category: string | undefined;
        if (enrollPlanId) {
          category = planIdToType.get(enrollPlanId);
          if (!category && enrollPlanName) {
            category = planNameToType.get(enrollPlanName);
          }
        } else if (enrollPlanName) {
          category = planNameToType.get(enrollPlanName);
        }

        if (!category) continue;

        enrolledSets[category].add(empIdx);

        // Sum premium from enrollment PlanCost
        const rawCost = String(
          enrollment.PlanCost || enrollment.MonthlyPlanCost || ""
        );
        if (rawCost) {
          const parsed = parseFloat(rawCost);
          if (!isNaN(parsed)) totalPremium += parsed;
        }
      }
    }

    for (const type of Object.keys(enrolledByType)) {
      enrolledByType[type] = enrolledSets[type].size;
    }
  } else {
    // Fallback: use BenefitPlan.enrollees and BenefitPlan.premium
    for (const bp of snapshot.benefitPlans) {
      const category = classifyPlanType(bp.planType);
      enrolledByType[category] += bp.enrollees ?? 0;
      totalPremium += bp.premium ?? 0;
    }
  }

  return { enrolledByType, totalPremium };
}

/**
 * Find enrollment arrays from employee metadata (matches benefits report logic).
 */
function findEnrollments(meta: any): any[] {
  if (!meta) return [];

  // Direct array
  if (Array.isArray(meta.Enrollments)) return meta.Enrollments;
  if (Array.isArray(meta.enrollments)) return meta.enrollments;
  if (Array.isArray(meta.Enrollment)) return meta.Enrollment;

  // Nested under a wrapper
  const enrollment = meta.Enrollments || meta.enrollments || meta.Enrollment;
  if (enrollment && typeof enrollment === "object") {
    if (Array.isArray(enrollment.Enrollment)) return enrollment.Enrollment;
    if (Array.isArray(enrollment.enrollment)) return enrollment.enrollment;
    // Single enrollment object
    if (enrollment.PlanIdentifier || enrollment.PlanName || enrollment.PlanId) {
      return [enrollment];
    }
  }

  return [];
}

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
                metadata: true,
              },
            },
            employees: {
              select: {
                status: true,
                metadata: true,
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
    const currentYear =
      allSystemYears.length > 0
        ? Math.max(...allSystemYears)
        : new Date().getFullYear();
    const previousYears = allSystemYears.filter((y) => y < currentYear);
    const lastYear =
      previousYears.length > 0
        ? Math.max(...previousYears)
        : currentYear - 1;

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

      const currentYearSnapshots = client.snapshots.filter(
        (s) => s.year === currentYear
      );
      const lastYearSnapshots = client.snapshots.filter(
        (s) => s.year === lastYear
      );
      const cySnap =
        currentYearSnapshots.length > 0
          ? currentYearSnapshots[currentYearSnapshots.length - 1]
          : null;
      const lySnap =
        lastYearSnapshots.length > 0
          ? lastYearSnapshots[lastYearSnapshots.length - 1]
          : null;

      // Active employee count from the current year snapshot
      const activeEmployeeCount = cySnap ? countActiveEmployees(cySnap) : null;

      // Compute per-plan-type enrolled counts from current year
      let medicalEnrolled = 0;
      let dentalEnrolled = 0;
      let visionEnrolled = 0;
      let supplementalEnrolled = 0;

      if (cySnap) {
        const { enrolledByType, totalPremium } = computePlanMetrics(cySnap);
        medicalEnrolled = enrolledByType.Medical;
        dentalEnrolled = enrolledByType.Dental;
        visionEnrolled = enrolledByType.Vision;
        supplementalEnrolled = enrolledByType.Supplemental;

        currentYearActiveGroups++;
        currentYearEnrolled += countActiveEmployees(cySnap);
        currentYearPremium += totalPremium;
      }

      if (lySnap) {
        const { totalPremium } = computePlanMetrics(lySnap);
        lastYearActiveGroups++;
        lastYearEnrolled += countActiveEmployees(lySnap);
        lastYearPremium += totalPremium;
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
        medicalEnrolled,
        dentalEnrolled,
        visionEnrolled,
        supplementalEnrolled,
      };
    });

    // Cross-check: active clients in enriched should match currentYearActiveGroups
    const activeInList = enriched.filter(
      (c) => c.status === "Active" || c.status === "New" || c.status === "Returned"
    );
    const enrolledFromList = activeInList.reduce(
      (sum, c) => sum + (c.activeEmployees ?? 0),
      0
    );

    console.log("[Groups API Audit]", {
      systemYears: allSystemYears,
      currentYear,
      lastYear,
      activeGroupsCard: currentYearActiveGroups,
      activeGroupsInList: activeInList.length,
      enrolledCard: currentYearEnrolled,
      enrolledFromList,
      premiumCurrent: currentYearPremium,
      premiumPrevious: lastYearPremium,
      match:
        currentYearActiveGroups === activeInList.length &&
        currentYearEnrolled === enrolledFromList,
    });

    const summary = {
      currentYear,
      lastYear,
      activeGroups: {
        current: currentYearActiveGroups,
        previous: lastYearActiveGroups,
      },
      enrolled: { current: currentYearEnrolled, previous: lastYearEnrolled },
      premium: { current: currentYearPremium, previous: lastYearPremium },
    };

    return NextResponse.json({
      clients: enriched,
      systemYears: allSystemYears,
      summary,
    });
  } catch (error) {
    console.error("Error fetching clients:", error);
    return NextResponse.json(
      { error: "Failed to fetch clients" },
      { status: 500 }
    );
  }
}
