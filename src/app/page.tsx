"use client";

import { useEffect, useState } from "react";
import { Search, Users, ChevronRight, TrendingUp, Building2 } from "lucide-react";

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
}

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

export default function ClientsPage() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [systemYears, setSystemYears] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [loading, setLoading] = useState(true);

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
      (c.state && c.state.toLowerCase().includes(search.toLowerCase()));
    const matchesStatus = statusFilter === "All" || c.status === statusFilter;
    return matchesSearch && matchesStatus;
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

  return (
    <div>
      {/* Hero header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-bob-text">Your People</h1>
        <p className="text-bob-text-soft mt-1">
          Here&apos;s what&apos;s happening across your community
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

      {/* Search + Filters */}
      <div className="flex gap-4 mb-6 flex-wrap items-center">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-bob-text-soft" />
          <input
            type="text"
            placeholder="Search people, groups, or states..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-11 pr-4 py-3 bg-white border border-bob-border rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-bob-purple/30 focus:border-bob-purple transition-all duration-200 placeholder:text-gray-400"
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
                className={`px-4 py-2.5 text-sm font-medium rounded-2xl border transition-all duration-200 ${
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
      </div>

      {/* Client cards */}
      {loading ? (
        <div className="text-center py-16 text-bob-text-soft">
          <div className="w-8 h-8 border-2 border-bob-purple border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          Loading your community...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 animate-fade-in">
          <div className="w-16 h-16 bg-bob-purple-light rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Users className="w-8 h-8 text-bob-purple" />
          </div>
          <p className="text-bob-text font-semibold mb-1">
            {clients.length === 0 ? "No groups yet" : "No matches found"}
          </p>
          <p className="text-bob-text-soft text-sm">
            {clients.length === 0
              ? "Upload an XML file to bring your community to life"
              : "Try adjusting your search or filters"}
          </p>
        </div>
      ) : (
        <div className="space-y-3 stagger-children">
          {filtered.map((client) => {
            const sc = statusConfig[client.status];
            return (
              <a
                key={client.id}
                href={`/clients/${client.id}`}
                className="group flex items-center justify-between bg-white rounded-2xl border border-bob-border px-6 py-5 hover:shadow-md hover:border-bob-purple/20 transition-all duration-200"
              >
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  {/* Avatar */}
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-bob-purple-light to-bob-blue-light flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-bold text-bob-purple">
                      {client.groupName.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5">
                      <span className="font-semibold text-bob-text truncate group-hover:text-bob-purple transition-colors duration-200">
                        {client.groupName}
                      </span>
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium rounded-full ${sc.bg} ${sc.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                        {client.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-sm text-bob-text-soft">
                      <span>{client.groupId}</span>
                      {client.state && (
                        <>
                          <span className="w-1 h-1 rounded-full bg-gray-300" />
                          <span>{client.state}</span>
                        </>
                      )}
                      {client.sicCode && (
                        <>
                          <span className="w-1 h-1 rounded-full bg-gray-300" />
                          <span>SIC {client.sicCode}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4 ml-4">
                  <div className="flex gap-1.5">
                    {client.years.map((yr) => (
                      <span
                        key={yr}
                        className="px-2.5 py-1 text-xs font-medium bg-bob-bg text-bob-text-soft rounded-lg"
                      >
                        {yr}
                      </span>
                    ))}
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-bob-purple group-hover:translate-x-0.5 transition-all duration-200" />
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
