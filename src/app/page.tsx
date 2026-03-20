"use client";

import { useEffect, useState, useRef } from "react";
import {
  Search, Users, TrendingUp, Building2, Download,
  ArrowUpDown, ArrowUp, ArrowDown,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClientRow {
  id: string;
  groupId: string;
  groupName: string;
  sicCode: string | null;
  state: string | null;
  years: number[];
  firstYear: number | null;
  lastYear: number | null;
  status: "Active" | "New" | "Termed" | "Returned";
  totalEmployees: number | null;
  totalMembers: number | null;
  effectiveDate: string | null;
  renewalDate: string | null;
}

type SortKey = "groupName" | "groupId" | "state" | "status" | "totalEmployees" | "totalMembers" | "sicCode" | "effectiveDate" | "renewalDate";
type SortDir = "asc" | "desc";

const statusConfig: Record<string, { bg: string; text: string; dot: string }> = {
  Active: { bg: "bg-bob-green-light", text: "text-emerald-700", dot: "bg-bob-green" },
  New: { bg: "bg-bob-blue-light", text: "text-blue-700", dot: "bg-bob-blue" },
  Termed: { bg: "bg-bob-coral-light", text: "text-red-600", dot: "bg-bob-coral" },
  Returned: { bg: "bg-bob-amber-light", text: "text-amber-700", dot: "bg-bob-amber" },
};

const filterConfig: Record<string, { active: string }> = {
  All: { active: "bg-bob-purple text-white" },
  Active: { active: "bg-bob-green text-white" },
  New: { active: "bg-bob-blue text-white" },
  Termed: { active: "bg-bob-coral text-white" },
  Returned: { active: "bg-bob-amber text-white" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  const header = "Group Name,Group ID,State,SIC Code,Status,Employees,Members,Effective Date,Renewal Date,Years";
  const lines = rows.map((r) =>
    [
      `"${r.groupName}"`,
      `"${r.groupId}"`,
      r.state || "",
      r.sicCode || "",
      r.status,
      r.totalEmployees ?? "",
      r.totalMembers ?? "",
      r.effectiveDate || "",
      r.renewalDate || "",
      `"${r.years.join(", ")}"`,
    ].join(",")
  );
  return [header, ...lines].join("\n");
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function GroupsPage() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [systemYears, setSystemYears] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("groupName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/clients")
      .then((res) => res.json())
      .then((data) => {
        setClients(data.clients || []);
        setSystemYears(data.systemYears || []);
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = clients.filter((c) => {
    const matchesSearch =
      !search ||
      c.groupName.toLowerCase().includes(search.toLowerCase()) ||
      c.groupId.toLowerCase().includes(search.toLowerCase()) ||
      (c.state && c.state.toLowerCase().includes(search.toLowerCase())) ||
      (c.sicCode && c.sicCode.toLowerCase().includes(search.toLowerCase()));
    const matchesStatus = statusFilter === "All" || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const sorted = [...filtered].sort((a, b) => {
    const aVal = a[sortKey];
    const bVal = b[sortKey];

    // Handle nulls — push to end
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

  const statusCounts = clients.reduce(
    (acc, c) => {
      acc[c.status] = (acc[c.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const activeCount = statusCounts["Active"] || 0;
  const newCount = statusCounts["New"] || 0;

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "groupName" || key === "groupId" || key === "state" || key === "status" || key === "sicCode" ? "asc" : "desc");
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

  const columns: { key: SortKey; label: string; align: string }[] = [
    { key: "groupName", label: "Group Name", align: "text-left" },
    { key: "groupId", label: "Group ID", align: "text-left" },
    { key: "state", label: "State", align: "text-left" },
    { key: "sicCode", label: "SIC", align: "text-left" },
    { key: "status", label: "Status", align: "text-left" },
    { key: "totalEmployees", label: "Employees", align: "text-right" },
    { key: "totalMembers", label: "Members", align: "text-right" },
    { key: "effectiveDate", label: "Effective", align: "text-left" },
    { key: "renewalDate", label: "Renewal", align: "text-left" },
  ];

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-bob-text">Your Groups</h1>
        <p className="text-bob-text-soft mt-1">
          All groups across your community
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-4 mb-8 stagger-children">
        <div className="bg-white rounded-2xl border border-bob-border p-5 hover:shadow-md transition-shadow duration-300">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-bob-purple-light flex items-center justify-center">
              <Building2 className="w-5 h-5 text-bob-purple" />
            </div>
            <span className="text-sm font-medium text-bob-text-soft">Total Groups</span>
          </div>
          <p className="text-3xl font-bold text-bob-text">{clients.length}</p>
          <p className="text-xs text-bob-text-soft mt-1">
            across {systemYears.length} year{systemYears.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-bob-border p-5 hover:shadow-md transition-shadow duration-300">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-bob-green-light flex items-center justify-center">
              <Users className="w-5 h-5 text-bob-green" />
            </div>
            <span className="text-sm font-medium text-bob-text-soft">Active</span>
          </div>
          <p className="text-3xl font-bold text-bob-text">{activeCount}</p>
          <p className="text-xs text-bob-text-soft mt-1">currently enrolled groups</p>
        </div>
        <div className="bg-white rounded-2xl border border-bob-border p-5 hover:shadow-md transition-shadow duration-300">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-bob-blue-light flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-bob-blue" />
            </div>
            <span className="text-sm font-medium text-bob-text-soft">New This Cycle</span>
          </div>
          <p className="text-3xl font-bold text-bob-text">{newCount}</p>
          <p className="text-xs text-bob-text-soft mt-1">recently onboarded</p>
        </div>
      </div>

      {/* Search + Filters + Export */}
      <div className="flex gap-4 mb-5 flex-wrap items-center">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-bob-text-soft" />
          <input
            type="text"
            placeholder="Search groups, IDs, states, or SIC codes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-11 pr-4 py-2.5 bg-white border border-bob-border rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-bob-purple/30 focus:border-bob-purple transition-all duration-200 placeholder:text-gray-400"
          />
        </div>
        <div className="flex gap-2">
          {["All", "Active", "New", "Termed", "Returned"].map((s) => {
            const isActive = statusFilter === s;
            const conf = filterConfig[s];
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-2 text-sm font-medium rounded-2xl border transition-all duration-200 ${
                  isActive
                    ? `${conf.active} border-transparent shadow-sm`
                    : "bg-white text-bob-text-soft border-bob-border hover:border-gray-300 hover:text-bob-text"
                }`}
              >
                {s}
                {s !== "All" && statusCounts[s] ? ` ${statusCounts[s]}` : ""}
                {s === "All" ? ` ${clients.length}` : ""}
              </button>
            );
          })}
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
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 animate-fade-in">
          <div className="w-16 h-16 bg-bob-purple-light rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Building2 className="w-8 h-8 text-bob-purple" />
          </div>
          <p className="text-bob-text font-semibold mb-1">
            {clients.length === 0 ? "No groups yet" : "No matches found"}
          </p>
          <p className="text-bob-text-soft text-sm">
            {clients.length === 0
              ? "Upload an XML file to get started"
              : "Try adjusting your search or filters"}
          </p>
        </div>
      ) : (
        <>
          <div ref={tableRef} className="bg-white rounded-2xl border border-bob-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-bob-bg border-b border-bob-border">
                  <tr>
                    {columns.map((col) => (
                      <th
                        key={col.key}
                        className={`${col.align} px-4 py-3 font-semibold text-bob-text-soft cursor-pointer hover:text-bob-text select-none transition-colors duration-200 whitespace-nowrap text-xs`}
                        onClick={() => handleSort(col.key)}
                      >
                        {col.label} <SortIcon column={col.key} />
                      </th>
                    ))}
                    <th className="px-4 py-3 text-left font-semibold text-bob-text-soft text-xs whitespace-nowrap">
                      Years
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bob-border-light">
                  {sorted.map((row) => {
                    const sc = statusConfig[row.status];
                    return (
                      <tr key={row.id} className="hover:bg-bob-bg/50 transition-colors duration-150 group">
                        {/* Group Name */}
                        <td className="px-4 py-3 font-medium">
                          <a
                            href={`/clients/${row.id}`}
                            className="text-bob-purple hover:underline hover:text-bob-purple/80 transition-colors"
                          >
                            {row.groupName}
                          </a>
                        </td>
                        {/* Group ID */}
                        <td className="px-4 py-3 text-bob-text-soft font-mono text-xs">
                          {row.groupId}
                        </td>
                        {/* State */}
                        <td className="px-4 py-3 text-bob-text-soft">
                          {row.state || "—"}
                        </td>
                        {/* SIC */}
                        <td className="px-4 py-3 text-bob-text-soft font-mono text-xs">
                          {row.sicCode || "—"}
                        </td>
                        {/* Status */}
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium rounded-full ${sc.bg} ${sc.text}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                            {row.status}
                          </span>
                        </td>
                        {/* Employees */}
                        <td className="px-4 py-3 text-right font-medium tabular-nums">
                          {row.totalEmployees != null ? row.totalEmployees.toLocaleString() : "—"}
                        </td>
                        {/* Members */}
                        <td className="px-4 py-3 text-right font-medium tabular-nums">
                          {row.totalMembers != null ? row.totalMembers.toLocaleString() : "—"}
                        </td>
                        {/* Effective Date */}
                        <td className="px-4 py-3 text-bob-text-soft text-xs whitespace-nowrap">
                          {row.effectiveDate || "—"}
                        </td>
                        {/* Renewal Date */}
                        <td className="px-4 py-3 text-bob-text-soft text-xs whitespace-nowrap">
                          {row.renewalDate || "—"}
                        </td>
                        {/* Years */}
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            {row.years.map((yr) => (
                              <span
                                key={yr}
                                className="px-2 py-0.5 text-xs font-medium bg-bob-bg text-bob-text-soft rounded"
                              >
                                {yr}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div className="mt-3 text-xs text-bob-text-soft">
            Showing {sorted.length.toLocaleString()} of {clients.length.toLocaleString()} groups
          </div>
        </>
      )}
    </div>
  );
}
