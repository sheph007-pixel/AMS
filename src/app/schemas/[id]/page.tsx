"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import {
  ArrowLeft, ChevronDown, ChevronRight, Save, Wand2, ShieldAlert,
  CheckCircle, XCircle, Minus, Eye, EyeOff,
} from "lucide-react";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface SchemaField {
  id: string;
  xmlPath: string;
  elementName: string;
  xmlType: string;
  isRequired: boolean;
  isRepeating: boolean;
  isNillable: boolean;
  isAttribute: boolean;
  parentPath: string | null;
  depth: number;
  mappings: any[];
}

interface SchemaVersion {
  id: string;
  name: string;
  version: string;
  status: string;
}

interface MappingEdit {
  xmlPath: string;
  schemaFieldId: string | null;
  included: boolean;
  targetModel: string;
  targetColumn: string;
  reportingName: string;
  targetType: string;
  fallbackFields: string;
  notes: string;
  dirty: boolean;
}

interface Warning {
  type: string;
  severity: string;
  fieldPath: string;
  message: string;
}

const MODELS = ["", "Client", "ClientSnapshot", "BenefitPlan", "EmployeeSnapshot", "Enrollment"];
const TYPES = ["string", "number", "date", "boolean"];

function typeBadge(t: string) {
  const colors: Record<string, string> = {
    "xs:string": "bg-blue-50 text-blue-700",
    "xs:decimal": "bg-green-50 text-green-700",
    "xs:integer": "bg-green-50 text-green-700",
    "xs:date": "bg-amber-50 text-amber-700",
    "xs:dateTime": "bg-amber-50 text-amber-700",
    "xs:boolean": "bg-purple-50 text-purple-700",
    "xs:complexType": "bg-gray-100 text-gray-600",
  };
  return <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${colors[t] || "bg-gray-50 text-gray-500"}`}>{t.replace("xs:", "")}</span>;
}

export default function SchemaDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [schema, setSchema] = useState<SchemaVersion | null>(null);
  const [fields, setFields] = useState<SchemaField[]>([]);
  const [mappings, setMappings] = useState<Map<string, MappingEdit>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showWarnings, setShowWarnings] = useState(false);
  const [autoMapSummary, setAutoMapSummary] = useState<string | null>(null);

  const loadData = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/schema/versions/${id}`).then(r => r.json()),
      fetch(`/api/schema/versions/${id}/fields`).then(r => r.json()),
      fetch(`/api/schema/versions/${id}/mappings`).then(r => r.json()),
    ]).then(([sv, flds, maps]) => {
      setSchema(sv);
      setFields(flds);

      // Build mapping map keyed by xmlPath
      const m = new Map<string, MappingEdit>();
      for (const f of flds) {
        const existing = maps.find((mp: any) => mp.xmlPath === f.xmlPath);
        m.set(f.xmlPath, {
          xmlPath: f.xmlPath,
          schemaFieldId: f.id,
          included: existing?.included ?? true,
          targetModel: existing?.targetModel || "",
          targetColumn: existing?.targetColumn || "",
          reportingName: existing?.reportingName || "",
          targetType: existing?.targetType || "string",
          fallbackFields: existing?.fallbackFields || "[]",
          notes: existing?.notes || "",
          dirty: false,
        });
      }
      setMappings(m);
    }).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { loadData(); }, [loadData]);

  function updateMapping(xmlPath: string, field: string, value: any) {
    setMappings(prev => {
      const next = new Map(prev);
      const m = { ...next.get(xmlPath)! };
      (m as any)[field] = value;
      m.dirty = true;
      next.set(xmlPath, m);
      return next;
    });
  }

  async function saveMappings() {
    setSaving(true);
    const dirty = Array.from(mappings.values()).filter(m => m.dirty);
    if (dirty.length === 0) { setSaving(false); return; }

    await fetch(`/api/schema/versions/${id}/mappings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mappings: dirty.map(m => ({
          xmlPath: m.xmlPath,
          schemaFieldId: m.schemaFieldId,
          included: m.included,
          targetModel: m.targetModel || null,
          targetColumn: m.targetColumn || null,
          reportingName: m.reportingName || null,
          targetType: m.targetType || "string",
          fallbackFields: m.fallbackFields,
          notes: m.notes || null,
        })),
      }),
    });

    setSaving(false);
    loadData();
  }

  async function runAutoMap() {
    const res = await fetch(`/api/schema/versions/${id}/auto-map`, { method: "POST" });
    const data = await res.json();

    setMappings(prev => {
      const next = new Map(prev);
      for (const s of data.suggestions || []) {
        if (s.confidence === "none") continue;
        const existing = next.get(s.xmlPath);
        if (!existing) continue;
        // Only auto-fill empty mappings
        if (!existing.targetModel && !existing.targetColumn) {
          next.set(s.xmlPath, {
            ...existing,
            targetModel: s.targetModel || "",
            targetColumn: s.targetColumn || "",
            reportingName: s.reportingName || "",
            targetType: s.targetType || "string",
            fallbackFields: JSON.stringify(s.fallbackFields || []),
            dirty: true,
          });
        }
      }
      return next;
    });

    setAutoMapSummary(`Auto-mapped: ${data.summary?.exact || 0} exact, ${data.summary?.fuzzy || 0} fuzzy. Review and save.`);
    setTimeout(() => setAutoMapSummary(null), 5000);
  }

  async function runGuardrails() {
    const res = await fetch(`/api/schema/versions/${id}/guardrails`);
    const data = await res.json();
    setWarnings(data.warnings || []);
    setShowWarnings(true);
  }

  function toggleCollapse(parentPath: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(parentPath)) next.delete(parentPath);
      else next.add(parentPath);
      return next;
    });
  }

  // Filter visible fields based on collapsed parents
  const visibleFields = fields.filter(f => {
    if (!f.parentPath) return true;
    // Check if any ancestor is collapsed
    const parts = f.xmlPath.split(".");
    for (let i = 1; i < parts.length; i++) {
      const ancestor = parts.slice(0, i).join(".");
      if (collapsed.has(ancestor)) return false;
    }
    return true;
  });

  const dirtyCount = Array.from(mappings.values()).filter(m => m.dirty).length;
  const hasChildren = (path: string) => fields.some(f => f.parentPath === path);

  if (loading) {
    return (
      <div className="text-center py-16 text-bob-text-soft">
        <div className="w-8 h-8 border-2 border-bob-purple border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        Loading schema...
      </div>
    );
  }

  return (
    <div>
      <a href="/schemas" className="inline-flex items-center gap-1.5 text-sm text-bob-text-soft hover:text-bob-purple transition-colors mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to Schemas
      </a>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-bob-text">
            {schema?.name} <span className="text-bob-text-soft font-normal">v{schema?.version}</span>
          </h1>
          <p className="text-bob-text-soft text-sm mt-1">{fields.length} fields parsed</p>
        </div>
        <div className="flex items-center gap-2">
          <a href={`/schemas/${id}/test`}
            className="px-3 py-2 text-sm font-medium bg-white border border-bob-border rounded-xl hover:border-bob-purple/30 transition-colors">
            Test File
          </a>
          <button onClick={runAutoMap}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-white border border-bob-border rounded-xl hover:border-bob-purple/30 transition-colors">
            <Wand2 className="w-3.5 h-3.5" /> Auto-Map
          </button>
          <button onClick={runGuardrails}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-white border border-bob-border rounded-xl hover:border-bob-purple/30 transition-colors">
            <ShieldAlert className="w-3.5 h-3.5" /> Guardrails
          </button>
          <button onClick={saveMappings} disabled={saving || dirtyCount === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-bob-purple text-white rounded-xl hover:bg-bob-purple/90 disabled:opacity-50 transition-colors">
            <Save className="w-3.5 h-3.5" /> Save {dirtyCount > 0 && `(${dirtyCount})`}
          </button>
        </div>
      </div>

      {autoMapSummary && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800 mb-4">{autoMapSummary}</div>
      )}

      {/* Warnings Panel */}
      {showWarnings && warnings.length > 0 && (
        <div className="bg-white rounded-2xl border border-bob-border p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-bob-text">Guardrail Warnings ({warnings.length})</span>
            <button onClick={() => setShowWarnings(false)} className="text-xs text-bob-text-soft hover:text-bob-text">Hide</button>
          </div>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {warnings.map((w, i) => (
              <div key={i} className={`text-xs px-3 py-1.5 rounded ${
                w.severity === "error" ? "bg-red-50 text-red-700" :
                w.severity === "warning" ? "bg-yellow-50 text-yellow-700" :
                "bg-blue-50 text-blue-700"
              }`}>
                <span className="font-medium">{w.fieldPath}:</span> {w.message}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Field Inventory + Mapping Table */}
      <div className="bg-white rounded-2xl border border-bob-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-bob-bg border-b border-bob-border">
              <tr>
                <th className="text-left px-3 py-2.5 font-semibold text-bob-text-soft w-8"></th>
                <th className="text-left px-3 py-2.5 font-semibold text-bob-text-soft">XML Path</th>
                <th className="text-left px-3 py-2.5 font-semibold text-bob-text-soft w-20">Type</th>
                <th className="text-center px-3 py-2.5 font-semibold text-bob-text-soft w-12">Req</th>
                <th className="text-center px-3 py-2.5 font-semibold text-bob-text-soft w-12">Inc</th>
                <th className="text-left px-3 py-2.5 font-semibold text-bob-text-soft">Target Model</th>
                <th className="text-left px-3 py-2.5 font-semibold text-bob-text-soft">Target Column</th>
                <th className="text-left px-3 py-2.5 font-semibold text-bob-text-soft">Report Name</th>
                <th className="text-left px-3 py-2.5 font-semibold text-bob-text-soft w-20">Type</th>
                <th className="text-left px-3 py-2.5 font-semibold text-bob-text-soft">Fallback Fields</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bob-border-light">
              {visibleFields.map(f => {
                const m = mappings.get(f.xmlPath);
                const isComplex = f.xmlType.includes("complex") || hasChildren(f.xmlPath);
                const isCollapsed = collapsed.has(f.xmlPath);

                return (
                  <tr key={f.id} className={`transition-colors ${m?.dirty ? "bg-amber-50/50" : "hover:bg-gray-50"} ${!m?.included ? "opacity-40" : ""}`}>
                    <td className="px-3 py-2">
                      {isComplex && (
                        <button onClick={() => toggleCollapse(f.xmlPath)} className="text-gray-400 hover:text-gray-600">
                          {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div style={{ paddingLeft: `${f.depth * 16}px` }} className="flex items-center gap-1">
                        {f.isAttribute && <span className="text-bob-text-soft">@</span>}
                        <span className="font-mono text-bob-text">{f.elementName}</span>
                        {f.isRepeating && <span className="text-[9px] text-bob-text-soft">[]</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2">{typeBadge(f.xmlType)}</td>
                    <td className="px-3 py-2 text-center">
                      {f.isRequired ? <CheckCircle className="w-3.5 h-3.5 text-green-500 mx-auto" /> : <Minus className="w-3.5 h-3.5 text-gray-300 mx-auto" />}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {m && (
                        <button onClick={() => updateMapping(f.xmlPath, "included", !m.included)}
                          className={m.included ? "text-green-500" : "text-red-400"}>
                          {m.included ? <Eye className="w-3.5 h-3.5 mx-auto" /> : <EyeOff className="w-3.5 h-3.5 mx-auto" />}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {m && !isComplex && (
                        <select value={m.targetModel} onChange={e => updateMapping(f.xmlPath, "targetModel", e.target.value)}
                          className="w-full border border-bob-border rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-bob-purple/20">
                          {MODELS.map(mo => <option key={mo} value={mo}>{mo || "—"}</option>)}
                        </select>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {m && !isComplex && (
                        <input type="text" value={m.targetColumn} onChange={e => updateMapping(f.xmlPath, "targetColumn", e.target.value)}
                          className="w-full border border-bob-border rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-bob-purple/20"
                          placeholder="column" />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {m && !isComplex && (
                        <input type="text" value={m.reportingName} onChange={e => updateMapping(f.xmlPath, "reportingName", e.target.value)}
                          className="w-full border border-bob-border rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-bob-purple/20"
                          placeholder="display name" />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {m && !isComplex && (
                        <select value={m.targetType} onChange={e => updateMapping(f.xmlPath, "targetType", e.target.value)}
                          className="w-full border border-bob-border rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-bob-purple/20">
                          {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {m && !isComplex && (
                        <input type="text" value={m.fallbackFields} onChange={e => updateMapping(f.xmlPath, "fallbackFields", e.target.value)}
                          className="w-full border border-bob-border rounded px-1.5 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-bob-purple/20"
                          placeholder='["Alt1","Alt2"]' />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
