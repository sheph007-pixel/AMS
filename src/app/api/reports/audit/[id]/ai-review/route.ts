import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * POST — Request optional AI anomaly review for a completed audit.
 *
 * This is NOT the primary verification signal.
 * The AI review is advisory only — it generates a narrative note
 * explaining anomalies and likely causes of variance.
 *
 * Requires OPENAI_API_KEY environment variable.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const audit = await prisma.reportAudit.findUnique({ where: { id } });
    if (!audit) return NextResponse.json({ error: "Audit not found" }, { status: 404 });

    const apiKey = process.env.OPENAI_API_KEY || process.env.openai;
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY not configured. Set OPENAI_API_KEY or openai env var." }, { status: 400 });
    }

    // Build summary for AI review
    const checks = audit.checksDetail ? JSON.parse(audit.checksDetail) : [];
    const failedChecks = checks.filter((c: any) => c.status !== "pass");
    const monthSubs = audit.monthSubtotals ? JSON.parse(audit.monthSubtotals) : {};

    const prompt = buildAiPrompt(audit, failedChecks, monthSubs);

    // Call OpenAI
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a benefits administration auditor. Analyze the audit results and provide a concise narrative explaining any anomalies or variances. Be specific about likely causes. Do not present yourself as certifying accuracy — you are providing an advisory note only.",
          },
          { role: "user", content: prompt },
        ],
        max_tokens: 800,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error("OpenAI error:", errBody);
      return NextResponse.json({ error: "AI review request failed" }, { status: 502 });
    }

    const aiData = await response.json();
    const aiNote = aiData.choices?.[0]?.message?.content || "No response generated.";

    // Store AI note on the audit record
    await prisma.reportAudit.update({
      where: { id },
      data: {
        aiReviewCompleted: true,
        aiNote,
        aiReviewedAt: new Date(),
      },
    });

    return NextResponse.json({
      aiReviewCompleted: true,
      aiNote,
    });
  } catch (error) {
    console.error("AI review error:", error);
    return NextResponse.json({ error: "Failed to run AI review" }, { status: 500 });
  }
}

function buildAiPrompt(audit: any, failedChecks: any[], monthSubs: any): string {
  let prompt = `Production Report Audit Summary (${audit.reportType}):\n\n`;
  prompt += `Status: ${audit.status}\n`;
  prompt += `Checks: ${audit.checksPassed} passed, ${audit.checksFailed} failed/warning out of ${audit.checksRun}\n\n`;

  prompt += `Report Totals: ${audit.reportTotalRows} rows, ${audit.reportTotalLives} lives, $${audit.reportTotalPremium.toFixed(2)} premium, $${audit.reportTotalIncome.toFixed(2)} est. income\n`;
  prompt += `Audit Totals:  ${audit.auditTotalRows} rows, ${audit.auditTotalLives} lives, $${audit.auditTotalPremium.toFixed(2)} premium, $${audit.auditTotalIncome.toFixed(2)} est. income\n`;
  prompt += `Variances: rows=${audit.varianceRows}, lives=${audit.varianceLives}, premium=$${audit.variancePremium.toFixed(2)}, income=$${audit.varianceIncome.toFixed(2)}\n\n`;

  if (failedChecks.length > 0) {
    prompt += `Failed/Warning Checks:\n`;
    for (const c of failedChecks) {
      prompt += `  - ${c.name} [${c.status}]: ${c.message}\n`;
    }
    prompt += "\n";
  }

  // Monthly trend
  const months = Object.entries(monthSubs).sort(([a], [b]) => a.localeCompare(b));
  if (months.length > 0) {
    prompt += `Monthly Premium Trend (last 6):\n`;
    for (const [m, data] of months.slice(-6)) {
      const d = data as any;
      prompt += `  ${m}: ${d.lives} lives, $${d.premium.toFixed(2)} premium, $${d.income.toFixed(2)} income\n`;
    }
  }

  prompt += "\nPlease provide:\n1. A brief narrative summary of the audit findings\n2. Likely causes for any variances or anomalies\n3. Any data quality concerns\n\nKeep the response under 300 words. Do not claim to certify or verify the data.";

  return prompt;
}
