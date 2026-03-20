"use client";

import { useEffect, useState } from "react";

interface ExclusionRule {
  id: string;
  field: string;
  value: string;
  description: string | null;
  createdAt: string;
}

const FIELD_OPTIONS = [
  { value: "carrier", label: "Carrier" },
  { value: "planName", label: "Plan Name" },
  { value: "planType", label: "Plan Type" },
  { value: "groupName", label: "Group Name" },
];

export default function RulesPage() {
  const [rules, setRules] = useState<ExclusionRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [field, setField] = useState("carrier");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadRules() {
    const res = await fetch("/api/rules");
    const data = await res.json();
    setRules(data);
    setLoading(false);
  }

  useEffect(() => { loadRules(); }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, value: value.trim(), description: description.trim() || null }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to add rule");
      }
      setValue("");
      setDescription("");
      await loadRules();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to add rule");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/rules?id=${id}`, { method: "DELETE" });
    await loadRules();
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Exclusion Rules</h1>
      <p className="text-gray-500 mb-8">
        Carriers, plans, or groups listed here will be automatically excluded during XML import.
        Matching is case-insensitive and uses partial matching (contains).
      </p>

      {/* Add Rule Form */}
      <form onSubmit={handleAdd} className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
        <h2 className="text-lg font-semibold mb-4">Add Exclusion Rule</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Field</label>
            <select
              value={field}
              onChange={(e) => setField(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            >
              {FIELD_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Value to Exclude</label>
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="e.g. Blue Cross Blue Shield of Alabama"
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Reason (optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Why this is excluded"
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            />
          </div>
        </div>
        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
        <button
          type="submit"
          disabled={saving || !value.trim()}
          className="bg-gray-900 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
        >
          {saving ? "Adding..." : "Add Rule"}
        </button>
      </form>

      {/* Rules List */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-5 py-3 font-medium text-gray-600">Field</th>
              <th className="text-left px-5 py-3 font-medium text-gray-600">Excluded Value</th>
              <th className="text-left px-5 py-3 font-medium text-gray-600">Reason</th>
              <th className="text-left px-5 py-3 font-medium text-gray-600">Added</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-400">Loading...</td></tr>
            ) : rules.length === 0 ? (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-400">No exclusion rules configured.</td></tr>
            ) : (
              rules.map((rule) => (
                <tr key={rule.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-5 py-3">
                    <span className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-xs font-medium">
                      {FIELD_OPTIONS.find(o => o.value === rule.field)?.label || rule.field}
                    </span>
                  </td>
                  <td className="px-5 py-3 font-medium">{rule.value}</td>
                  <td className="px-5 py-3 text-gray-500">{rule.description || "—"}</td>
                  <td className="px-5 py-3 text-gray-500">
                    {new Date(rule.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => handleDelete(rule.id)}
                      className="text-red-600 hover:text-red-800 text-xs font-medium"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
