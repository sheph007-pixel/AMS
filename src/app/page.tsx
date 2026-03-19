"use client";

import { useEffect, useState } from "react";
import { Search, Users, ChevronRight } from "lucide-react";

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

const statusColors: Record<string, string> = {
  Active: "bg-green-100 text-green-800",
  New: "bg-blue-100 text-blue-800",
  Termed: "bg-red-100 text-red-800",
  Returned: "bg-amber-100 text-amber-800",
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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Clients</h1>
          <p className="text-sm text-gray-500 mt-1">
            {clients.length} clients across {systemYears.length} year{systemYears.length !== 1 ? "s" : ""}
            {systemYears.length > 0 && ` (${systemYears.join(", ")})`}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name, group ID, or state..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex gap-2">
          {["All", "Active", "New", "Termed", "Returned"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                statusFilter === s
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
              }`}
            >
              {s}
              {s !== "All" && statusCounts[s] ? ` (${statusCounts[s]})` : ""}
              {s === "All" ? ` (${clients.length})` : ""}
            </button>
          ))}
        </div>
      </div>

      {/* Client list */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading clients...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">
            {clients.length === 0
              ? "No clients yet. Import an annual XML to get started."
              : "No clients match your filters."}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200">
          {filtered.map((client) => (
            <a
              key={client.id}
              href={`/clients/${client.id}`}
              className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-gray-900 truncate">
                    {client.groupName}
                  </span>
                  <span
                    className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[client.status]}`}
                  >
                    {client.status}
                  </span>
                </div>
                <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                  <span>ID: {client.groupId}</span>
                  {client.state && <span>{client.state}</span>}
                  {client.sicCode && <span>SIC: {client.sicCode}</span>}
                </div>
              </div>
              <div className="flex items-center gap-3 ml-4">
                <div className="flex gap-1">
                  {client.years.map((yr) => (
                    <span
                      key={yr}
                      className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700 rounded"
                    >
                      {yr}
                    </span>
                  ))}
                </div>
                <ChevronRight className="w-4 h-4 text-gray-400" />
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
