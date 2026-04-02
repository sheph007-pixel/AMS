"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, Upload, CheckCircle, XCircle, AlertTriangle, FileText } from "lucide-react";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface TestResult {
  id: string;
  status: string;
  coverage: {
    totalDiscoveredFields: number;
    mappedFields: number;
    unmappedFields: number;
    includedFields: number;
    excludedFields: number;
  };
  errors: any[];
  warnings: any[];
  info: any[];
  fieldDetails: any[];
}

interface PastResult {
  id: string;
  fileName: string;
  fileSize: number;
  status: string;
  totalDiscoveredFields: number;
  mappedFields: number;
  unmappedFields: number;
  includedFields: number;
  excludedFields: number;
  createdAt: string;
}

export default function SchemaTestPage() {
  const params = useParams();
  const id = params.id as string;
  const fileRef = useRef<HTMLInputElement>(null);

  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [pastResults, setPastResults] = useState<PastResult[]>([]);
  const [tab, setTab] = useState<"coverage" | "errors" | "fields">("coverage");

  useEffect(() => {
    fetch(`/api/schema/versions/${id}/test`).then(r => r.json()).then(setPastResults);
  }, [id]);

  async function handleTest() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;

    setTesting(true);
    setResult(null);

    const fd = new FormData();
    fd.append("file", file);

    try {
      const res = await fetch(`/api/schema/versions/${id}/test`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
      // Reload past results
      fetch(`/api/schema/versions/${id}/test`).then(r => r.json()).then(setPastResults);
    } catch {
      setResult(null);
    } finally {
      setTesting(false);
    }
  }

  const statusIcon = (s: string) => {
    if (s === "pass") return <CheckCircle className="w-5 h-5 text-green-500" />;
    if (s === "fail") return <XCircle className="w-5 h-5 text-red-500" />;
    return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
  };

  return (
    <div>
      <a href={`/schemas/${id}`} className="inline-flex items-center gap-1.5 text-sm text-bob-text-soft hover:text-bob-purple transition-colors mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to Field Inventory
      </a>

      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-bob-text">Test XML File</h1>
        <p className="text-bob-text-soft text-sm mt-1">Upload a sample XML to validate against this schema and its mappings</p>
      </div>

      {/* Upload */}
      <div className="bg-white rounded-2xl border border-bob-border p-5 mb-6">
        <div className="flex items-center gap-4">
          <input ref={fileRef} type="file" accept=".xml" className="text-sm flex-1" />
          <button onClick={handleTest} disabled={testing}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-bob-purple text-white text-sm font-medium rounded-xl hover:bg-bob-purple/90 disabled:opacity-50 transition-colors">
            <Upload className="w-4 h-4" /> {testing ? "Testing..." : "Run Test"}
          </button>
        </div>
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-4 mb-8">
          {/* Status Banner */}
          <div className={`rounded-2xl border p-5 flex items-center gap-4 ${
            result.status === "pass" ? "bg-green-50 border-green-200" :
            result.status === "fail" ? "bg-red-50 border-red-200" :
            "bg-yellow-50 border-yellow-200"
          }`}>
            {statusIcon(result.status)}
            <div>
              <span className="font-semibold text-bob-text capitalize">{result.status}</span>
              <span className="text-sm text-bob-text-soft ml-2">
                {result.errors.length} errors, {result.warnings.length} warnings
              </span>
            </div>
          </div>

          {/* Coverage Cards */}
          <div className="grid grid-cols-5 gap-3">
            {[
              { label: "Discovered", value: result.coverage.totalDiscoveredFields, color: "text-bob-text" },
              { label: "Mapped", value: result.coverage.mappedFields, color: "text-blue-600" },
              { label: "Unmapped", value: result.coverage.unmappedFields, color: "text-yellow-600" },
              { label: "Included", value: result.coverage.includedFields, color: "text-green-600" },
              { label: "Excluded", value: result.coverage.excludedFields, color: "text-red-500" },
            ].map(c => (
              <div key={c.label} className="bg-white rounded-xl border border-bob-border p-3 text-center">
                <div className={`text-lg font-bold ${c.color}`}>{c.value}</div>
                <div className="text-[10px] text-bob-text-soft uppercase">{c.label}</div>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
            {(["coverage", "errors", "fields"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors capitalize ${
                  tab === t ? "bg-white text-bob-text shadow-sm" : "text-bob-text-soft hover:text-bob-text"
                }`}>{t} {t === "errors" && `(${result.errors.length + result.warnings.length})`}</button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="bg-white rounded-2xl border border-bob-border p-4 max-h-96 overflow-y-auto">
            {tab === "coverage" && (
              <div className="text-xs space-y-1">
                <p className="text-bob-text-soft mb-2">
                  mapped ({result.coverage.mappedFields}) + unmapped ({result.coverage.unmappedFields}) = total ({result.coverage.totalDiscoveredFields})
                </p>
                <p className="text-bob-text-soft">
                  included ({result.coverage.includedFields}) + excluded ({result.coverage.excludedFields}) = mapped ({result.coverage.mappedFields})
                </p>
              </div>
            )}
            {tab === "errors" && (
              <div className="space-y-1">
                {[...result.errors, ...result.warnings, ...result.info].map((e, i) => (
                  <div key={i} className={`text-xs px-3 py-1.5 rounded ${
                    result.errors.includes(e) ? "bg-red-50 text-red-700" :
                    result.warnings.includes(e) ? "bg-yellow-50 text-yellow-700" :
                    "bg-blue-50 text-blue-700"
                  }`}>
                    <span className="font-medium">[{e.type}]</span> {e.field}: {e.message}
                  </div>
                ))}
                {result.errors.length === 0 && result.warnings.length === 0 && result.info.length === 0 && (
                  <p className="text-bob-text-soft text-xs">No issues found</p>
                )}
              </div>
            )}
            {tab === "fields" && (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-bob-border">
                    <th className="text-left py-1.5 px-2 font-semibold text-bob-text-soft">XML Path</th>
                    <th className="text-left py-1.5 px-2 font-semibold text-bob-text-soft">Status</th>
                    <th className="text-left py-1.5 px-2 font-semibold text-bob-text-soft">Target</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bob-border-light">
                  {result.fieldDetails.map((f: any, i: number) => (
                    <tr key={i} className={f.mappingStatus === "excluded" ? "opacity-40" : ""}>
                      <td className="py-1.5 px-2 font-mono">{f.xmlPath}</td>
                      <td className="py-1.5 px-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          f.mappingStatus === "mapped" ? "bg-green-50 text-green-700" :
                          f.mappingStatus === "excluded" ? "bg-red-50 text-red-500" :
                          "bg-yellow-50 text-yellow-700"
                        }`}>{f.mappingStatus}</span>
                      </td>
                      <td className="py-1.5 px-2 text-bob-text-soft">{f.targetColumn || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Past Results */}
      {pastResults.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-bob-text mb-3">Test History</h2>
          <div className="space-y-2">
            {pastResults.map(r => (
              <div key={r.id} className="bg-white rounded-xl border border-bob-border p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {statusIcon(r.status)}
                  <div>
                    <span className="text-sm font-medium text-bob-text flex items-center gap-2">
                      <FileText className="w-3.5 h-3.5 text-bob-text-soft" /> {r.fileName}
                    </span>
                    <div className="text-[10px] text-bob-text-soft mt-0.5">
                      {r.totalDiscoveredFields} discovered &middot; {r.mappedFields} mapped &middot; {r.unmappedFields} unmapped
                      &middot; {new Date(r.createdAt).toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
