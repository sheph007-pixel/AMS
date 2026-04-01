"use client";

import { useEffect, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend,
} from "recharts";
import { ArrowLeft, DollarSign, TrendingUp, Building2 } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrendPoint {
  period: string;
  year: number;
  month: number;
  premium: number;
  estIncome: number;
  clients: number;
  employees: number;
}

interface YoYRow {
  year: number;
  months: number;
  avgClients: number;
  avgEmployees: number;
  totalPremium: number;
  totalEstIncome: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  return `$${val.toLocaleString("en-US", { minimumFractionDigits: 0 })}`;
}

function formatCurrencyFull(val: number): string {
  return "$" + val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function monthLabel(m: number): string {
  return ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m] || "";
}

function CustomTooltip({ active, payload, label }: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-bob-border rounded-xl shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-bob-text mb-1">{label}</p>
      {payload.map((p: any, i: number) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
        <p key={i} style={{ color: p.color }} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          {p.name}: {typeof p.value === "number" ? formatCurrencyFull(p.value) : p.value}
        </p>
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FinancialsPage() {
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [yoy, setYoy] = useState<YoYRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((res) => res.json())
      .then((data) => {
        setTrend(data.premiumTrend || []);
        setYoy(data.yoySummary || []);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-bob-purple border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-bob-text-soft text-sm">Loading financials...</p>
        </div>
      </div>
    );
  }

  // Compute annual revenue/income for bar chart
  const annualData = yoy.map(row => ({
    year: String(row.year),
    premium: row.totalPremium,
    estIncome: row.totalEstIncome,
  }));

  // Trend chart data
  const trendData = trend.map(t => ({
    name: `${monthLabel(t.month)} ${t.year}`,
    premium: t.premium,
    estIncome: t.estIncome,
  }));

  // Totals
  const totalPremium = yoy.reduce((s, r) => s + r.totalPremium, 0);
  const totalIncome = yoy.reduce((s, r) => s + r.totalEstIncome, 0);
  const totalMonths = yoy.reduce((s, r) => s + r.months, 0);

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <a href="/" className="inline-flex items-center gap-1.5 text-sm text-bob-text-soft hover:text-bob-purple transition-colors mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to Dashboard
        </a>
        <h1 className="text-3xl font-bold tracking-tight text-bob-text">Financial Overview</h1>
        <p className="text-bob-text-soft mt-1">
          Revenue and fee income analysis derived from production data — {totalMonths} months of billing records
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8 stagger-children">
        <div className="bg-white rounded-2xl border border-bob-border p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-bob-purple-light flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-bob-purple" />
            </div>
            <span className="text-xs font-medium text-bob-text-soft uppercase tracking-wide">Total Premium Billed</span>
          </div>
          <p className="text-2xl font-bold text-bob-text">{formatCurrencyFull(totalPremium)}</p>
          <p className="text-xs text-bob-text-soft mt-1">Across all carriers, {yoy.length} fiscal years</p>
        </div>
        <div className="bg-white rounded-2xl border border-bob-border p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-bob-green-light flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-bob-green" />
            </div>
            <span className="text-xs font-medium text-bob-text-soft uppercase tracking-wide">Est. Fee Income</span>
          </div>
          <p className="text-2xl font-bold text-bob-green">{formatCurrencyFull(totalIncome)}</p>
          <p className="text-xs text-bob-text-soft mt-1">PEPM ($20/mo) + Commission (10%)</p>
        </div>
        <div className="bg-white rounded-2xl border border-bob-border p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-bob-blue-light flex items-center justify-center">
              <Building2 className="w-5 h-5 text-bob-blue" />
            </div>
            <span className="text-xs font-medium text-bob-text-soft uppercase tracking-wide">Billing Periods</span>
          </div>
          <p className="text-2xl font-bold text-bob-text">{totalMonths}</p>
          <p className="text-xs text-bob-text-soft mt-1">{yoy[0]?.year || 2022} through {yoy[yoy.length - 1]?.year || 2025}</p>
        </div>
      </div>

      {/* Annual Revenue Bar Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-2xl border border-bob-border p-5">
          <h2 className="text-sm font-semibold text-bob-text mb-1">Annual Premium & Fee Income</h2>
          <p className="text-xs text-bob-text-soft mb-4">Year-over-year comparison of total premium billed and estimated fee income</p>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={annualData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="year" tick={{ fontSize: 12, fill: "#6B7280" }} />
                <YAxis tick={{ fontSize: 10, fill: "#9CA3AF" }} tickFormatter={(v) => formatCurrency(v)} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="premium" name="Premium Billed" fill="#7C5CFC" radius={[4, 4, 0, 0]} />
                <Bar dataKey="estIncome" name="Est. Fee Income" fill="#34D399" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Monthly Income Trend */}
        <div className="bg-white rounded-2xl border border-bob-border p-5">
          <h2 className="text-sm font-semibold text-bob-text mb-1">Monthly Fee Income Trend</h2>
          <p className="text-xs text-bob-text-soft mb-4">Estimated monthly fee income from PEPM and commission carriers</p>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#34D399" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#34D399" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#9CA3AF" }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: "#9CA3AF" }} tickFormatter={(v) => formatCurrency(v)} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="estIncome" name="Est. Fee Income" stroke="#34D399" strokeWidth={2} fill="url(#incomeGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Annual Detail Table */}
      <div className="bg-white rounded-2xl border border-bob-border overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-bob-border">
          <h2 className="text-sm font-semibold text-bob-text">Annual Financial Summary</h2>
          <p className="text-xs text-bob-text-soft mt-0.5">Aggregated from Employee Navigator enrollment/billing data</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-bob-border">
              <tr>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Fiscal Year</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Months</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Avg Clients</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Avg Enrolled</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Total Premium</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Est. Fee Income</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Effective Margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {yoy.map((row) => {
                const margin = row.totalPremium > 0 ? (row.totalEstIncome / row.totalPremium) * 100 : 0;
                return (
                  <tr key={row.year} className="hover:bg-purple-50/30 transition-colors">
                    <td className="px-5 py-3 font-semibold text-bob-text">{row.year}</td>
                    <td className="px-5 py-3 text-right text-bob-text-soft">{row.months}</td>
                    <td className="px-5 py-3 text-right text-bob-text tabular-nums">{row.avgClients.toLocaleString()}</td>
                    <td className="px-5 py-3 text-right text-bob-text tabular-nums">{row.avgEmployees.toLocaleString()}</td>
                    <td className="px-5 py-3 text-right font-medium text-bob-text tabular-nums">{formatCurrencyFull(row.totalPremium)}</td>
                    <td className="px-5 py-3 text-right font-medium text-bob-green tabular-nums">{formatCurrencyFull(row.totalEstIncome)}</td>
                    <td className="px-5 py-3 text-right text-bob-text-soft tabular-nums">{margin.toFixed(2)}%</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-bob-border bg-gray-50">
              <tr>
                <td className="px-5 py-3 font-bold text-bob-text">Total</td>
                <td className="px-5 py-3 text-right font-semibold text-bob-text">{totalMonths}</td>
                <td className="px-5 py-3 text-right text-bob-text-soft">—</td>
                <td className="px-5 py-3 text-right text-bob-text-soft">—</td>
                <td className="px-5 py-3 text-right font-bold text-bob-text tabular-nums">{formatCurrencyFull(totalPremium)}</td>
                <td className="px-5 py-3 text-right font-bold text-bob-green tabular-nums">{formatCurrencyFull(totalIncome)}</td>
                <td className="px-5 py-3 text-right text-bob-text-soft tabular-nums">{totalPremium > 0 ? ((totalIncome / totalPremium) * 100).toFixed(2) : 0}%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Methodology Note */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-900">
        <p className="font-semibold mb-1">Methodology</p>
        <p>
          Financial figures are derived from Employee Navigator enrollment billing data — the source system
          for all client billing and premium collection. Fee income is estimated using our standard fee model:
          PEPM carriers (EBPA, HealthEZ) at $20/enrolled employee/month, commission carriers (Guardian, VSP)
          at 10% of monthly premium. Actual collected revenue from carriers, captives, and other fee arrangements
          is tracked in Kennion/NIA QuickBooks and may differ due to timing, retroactive adjustments, and billing cycles.
        </p>
      </div>
    </div>
  );
}
