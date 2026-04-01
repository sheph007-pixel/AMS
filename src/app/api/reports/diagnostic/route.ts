import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * GET /api/reports/diagnostic?year=2026&month=3
 * GET /api/reports/diagnostic?year=2026&month=3&client=Faith+Presbyterian
 *
 * Returns per-client premium breakdown for a given period.
 * When &client= is provided, returns enrollment-level detail for that client.
 * Used to validate against actual carrier invoices.
 */

function getField(obj: any, ...keys: string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "") return String(obj[key]);
    if (obj[`@_${key}`] !== undefined && obj[`@_${key}`] !== null) return String(obj[`@_${key}`]);
  }
  return null;
}

function findEnrollments(meta: any): any[] {
  const container = meta.Enrollments || meta.enrollments;
  if (!container) return [];
  if (Array.isArray(container)) return container;
  const e = container.Enrollment || container.enrollment;
  if (Array.isArray(e)) return e;
  if (e && typeof e === "object") return [e];
  return [];
}

function qualifyEnrollment(enrollment: any): boolean {
  const enrollmentType = getField(enrollment, "EnrollmentType", "enrollmentType", "Type");
  if (enrollmentType) return enrollmentType.toLowerCase() === "current";
  const declineReason = getField(enrollment, "DeclineReason", "declineReason");
  const endDate = getField(enrollment, "CoverageEndDate", "EndDate", "EndedOn");
  const isEnded = endDate && new Date(endDate) <= new Date();
  return !declineReason && !isEnded;
}

function getPremium(enrollment: any): number {
  const raw = getField(enrollment,
    "PlanCost", "MonthlyPlanCost", "TotalPremium", "Premium",
    "MonthlyPremium", "TotalMonthlyPremium", "Cost", "Rate"
  );
  if (!raw) return 0;
  const v = parseFloat(raw);
  return isNaN(v) || v <= 0 ? 0 : v;
}

function resolvePlan(
  enrollment: any,
  planIdMap: Map<string, { carrier: string; planType: string; planName: string }>,
  planNameMap: Map<string, { carrier: string; planType: string; planName: string }>
): { info: { carrier: string; planType: string; planName: string } | undefined; method: string } {
  const enrollPlanId = getField(enrollment, "PlanIdentifier", "PlanId", "PlanID") || "";
  const enrollPlanName = getField(enrollment, "PlanName", "Plan", "Name") || "";

  if (enrollPlanId) {
    const info = planIdMap.get(enrollPlanId);
    if (info) return { info, method: `planId:${enrollPlanId}` };
    if (enrollPlanName) {
      const info2 = planNameMap.get(enrollPlanName);
      if (info2) return { info: info2, method: `planName:${enrollPlanName}(fallback)` };
    }
    return { info: undefined, method: `unresolved(planId:${enrollPlanId},planName:${enrollPlanName})` };
  } else if (enrollPlanName) {
    const info = planNameMap.get(enrollPlanName);
    if (info) return { info, method: `planName:${enrollPlanName}` };
    return { info: undefined, method: `unresolved(planName:${enrollPlanName})` };
  }
  return { info: undefined, method: "unresolved(no-id-or-name)" };
}

function buildPlanMaps(benefitPlans: any[]) {
  const planIdMap = new Map<string, { carrier: string; planType: string; planName: string }>();
  const planNameMap = new Map<string, { carrier: string; planType: string; planName: string }>();

  for (const bp of benefitPlans) {
    const carrier = bp.carrier || "Unspecified";
    const info = { carrier, planType: bp.planType, planName: bp.planName || "" };
    if (bp.metadata) {
      try {
        const meta = JSON.parse(bp.metadata);
        const planId = meta.PlanIdentifier || meta.planIdentifier || meta["@_PlanIdentifier"];
        if (planId) planIdMap.set(String(planId), info);
      } catch { /* */ }
    }
    if (bp.planName) planNameMap.set(bp.planName, info);
  }

  return { planIdMap, planNameMap };
}

// ─── Detailed trace for a single client ─────────────────────────────────────

