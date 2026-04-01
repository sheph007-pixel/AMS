import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getOpenAI } from "@/lib/openai";
import { getExclusionRules, isExcluded } from "@/lib/exclusions";

/* eslint-disable @typescript-eslint/no-explicit-any */

const PEPM_RATE = 20;
const COMMISSION_RATE = 0.10;
const PEPM_CARRIERS = ["EBPA", "HealthEZ"];
const COMMISSION_CARRIERS = ["Guardian", "VSP"];

// ─── Data Gathering (MEMORY-OPTIMIZED) ──────────────────────────────────────

async function gatherSystemContext(): Promise<string> {
  const exclusionRules = await getExclusionRules();

  // 1. All clients
  const clients = await prisma.client.findMany({
    select: { groupId: true, groupName: true, sicCode: true, state: true },
    orderBy: { groupName: "asc" },
  });
  const activeClients = clients.filter(
    (c) => !isExcluded({ groupName: c.groupName }, exclusionRules)
  );

  // 2. Period coverage
  const periods = await prisma.clientSnapshot.findMany({
    where: { year: { gte: 2022 } },
    select: { year: true, month: true },
    distinct: ["year", "month"],
    orderBy: [{ year: "asc" }, { month: "asc" }],
  });

  // 3. Get snapshot list (NO employees)
  const snapshotList = await prisma.clientSnapshot.findMany({
    where: { year: { gte: 2022 } },
    select: {
      id: true,
      year: true,
      month: true,
      client: { select: { groupId: true, groupName: true } },
    },
    orderBy: [{ year: "asc" }, { month: "asc" }],
  });

  // Process into summary structures
  const yearData = new Map<
    number,
    {
      clients: Set<string>;
      carriers: Map<string, { premium: number; enrolled: number; fee: number }>;
      totalPremium: number;
      totalFee: number;
      totalEnrolled: number;
      months: Set<number>;
    }
  >();

  const clientYearData = new Map<
    string,
    Map<number, { premium: number; enrolled: number; fee: number; carriers: Set<string> }>
  >();

  for (const snap of snapshotList) {
    if (isExcluded({ groupName: snap.client.groupName }, exclusionRules)) continue;

    const { year, month } = snap;
    if (!yearData.has(year)) {
      yearData.set(year, {
        clients: new Set(),
        carriers: new Map(),
        totalPremium: 0,
        totalFee: 0,
        totalEnrolled: 0,
        months: new Set(),
      });
    }
    const yd = yearData.get(year)!;
    yd.clients.add(snap.client.groupName);
    yd.months.add(month);

    // Fetch benefit plans for this snapshot
    const benefitPlans = await prisma.benefitPlan.findMany({
      where: { clientSnapshotId: snap.id },
      select: { carrier: true, planType: true, planName: true, metadata: true },
    });

    const planIdToInfo = new Map<string, { carrier: string; planType: string }>();
    const planNameToInfo = new Map<string, { carrier: string; planType: string }>();
    for (const bp of benefitPlans) {
      if (isExcluded({ carrier: bp.carrier, planName: bp.planName, planType: bp.planType }, exclusionRules)) continue;
      const carrier = bp.carrier || "Unspecified";
      const info = { carrier, planType: bp.planType };
      if (bp.metadata) {
        try {
          const meta = JSON.parse(bp.metadata);
          const planId = meta.PlanIdentifier || meta.planIdentifier;
          if (planId) planIdToInfo.set(String(planId), info);
        } catch { /* ignore */ }
      }
      if (bp.planName) planNameToInfo.set(bp.planName, info);
    }

    // Fetch employees in batches
    const BATCH_SIZE = 500;
    let skip = 0;
    let hasMore = true;

    while (hasMore) {
      const employees = await prisma.employeeSnapshot.findMany({
        where: { clientSnapshotId: snap.id },
        select: { employeeId: true, status: true, metadata: true },
        take: BATCH_SIZE,
        skip,
      });

      if (employees.length < BATCH_SIZE) hasMore = false;
      skip += BATCH_SIZE;

      for (const emp of employees) {
        if ((emp.status || "Active").toLowerCase() !== "active") continue;
        if (!emp.metadata) continue;

        let meta: any;
        try { meta = JSON.parse(emp.metadata); } catch { continue; }

        const enrollments = findEnrollments(meta);
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

          let info: { carrier: string; planType: string } | undefined;
          if (enrollPlanId) {
            info = planIdToInfo.get(enrollPlanId);
            if (!info && enrollPlanName) info = planNameToInfo.get(enrollPlanName);
          } else if (enrollPlanName) {
            info = planNameToInfo.get(enrollPlanName);
          }
          if (!info) continue;

          const rawCost = String(enrollment.PlanCost || enrollment.MonthlyPlanCost || "");
          const premium = rawCost ? parseFloat(rawCost) || 0 : 0;

          const isPEPM = PEPM_CARRIERS.some((c) => info!.carrier.toLowerCase().includes(c.toLowerCase()));
          const isComm = COMMISSION_CARRIERS.some((c) => info!.carrier.toLowerCase().includes(c.toLowerCase()));
          let fee = 0;
          if (isPEPM) fee = PEPM_RATE;
          else if (isComm) fee = premium * COMMISSION_RATE;

          yd.totalPremium += premium;
          yd.totalFee += fee;
          yd.totalEnrolled++;

          if (!yd.carriers.has(info.carrier)) {
            yd.carriers.set(info.carrier, { premium: 0, enrolled: 0, fee: 0 });
          }
          const ca = yd.carriers.get(info.carrier)!;
          ca.premium += premium;
          ca.enrolled++;
          ca.fee += fee;

          const clientKey = snap.client.groupName;
          if (!clientYearData.has(clientKey)) {
            clientYearData.set(clientKey, new Map());
          }
          const cyd = clientYearData.get(clientKey)!;
          if (!cyd.has(year)) {
            cyd.set(year, { premium: 0, enrolled: 0, fee: 0, carriers: new Set() });
          }
          const cd = cyd.get(year)!;
          cd.premium += premium;
          cd.enrolled++;
          cd.fee += fee;
          cd.carriers.add(info.carrier);
        }
      }
    }
  }

  // ─── Build context string ───────────────────────────────────────────

  let ctx = `# KENNION AMS — Complete Book of Business Data\n\n`;
  ctx += `As of: ${new Date().toISOString().split("T")[0]}\n`;
  ctx += `Broker of Record: Kennion\n`;
  ctx += `Agency: Kennion Benefits\n`;
  ctx += `Data Source: Employee Navigator enrollment/billing data\n\n`;

  ctx += `## Period Coverage\n`;
  ctx += `Months in database: ${periods.length}\n`;
  ctx += `Range: ${periods[0]?.year}-${String(periods[0]?.month).padStart(2, "0")} through ${periods[periods.length - 1]?.year}-${String(periods[periods.length - 1]?.month).padStart(2, "0")}\n\n`;

  ctx += `## Active Clients (${activeClients.length})\n`;
  for (const c of activeClients) {
    const cyd = clientYearData.get(c.groupName);
    ctx += `- ${c.groupName} (${c.groupId}) — State: ${c.state || "N/A"}, SIC: ${c.sicCode || "N/A"}`;
    if (cyd) {
      const years = Array.from(cyd.keys()).sort();
      const latest = cyd.get(years[years.length - 1]);
      if (latest) {
        ctx += ` — Latest year premium: $${latest.premium.toFixed(2)}, enrolled: ${latest.enrolled}, carriers: ${Array.from(latest.carriers).join(", ")}`;
      }
    }
    ctx += `\n`;
  }

  ctx += `\n## Year-Over-Year Summary\n`;
  for (const [year, data] of Array.from(yearData.entries()).sort((a, b) => a[0] - b[0])) {
    const margin = data.totalPremium > 0 ? ((data.totalFee / data.totalPremium) * 100).toFixed(2) : "0";
    ctx += `### ${year} (${data.months.size} months)\n`;
    ctx += `- Active clients: ${data.clients.size}\n`;
    ctx += `- Total enrolled: ${data.totalEnrolled.toLocaleString()}\n`;
    ctx += `- Total premium: $${data.totalPremium.toFixed(2)}\n`;
    ctx += `- Est. fee income: $${data.totalFee.toFixed(2)}\n`;
    ctx += `- Effective margin: ${margin}%\n`;
    ctx += `- Carriers:\n`;
    for (const [carrier, cd] of Array.from(data.carriers.entries()).sort((a, b) => b[1].premium - a[1].premium)) {
      const isPEPM = PEPM_CARRIERS.some((c) => carrier.toLowerCase().includes(c.toLowerCase()));
      const isComm = COMMISSION_CARRIERS.some((c) => carrier.toLowerCase().includes(c.toLowerCase()));
      const feeType = isPEPM ? "PEPM" : isComm ? "Commission" : "N/A";
      ctx += `  - ${carrier}: Premium $${cd.premium.toFixed(2)}, Enrolled ${cd.enrolled}, Fee $${cd.fee.toFixed(2)} (${feeType})\n`;
    }
    ctx += `\n`;
  }

  ctx += `## Fee Model\n`;
  ctx += `- PEPM carriers (${PEPM_CARRIERS.join(", ")}): $${PEPM_RATE}/enrolled employee/month\n`;
  ctx += `- Commission carriers (${COMMISSION_CARRIERS.join(", ")}): ${COMMISSION_RATE * 100}% of monthly premium\n`;
  ctx += `- Other carriers: fee income tracked in financial statements, not estimated here\n\n`;

  let grandPremium = 0;
  let grandFee = 0;
  for (const data of yearData.values()) {
    grandPremium += data.totalPremium;
    grandFee += data.totalFee;
  }
  ctx += `## Grand Totals (All Years)\n`;
  ctx += `- Total premium under management: $${grandPremium.toFixed(2)}\n`;
  ctx += `- Total est. fee income: $${grandFee.toFixed(2)}\n`;
  ctx += `- Overall margin: ${grandPremium > 0 ? ((grandFee / grandPremium) * 100).toFixed(2) : "0"}%\n`;

  return ctx;
}

