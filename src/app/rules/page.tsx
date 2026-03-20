"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, ShieldCheck } from "lucide-react";

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

const fieldColors: Record<string, string> = {
  carrier: "bg-bob-purple-light text-bob-purple",
  planName: "bg-bob-blue-light text-bob-blue",
  planType: "bg-bob-teal-light text-emerald-700",
  groupName: "bg-bob-amber-light text-amber-700",
};

export default function RulesPage() {
  const [rules, setRules] = useState<ExclusionRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [field, setField] = useState("carrier");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

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
      setShowForm(false);
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
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-bob-text">Rules</h1>
          <p className="text-bob-text-soft mt-1">
            Keep your data clean — excluded items won&apos;t show up in reports
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-semibold transition-all duration-200 ${
            showForm
              ? "bg-bob-bg text-bob-text-soft border border-bob-border"
              : "bg-gradient-to-r from-bob-purple to-bob-blue text-white shadow-sm hover:opacity-90"
          }`}
        >
          <Plus className={`w-4 h-4 transition-transform duration-200 ${showForm ? "rotate-45" : ""}`} />
          {showForm ? "Cancel" : "New Rule"}
        </button>
      </div>

      {/* Add Rule Form */}
      {showForm && (
        <form onSubmit={handleAdd} className="bg-white rounded-3xl border border-bob-border p-7 mb-6 animate-fade-in-up">
          <h2 className="text-lg font-bold text-bob-text mb-5">What should we exclude?</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
            <div>
              <label className="block text-sm font-medium text-bob-text-soft mb-1.5">Category</label>
              <select
                value={field}
                onChange={(e) => setField(e.target.value)}
                className="w-full border border-bob-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-bob-purple/30 focus:border-bob-purple transition-all duration-200 bg-white"
              >
                {FIELD_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-bob-text-soft mb-1.5">Value to exclude</label>
              <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="e.g. Blue Cross Blue Shield of Alabama"
                className="w-full border border-bob-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-bob-purple/30 focus:border-bob-purple transition-all duration-200 placeholder:text-gray-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-bob-text-soft mb-1.5">Why? (optional)</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Quick note for your team"
                className="w-full border border-bob-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-bob-purple/30 focus:border-bob-purple transition-all duration-200 placeholder:text-gray-400"
              />
            </div>
          </div>
          {error && (
            <p className="text-bob-coral text-sm mb-4 font-medium">{error}</p>
          )}
          <button
            type="submit"
            disabled={saving || !value.trim()}
            className="bg-gradient-to-r from-bob-purple to-bob-blue text-white px-6 py-3 rounded-2xl text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity duration-200 shadow-sm"
          >
            {saving ? "Adding..." : "Add Rule"}
          </button>
        </form>
      )}

      {/* Rules List */}
      {loading ? (
        <div className="text-center py-16 text-bob-text-soft">
          <div className="w-8 h-8 border-2 border-bob-purple border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          Loading rules...
        </div>
      ) : rules.length === 0 ? (
        <div className="text-center py-16 animate-fade-in">
          <div className="w-16 h-16 bg-bob-green-light rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ShieldCheck className="w-8 h-8 text-bob-green" />
          </div>
          <p className="text-bob-text font-semibold mb-1">All clear!</p>
          <p className="text-bob-text-soft text-sm">No exclusion rules yet — add one to filter out unwanted data</p>
        </div>
      ) : (
        <div className="space-y-3 stagger-children">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="bg-white rounded-2xl border border-bob-border px-6 py-5 flex items-center justify-between hover:shadow-sm transition-shadow duration-200 group"
            >
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <span className={`px-3 py-1 rounded-xl text-xs font-semibold ${fieldColors[rule.field] || "bg-gray-100 text-gray-700"}`}>
                  {FIELD_OPTIONS.find(o => o.value === rule.field)?.label || rule.field}
                </span>
                <div className="min-w-0">
                  <p className="font-semibold text-bob-text truncate">{rule.value}</p>
                  {rule.description && (
                    <p className="text-sm text-bob-text-soft truncate">{rule.description}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-4 ml-4">
                <span className="text-xs text-bob-text-soft">
                  {new Date(rule.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </span>
                <button
                  onClick={() => handleDelete(rule.id)}
                  className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-bob-coral transition-all duration-200 p-1.5 rounded-xl hover:bg-bob-coral-light"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