async function traceClient(snap: any) {
  const { planIdMap, planNameMap } = buildPlanMaps(snap.benefitPlans);

  const employees = await prisma.employeeSnapshot.findMany({
    where: { clientSnapshotId: snap.id },
    select: { employeeId: true, firstName: true, lastName: true, status: true, metadata: true },
  });

  const employeeDetails: any[] = [];
  let clientTotal = 0;

  for (const emp of employees) {
    const status = (emp.status || "Active").toLowerCase();
    if (status !== "active") continue;

    if (!emp.metadata) {
      employeeDetails.push({
        employeeId: emp.employeeId,
        name: `${emp.firstName} ${emp.lastName}`,
        status: emp.status,
        issue: "no metadata",
        enrollments: [],
        total: 0,
      });
      continue;
    }

    let meta: any;
    try { meta = JSON.parse(emp.metadata); } catch {
      employeeDetails.push({
        employeeId: emp.employeeId,
        name: `${emp.firstName} ${emp.lastName}`,
        status: emp.status,
        issue: "metadata parse error",
        enrollments: [],
        total: 0,
      });
      continue;
    }

    const enrollments = findEnrollments(meta);
    const enrollmentDetails: any[] = [];
    let empTotal = 0;

    for (const enrollment of enrollments) {
      const { info, method } = resolvePlan(enrollment, planIdMap, planNameMap);
      const qualified = qualifyEnrollment(enrollment);
      const premium = getPremium(enrollment);
      const enrollmentType = getField(enrollment, "EnrollmentType", "enrollmentType", "Type");
      const declineReason = getField(enrollment, "DeclineReason", "declineReason");

      // Show ALL premium-related fields for debugging
      const premiumFields: Record<string, any> = {};
      for (const f of ["PlanCost", "MonthlyPlanCost", "TotalPremium", "Premium",
        "MonthlyPremium", "TotalMonthlyPremium", "Cost", "Rate"]) {
        if (enrollment[f] !== undefined) premiumFields[f] = enrollment[f];
        if (enrollment[`@_${f}`] !== undefined) premiumFields[`@_${f}`] = enrollment[`@_${f}`];
      }

      const counted = info && qualified && premium > 0;
      if (counted) empTotal += premium;

      enrollmentDetails.push({
        resolved: !!info,
        resolveMethod: method,
        carrier: info?.carrier || null,
        planType: info?.planType || null,
        planName: getField(enrollment, "PlanName", "Plan", "Name"),
        enrollmentType: enrollmentType || null,
        declineReason: declineReason || null,
        qualified,
        premium,
        premiumFields,
        counted,
      });
    }

    clientTotal += empTotal;
    if (enrollmentDetails.length > 0) {
      employeeDetails.push({
        employeeId: emp.employeeId,
        name: `${emp.firstName} ${emp.lastName}`,
        enrollmentCount: enrollmentDetails.length,
        countedEnrollments: enrollmentDetails.filter(e => e.counted).length,
        total: Math.round(empTotal * 100) / 100,
        enrollments: enrollmentDetails,
      });
    }
  }

  // BenefitPlan summary
  const benefitPlanTotal = snap.benefitPlans.reduce((s: number, bp: any) => s + (bp.premium || 0), 0);

  return {
    name: snap.client.groupName,
    groupId: snap.client.groupId,
    benefitPlanTotal: Math.round(benefitPlanTotal * 100) / 100,
    recalcTotal: Math.round(clientTotal * 100) / 100,
    delta: Math.round((clientTotal - benefitPlanTotal) * 100) / 100,
    planMaps: {
      planIdMapSize: planIdMap.size,
      planNameMapSize: planNameMap.size,
      planIdEntries: Object.fromEntries(planIdMap),
      planNameEntries: Object.fromEntries(planNameMap),
    },
    benefitPlans: snap.benefitPlans.map((bp: any) => ({
      carrier: bp.carrier, planType: bp.planType, planName: bp.planName,
      storedPremium: bp.premium, storedEnrollees: bp.enrollees,
    })),
    employeeSummary: {
      total: employees.length,
      active: employeeDetails.length,
      withEnrollments: employeeDetails.filter((e: any) => e.enrollmentCount > 0).length,
      withCountedPremium: employeeDetails.filter((e: any) => e.total > 0).length,
    },
    employees: employeeDetails,
  };
}

// ─── Summary for all clients ────────────────────────────────────────────────

