import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getExclusionRules, isExcluded } from "@/lib/exclusions";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Drill-down detail for any cell in the Benefits Report.
 *
 * GET /api/reports/benefits/detail?carrier=Guardian&type=groups
 * GET /api/reports/benefits/detail?carrier=Guardian&type=eligible
 * GET /api/reports/benefits/detail?carrier=Guardian&type=enrolled
 * GET /api/reports/benefits/detail?carrier=Guardian&type=premium
 * GET /api/reports/benefits/detail?carrier=__all__&type=groups  (total row)
 *
 * Returns rows appropriate to the type, all from the latest data period.
 */
export async function GET(request: NextRequest) {
  try {
    const carrierParam = request.nextUrl.searchParams.get("carrier");
    const type = request.nextUrl.searchParams.get("type");

    if (!carrierParam || !type) {
      return NextResponse.json({ error: "carrier and type parameters required" }, { status: 400 });
    }

    const isAll = carrierParam === "__all__";
    const exclusionRules = await getExclusionRules();

    // Latest data period
    const latestSnapshot = await prisma.clientSnapshot.findFirst({
      orderBy: [{ year: "desc" }, { month: "desc" }],
      select: { year: true, month: true },
    });

    if (!latestSnapshot) {
      return NextResponse.json({ rows: [], title: "" });
    }

    const snapshots = await prisma.clientSnapshot.findMany({
      where: { year: latestSnapshot.year, month: latestSnapshot.month },
      include: {
        client: true,
        benefitPlans: true,
        employees: true,
      },
    });

    // ── Build lookup structures per snapshot ─────────────────────────────

    // Carrier → set of group names
    const carrierGroups = new Map<string, Map<string, { enrolled: number; premium: number }>>();
    // Carrier → eligible employees
    const carrierEligible = new Map<string, { name: string; group: string; employeeId: string }[]>();
    // Carrier → enrolled employees
    const carrierEnrolled = new Map<string, { name: string; group: string; employeeId: string; plans: string[] }[]>();
    // Carrier → premium rows
    const carrierPremiumRows = new Map<string, { name: string; group: string; planName: string; planType: string; tier: string; planCost: number }[]>();

    // Carrier → set of clientIds with plans
    const carrierCompanyIds = new Map<string, Set<string>>();
    // clientId → { groupName, active employee keys }
    const companyData = new Map<string, { groupName: string; activeEmpKeys: Set<string> }>();

    for (const snapshot of snapshots) {
      if (isExcluded({ groupName: snapshot.client.groupName }, exclusionRules)) continue;

      const clientId = snapshot.clientId;
      const groupName = snapshot.client.groupName;

      if (!companyData.has(clientId)) {
        companyData.set(clientId, { groupName, activeEmpKeys: new Set() });
      }

      // Plan lookup
      const planIdLookup = new Map<string, { carrier: string; planName: string; planType: string }>();
      const planNameLookup = new Map<string, { carrier: string; planName: string; planType: string }>();

      for (const bp of snapshot.benefitPlans) {
        if (isExcluded({ carrier: bp.carrier, planName: bp.planName, planType: bp.planType }, exclusionRules)) continue;

        const carrier = bp.carrier || "Unspecified Carrier";
        const info = { carrier, planName: bp.planName || "", planType: bp.planType || "" };

        if (bp.metadata) {
          try {
            const meta = JSON.parse(bp.metadata);
            const planId = meta.PlanIdentifier || meta.planIdentifier;
            if (planId) planIdLookup.set(String(planId), info);
          } catch { /* ignore */ }
        }
        if (bp.planName) planNameLookup.set(bp.planName, info);

        // Track carrier → company
        if (!carrierCompanyIds.has(carrier)) carrierCompanyIds.set(carrier, new Set());
        carrierCompanyIds.get(carrier)!.add(clientId);
      }

      // Process employees
      for (const emp of snapshot.employees) {
        if ((emp.status || "Active").toLowerCase() !== "active") continue;

        const empKey = `${clientId}::${emp.employeeId}`;
        companyData.get(clientId)!.activeEmpKeys.add(empKey);

        if (!emp.metadata) continue;
        let meta: any;
        try { meta = JSON.parse(emp.metadata); } catch { continue; }

        const enrollments = findEnrollmentsFromMeta(meta);
        const empName = `${emp.firstName} ${emp.lastName}`.trim();
        const enrolledCarriers = new Set<string>();
        const carrierPlanNames = new Map<string, string[]>();

        for (const enrollment of enrollments) {
          // EnrollmentType filter
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
          if (!resolved) continue;

          const carrier = resolved.carrier;

          // PlanCost
          const rawCost = String(enrollment.PlanCost || enrollment.MonthlyPlanCost || "");
          const cost = rawCost ? parseFloat(rawCost) : 0;
          const planCost = !isNaN(cost) ? Math.round(cost * 100) / 100 : 0;

          const tier = String(enrollment.CoverageLevel || enrollment.Tier || enrollment.CoverageTier || "");

          // Track enrolled
          if (!enrolledCarriers.has(carrier)) {
            enrolledCarriers.add(carrier);
            if (!carrierPlanNames.has(carrier)) carrierPlanNames.set(carrier, []);
          }
          carrierPlanNames.get(carrier)!.push(resolved.planName || enrollPlanName);

          // Groups: track enrolled + premium per group per carrier
          if (!carrierGroups.has(carrier)) carrierGroups.set(carrier, new Map());
          const groupMap = carrierGroups.get(carrier)!;
          if (!groupMap.has(groupName)) groupMap.set(groupName, { enrolled: 0, premium: 0 });

          // Premium rows
          if (!carrierPremiumRows.has(carrier)) carrierPremiumRows.set(carrier, []);
          carrierPremiumRows.get(carrier)!.push({
            name: empName,
            group: groupName,
            planName: resolved.planName || enrollPlanName,
            planType: resolved.planType,
            tier,
            planCost,
          });
        }

        // After processing all enrollments for this employee
        for (const carrier of enrolledCarriers) {
          // Enrolled list
          if (!carrierEnrolled.has(carrier)) carrierEnrolled.set(carrier, []);
          carrierEnrolled.get(carrier)!.push({
            name: empName,
            group: groupName,
            employeeId: emp.employeeId,
            plans: carrierPlanNames.get(carrier) || [],
          });

          // Group enrolled count (once per employee)
          const groupMap = carrierGroups.get(carrier)!;
          const gd = groupMap.get(groupName)!;
          gd.enrolled++;
        }
      }
    }

    // Sum premium per group per carrier
    for (const [carrier, premRows] of carrierPremiumRows) {
      const groupMap = carrierGroups.get(carrier);
      if (!groupMap) continue;
      for (const row of premRows) {
        const gd = groupMap.get(row.group);
        if (gd) gd.premium += row.planCost;
      }
    }

    // Build eligible lists from company-carrier mapping
    for (const [carrier, clientIds] of carrierCompanyIds) {
      if (!carrierEligible.has(carrier)) carrierEligible.set(carrier, []);
      for (const clientId of clientIds) {
        const cd = companyData.get(clientId);
        if (!cd) continue;
        // We need employee names — pull from snapshot employees
        const snapshot = snapshots.find((s) => s.clientId === clientId);
        if (!snapshot) continue;
        for (const emp of snapshot.employees) {
          if ((emp.status || "Active").toLowerCase() !== "active") continue;
          carrierEligible.get(carrier)!.push({
            name: `${emp.firstName} ${emp.lastName}`.trim(),
            group: cd.groupName,
            employeeId: emp.employeeId,
          });
        }
      }
    }

    // ── Build response based on type ─────────────────────────────────────

    const targetCarriers = isAll
      ? Array.from(carrierGroups.keys())
      : [carrierParam];

    if (type === "groups") {
      const rows: { groupName: string; enrolled: number; premium: number; carrier?: string }[] = [];
      for (const carrier of targetCarriers) {
        const groupMap = carrierGroups.get(carrier);
        if (!groupMap) continue;
        for (const [gn, data] of groupMap) {
          rows.push({
            groupName: gn,
            enrolled: data.enrolled,
            premium: Math.round(data.premium * 100) / 100,
            ...(isAll ? { carrier } : {}),
          });
        }
      }
      rows.sort((a, b) => a.groupName.localeCompare(b.groupName));

      return NextResponse.json({
        title: isAll ? `All Groups (${rows.length})` : `${carrierParam} — ${rows.length} Groups`,
        columns: isAll
          ? ["Group Name", "Carrier", "Enrolled", "Monthly Premium"]
          : ["Group Name", "Enrolled", "Monthly Premium"],
        rows: rows.map((r) =>
          isAll
            ? [r.groupName, r.carrier!, r.enrolled, formatMoney(r.premium)]
            : [r.groupName, r.enrolled, formatMoney(r.premium)]
        ),
      });
    }

    if (type === "eligible") {
      const rows: { name: string; group: string; carrier?: string }[] = [];
      const seen = new Set<string>();
      for (const carrier of targetCarriers) {
        const list = carrierEligible.get(carrier) || [];
        for (const emp of list) {
          const key = `${emp.employeeId}::${emp.group}::${carrier}`;
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push({ name: emp.name, group: emp.group, ...(isAll ? { carrier } : {}) });
        }
      }
      rows.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));

      return NextResponse.json({
        title: isAll ? `All Eligible Employees (${rows.length})` : `${carrierParam} — ${rows.length} Eligible Employees`,
        columns: isAll ? ["Employee", "Group", "Carrier"] : ["Employee", "Group"],
        rows: rows.map((r) => isAll ? [r.name, r.group, r.carrier!] : [r.name, r.group]),
      });
    }

    if (type === "enrolled") {
      const rows: { name: string; group: string; plans: string; carrier?: string }[] = [];
      for (const carrier of targetCarriers) {
        const list = carrierEnrolled.get(carrier) || [];
        for (const emp of list) {
          rows.push({
            name: emp.name,
            group: emp.group,
            plans: [...new Set(emp.plans)].join(", "),
            ...(isAll ? { carrier } : {}),
          });
        }
      }
      rows.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));

      return NextResponse.json({
        title: isAll ? `All Enrolled Employees (${rows.length})` : `${carrierParam} — ${rows.length} Enrolled Employees`,
        columns: isAll ? ["Employee", "Group", "Carrier", "Plans"] : ["Employee", "Group", "Plans"],
        rows: rows.map((r) => isAll ? [r.name, r.group, r.carrier!, r.plans] : [r.name, r.group, r.plans]),
      });
    }

    if (type === "premium") {
      const rows: { name: string; group: string; planName: string; planType: string; tier: string; planCost: number; carrier?: string }[] = [];
      for (const carrier of targetCarriers) {
        const list = carrierPremiumRows.get(carrier) || [];
        for (const r of list) {
          rows.push({ ...r, ...(isAll ? { carrier } : {}) });
        }
      }
      rows.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));

      const totalPremium = rows.reduce((s, r) => s + r.planCost, 0);

      return NextResponse.json({
        title: isAll
          ? `All Premium Detail (${rows.length} rows — ${formatMoney(Math.round(totalPremium * 100) / 100)})`
          : `${carrierParam} — Premium Detail (${rows.length} rows — ${formatMoney(Math.round(totalPremium * 100) / 100)})`,
        columns: isAll
          ? ["Employee", "Group", "Carrier", "Plan", "Type", "Tier", "PlanCost"]
          : ["Employee", "Group", "Plan", "Type", "Tier", "PlanCost"],
        rows: rows.map((r) =>
          isAll
            ? [r.name, r.group, r.carrier!, r.planName, r.planType, r.tier, formatMoney(r.planCost)]
            : [r.name, r.group, r.planName, r.planType, r.tier, formatMoney(r.planCost)]
        ),
      });
    }

    return NextResponse.json({ error: "Invalid type. Use: groups, eligible, enrolled, premium" }, { status: 400 });
  } catch (error) {
    console.error("Detail API error:", error);
    return NextResponse.json({ error: "Failed to generate detail" }, { status: 500 });
  }
}

function formatMoney(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
