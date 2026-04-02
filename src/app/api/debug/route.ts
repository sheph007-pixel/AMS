import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * TEMPORARY: Dump all unique field names found at every level of enrollment metadata.
 * Shows the actual EN XML structure so we can find age band fields.
 */
export async function GET() {
  try {
    const snap = await prisma.clientSnapshot.findFirst({
      where: { year: { gte: 2025 } },
      select: { id: true, year: true, month: true, client: { select: { groupName: true } } },
      orderBy: [{ year: "desc" }, { month: "desc" }],
    });
    if (!snap) return NextResponse.json({ error: "No snapshot" });

    const emps = await prisma.employeeSnapshot.findMany({
      where: { clientSnapshotId: snap.id, status: "Active" },
      select: { metadata: true },
      take: 5,
    });

    // Collect ALL field keys at every level
    const topLevelKeys = new Set<string>();
    const enrollmentKeys = new Set<string>();
    const enrollmentSubObjects: Record<string, Set<string>> = {};
    const sampleEnrollments: any[] = [];

    for (const emp of emps) {
      let meta: any;
      try { meta = JSON.parse(emp.metadata || "{}"); } catch { continue; }
      const container = meta.Enrollments || meta.enrollments;
      if (!container) continue;
      const enrollments = container.Enrollment || container.enrollment;
      const list = Array.isArray(enrollments) ? enrollments : enrollments ? [enrollments] : [];

      for (const e of list) {
        for (const [k, v] of Object.entries(e)) {
          enrollmentKeys.add(k);
          if (v && typeof v === "object" && !Array.isArray(v)) {
            if (!enrollmentSubObjects[k]) enrollmentSubObjects[k] = new Set();
            for (const sk of Object.keys(v)) enrollmentSubObjects[k].add(sk);
          }
          if (Array.isArray(v) && v[0] && typeof v[0] === "object") {
            if (!enrollmentSubObjects[k]) enrollmentSubObjects[k] = new Set();
            for (const item of v) {
              if (typeof item === "object" && item) {
                for (const sk of Object.keys(item)) enrollmentSubObjects[k].add(sk);
              }
            }
          }
        }
        // Save first 3 full enrollment objects as samples
        if (sampleEnrollments.length < 6) sampleEnrollments.push(e);
      }
    }

    return NextResponse.json({
      snapshot: `${snap.client.groupName} ${snap.year}-${snap.month}`,
      employeesScanned: emps.length,
      enrollmentTopLevelKeys: Array.from(enrollmentKeys).sort(),
      subObjectKeys: Object.fromEntries(
        Object.entries(enrollmentSubObjects).map(([k, v]) => [k, Array.from(v).sort()])
      ),
      sampleEnrollments,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