function findEnrollments(meta: any): any[] {
  const container = meta.Enrollments || meta.enrollments;
  if (!container) return [];
  if (Array.isArray(container)) return container;
  const enrollments = container.Enrollment || container.enrollment;
  if (Array.isArray(enrollments)) return enrollments;
  if (enrollments && typeof enrollments === "object") return [enrollments];
  return [];
}

// ─── Chat API ────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the Kennion AMS AI Analyst — a senior-level insurance industry data analyst embedded in the Kennion Agency Management System. You have complete access to Kennion's book of business data spanning 2022 through present.

Your role:
- Answer questions about clients, carriers, premiums, enrollment, fees, and trends
- Provide data-backed analysis with specific numbers from the actual data
- Generate audit findings and identify anomalies
- Help prepare materials for due diligence (Reagan Consulting is helping sell the company)
- Create custom breakdowns and summaries on demand
- Compare year-over-year performance
- Identify growth trends, client concentration risk, carrier mix changes

Style guidelines:
- Be precise — use actual dollar amounts and percentages from the data
- Be concise but thorough — lead with the answer, then support with data
- Use tables and structured formatting when presenting comparisons
- Flag interesting patterns or anomalies proactively
- When asked about something not in the data, clearly state what's available vs not
- Never fabricate numbers — only use data provided in your context
- Format currencies with commas and 2 decimal places
- Reference time periods specifically (e.g., "In FY2024..." not "recently")

