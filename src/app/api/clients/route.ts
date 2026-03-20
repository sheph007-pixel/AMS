import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deriveLifecycleStatus } from "@/lib/lifecycle";
import { getExclusionRules, isExcluded } from "@/lib/exclusions";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Classify a plan type string into: Medical, Dental, Vision, Supplemental
 */
function classifyPlanType(planType: string | null): string {
  const t = (planType || "").toLowerCase();
  if (t.includes("medical") || t.includes("health")) return "Medical";
  if (t.includes("dental")) return "Dental";
  if (t.includes("vision")) return "Vision";
  return "Supplemental";
}

/**
 * Extract enrollment records from parsed employee metadata.
 * IDENTICAL to the benefits report's findEnrollmentsFromMeta.
 */
function findEnrollmentsFromMeta(meta: any): any[] {
  const container = meta.Enrollments || meta.enrollments;
  if (!container) return [];
  if (Array.isArray(container)) return container;
  const enrollments = container.Enrollment || container.enrollment;
  if (Array.isArray(enrollments)) return enrollments;
  if (enrollments && typeof enrollments === "object") return [enrollments];
  return [];
}

export async function GET() {
  try {
    const exclusionRules = await getExclusionRules();

    // ── Find the latest data period (same as benefits report) ──────────
    const latestSnapshot = await prisma.clientSnapshot.findFirst({
      orderBy: [{ year: "desc" }, { month: "desc" }],
      select: { year: true, month: true },
    });

    if (!latestSnapshot) {
      return NextResponse.json({
        clients: [],
        systemYears: [],
        summary: null,
      });
    }

    const { year: latestYear, month: latestMonth } = latestSnapshot;

    // ── Find the previous data period ──────────────────────────────────
    const prevSnapshot = await prisma.clientSnapshot.findFirst({
      where: {
        OR: [
          { year: { lt: latestYear } },
          { year: latestYear, month: { lt: latestMonth } },
        ],
      },
      orderBy: [{ year: "desc" }, { month: "desc" }],
      select: { year: true, month: true },
    });

    const prevYear = prevSnapshot?.year ?? latestYear - 1;
    const prevMonth = prevSnapshot?.month ?? latestMonth;

    // ── Get all system years ───────────────────────────────────────────
    const allYearsResult = await prisma.clientSnapshot.findMany({
      select: { year: true },
      distinct: ["year"],
      orderBy: { year: "asc" },
    });
    const allSystemYears = allYearsResult.map((r) => r.year);

    // ── Load ALL clients with snapshots ────────────────────────────────
    const clients = await prisma.client.findMany({
      include: {
        snapshots: {
          select: {
            id: true,
            year: true,
            month: true,
            totalEmployees: true,
            benefitPlans: {
              select: {
                planType: true,
                carrier: true,
                planName: true,
                enrollees: true,
                premium: true,
                metadata: true,
              },
            },
            employees: {
              select: {
                employeeId: true,
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

    // Filter excluded clients
    const filteredClients = clients.filter(
      (client) => !isExcluded({ groupName: client.groupName }, exclusionRules)
    );

    // ── YoY summary accumulators ───────────────────────────────────────
    let currentYearActiveGroups = 0;
    let lastYearActiveGroups = 0;
    let currentYearEnrolled = 0;
    let lastYearEnrolled = 0;
    let currentYearPremium = 0;
    let lastYearPremium = 0;

    // ── Process each client ────────────────────────────────────────────
    const enriched = filteredClients.map((client) => {
      const years = client.snapshots.map((s) => s.year);
      const uniqueYears = [...new Set(years)];
      const status = deriveLifecycleStatus(uniqueYears, allSystemYears);

      // Current period snapshot (same period as benefits report)
      const cySnap = client.snapshots.find(
        (s) => s.year === latestYear && s.month === latestMonth
      ) ?? null;

      // Previous period snapshot
      const lySnap = prevSnapshot
        ? (client.snapshots.find(
            (s) => s.year === prevYear && s.month === prevMonth
          ) ?? null)
        : null;

      // Process current year snapshot
      let activeEmployeeCount: number | null = null;
      let medicalEnrolled = 0;
      let dentalEnrolled = 0;
      let visionEnrolled = 0;
      let supplementalEnrolled = 0;

      if (cySnap) {
        const result = processSnapshot(cySnap, exclusionRules);
        activeEmployeeCount = result.activeEmployees;
        medicalEnrolled = result.enrolledByType.Medical;
        dentalEnrolled = result.enrolledByType.Dental;
        visionEnrolled = result.enrolledByType.Vision;
        supplementalEnrolled = result.enrolledByType.Supplemental;

        currentYearActiveGroups++;
        currentYearEnrolled += result.activeEmployees;
        currentYearPremium += result.totalPremium;
      }

      if (lySnap) {
        const result = processSnapshot(lySnap, exclusionRules);
        lastYearActiveGroups++;
        lastYearEnrolled += result.activeEmployees;
        lastYearPremium += result.totalPremium;
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

    // ── Audit log ──────────────────────────────────────────────────────
    const activeInList = enriched.filter(
      (c) => c.status === "Active" || c.status === "New" || c.status === "Returned"
    );
    const enrolledFromList = activeInList.reduce(
      (sum, c) => sum + (c.activeEmployees ?? 0),
      0
    );

    console.log("[Groups API Audit]", {
      dataPeriod: `${latestYear}-${String(latestMonth).padStart(2, "0")}`,
      prevPeriod: prevSnapshot
        ? `${prevYear}-${String(prevMonth).padStart(2, "0")}`
        : "none",
      activeGroupsCard: currentYearActiveGroups,
      activeGroupsInList: activeInList.length,
      enrolledCard: currentYearEnrolled,
      enrolledFromList,
      premiumCurrent: Math.round(currentYearPremium * 100) / 100,
      premiumPrevious: Math.round(lastYearPremium * 100) / 100,
      match:
        currentYearActiveGroups === activeInList.length &&
        currentYearEnrolled === enrolledFromList,
    });

    const summary = {
      currentYear: latestYear,
      lastYear: prevYear,
      activeGroups: {
        current: currentYearActiveGroups,
        previous: lastYearActiveGroups,
      },
      enrolled: { current: currentYearEnrolled, previous: lastYearEnrolled },
      premium: {
        current: Math.round(currentYearPremium * 100) / 100,
        previous: Math.round(lastYearPremium * 100) / 100,
      },
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

/**
 * Process a single snapshot using the SAME logic as the benefits report:
 *  - Build PlanIdentifier/PlanName → planType lookup from BenefitPlans
 *  - Walk employee enrollments, filter qualifying (EnrollmentType=Current)
 *  - Resolve each enrollment to a planType
 *  - Count distinct enrolled employees per plan type
 *  - Sum PlanCost for total premium
 */
function processSnapshot(
  snapshot: {
    totalEmployees: number | null;
    benefitPlans: {
      planType: string | null;
      carrier: string | null;
      planName: string | null;
      enrollees: number | null;
      premium: number | null;
      metadata: string | null;
    }[];
    employees: {
      employeeId: string;
      status: string | null;
      metadata: string | null;
    }[];
  },
  exclusionRules: any[]
): {
  activeEmployees: number;
  enrolledByType: Record<string, number>;
  totalPremium: number;
} {
  const enrolledByType: Record<string, number> = {
    Medical: 0,
    Dental: 0,
    Vision: 0,
    Supplemental: 0,
  };

  // Build plan lookups: PlanIdentifier → planType, PlanName → planType
  const planIdToType = new Map<string, string>();
  const planNameToType = new Map<string, string>();

  for (const bp of snapshot.benefitPlans) {
    if (
      isExcluded(
        { carrier: bp.carrier, planName: bp.planName, planType: bp.planType },
        exclusionRules
      )
    ) {
      continue;
    }

    const category = classifyPlanType(bp.planType);

    // Map PlanIdentifier from metadata (same as benefits report)
    if (bp.metadata) {
      try {
        const meta = JSON.parse(bp.metadata);
        const planId = meta.PlanIdentifier || meta.planIdentifier;
        if (planId) {
          planIdToType.set(String(planId), category);
        }
      } catch {
        /* ignore */
      }
    }

    // Map PlanName directly (same as benefits report uses bp.planName)
    if (bp.planName) {
      planNameToType.set(bp.planName, category);
    }
  }

  // Count active employees
  let activeEmployees = 0;
  if (snapshot.employees.length > 0) {
    activeEmployees = snapshot.employees.filter(
      (e) => !e.status || e.status.toLowerCase() === "active"
    ).length;
  } else {
    activeEmployees = snapshot.totalEmployees ?? 0;
  }

  // If no plan mappings exist, fall back to BenefitPlan.enrollees/premium
  if (planIdToType.size === 0 && planNameToType.size === 0) {
    let totalPremium = 0;
    for (const bp of snapshot.benefitPlans) {
      const category = classifyPlanType(bp.planType);
      enrolledByType[category] += bp.enrollees ?? 0;
      totalPremium += bp.premium ?? 0;
    }
    return { activeEmployees, enrolledByType, totalPremium };
  }

  // Process employee enrollments (SAME logic as benefits report)
  const enrolledSets: Record<string, Set<string>> = {
    Medical: new Set(),
    Dental: new Set(),
    Vision: new Set(),
    Supplemental: new Set(),
  };
  let totalPremium = 0;

  for (const emp of snapshot.employees) {
    const status = (emp.status || "Active").toLowerCase();
    if (status !== "active") continue;

    if (!emp.metadata) continue;
    let meta: any;
    try {
      meta = JSON.parse(emp.metadata);
    } catch {
      continue;
    }

    const enrollments = findEnrollmentsFromMeta(meta);

    for (const enrollment of enrollments) {
      // Filter: EnrollmentType = "Current" (same as benefits report)
      const enrollmentType =
        enrollment.EnrollmentType ||
        enrollment.enrollmentType ||
        enrollment.Type;
      let isQualifying = false;
      if (enrollmentType) {
        isQualifying = String(enrollmentType).toLowerCase() === "current";
      } else {
        const declineReason =
          enrollment.DeclineReason || enrollment.declineReason;
        const endDate =
          enrollment.CoverageEndDate ||
          enrollment.EndDate ||
          enrollment.EndedOn;
        const isEnded = endDate && new Date(String(endDate)) <= new Date();
        isQualifying = !declineReason && !isEnded;
      }
      if (!isQualifying) continue;

      // Resolve plan type via PlanIdentifier → BenefitPlan → planType
      const enrollPlanId = String(
        enrollment.PlanIdentifier ||
          enrollment.PlanId ||
          enrollment.PlanID ||
          ""
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

      // Track distinct enrolled per plan type
      enrolledSets[category].add(emp.employeeId);

      // Sum PlanCost (same as benefits report)
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

  return { activeEmployees, enrolledByType, totalPremium };
}
