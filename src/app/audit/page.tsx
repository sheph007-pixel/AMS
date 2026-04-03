"use client";

import React, { useEffect, useState, useMemo, useCallback } from "react";
import { ArrowUp, ArrowDown, ArrowUpDown, Download, X } from "lucide-react";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── Types ──────────────────────────────────────────────────────────────────

interface DashRow {
  month: string; year: number; monthNum: number;
  clientName: string; clientCode: string;
  carrier: string; policyNumber: string; planName: string;
  grouping: string; rate: number; lives: number; benefitAmount: number;
  monthlyPremium: number; incomeMethod: string; feeRate: number;
  feeRateDisplay: string; income: number; coverageType: string;
}

interface RawMonth {
  period: string; year: number; month: number;
  rawCompanies: number; rawEmployees: number;
  activeEmployees: number; termedEmployees: number;
  rawPlans: number; excludedPlans: number;
}

interface MonthSummary {
  period: string; year: number; month: number;
  // Raw (from database)
  rawCompanies: number;
  rawEmployees: number;
  // Filtered (from dashboard cache)
  filteredActiveEmployees: number;
  filteredPremium: number;
  filteredEstIncome: number;
  // Excluded
  excludedEmployees: number;
  excludedPlans: number;
  // Detail
  companyList: string[];
}

type SortKey = "period" | "rawCompanies" | "rawEmployees" | "filteredActiveEmployees" | "filteredPremium" | "filteredEstIncome";
type SortDir = "asc" | "desc";
type DrillType = "companies" | "employees" | "premium" | "income";
interface DrillState { period: string; type: DrillType }