async function summarizeAll(snapshots: any[]) {
  const clients: any[] = [];

  for (const snap of snapshots) {
    const { planIdMap, planNameMap } = buildPlanMaps(snap.benefitPlans);
    const benefitPlanTotal = snap.benefitPlans.reduce((s: number, bp: any) => s + (bp.premium || 0), 0);

    const employees = await prisma.employeeSnapshot.findMany({
      where: { clientSnapshotId: snap.id },
      select: { employeeId: true, status: true, metadata: true },
    });

    let recalcTotal = 0;
    let totalEmployees = 0, activeEmployees = 0, totalEnrollments = 0;
    let resolvedEnrollments = 0, qualifiedEnrollments = 0, premiumEnrollments = 0;
    const carrierBreakdown = new Map<string, number>();

    for (const emp of employees) {
      totalEmployees++;
      if ((emp.status || "Active").toLowerCase() !== "active") continue;
      activeEmployees++;
      if (!emp.metadata) continue;
      let meta: any;
      try { meta = JSON.parse(emp.metadata); } catch { continue; }

      for (const enrollment of findEnrollments(meta)) {
        totalEnrollments++;
        const enrollPlanId = getField(enrollment, "PlanIdentifier", "PlanId", "PlanID") || "";
        const enrollPlanName = getField(enrollment, "PlanName", "Plan", "Name") || "";
        let info: { carrier: string; planType: string; planName: string } | undefined;
        if (enrollPlanId) {
          info = planIdMap.get(enrollPlanId);
          if (!info && enrollPlanName) info = planNameMap.get(enrollPlanName);
        } else if (enrollPlanName) {
          info = planNameMap.get(enrollPlanName);
        }
        if (!info) continue;
        resolvedEnrollments++;

        if (qualifyEnrollment(enrollment)) {
          qualifiedEnrollments++;
          const prem = getPremium(enrollment);
          if (prem > 0) {
            premiumEnrollments++;
            recalcTotal += prem;
            carrierBreakdown.set(info.carrier, (carrierBreakdown.get(info.carrier) || 0) + prem);
          }
        }
      }
    }

    clients.push({
      name: snap.client.groupName,
      groupId: snap.client.groupId,
      benefitPlanTotal: Math.round(benefitPlanTotal * 100) / 100,
      recalcTotal: Math.round(recalcTotal * 100) / 100,
      delta: Math.round((recalcTotal - benefitPlanTotal) * 100) / 100,
      stats: { totalEmployees, activeEmployees, totalEnrollments, resolvedEnrollments, qualifiedEnrollments, premiumEnrollments },
      carrierBreakdown: Object.fromEntries(
        Array.from(carrierBreakdown.entries()).map(([k, v]) => [k, Math.round(v * 100) / 100])
      ),
    });
  }

  clients.sort((a, b) => b.recalcTotal - a.recalcTotal);
  const grandTotal = Math.round(clients.reduce((s, c) => s + c.recalcTotal, 0) * 100) / 100;
  const bpGrandTotal = Math.round(clients.reduce((s, c) => s + c.benefitPlanTotal, 0) * 100) / 100;

  return { clients, grandTotal, benefitPlanGrandTotal: bpGrandTotal };
}

// ─── Route Handler ──────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const clientFilter = searchParams.get("client") || "";

    // Find the latest period if year/month not specified
    let year = parseInt(searchParams.get("year") || "0", 10);
    let month = parseInt(searchParams.get("month") || "0", 10);

    if (!year || !month) {
      const latest = await prisma.clientSnapshot.findFirst({
        orderBy: [{ year: "desc" }, { month: "desc" }],
        select: { year: true, month: true },
      });
      if (!latest) return NextResponse.json({ error: "No data" }, { status: 404 });
      year = latest.year;
      month = latest.month;
    }

    // Get snapshots for this period
    const snapshots = await prisma.clientSnapshot.findMany({
      where: {
        year, month,
        ...(clientFilter ? { client: { groupName: { contains: clientFilter, mode: "insensitive" as any } } } : {}),
      },
      select: {
        id: true,
        client: { select: { groupId: true, groupName: true } },
        benefitPlans: {
          select: { carrier: true, planType: true, planName: true, premium: true, enrollees: true, metadata: true },
        },
      },
    });

    if (snapshots.length === 0) {
      return NextResponse.json({ error: `No snapshots found for ${year}-${String(month).padStart(2, "0")}${clientFilter ? ` matching "${clientFilter}"` : ""}` }, { status: 404 });
    }

    const period = `${year}-${String(month).padStart(2, "0")}`;

    // If single client filter, show detailed trace
    if (clientFilter && snapshots.length <= 3) {
      const results = [];
      for (const snap of snapshots) {
        results.push(await traceClient(snap));
      }
      return NextResponse.json({ period, mode: "detail", clientCount: results.length, clients: results });
    }

    // Otherwise, summary view
    const { clients, grandTotal, benefitPlanGrandTotal } = await summarizeAll(snapshots);
    return NextResponse.json({ period, mode: "summary", clientCount: clients.length, grandTotal, benefitPlanGrandTotal, clients });
  } catch (error) {
    console.error("Diagnostic report error:", error);
    return NextResponse.json({ error: "Diagnostic report failed" }, { status: 500 });
  }
}
