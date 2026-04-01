import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getExclusionRules, isExcluded } from "@/lib/exclusions";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Benefits Report — auto-validates against latest XML upload.
 *
 * Produces:
 *   1. Main carrier summary table
 *   2. Full reconciliation/debug data for auditing
 *   3. Per-company plan-type enrollment data (for Groups page)
 *
 * All data comes from the latest data period (max year+month).
 * Re-computed from enrollment metadata on every request — never stale.
 */

function classifyPlanType(planType: string | null): string {
  const t = (planType || "").toLowerCase();
  if (t.includes("medical") || t.includes("health")) return "Medical";
  if (t.includes("dental")) return "Dental";
  if (t.includes("vision")) return "Vision";
  return "Supplemental";
}

export async function GET() {
  try {
    const exclusionRules = await getExclusionRules();

    // ── Step 1: Find the latest data period ──────────────────────────────

    const latestSnapshot = await prisma.clientSnapshot.findFirst({
      orderBy: [{ year: "desc" }, { month: "desc" }],
      select: { year: true, month: true },
    });

    if (!latestSnapshot) {
      return NextResponse.json({
        rows: [],
        totals: { eligible: 0, enrolled: 0, monthlyPremium: 0 },
        reconciliation: null,
        lastUpload: null,
        dataPeriod: null,
        companyPlanTypes: {},
      });
    }

    const { year: latestYear, month: latestMonth } = latestSnapshot;

    // ── Find previous data period ────────────────────────────────────────
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

    // ── Step 2: Load all snapshots from the latest period ────────────────

    const snapshots = await prisma.clientSnapshot.findMany({
      where: { year: latestYear, month: latestMonth },
      include: {
        client: true,
        benefitPlans: true,
      },
    });

    // Also load previous period snapshots for YoY
    const prevSnapshots = prevSnapshot
      ? await prisma.clientSnapshot.findMany({
          where: { year: prevSnapshot.year, month: prevSnapshot.month },
          include: {
            client: true,
            benefitPlans: true,
          },
        })
      : [];

    let latestImportDate: Date | null = null;

    // ── Data structures ──────────────────────────────────────────────────

    // Carrier → aggregated data
    const carrierMap = new Map<
      string,
      {
        carrier: string;
        eligibleEmployees: Set<string>;
        enrolledEmployees: Set<string>;
        enrollmentRows: number;
        monthlyPremium: number;
      }
    >();

    // Carrier → Set of clientIds that have plans with this carrier
    const carrierCompanies = new Map<string, Set<string>>();

    // clientId → { groupName, activeEmployees Set }
    const companyInfo = new Map<string, { groupName: string; activeEmployees: Set<string> }>();

    // `${carrier}::${clientId}` → per-company-carrier breakdown
    const companyCarrierData = new Map<
      string,
      { distinctEnrolled: Set<string>; enrollmentRows: number; premium: number }
    >();

    // Per-company plan-type enrollment: clientId → { Medical: Set, Dental: Set, ... }
    const companyPlanTypeEnrolled = new Map<
      string,
      Record<string, Set<string>>
    >();

    // Exception counters
    const exceptions = {
      missingPlanIdentifier: 0,
      unmatchedPlanIdentifier: 0,
      fallbackPlanNameMatch: 0,
      currentEnrollmentsWithEndDate: 0,
      blankOrInvalidPlanCost: 0,
    };

    let totalActiveEmployees = 0;
    let totalCompanies = 0;
    let totalPlansInMap = 0;

    function getOrCreateCarrier(carrier: string) {
      let entry = carrierMap.get(carrier);
      if (!entry) {
        entry = {
          carrier,
          eligibleEmployees: new Set(),
          enrolledEmployees: new Set(),
          enrollmentRows: 0,
          monthlyPremium: 0,
        };
        carrierMap.set(carrier, entry);
      }
      return entry;
    }

    function getCompanyCarrier(carrier: string, clientId: string) {
      const key = `${carrier}::${clientId}`;
      let d = companyCarrierData.get(key);
      if (!d) {
        d = { distinctEnrolled: new Set(), enrollmentRows: 0, premium: 0 };
        companyCarrierData.set(key, d);
      }
      return d;
    }

    function getCompanyPlanTypes(clientId: string): Record<string, Set<string>> {
      let entry = companyPlanTypeEnrolled.get(clientId);
      if (!entry) {
        entry = {
          Medical: new Set(),
          Dental: new Set(),
          Vision: new Set(),
          Supplemental: new Set(),
        };
        companyPlanTypeEnrolled.set(clientId, entry);
      }
      return entry;
    }

    // ── Step 3: Process each snapshot ────────────────────────────────────

    for (const snapshot of snapshots) {
      if (isExcluded({ groupName: snapshot.client.groupName }, exclusionRules)) {
        continue;
      }

      if (!latestImportDate || snapshot.importedAt > latestImportDate) {
        latestImportDate = snapshot.importedAt;
      }

      totalCompanies++;
      const clientId = snapshot.clientId;
      const groupName = snapshot.client.groupName;

      if (!companyInfo.has(clientId)) {
        companyInfo.set(clientId, { groupName, activeEmployees: new Set() });
      }

      // Build plan lookup: PlanIdentifier → carrier, PlanName → carrier
      // Also build planType lookup: PlanIdentifier → planType
      const planIdToCarrier = new Map<string, string>();
      const planNameToCarrier = new Map<string, string>();
      const planIdToPlanType = new Map<string, string>();
      const planNameToPlanType = new Map<string, string>();

      for (const bp of snapshot.benefitPlans) {
        if (
          isExcluded(
            { carrier: bp.carrier, planName: bp.planName, planType: bp.planType },
            exclusionRules
          )
        ) {
          continue;
        }

        const carrier = bp.carrier || "Unspecified Carrier";
        const category = classifyPlanType(bp.planType);

        if (bp.metadata) {
          try {
            const meta = JSON.parse(bp.metadata);
            const planId = meta.PlanIdentifier || meta.planIdentifier;
            if (planId) {
              planIdToCarrier.set(String(planId), carrier);
              planIdToPlanType.set(String(planId), category);
              totalPlansInMap++;
            }
          } catch { /* ignore */ }
        }
        if (bp.planName) {
          planNameToCarrier.set(bp.planName, carrier);
          planNameToPlanType.set(bp.planName, category);
        }

        // Track carrier → company for eligibility
        if (!carrierCompanies.has(carrier)) carrierCompanies.set(carrier, new Set());
        carrierCompanies.get(carrier)!.add(clientId);
      }

      if (planIdToCarrier.size === 0 && planNameToCarrier.size === 0) continue;

      // Process employees in batches to avoid loading all into memory
      const BATCH_SIZE = 500;
      let skip = 0;
      let hasMore = true;
      while (hasMore) {
        const employeeBatch = await prisma.employeeSnapshot.findMany({
          where: { clientSnapshotId: snapshot.id },
          select: { employeeId: true, status: true, metadata: true },
          take: BATCH_SIZE,
          skip,
        });
        if (employeeBatch.length < BATCH_SIZE) hasMore = false;
        skip += BATCH_SIZE;

        for (const emp of employeeBatch) {
          const status = (emp.status || "Active").toLowerCase();
          if (status !== "active") continue;

          totalActiveEmployees++;
          const empKey = `${clientId}::${emp.employeeId}`;
          companyInfo.get(clientId)!.activeEmployees.add(empKey);

          if (!emp.metadata) continue;
          let meta: any;
          try { meta = JSON.parse(emp.metadata); } catch { continue; }

          const enrollments = findEnrollmentsFromMeta(meta);
          const enrolledCarriersThisEmp = new Set<string>();

          for (const enrollment of enrollments) {
            // ── Filter: EnrollmentType = "Current" ──
            const enrollmentType =
              enrollment.EnrollmentType || enrollment.enrollmentType || enrollment.Type;
            let isQualifying = false;
            if (enrollmentType) {
              isQualifying = String(enrollmentType).toLowerCase() === "current";
            } else {
              // Fallback if EnrollmentType not in XML
              const declineReason = enrollment.DeclineReason || enrollment.declineReason;
              const endDate = enrollment.CoverageEndDate || enrollment.EndDate || enrollment.EndedOn;
              const isEnded = endDate && new Date(String(endDate)) <= new Date();
              isQualifying = !declineReason && !isEnded;
            }

            if (!isQualifying) continue;

            // ── Resolve carrier via PlanIdentifier → Plan → Carrier ──
            const enrollPlanId = String(
              enrollment.PlanIdentifier || enrollment.PlanId || enrollment.PlanID || ""
            );
            const enrollPlanName = String(
              enrollment.PlanName || enrollment.Plan || enrollment.Name || ""
            );

            let carrier: string | undefined;
            let planType: string | undefined;

            if (enrollPlanId) {
              carrier = planIdToCarrier.get(enrollPlanId);
              planType = planIdToPlanType.get(enrollPlanId);
              if (!carrier) {
                exceptions.unmatchedPlanIdentifier++;
                // Fallback to plan name
                if (enrollPlanName) {
                  carrier = planNameToCarrier.get(enrollPlanName);
                  planType = planNameToPlanType.get(enrollPlanName);
                  if (carrier) exceptions.fallbackPlanNameMatch++;
                }
              }
            } else {
              exceptions.missingPlanIdentifier++;
              if (enrollPlanName) {
                carrier = planNameToCarrier.get(enrollPlanName);
                planType = planNameToPlanType.get(enrollPlanName);
                if (carrier) exceptions.fallbackPlanNameMatch++;
              }
            }

            if (!carrier) continue;

            // Track EndDate exception
            const endDate = enrollment.EndDate || enrollment.CoverageEndDate || enrollment.EndedOn;
            if (endDate) exceptions.currentEnrollmentsWithEndDate++;

            // ── PlanCost ──
            const rawCost = String(
              enrollment.PlanCost || enrollment.MonthlyPlanCost || ""
            );
            let cost = 0;
            if (rawCost) {
              const parsed = parseFloat(rawCost);
              if (!isNaN(parsed)) {
                cost = parsed;
              } else {
                exceptions.blankOrInvalidPlanCost++;
              }
            } else {
              exceptions.blankOrInvalidPlanCost++;
            }

            // ── Aggregate: carrier level ──
            const cd = getOrCreateCarrier(carrier);
            cd.enrollmentRows++;
            cd.monthlyPremium += cost;

            if (!enrolledCarriersThisEmp.has(carrier)) {
              enrolledCarriersThisEmp.add(carrier);
              cd.enrolledEmployees.add(empKey);
            }

            // ── Aggregate: company-carrier level ──
            const ccd = getCompanyCarrier(carrier, clientId);
            ccd.enrollmentRows++;
            ccd.premium += cost;
            ccd.distinctEnrolled.add(empKey);

            // ── Aggregate: company plan-type level ──
            if (planType) {
              const cpt = getCompanyPlanTypes(clientId);
              cpt[planType].add(emp.employeeId);
            }
          }
        }
      }
    }

    // ── Step 4: Compute carrier-specific eligibility ─────────────────────

    for (const [carrier, clientIds] of carrierCompanies) {
      const entry = getOrCreateCarrier(carrier);
      for (const clientId of clientIds) {
        const info = companyInfo.get(clientId);
        if (info) {
          for (const empKey of info.activeEmployees) {
            entry.eligibleEmployees.add(empKey);
          }
        }
      }
    }

    // ── Step 5: Build main rows ──────────────────────────────────────────

    const rows = Array.from(carrierMap.values())
      .filter((e) => e.eligibleEmployees.size > 0)
      .map((e) => ({
        carrier: e.carrier,
        groups: carrierCompanies.get(e.carrier)?.size || 0,
        eligible: e.eligibleEmployees.size,
        enrolled: e.enrolledEmployees.size,
        monthlyPremium: Math.round(e.monthlyPremium * 100) / 100,
      }))
      .sort((a, b) => b.monthlyPremium - a.monthlyPremium);

    const totals = {
      groups: totalCompanies,
      eligible: rows.reduce((s, r) => s + r.eligible, 0),
      enrolled: rows.reduce((s, r) => s + r.enrolled, 0),
      monthlyPremium: Math.round(rows.reduce((s, r) => s + r.monthlyPremium, 0) * 100) / 100,
    };

    // ── Step 6: Build reconciliation data ────────────────────────────────

    const carrierAudit = Array.from(carrierMap.values())
      .filter((e) => e.eligibleEmployees.size > 0)
      .map((e) => ({
        carrier: e.carrier,
        eligible: e.eligibleEmployees.size,
        enrolled: e.enrolledEmployees.size,
        enrollmentRows: e.enrollmentRows,
        monthlyPremium: Math.round(e.monthlyPremium * 100) / 100,
      }))
      .sort((a, b) => b.monthlyPremium - a.monthlyPremium);

    const companyEligibility: {
      carrier: string;
      companyId: string;
      companyName: string;
      activeEmployees: number;
      hasCarrierPlan: boolean;
      eligibleContributed: number;
    }[] = [];

    for (const [carrier, clientIds] of carrierCompanies) {
      for (const clientId of clientIds) {
        const info = companyInfo.get(clientId);
        if (!info) continue;
        companyEligibility.push({
          carrier,
          companyId: clientId,
          companyName: info.groupName,
          activeEmployees: info.activeEmployees.size,
          hasCarrierPlan: true,
          eligibleContributed: info.activeEmployees.size,
        });
      }
    }
    companyEligibility.sort((a, b) => a.carrier.localeCompare(b.carrier) || a.companyName.localeCompare(b.companyName));

    const companyEnrollment: {
      carrier: string;
      companyId: string;
      companyName: string;
      enrolled: number;
      enrollmentRows: number;
      premium: number;
    }[] = [];

    for (const [key, data] of companyCarrierData) {
      const [carrier, clientId] = key.split("::");
      const info = companyInfo.get(clientId);
      companyEnrollment.push({
        carrier,
        companyId: clientId,
        companyName: info?.groupName || clientId,
        enrolled: data.distinctEnrolled.size,
        enrollmentRows: data.enrollmentRows,
        premium: Math.round(data.premium * 100) / 100,
      });
    }
    companyEnrollment.sort((a, b) => b.premium - a.premium);

    // ── Step 7: Build per-company plan-type data (for Groups page) ──────

    const companyPlanTypes: Record<string, {
      activeEmployees: number;
      medical: number;
      dental: number;
      vision: number;
      supplemental: number;
      premium: number;
    }> = {};

    for (const [clientId, info] of companyInfo) {
      const planTypes = companyPlanTypeEnrolled.get(clientId);

      // Sum premium across all carriers for this company
      let companyPremium = 0;
      for (const [key, data] of companyCarrierData) {
        if (key.endsWith(`::${clientId}`)) {
          companyPremium += data.premium;
        }
      }

      companyPlanTypes[clientId] = {
        activeEmployees: info.activeEmployees.size,
        medical: planTypes?.Medical?.size ?? 0,
        dental: planTypes?.Dental?.size ?? 0,
        vision: planTypes?.Vision?.size ?? 0,
        supplemental: planTypes?.Supplemental?.size ?? 0,
        premium: Math.round(companyPremium * 100) / 100,
      };
    }

    // ── YoY: Process previous period ─────────────────────────────────────

    let prevTotalActiveEmployees = 0;
    let prevTotalCompanies = 0;
    let prevTotalPremium = 0;

    for (const snapshot of prevSnapshots) {
      if (isExcluded({ groupName: snapshot.client.groupName }, exclusionRules)) {
        continue;
      }

      prevTotalCompanies++;
      const planIdToCarrier = new Map<string, string>();
      const planNameToCarrier = new Map<string, string>();

      for (const bp of snapshot.benefitPlans) {
        if (isExcluded({ carrier: bp.carrier, planName: bp.planName, planType: bp.planType }, exclusionRules)) continue;
        const carrier = bp.carrier || "Unspecified Carrier";
        if (bp.metadata) {
          try {
            const meta = JSON.parse(bp.metadata);
            const planId = meta.PlanIdentifier || meta.planIdentifier;
            if (planId) planIdToCarrier.set(String(planId), carrier);
          } catch { /* ignore */ }
        }
        if (bp.planName) planNameToCarrier.set(bp.planName, carrier);
      }

      if (planIdToCarrier.size === 0 && planNameToCarrier.size === 0) continue;

      // Process previous period employees in batches
      const PREV_BATCH_SIZE = 500;
      let prevSkip = 0;
      let prevHasMore = true;
      while (prevHasMore) {
        const employeeBatch = await prisma.employeeSnapshot.findMany({
          where: { clientSnapshotId: snapshot.id },
          select: { employeeId: true, status: true, metadata: true },
          take: PREV_BATCH_SIZE,
          skip: prevSkip,
        });
        if (employeeBatch.length < PREV_BATCH_SIZE) prevHasMore = false;
        prevSkip += PREV_BATCH_SIZE;

        for (const emp of employeeBatch) {
          const status = (emp.status || "Active").toLowerCase();
          if (status !== "active") continue;
          prevTotalActiveEmployees++;

          if (!emp.metadata) continue;
          let meta: any;
          try { meta = JSON.parse(emp.metadata); } catch { continue; }

          const enrollments = findEnrollmentsFromMeta(meta);
          for (const enrollment of enrollments) {
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

            const enrollPlanId = String(enrollment.PlanIdentifier || enrollment.PlanId || enrollment.PlanID || "");
            const enrollPlanName = String(enrollment.PlanName || enrollment.Plan || enrollment.Name || "");
            let carrier: string | undefined;
            if (enrollPlanId) {
              carrier = planIdToCarrier.get(enrollPlanId);
              if (!carrier && enrollPlanName) carrier = planNameToCarrier.get(enrollPlanName);
            } else if (enrollPlanName) {
              carrier = planNameToCarrier.get(enrollPlanName);
            }
            if (!carrier) continue;

            const rawCost = String(enrollment.PlanCost || enrollment.MonthlyPlanCost || "");
            if (rawCost) {
              const parsed = parseFloat(rawCost);
              if (!isNaN(parsed)) prevTotalPremium += parsed;
            }
          }
        }
      }
    }

    const dataPeriod = `${latestYear}-${String(latestMonth).padStart(2, "0")}`;
    const prevPeriod = prevSnapshot
      ? `${prevSnapshot.year}-${String(prevSnapshot.month).padStart(2, "0")}`
      : null;

    return NextResponse.json({
      rows,
      totals,
      lastUpload: latestImportDate?.toISOString() || null,
      dataPeriod,
      reconciliation: {
        totalActiveEmployees,
        totalCompanies,
        totalPlansInMap: totalPlansInMap,
        carrierAudit,
        companyEligibility,
        companyEnrollment,
        exceptions,
      },
      // New fields for Groups page
      companyPlanTypes,
      yoy: {
        currentYear: latestYear,
        previousYear: prevSnapshot?.year ?? null,
        currentPeriod: dataPeriod,
        previousPeriod: prevPeriod,
        current: {
          activeGroups: totalCompanies,
          activeEmployees: totalActiveEmployees,
          premium: Math.round(totals.monthlyPremium * 100) / 100,
        },
        previous: {
          activeGroups: prevTotalCompanies,
          activeEmployees: prevTotalActiveEmployees,
          premium: Math.round(prevTotalPremium * 100) / 100,
        },
      },
    });
  } catch (error) {
    console.error("Benefits report error:", error);
    return NextResponse.json(
      { error: "Failed to generate report" },
      { status: 500 }
    );
  }
}

/** Extract enrollment records from parsed employee metadata */
function findEnrollmentsFromMeta(meta: any): any[] {
  const container = meta.Enrollments || meta.enrollments;
  if (!container) return [];
  if (Array.isArray(container)) return container;
  const enrollments = container.Enrollment || container.enrollment;
  if (Array.isArray(enrollments)) return enrollments;
  if (enrollments && typeof enrollments === "object") return [enrollments];
  return [];
}
