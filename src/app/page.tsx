"use client";

import { useEffect, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from "recharts";
import { Building2, Users, DollarSign, TrendingUp, FileText, ArrowRight } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface KPI {
  currentYear: number;
  previousYear: number;
  current: { clients: number; employees: number; premium: number; estIncome: number };
  previous: { clients: number; employees: number; premium: number; estIncome: number };
}

interface TrendPoint {
  period: string;
  year: number;
  month: number;
  premium: number;
  clients: number;
  employees: number;
  estIncome: number;
}

interface CarrierData {
  carrier: string;
  premium: number;
}

interface LOBData {
  lob: string;
  premium: number;
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
  return `$${val.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatCurrencyFull(val: number): string {
  return "$" + val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pctChange(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? "+100%" : "—";
  const pct = ((current - previous) / previous) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function monthLabel(m: number): string {
  return ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m] || "";
}

const CHART_COLORS = ["#7C5CFC", "#4A9EFF", "#34D399", "#FF6B6B", "#FFB347", "#2CC5BD", "#F472B6", "#A78BFA"];

// ─── Tooltip ──────────────────────────────────────────────────────────────────

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

export default function DashboardPage() {
  const [kpi, setKpi] = useState<KPI | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [carriers, setCarriers] = useState<CarrierData[]>([]);
  const [lob, setLob] = useState<LOBData[]>([]);
  const [yoy, setYoy] = useState<YoYRow[]>([]);
  const [totalPeriods, setTotalPeriods] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = () => {
    setLoading(true);
    setError(null);
    fetch("/api/dashboard")
      .then((res) => {
        if (!res.ok) throw new Error(`Server error (${res.status})`);
        return res.json();
      })
      .then((data) => {
        setKpi(data.kpi || null);
        setTrend(data.premiumTrend || []);
        setCarriers(data.topCarriers || []);
        setLob(data.lobBreakdown || []);
        setYoy(data.yoySummary || []);
        setTotalPeriods(data.totalPeriods || 0);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[500px]">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-bob-purple border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-bob-text-soft text-sm">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[500px]">
        <div className="text-center max-w-md">
          <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
            <span className="text-red-600 text-xl">!</span>
          </div>
          <p className="text-bob-text font-semibold mb-2">Failed to load dashboard</p>
          <p className="text-bob-text-soft text-sm mb-4">{error}</p>
          <button onClick={loadData} className="px-4 py-2 bg-bob-purple text-white rounded-lg text-sm font-medium hover:bg-bob-purple/90 transition-colors">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const trendData = trend.map(t => ({
    name: `${monthLabel(t.month)} ${t.year}`,
    premium: t.premium,
    estIncome: t.estIncome,
    clients: t.clients,
    employees: t.employees,
  }));

  const kpiCards = kpi ? [
    {
      label: "Active Clients",
      value: kpi.current.clients,
      prev: kpi.previous.clients,
      format: (v: number) => v.toLocaleString(),
      icon: <Building2 className="w-5 h-5 text-bob-purple" />,
      bg: "bg-bob-purple-light",
      change: pctChange(kpi.current.clients, kpi.previous.clients),
      up: kpi.current.clients >= kpi.previous.clients,
    },
    {
      label: "Enrolled Employees",
      value: kpi.current.employees,
      prev: kpi.previous.employees,
      format: (v: number) => v.toLocaleString(),
      icon: <Users className="w-5 h-5 text-bob-green" />,
      bg: "bg-bob-green-light",
      change: pctChange(kpi.current.employees, kpi.previous.employees),
      up: kpi.current.employees >= kpi.previous.employees,
    },
    {
      label: "Monthly Premium",
      value: kpi.current.premium,
      prev: kpi.previous.premium,
      format: formatCurrency,
      icon: <DollarSign className="w-5 h-5 text-bob-blue" />,
      bg: "bg-bob-blue-light",
      change: pctChange(kpi.current.premium, kpi.previous.premium),
      up: kpi.current.premium >= kpi.previous.premium,
    },
    {
      label: "Est. Monthly Income",
      value: kpi.current.estIncome,
      prev: kpi.previous.estIncome,
      format: formatCurrency,
      icon: <TrendingUp className="w-5 h-5 text-bob-teal" />,
      bg: "bg-bob-teal-light",
      change: pctChange(kpi.current.estIncome, kpi.previous.estIncome),
      up: kpi.current.estIncome >= kpi.previous.estIncome,
    },
  ] : [];

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-bob-text">Dashboard</h1>
            <p className="text-bob-text-soft mt-1">
              Kennion Agency Management System — {totalPeriods} months of production data
            </p>
          </div>
          <a
            href="/reports/production"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-bob-purple to-bob-blue text-white text-sm font-semibold rounded-xl hover:opacity-90 transition-opacity shadow-md"
          >
            <FileText className="w-4 h-4" /> Production Report <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      </div>

      {/* KPI Cards */}
      {kpi && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8 stagger-children">
          {kpiCards.map((card) => (
            <div key={card.label} className="bg-white rounded-2xl border border-bob-border p-5 hover:shadow-md transition-shadow duration-300">
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-10 h-10 rounded-xl ${card.bg} flex items-center justify-center`}>
                  {card.icon}
                </div>
                <span className="text-xs font-medium text-bob-text-soft uppercase tracking-wide">{card.label}</span>
              </div>
              <p className="text-2xl font-bold text-bob-text">{card.format(card.value)}</p>
              <div className="flex items-center gap-2 mt-2">
                <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                  card.up ? "text-emerald-700 bg-emerald-50" : "text-red-600 bg-red-50"
                }`}>
                  {card.change}
                </span>
                <span className="text-xs text-bob-text-soft">
                  vs {kpi.previousYear} ({card.format(card.prev)})
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Charts Row 1: Premium Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-bob-border p-5">
          <h2 className="text-sm font-semibold text-bob-text mb-1">Monthly Premium Trend</h2>
          <p className="text-xs text-bob-text-soft mb-4">Total monthly premium under management across all carriers</p>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="premGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#7C5CFC" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#7C5CFC" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#9CA3AF" }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: "#9CA3AF" }} tickFormatter={(v) => formatCurrency(v)} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="premium" name="Premium" stroke="#7C5CFC" strokeWidth={2} fill="url(#premGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* LOB Breakdown */}
        <div className="bg-white rounded-2xl border border-bob-border p-5">
          <h2 className="text-sm font-semibold text-bob-text mb-1">Line of Business</h2>
          <p className="text-xs text-bob-text-soft mb-4">Premium distribution by coverage type (latest month)</p>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={lob}
                  dataKey="premium"
                  nameKey="lob"
                  cx="50%" cy="50%"
                  outerRadius={90}
                  innerRadius={50}
                  paddingAngle={2}
                  label={(props: any) => `${props.name || ''} ${((props.percent || 0) * 100).toFixed(0)}%`} /* eslint-disable-line @typescript-eslint/no-explicit-any */
                  labelLine={false}
                  style={{ fontSize: 10 }}
                >
                  {lob.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: any) => formatCurrencyFull(Number(v))} /> {/* eslint-disable-line @typescript-eslint/no-explicit-any */}
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Charts Row 2: Carriers + Clients */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Top Carriers */}
        <div className="bg-white rounded-2xl border border-bob-border p-5">
          <h2 className="text-sm font-semibold text-bob-text mb-1">Top Carriers by Premium</h2>
          <p className="text-xs text-bob-text-soft mb-4">Cumulative premium across all periods (2022-present)</p>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={carriers} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis type="number" tick={{ fontSize: 10, fill: "#9CA3AF" }} tickFormatter={(v) => formatCurrency(v)} />
                <YAxis type="category" dataKey="carrier" tick={{ fontSize: 11, fill: "#6B7280" }} width={120} />
                <Tooltip formatter={(v: any) => formatCurrencyFull(Number(v))} /> {/* eslint-disable-line @typescript-eslint/no-explicit-any */}
                <Bar dataKey="premium" name="Premium" fill="#7C5CFC" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Client & Employee Trend */}
        <div className="bg-white rounded-2xl border border-bob-border p-5">
          <h2 className="text-sm font-semibold text-bob-text mb-1">Clients & Employees</h2>
          <p className="text-xs text-bob-text-soft mb-4">Monthly active client groups and enrolled employees</p>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="clientGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4A9EFF" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#4A9EFF" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#9CA3AF" }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: "#9CA3AF" }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="clients" name="Clients" stroke="#4A9EFF" strokeWidth={2} fill="url(#clientGrad)" />
                <Area type="monotone" dataKey="employees" name="Employees" stroke="#34D399" strokeWidth={2} fillOpacity={0.1} fill="#34D399" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Year-over-Year Summary Table */}
      {yoy.length > 0 && (
        <div className="bg-white rounded-2xl border border-bob-border overflow-hidden mb-6">
          <div className="px-5 py-4 border-b border-bob-border">
            <h2 className="text-sm font-semibold text-bob-text">Year-over-Year Summary</h2>
            <p className="text-xs text-bob-text-soft mt-0.5">Annual aggregated metrics across all carriers and lines of business</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-bob-border">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Year</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Months</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Avg Clients</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Avg Enrolled</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Total Premium</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Est. Fee Income</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {yoy.map((row) => (
                  <tr key={row.year} className="hover:bg-purple-50/30 transition-colors">
                    <td className="px-5 py-3 font-semibold text-bob-text">{row.year}</td>
                    <td className="px-5 py-3 text-right text-bob-text-soft">{row.months}</td>
                    <td className="px-5 py-3 text-right text-bob-text tabular-nums">{row.avgClients.toLocaleString()}</td>
                    <td className="px-5 py-3 text-right text-bob-text tabular-nums">{row.avgEmployees.toLocaleString()}</td>
                    <td className="px-5 py-3 text-right font-medium text-bob-text tabular-nums">{formatCurrencyFull(row.totalPremium)}</td>
                    <td className="px-5 py-3 text-right font-medium text-bob-green tabular-nums">{formatCurrencyFull(row.totalEstIncome)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Quick Links */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <a href="/reports/production" className="group bg-white rounded-2xl border border-bob-border p-4 hover:shadow-md hover:border-bob-purple/20 transition-all flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center">
            <FileText className="w-5 h-5 text-orange-500" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-bob-text group-hover:text-bob-purple transition-colors">Production Report</p>
            <p className="text-xs text-bob-text-soft">Full detail export</p>
          </div>
          <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-bob-purple transition-colors" />
        </a>
        <a href="/groups" className="group bg-white rounded-2xl border border-bob-border p-4 hover:shadow-md hover:border-bob-purple/20 transition-all flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-bob-purple-light flex items-center justify-center">
            <Building2 className="w-5 h-5 text-bob-purple" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-bob-text group-hover:text-bob-purple transition-colors">Client Groups</p>
            <p className="text-xs text-bob-text-soft">View all groups</p>
          </div>
          <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-bob-purple transition-colors" />
        </a>
        <a href="/reports" className="group bg-white rounded-2xl border border-bob-border p-4 hover:shadow-md hover:border-bob-purple/20 transition-all flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-bob-green-light flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-bob-green" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-bob-text group-hover:text-bob-purple transition-colors">All Reports</p>
            <p className="text-xs text-bob-text-soft">Benefits, income & more</p>
          </div>
          <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-bob-purple transition-colors" />
        </a>
      </div>
    </div>
  );
}
