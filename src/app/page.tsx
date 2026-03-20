"use client";

import { useEffect, useState, useRef } from "react";
import {
  Search, Users, DollarSign, Download,
  ArrowUpDown, ArrowUp, ArrowDown, Building2,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClientBase {
  id: string;
  groupId: string;
  groupName: string;
  state: string | null;
  status: string;
}

interface ClientRow extends ClientBase {
  activeEmployees: number;
  medicalEnrolled: number;
  dentalEnrolled: number;
  visionEnrolled: number;
  supplementalEnrolled: number;
}

interface YoYData {
  currentYear: number;
  previousYear: number | null;
  current: { activeGroups: number; activeEmployees: number; premium: number };
  previous: { activeGroups: number; activeEmployees: number; premium: number };
}

type SortKey = "groupName" | "state" | "activeEmployees";
type SortDir = "asc" | "desc";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toTitleCase(str: string): string {
  const uppercaseWords = new Set(["LLC", "INC", "CO", "LP", "LLP", "PC", "PA", "DBA", "USA", "US"]);
  const lowercaseWords = new Set(["of", "the", "and", "in", "for", "on", "at", "to", "a", "an"]);

  return str
    .split(/\s+/)
    .map((word, index) => {
      const clean = word.replace(/[.,]+$/, "");
      const punctuation = word.slice(clean.length);
      if (uppercaseWords.has(clean.toUpperCase())) return clean.toUpperCase() + punctuation;
      if (index > 0 && lowercaseWords.has(clean.toLowerCase())) return clean.toLowerCase() + punctuation;
      if (clean === clean.toUpperCase() && clean.length > 1) {
        return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase() + punctuation;
      }
      return clean.charAt(0).toUpperCase() + clean.slice(1) + punctuation;
    })
    .join(" ");
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}

function formatPct(value: number | null): string {
  if (value === null) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toCSV(rows: ClientRow[]): string {
  const header = "Group,State,# Employees,Medical,Dental,Vision,Supplemental (Guardian)";
  const lines = rows.map((r) =>
    [
      `"${toTitleCase(r.groupName)}"`,
      r.state || "",
      r.activeEmployees,
      r.medicalEnrolled,
      r.dentalEnrolled,
      r.visionEnrolled,
      r.supplementalEnrolled,
    ].join(",")
  );
  return [header, ...lines].join("\n");
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function GroupsPage() {
  const [rows, setRows] = useState<ClientRow[]>([]);
  const [yoy, setYoy] = useState<YoYData | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("groupName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Fetch both APIs in parallel — clients for group list, benefits for enrollment data
    Promise.all([
      fetch("/api/clients").then((r) => r.json()),
      fetch("/api/reports/benefits").then((r) => r.json()),
    ])
      .then(([clientsData, benefitsData]) => {
        const clients: ClientBase[] = clientsData.clients || [];
        const companyPlanTypes: Record<string, {
          activeEmployees: number;
          medical: number;
          dental: number;
          vision: number;
          supplemental: number;
        }> = benefitsData.companyPlanTypes || {};

        // Only active groups (present in current year)
        const activeClients = clients.filter(
          (c) => c.status === "Active" || c.status === "New" || c.status === "Returned"
        );

        // Merge: group list + benefits enrollment data
        const merged: ClientRow[] = activeClients.map((client) => {
          const planData = companyPlanTypes[client.id];
          return {
            ...client,
            activeEmployees: planData?.activeEmployees ?? 0,
            medicalEnrolled: planData?.medical ?? 0,
            dentalEnrolled: planData?.dental ?? 0,
            visionEnrolled: planData?.vision ?? 0,
            supplementalEnrolled: planData?.supplemental ?? 0,
          };
        });

        setRows(merged);

        // YoY data comes directly from the benefits report
        if (benefitsData.yoy) {
          setYoy(benefitsData.yoy);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = rows.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.groupName.toLowerCase().includes(q) ||
      (c.state && c.state.toLowerCase().includes(q))
    );
  });

  const sorted = [...filtered].sort((a, b) => {
    const aVal = a[sortKey];
    const bVal = b[sortKey];
    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    if (typeof aVal === "string" && typeof bVal === "string") {
      return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    if (typeof aVal === "number" && typeof bVal === "number") {
      return sortDir === "asc" ? aVal - bVal : bVal - aVal;
    }
    return 0;
  });

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "activeEmployees" ? "desc" : "asc");
    }
  }

  function SortIcon({ column }: { column: SortKey }) {
    if (sortKey !== column) return <ArrowUpDown className="w-3 h-3 text-gray-400 ml-1 inline" />;
    return sortDir === "asc"
      ? <ArrowUp className="w-3 h-3 text-bob-purple ml-1 inline" />
      : <ArrowDown className="w-3 h-3 text-bob-purple ml-1 inline" />;
  }

  function handleExportCSV() {
    downloadFile(toCSV(sorted), "groups.csv", "text/csv");
  }

  // Summary cards use YoY data from benefits report (guaranteed match)
  const cards = yoy
    ? [
        {
          label: "Active Groups",
          icon: <Building2 className="w-5 h-5 text-bob-purple" />,
          iconBg: "bg-bob-purple-light",
          current: yoy.current.activeGroups,
          previous: yoy.previous.activeGroups,
          format: (v: number) => v.toLocaleString(),
          pct: pctChange(yoy.current.activeGroups, yoy.previous.activeGroups),
        },
        {
          label: "# Enrolled",
          icon: <Users className="w-5 h-5 text-bob-green" />,
          iconBg: "bg-bob-green-light",
          current: yoy.current.activeEmployees,
          previous: yoy.previous.activeEmployees,
          format: (v: number) => v.toLocaleString(),
          pct: pctChange(yoy.current.activeEmployees, yoy.previous.activeEmployees),
        },
        {
          label: "Premium",
          icon: <DollarSign className="w-5 h-5 text-bob-blue" />,
          iconBg: "bg-bob-blue-light",
          current: yoy.current.premium,
          previous: yoy.previous.premium,
          format: formatCurrency,
          pct: pctChange(yoy.current.premium, yoy.previous.premium),
        },
      ]
    : [];

  const currentYear = yoy?.currentYear;
  const previousYear = yoy?.previousYear;

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-bob-text">Groups</h1>
        <p className="text-bob-text-soft mt-1">All groups in employee benefits program</p>
      </div>

      {/* Stat cards — YoY comparison */}
      {yoy && (
        <div className="grid grid-cols-3 gap-4 mb-8 stagger-children">
          {cards.map((card) => (
            <div
              key={card.label}
              className="bg-white rounded-2xl border border-bob-border p-5 hover:shadow-md transition-shadow duration-300"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-10 h-10 rounded-xl ${card.iconBg} flex items-center justify-center`}>
                  {card.icon}
                </div>
                <span className="text-sm font-medium text-bob-text-soft">{card.label}</span>
              </div>
              <p className="text-3xl font-bold text-bob-text">{card.format(card.current)}</p>
              <div className="flex items-center gap-3 mt-2">
                <span className="text-xs text-bob-text-soft">
                  {currentYear}: <span className="font-semibold text-bob-text">{card.format(card.current)}</span>
                </span>
                {previousYear && (
                  <span className="text-xs text-bob-text-soft">
                    {previousYear}: <span className="font-semibold text-bob-text">{card.format(card.previous)}</span>
                  </span>
                )}
                <span
                  className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                    card.pct !== null && card.pct >= 0
                      ? "text-emerald-700 bg-emerald-50"
                      : "text-red-600 bg-red-50"
                  }`}
                >
                  {formatPct(card.pct)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Search + Export */}
      <div className="flex gap-4 mb-5 flex-wrap items-center">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-bob-text-soft" />
          <input
            type="text"
            placeholder="Search groups or states..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-11 pr-4 py-2.5 bg-white border border-bob-border rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-bob-purple/30 focus:border-bob-purple transition-all duration-200 placeholder:text-gray-400"
          />
        </div>
        <button
          onClick={handleExportCSV}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-bob-border text-bob-text text-sm font-medium rounded-2xl hover:border-bob-purple/30 hover:text-bob-purple transition-all duration-200"
        >
          <Download className="w-4 h-4" /> CSV
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-16 text-bob-text-soft">
          <div className="w-8 h-8 border-2 border-bob-purple border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          Loading groups...
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 animate-fade-in">
          <div className="w-16 h-16 bg-bob-purple-light rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Building2 className="w-8 h-8 text-bob-purple" />
          </div>
          <p className="text-bob-text font-semibold mb-1">
            No active groups
          </p>
          <p className="text-bob-text-soft text-sm">
            Upload an XML file to get started
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 animate-fade-in">
          <p className="text-bob-text font-semibold mb-1">No matches found</p>
          <p className="text-bob-text-soft text-sm">Try adjusting your search</p>
        </div>
      ) : (
        <>
          <div ref={tableRef} className="bg-white rounded-2xl border border-bob-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-bob-bg border-b border-bob-border">
                  <tr>
                    <th
                      className="text-left px-4 py-3 font-semibold text-bob-text-soft cursor-pointer hover:text-bob-text select-none transition-colors duration-200 whitespace-nowrap text-xs"
                      onClick={() => handleSort("groupName")}
                    >
                      Group <SortIcon column="groupName" />
                    </th>
                    <th
                      className="text-left px-4 py-3 font-semibold text-bob-text-soft cursor-pointer hover:text-bob-text select-none transition-colors duration-200 whitespace-nowrap text-xs"
                      onClick={() => handleSort("state")}
                    >
                      State <SortIcon column="state" />
                    </th>
                    <th
                      className="text-right px-4 py-3 font-semibold text-bob-text-soft cursor-pointer hover:text-bob-text select-none transition-colors duration-200 whitespace-nowrap text-xs"
                      onClick={() => handleSort("activeEmployees")}
                    >
                      # Employees <SortIcon column="activeEmployees" />
                    </th>
                    <th className="text-right px-4 py-3 font-semibold text-bob-text-soft text-xs whitespace-nowrap">Medical</th>
                    <th className="text-right px-4 py-3 font-semibold text-bob-text-soft text-xs whitespace-nowrap">Dental</th>
                    <th className="text-right px-4 py-3 font-semibold text-bob-text-soft text-xs whitespace-nowrap">Vision</th>
                    <th className="text-right px-4 py-3 font-semibold text-bob-text-soft text-xs whitespace-nowrap">Supplemental (Guardian)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bob-border-light">
                  {sorted.map((row) => (
                    <tr key={row.id} className="hover:bg-bob-bg/50 transition-colors duration-150 group">
                      <td className="px-4 py-3 font-medium">
                        <a
                          href={`/clients/${row.id}`}
                          className="text-bob-purple hover:underline hover:text-bob-purple/80 transition-colors"
                        >
                          {toTitleCase(row.groupName)}
                        </a>
                      </td>
                      <td className="px-4 py-3 text-bob-text-soft">{row.state || "—"}</td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums">
                        {row.activeEmployees > 0 ? row.activeEmployees.toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-bob-text-soft">
                        {row.medicalEnrolled > 0 ? row.medicalEnrolled.toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-bob-text-soft">
                        {row.dentalEnrolled > 0 ? row.dentalEnrolled.toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-bob-text-soft">
                        {row.visionEnrolled > 0 ? row.visionEnrolled.toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-bob-text-soft">
                        {row.supplementalEnrolled > 0 ? row.supplementalEnrolled.toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="mt-3 text-xs text-bob-text-soft">
            Showing {sorted.length.toLocaleString()} of {rows.length.toLocaleString()} active groups
          </div>
        </>
      )}
    </div>
  );
}