// ─── Helpers ────────────────────────────────────────────────────────────────

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtCur = (n: number) => "$" + (n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtNum = (n: number) => (n ?? 0).toLocaleString();

function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function AuditPage() {
  const [dashRows, setDashRows] = useState<DashRow[]>([]);
  const [rawMonths, setRawMonths] = useState<RawMonth[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("period");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [drill, setDrill] = useState<DrillState | null>(null);

  const loadData = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/reports/production-dashboard").then(r => r.ok ? r.json() : { rows: [] }),
      fetch("/api/reports/audit-raw").then(r => r.ok ? r.json() : []),
    ])
      .then(([dashData, rawData]) => {
        setDashRows(dashData.rows || []);
        setRawMonths(Array.isArray(rawData) ? rawData : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Build monthly summaries merging raw + filtered ────────────────

  const months: MonthSummary[] = useMemo(() => {
    // Filtered data from dashboard cache
    const filtered = new Map<string, { clients: Set<string>; lives: number; premium: number; income: number }>();
    for (const r of dashRows) {
      if (!r.month) continue;
      let m = filtered.get(r.month);
      if (!m) { m = { clients: new Set(), lives: 0, premium: 0, income: 0 }; filtered.set(r.month, m); }
      m.clients.add(r.clientCode || r.clientName);
      m.lives += r.lives || 0;
      m.premium += r.monthlyPremium || 0;
      m.income += r.income || 0;
    }

    // Raw data from database
    const rawMap = new Map(rawMonths.map(r => [r.period, r]));

    // Merge: use all periods from either source
    const allPeriods = new Set([...filtered.keys(), ...rawMap.keys()]);

    return Array.from(allPeriods).map(period => {
      const raw = rawMap.get(period);
      const filt = filtered.get(period);

      return {
        period,
        year: raw?.year || parseInt(period.split("-")[0]),
        month: raw?.month || parseInt(period.split("-")[1]),
        rawCompanies: raw?.rawCompanies || 0,
        rawEmployees: raw?.rawEmployees || 0,
        filteredActiveEmployees: filt?.lives || 0,
        filteredPremium: Math.round((filt?.premium || 0) * 100) / 100,
        filteredEstIncome: Math.round((filt?.income || 0) * 100) / 100,
        excludedEmployees: raw?.termedEmployees || 0,
        excludedPlans: raw?.excludedPlans || 0,
        companyList: filt ? Array.from(filt.clients).sort() : [],
      };
    });
  }, [dashRows, rawMonths]);

  // ── Sort ──────────────────────────────────────────────────────────

  const sorted = useMemo(() => {
    return [...months].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "period") cmp = a.period.localeCompare(b.period);
      else cmp = (a[sortKey] as number) - (b[sortKey] as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [months, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir(key === "period" ? "desc" : "desc"); }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 text-gray-400 ml-0.5 inline" />;
    return sortDir === "asc" ? <ArrowUp className="w-3 h-3 text-bob-purple ml-0.5 inline" /> : <ArrowDown className="w-3 h-3 text-bob-purple ml-0.5 inline" />;
  }

  // ── Drill-down ────────────────────────────────────────────────────

  const drillData = useMemo(() => {
    if (!drill) return null;
    const monthRows = dashRows.filter(r => r.month === drill.period);

    if (drill.type === "companies") {
      const compMap = new Map<string, { name: string; code: string; plans: number; lives: number; premium: number; income: number }>();
      for (const r of monthRows) {
        const key = r.clientCode || r.clientName;
        let c = compMap.get(key);
        if (!c) { c = { name: r.clientName, code: r.clientCode, plans: 0, lives: 0, premium: 0, income: 0 }; compMap.set(key, c); }
        c.plans++; c.lives += r.lives || 0; c.premium += r.monthlyPremium || 0; c.income += r.income || 0;
      }
      return { title: "Companies", rows: Array.from(compMap.values()).sort((a, b) => b.premium - a.premium), type: "companies" as const };
    }
    if (drill.type === "employees") {
      const clientLives = new Map<string, { name: string; lives: number; plans: number }>();
      for (const r of monthRows) {
        let c = clientLives.get(r.clientName);
        if (!c) { c = { name: r.clientName, lives: 0, plans: 0 }; clientLives.set(r.clientName, c); }
        c.lives += r.lives || 0; c.plans++;
      }
      return { title: "Active Employees by Client", rows: Array.from(clientLives.values()).sort((a, b) => b.lives - a.lives), type: "employees" as const };
    }
    if (drill.type === "premium") {
      return {
        title: "Premium Detail", type: "premium" as const,
        rows: monthRows.filter(r => (r.monthlyPremium || 0) > 0).map(r => ({
          client: r.clientName, carrier: r.carrier, plan: r.planName, grouping: r.grouping, lives: r.lives || 0, premium: r.monthlyPremium || 0,
        })).sort((a, b) => b.premium - a.premium),
      };
    }
    return {
      title: "Estimated Income Detail", type: "income" as const,
      rows: monthRows.filter(r => (r.income || 0) > 0).map(r => ({
        client: r.clientName, carrier: r.carrier, plan: r.planName, grouping: r.grouping, lives: r.lives || 0, premium: r.monthlyPremium || 0,
        method: r.incomeMethod, rate: r.feeRateDisplay, income: r.income || 0,
      })).sort((a, b) => b.income - a.income),
    };
  }, [drill, dashRows]);

  function exportDrill() {
    if (!drillData || !drill) return;
    const p = drill.period;
    if (drillData.type === "companies") {
      const lines = ["Company,Code,Plans,Lives,Premium,Est. Income", ...drillData.rows.map((r: any) => `"${r.name}","${r.code}",${r.plans},${r.lives},${r.premium.toFixed(2)},${r.income.toFixed(2)}`)];
      downloadCSV(lines.join("\n"), `audit-companies-${p}.csv`);
    } else if (drillData.type === "employees") {
      const lines = ["Client,Active Employees,Plan Rows", ...drillData.rows.map((r: any) => `"${r.name}",${r.lives},${r.plans}`)];
      downloadCSV(lines.join("\n"), `audit-employees-${p}.csv`);
    } else if (drillData.type === "premium") {
      const lines = ["Client,Carrier,Plan,Grouping,Lives,Premium", ...drillData.rows.map((r: any) => `"${r.client}","${r.carrier}","${r.plan}","${r.grouping}",${r.lives},${r.premium.toFixed(2)}`)];
      downloadCSV(lines.join("\n"), `audit-premium-${p}.csv`);
    } else {
      const lines = ["Client,Carrier,Plan,Grouping,Lives,Premium,Method,Rate,Est. Income", ...drillData.rows.map((r: any) => `"${r.client}","${r.carrier}","${r.plan}","${r.grouping}",${r.lives},${r.premium.toFixed(2)},"${r.method}","${r.rate}",${r.income.toFixed(2)}`)];
      downloadCSV(lines.join("\n"), `audit-income-${p}.csv`);
    }
  }

  // ── Render ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="text-center py-16 text-bob-text-soft">
        <div className="w-8 h-8 border-2 border-bob-purple border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        Loading audit data...
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-bob-text">Monthly Audit</h1>
        <p className="text-bob-text-soft mt-1">
          Raw uploaded data vs filtered production report — {months.length} months
        </p>
      </div>

      {/* Note about historical data */}
      {rawMonths.some(m => m.excludedPlans === 0 && m.rawPlans > 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800 mb-4">
          Historical months imported before this update may show 0 excluded plans because excluded plans were previously dropped at import time.
          Re-import affected months to recover full raw plan data.
        </div>
      )}

      {/* Monthly Table */}
      <div className="bg-white rounded-2xl border border-bob-border overflow-hidden mb-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-bob-border">
                {([
                  ["period", "Month", "text-left"],
                  ["rawCompanies", "Raw Companies", "text-right"],
                  ["rawEmployees", "Raw Employees", "text-right"],
                  ["filteredActiveEmployees", "Active Employees", "text-right"],
                  ["filteredPremium", "Premium", "text-right"],
                  ["filteredEstIncome", "Est. Income", "text-right"],
                ] as [SortKey, string, string][]).map(([key, label, align]) => (
                  <th key={key} onClick={() => handleSort(key)}
                    className={`px-4 py-3 ${align} text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-bob-purple transition-colors select-none whitespace-nowrap`}>
                    {label} <SortIcon col={key} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sorted.map(m => (
                <tr key={m.period} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-bob-text whitespace-nowrap">
                    {m.month ? `${MONTHS[m.month]} ${m.year}` : m.period}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setDrill({ period: m.period, type: "companies" })}
                      className="text-bob-purple hover:underline font-medium">{m.rawCompanies}</button>
                  </td>
                  <td className="px-4 py-3 text-right text-bob-text">
                    {fmtNum(m.rawEmployees)}
                    {m.excludedEmployees > 0 && (
                      <span className="text-[10px] text-bob-text-soft ml-1">({fmtNum(m.excludedEmployees)} termed)</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setDrill({ period: m.period, type: "employees" })}
                      className="text-bob-purple hover:underline font-medium">{fmtNum(m.filteredActiveEmployees)}</button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setDrill({ period: m.period, type: "premium" })}
                      className="text-bob-purple hover:underline font-medium">{fmtCur(m.filteredPremium)}</button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setDrill({ period: m.period, type: "income" })}
                      className="text-bob-purple hover:underline font-medium">{fmtCur(m.filteredEstIncome)}</button>
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-bob-text-soft">No data available. Import XML data first.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drill-Down Modal */}
      {drill && drillData && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={() => setDrill(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-bob-border flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-bob-text">{drillData.title}</h3>
                <p className="text-xs text-bob-text-soft">{drill.period} — {drillData.rows.length} rows</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={exportDrill}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-50 text-bob-text rounded-lg hover:bg-gray-100 transition-colors">
                  <Download className="w-3 h-3" /> Export CSV
                </button>
                <button onClick={() => setDrill(null)} className="p-1.5 hover:bg-gray-100 rounded-lg"><X className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="overflow-auto flex-1 p-4">
              {drillData.type === "companies" && (
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-bob-border">
                    <th className="text-left py-2 px-2 font-semibold text-gray-500">Company</th>
                    <th className="text-left py-2 px-2 font-semibold text-gray-500">Code</th>
                    <th className="text-right py-2 px-2 font-semibold text-gray-500">Plans</th>
                    <th className="text-right py-2 px-2 font-semibold text-gray-500">Lives</th>
                    <th className="text-right py-2 px-2 font-semibold text-gray-500">Premium</th>
                    <th className="text-right py-2 px-2 font-semibold text-gray-500">Est. Income</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {drillData.rows.map((r: any, i: number) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="py-2 px-2 font-medium">{r.name}</td>
                        <td className="py-2 px-2 text-gray-500 font-mono text-[10px]">{r.code}</td>
                        <td className="py-2 px-2 text-right">{r.plans}</td>
                        <td className="py-2 px-2 text-right">{fmtNum(r.lives)}</td>
                        <td className="py-2 px-2 text-right">{fmtCur(r.premium)}</td>
                        <td className="py-2 px-2 text-right">{fmtCur(r.income)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {drillData.type === "employees" && (
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-bob-border">
                    <th className="text-left py-2 px-2 font-semibold text-gray-500">Client</th>
                    <th className="text-right py-2 px-2 font-semibold text-gray-500">Active Employees</th>
                    <th className="text-right py-2 px-2 font-semibold text-gray-500">Plan Rows</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {drillData.rows.map((r: any, i: number) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="py-2 px-2 font-medium">{r.name}</td>
                        <td className="py-2 px-2 text-right">{fmtNum(r.lives)}</td>
                        <td className="py-2 px-2 text-right">{r.plans}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {(drillData.type === "premium" || drillData.type === "income") && (
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-bob-border">
                    <th className="text-left py-2 px-2 font-semibold text-gray-500">Client</th>
                    <th className="text-left py-2 px-2 font-semibold text-gray-500">Carrier</th>
                    <th className="text-left py-2 px-2 font-semibold text-gray-500">Plan</th>
                    <th className="text-left py-2 px-2 font-semibold text-gray-500">Grouping</th>
                    <th className="text-right py-2 px-2 font-semibold text-gray-500">Lives</th>
                    <th className="text-right py-2 px-2 font-semibold text-gray-500">Premium</th>
                    {drillData.type === "income" && <>
                      <th className="text-left py-2 px-2 font-semibold text-gray-500">Method</th>
                      <th className="text-right py-2 px-2 font-semibold text-gray-500">Rate</th>
                      <th className="text-right py-2 px-2 font-semibold text-gray-500">Est. Income</th>
                    </>}
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {drillData.rows.map((r: any, i: number) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="py-2 px-2">{r.client}</td>
                        <td className="py-2 px-2">{r.carrier}</td>
                        <td className="py-2 px-2 max-w-[150px] truncate" title={r.plan}>{r.plan}</td>
                        <td className="py-2 px-2">{r.grouping}</td>
                        <td className="py-2 px-2 text-right">{r.lives}</td>
                        <td className="py-2 px-2 text-right">{fmtCur(r.premium)}</td>
                        {drillData.type === "income" && <>
                          <td className="py-2 px-2">{r.method}</td>
                          <td className="py-2 px-2 text-right">{r.rate}</td>
                          <td className="py-2 px-2 text-right font-medium">{fmtCur(r.income)}</td>
                        </>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
