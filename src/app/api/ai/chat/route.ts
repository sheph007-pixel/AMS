import { NextRequest } from "next/server";
import { getOpenAI } from "@/lib/openai";
import { getCachedReport, rebuildAllCaches } from "@/lib/report-cache";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── Build context from cached data ─────────────────────────────────────────

async function gatherSystemContext(): Promise<string> {
  // Use cached production report — already has everything we need
  let production = await getCachedReport("production");
  let dashboard = await getCachedReport("dashboard");

  if (!production || !dashboard) {
    await rebuildAllCaches();
    production = await getCachedReport("production");
    dashboard = await getCachedReport("dashboard");
  }

  if (!production || !dashboard) return "No data available. Reports have not been generated yet.";

  let ctx = `# KENNION AMS — Complete Book of Business Data\n\n`;
  ctx += `As of: ${new Date().toISOString().split("T")[0]}\n`;
  ctx += `Broker of Record: Kennion\n`;
  ctx += `Agency: Kennion Benefits\n`;
  ctx += `Data Source: Employee Navigator enrollment/billing data\n\n`;

  // Summary from production
  const s = production.summary;
  ctx += `## Overview\n`;
  ctx += `- Total Clients: ${s.totalClients}\n`;
  ctx += `- Total Periods: ${s.totalPeriods} months\n`;
  ctx += `- Period Range: ${production.periods[0]} through ${production.periods[production.periods.length - 1]}\n`;
  ctx += `- Total Premium: $${s.totalPremium.toFixed(2)}\n`;
  ctx += `- Total Est. Fee Income: $${s.totalEstIncome.toFixed(2)}\n\n`;

  // Year-over-year from dashboard
  ctx += `## Year-Over-Year Summary\n`;
  for (const y of dashboard.yoySummary) {
    const margin = y.totalPremium > 0 ? ((y.totalEstIncome / y.totalPremium) * 100).toFixed(2) : "0";
    ctx += `### ${y.year} (${y.months} months)\n`;
    ctx += `- Avg Clients: ${y.avgClients}, Avg Employees: ${y.avgEmployees}\n`;
    ctx += `- Total Premium: $${y.totalPremium.toFixed(2)}\n`;
    ctx += `- Est. Fee Income: $${y.totalEstIncome.toFixed(2)}\n`;
    ctx += `- Effective Margin: ${margin}%\n\n`;
  }

  // Top carriers from dashboard
  ctx += `## Top Carriers (by total premium)\n`;
  for (const c of dashboard.topCarriers) {
    ctx += `- ${c.carrier}: $${c.premium.toFixed(2)}\n`;
  }
  ctx += `\n`;

  // LOB breakdown
  ctx += `## Line of Business Mix (latest period)\n`;
  for (const l of dashboard.lobBreakdown) {
    ctx += `- ${l.lob}: $${l.premium.toFixed(2)}\n`;
  }
  ctx += `\n`;

  // Client detail from production rows
  const clientMap = new Map<string, { premium: number; carriers: Set<string>; periods: number }>();
  for (const row of production.rows) {
    let c = clientMap.get(row.clientName);
    if (!c) { c = { premium: 0, carriers: new Set(), periods: 0 }; clientMap.set(row.clientName, c); }
    c.premium += row.monthlyPremium;
    c.carriers.add(row.carrier);
  }
  // Count periods per client
  const clientPeriods = new Map<string, Set<string>>();
  for (const row of production.rows) {
    if (!clientPeriods.has(row.clientName)) clientPeriods.set(row.clientName, new Set());
    clientPeriods.get(row.clientName)!.add(`${row.year}-${row.month}`);
  }
  for (const [name, periods] of clientPeriods) {
    const c = clientMap.get(name);
    if (c) c.periods = periods.size;
  }

  ctx += `## Clients (${clientMap.size})\n`;
  for (const [name, data] of Array.from(clientMap.entries()).sort((a, b) => b[1].premium - a[1].premium)) {
    ctx += `- ${name}: Total Premium $${data.premium.toFixed(2)}, Carriers: ${Array.from(data.carriers).join(", ")}, Active ${data.periods} months\n`;
  }
  ctx += `\n`;

  // Fee model
  ctx += `## Fee Model\n`;
  ctx += `- PEPM carriers (EBPA, HealthEZ): $20/enrolled employee/month\n`;
  ctx += `- Commission carriers (Guardian, VSP): 10% of monthly premium\n`;
  ctx += `- Other carriers: fee income tracked in financial statements, not estimated here\n`;

  return ctx;
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
      return Response.json({ error: "Messages array is required" }, { status: 400 });
    }

    const openai = getOpenAI();
    const dataContext = await gatherSystemContext();

    const systemMessages = [
      { role: "system" as const, content: SYSTEM_PROMPT },
      { role: "system" as const, content: `Here is the complete, real-time data from the Kennion AMS database. Use ONLY this data to answer questions. Do not make up numbers.\n\n${dataContext}` },
    ];

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

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
            }
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "Stream error" })}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
    });
  } catch (error: any) {
    console.error("AI chat error:", error);
    return Response.json(
      { error: error?.message?.includes("API key") ? "OpenAI API key not configured" : "AI analysis failed" },
      { status: 500 }
    );
  }
}
