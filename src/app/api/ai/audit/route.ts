import { NextRequest } from "next/server";
import { getOpenAI } from "@/lib/openai";

/* eslint-disable @typescript-eslint/no-explicit-any */

const AUDIT_PROMPT = `You are a senior insurance industry auditor reviewing production data from the Kennion AMS.

Analyze the provided production report summary data and produce a concise audit report covering:

1. **Data Quality Assessment** — Are the numbers internally consistent? Any red flags?
2. **Trend Analysis** — YoY premium and enrollment trends. Growth or decline patterns.
3. **Carrier Concentration** — Is revenue diversified or concentrated? Risk assessment.
4. **Fee Income Validation** — Are PEPM and commission fees correctly calculated based on the rates?
5. **Notable Observations** — Anything that stands out, positive or negative.
6. **Recommendation** — 1-2 sentence summary of data health.

Format as clean markdown with headers. Be specific with numbers. Keep it under 500 words. This will be displayed in the production report UI.`;

export async function POST(request: NextRequest) {
  try {
    const { summary, audit, methodology, yearBreakdown, carrierBreakdown } =
      await request.json();

    const openai = getOpenAI();

    const dataContext = `
Production Report Summary:
- Total Clients: ${summary.totalClients}
- Total Periods: ${summary.totalPeriods} months
- Total Detail Rows: ${summary.totalRows}
- Total Premium: $${summary.totalPremium.toFixed(2)}
- Total Est. Fee Income: $${summary.totalEstIncome.toFixed(2)}

Audit Cross-Checks:
- Premium: Summary $${audit.premiumCrossCheck.summaryTotal} vs Detail Rows $${audit.premiumCrossCheck.rowDetailTotal} — ${audit.premiumCrossCheck.match ? "MATCH" : "MISMATCH"}
- Fee: Summary $${audit.feeCrossCheck.summaryTotal} vs Detail Rows $${audit.feeCrossCheck.rowDetailTotal} — ${audit.feeCrossCheck.match ? "MATCH" : "MISMATCH"}
- Period Coverage: ${audit.periodCoverage.first} through ${audit.periodCoverage.last} (${audit.periodCoverage.totalMonths} months)
- Period Gaps: ${audit.periodCoverage.gaps.length === 0 ? "None" : audit.periodCoverage.gaps.join(", ")}
- Snapshots: ${audit.snapshotsQueried} queried, ${audit.snapshotsProcessed} processed, ${audit.snapshotsSkipped} excluded
- Employees Processed: ${audit.employeesProcessed}
- Enrollments Processed: ${audit.enrollmentsProcessed}

Fee Model:
- PEPM Carriers (${methodology.pepmCarriers.join(", ")}): $${methodology.pepmRate}/enrolled/month
- Commission Carriers (${methodology.commissionCarriers.join(", ")}): ${methodology.commissionRate * 100}%

Year Breakdown:
${yearBreakdown || "Not available"}

Carrier Breakdown:
${carrierBreakdown || "Not available"}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: AUDIT_PROMPT },
        { role: "user", content: dataContext },
      ],
      temperature: 0.2,
      max_tokens: 1500,
    });

    const analysis = completion.choices[0]?.message?.content || "Audit analysis unavailable.";

    return Response.json({ analysis });
  } catch (error: any) {
    console.error("AI audit error:", error);
    return Response.json(
      {
        error:
          error?.message?.includes("API key")
            ? "OpenAI API key not configured"
            : "AI audit failed",
      },
      { status: 500 }
    );
  }
}
