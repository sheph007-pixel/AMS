"use client";

import { useEffect, useState } from "react";
import { normalizeCompanyName } from "@/lib/normalize-name";

interface ClientRow {
  id: string;
  groupName: string;
  state: string | null;
  status: string;
  years: number[];
}

interface ApiResponse {
  clients: ClientRow[];
  systemYears: number[];
}

const ACTIVE_STATUSES = new Set(["Active", "New", "Returned"]);

export default function TenurePage() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [latestYear, setLatestYear] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/clients")
      .then((r) => {
        if (!r.ok) throw new Error(`Server error (${r.status})`);
        return r.json() as Promise<ApiResponse>;
      })
      .then((data) => {
        setClients(data.clients.filter((c) => ACTIVE_STATUSES.has(c.status)));
        if (data.systemYears.length > 0) {
          setLatestYear(Math.max(...data.systemYears));
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="p-8 text-bob-text-soft">Loading…</div>;
  }
  if (error) {
    return <div className="p-8 text-red-600">Failed to load: {error}</div>;
  }
  if (latestYear === null) {
    return <div className="p-8 text-bob-text-soft">No data.</div>;
  }

  const withTenure = clients
    .map((c) => {
      const firstYear = c.years.length > 0 ? Math.min(...c.years) : latestYear;
      return { ...c, tenure: latestYear - firstYear, firstYear };
    })
    .sort((a, b) => b.tenure - a.tenure || a.groupName.localeCompare(b.groupName));

  const buckets = [1, 2, 3, 4, 5].map((n) => ({
    label: `${n}+ years`,
    count: withTenure.filter((c) => c.tenure >= n).length,
  }));

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Client Tenure</h1>
      <p className="text-bob-text-soft mb-6">
        {withTenure.length} active clients · tenure measured from first year in system through {latestYear}
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-8">
        {buckets.map((b) => (
          <div key={b.label} className="bg-white border border-bob-border rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-bob-purple">{b.count}</div>
            <div className="text-xs text-bob-text-soft mt-1">{b.label}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-bob-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bob-bg border-b border-bob-border">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-bob-text-soft text-xs">Group</th>
              <th className="text-left px-4 py-3 font-semibold text-bob-text-soft text-xs">State</th>
              <th className="text-right px-4 py-3 font-semibold text-bob-text-soft text-xs">First Year</th>
              <th className="text-right px-4 py-3 font-semibold text-bob-text-soft text-xs">Tenure</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-bob-border-light">
            {withTenure.map((c) => (
              <tr key={c.id} className="hover:bg-bob-bg/50">
                <td className="px-4 py-2 font-medium">
                  <a href={`/clients/${c.id}`} className="text-bob-purple hover:underline">
                    {normalizeCompanyName(c.groupName)}
                  </a>
                </td>
                <td className="px-4 py-2 text-bob-text-soft">{c.state || "—"}</td>
                <td className="px-4 py-2 text-right tabular-nums">{c.firstYear}</td>
                <td className="px-4 py-2 text-right tabular-nums font-semibold">
                  {c.tenure === 0 ? "<1 yr" : `${c.tenure} ${c.tenure === 1 ? "yr" : "yrs"}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