Context about the business:
- Kennion is an employee benefits agency (broker of record: Kennion)
- Managed through Employee Navigator for enrollment/billing
- Fee model: PEPM ($20/mo) for EBPA & HealthEZ; 10% commission for Guardian & VSP
- Reagan Consulting is conducting due diligence for a potential sale
- Data comes from monthly XML enrollment exports from Employee Navigator
`;

export async function POST(request: NextRequest) {
  try {
    const { messages } = await request.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return Response.json(
        { error: "Messages array is required" },
        { status: 400 }
      );
    }

    const openai = getOpenAI();

    // Gather full data context
    const dataContext = await gatherSystemContext();

    const systemMessages = [
      { role: "system" as const, content: SYSTEM_PROMPT },
      {
        role: "system" as const,
        content: `Here is the complete, real-time data from the Kennion AMS database. Use ONLY this data to answer questions. Do not make up numbers.\n\n${dataContext}`,
      },
    ];

    // Stream the response
    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        ...systemMessages,
        ...messages.map((m: { role: string; content: string }) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ],
      stream: true,
      temperature: 0.3,
      max_tokens: 4000,
    });

    // Convert to ReadableStream for SSE
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ content })}\n\n`)
              );
            }
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: "Stream error" })}\n\n`
            )
          );
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error: any) {
    console.error("AI chat error:", error);
    return Response.json(
      {
        error:
          error?.message?.includes("API key")
            ? "OpenAI API key not configured"
            : "AI analysis failed",
      },
      { status: 500 }
    );
  }
}
