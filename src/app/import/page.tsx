"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Upload, CheckCircle, AlertCircle, FileText, X,
  ChevronLeft, ChevronRight, Loader2, Calendar,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Period {
  year: number;
  month: number;
  groups: number;
  benefitPlans: number;
  employees: number;
  importedAt: string | null;
}

interface ImportResult {
  year: number;
  month: number | null;
  detectedDate: string | null;
  clientsProcessed: number;
  clientsCreated: number;
  clientsUpdated: number;
  benefitPlansCreated: number;
  employeesProcessed: number;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const MONTH_FULL = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const START_YEAR = 2022;
const END_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: END_YEAR - START_YEAR + 1 }, (_, i) => START_YEAR + i);

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ImportPage() {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<{ year: number; month: number } | null>(null);
  const [uploadResult, setUploadResult] = useState<ImportResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<{ year: number; month: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingCell, setPendingCell] = useState<{ year: number; month: number } | null>(null);

  const fetchPeriods = useCallback(() => {
    fetch("/api/import/periods")
      .then((r) => r.json())
      .then((data) => setPeriods(data.periods || []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchPeriods();
  }, [fetchPeriods]);

  // Lookup: "year-month" → Period
  const periodMap = new Map<string, Period>();
  for (const p of periods) {
    periodMap.set(`${p.year}-${p.month}`, p);
  }

  function getPeriod(year: number, month: number): Period | undefined {
    return periodMap.get(`${year}-${month}`);
  }

  async function handleUpload(file: File, year: number, month: number) {
    setUploading({ year, month });
    setUploadResult(null);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("year", String(year));
      formData.append("month", String(month));

      const res = await fetch("/api/import", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Import failed");

      setUploadResult(data);
      fetchPeriods(); // Refresh grid
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setUploading(null);
    }
  }

  function handleCellClick(year: number, month: number) {
    const existing = getPeriod(year, month);
    if (existing) return; // Already uploaded — locked
    setPendingCell({ year, month });
    fileInputRef.current?.click();
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file && pendingCell) {
      handleUpload(file, pendingCell.year, pendingCell.month);
    }
    setPendingCell(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleCellDrop(e: React.DragEvent, year: number, month: number) {
    e.preventDefault();
    setDragTarget(null);
    const existing = getPeriod(year, month);
    if (existing) return;
    const file = e.dataTransfer.files[0];
    if (file && file.name.toLowerCase().endsWith(".xml")) {
      handleUpload(file, year, month);
    }
  }

  // Auto-detect upload: drop anywhere on page, detect date from XML
  async function handleAutoUpload(file: File) {
    setUploading({ year: 0, month: 0 }); // Show generic uploading state
    setUploadResult(null);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      // Don't send year/month — let the XML date detection assign it

      const res = await fetch("/api/import", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Import failed");

      setUploadResult(data);
      fetchPeriods();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setUploading(null);
    }
  }

  // Stats
  const totalUploaded = periods.length;
  const totalCells = YEARS.length * 12;
  const totalGroups = new Set(periods.map((p) => `${p.year}-${p.month}`)).size;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-bob-text">Upload Data</h1>
        <p className="text-bob-text-soft mt-1">
          Upload XML files for each month. Data is locked once uploaded.
        </p>
      </div>

      {/* Quick Drop — auto-detect date */}
      <div className="mb-6">
        <div
          onDragOver={(e) => { e.preventDefault(); }}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file && file.name.toLowerCase().endsWith(".xml")) {
              handleAutoUpload(file);
            }
          }}
          onClick={() => {
            setPendingCell(null); // Clear any cell selection
            const input = document.createElement("input");
            input.type = "file";
            input.accept = ".xml";
            input.onchange = (e) => {
              const file = (e.target as HTMLInputElement).files?.[0];
              if (file) handleAutoUpload(file);
            };
            input.click();
          }}
          className="bg-white rounded-2xl border-2 border-dashed border-bob-border hover:border-bob-purple/40 hover:bg-gray-50 transition-all duration-200 cursor-pointer p-6 text-center"
        >
          <div className="flex items-center justify-center gap-3">
            <Upload className="w-5 h-5 text-bob-text-soft" />
            <span className="text-sm font-medium text-bob-text-soft">
              Drop XML here or click to auto-detect date from file
            </span>
          </div>
        </div>
      </div>

      {/* Summary bar */}
      <div className="flex items-center gap-6 mb-4 text-xs text-bob-text-soft">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-bob-green inline-block" />
          Uploaded ({totalUploaded})
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-bob-bg border border-bob-border inline-block" />
          Available ({totalCells - totalUploaded})
        </span>
      </div>

      {/* Year/Month Grid */}
      {loading ? (
        <div className="text-center py-16 text-bob-text-soft">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-bob-purple" />
          Loading data periods...
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-bob-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bob-bg border-b border-bob-border">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-bob-text-soft text-xs w-20">Year</th>
                  {MONTHS.map((m) => (
                    <th key={m} className="px-2 py-3 text-center font-semibold text-bob-text-soft text-xs">{m}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-bob-border-light">
                {YEARS.map((year) => (
                  <tr key={year} className="hover:bg-bob-bg/30 transition-colors">
                    <td className="px-4 py-2 font-semibold text-bob-text text-sm">{year}</td>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => {
                      const period = getPeriod(year, month);
                      const isUploading = uploading?.year === year && uploading?.month === month;
                      const isDragOver = dragTarget?.year === year && dragTarget?.month === month;
                      const hasData = !!period;

                      return (
                        <td key={month} className="px-1 py-2">
                          <div
                            onClick={() => !hasData && !isUploading && handleCellClick(year, month)}
                            onDragOver={(e) => {
                              if (!hasData) {
                                e.preventDefault();
                                setDragTarget({ year, month });
                              }
                            }}
                            onDragLeave={() => setDragTarget(null)}
                            onDrop={(e) => handleCellDrop(e, year, month)}
                            className={`rounded-lg px-2 py-2.5 text-center transition-all duration-200 min-h-[52px] flex flex-col items-center justify-center ${
                              hasData
                                ? "bg-emerald-50 border border-emerald-200 cursor-default"
                                : isUploading
                                ? "bg-bob-purple-light border border-bob-purple/30"
                                : isDragOver
                                ? "bg-bob-purple-light/50 border-2 border-dashed border-bob-purple scale-105"
                                : "bg-bob-bg/50 border border-dashed border-bob-border hover:border-bob-purple/40 hover:bg-bob-purple-light/20 cursor-pointer"
                            }`}
                            title={
                              hasData
                                ? `${period.groups} groups, ${period.employees.toLocaleString()} employees\nUploaded: ${period.importedAt ? new Date(period.importedAt).toLocaleDateString() : "—"}`
                                : `Upload ${MONTH_FULL[month]} ${year}`
                            }
                          >
                            {isUploading ? (
                              <Loader2 className="w-4 h-4 animate-spin text-bob-purple" />
                            ) : hasData ? (
                              <>
                                <CheckCircle className="w-3.5 h-3.5 text-emerald-500 mb-0.5" />
                                <span className="text-[10px] font-semibold text-emerald-700">{period.groups}</span>
                              </>
                            ) : (
                              <Upload className="w-3.5 h-3.5 text-gray-300" />
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Hidden file input for cell clicks */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xml"
        onChange={handleFileSelected}
        className="hidden"
      />

      {/* Upload result toast */}
      {uploadResult && (
        <div className="fixed bottom-6 right-6 bg-white rounded-2xl border border-bob-border shadow-lg p-5 max-w-sm animate-fade-in-up z-50">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-bob-text text-sm">Upload complete</p>
              <p className="text-xs text-bob-text-soft mt-0.5">
                {uploadResult.month
                  ? `${MONTH_FULL[uploadResult.month]} ${uploadResult.year}`
                  : `${uploadResult.year}`}
                {" — "}
                {uploadResult.clientsProcessed} groups, {uploadResult.employeesProcessed.toLocaleString()} employees
              </p>
            </div>
            <button onClick={() => setUploadResult(null)} className="text-gray-300 hover:text-gray-500">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Upload error toast */}
      {uploadError && (
        <div className="fixed bottom-6 right-6 bg-white rounded-2xl border border-red-200 shadow-lg p-5 max-w-sm animate-fade-in-up z-50">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0">
              <AlertCircle className="w-4 h-4 text-red-500" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-bob-text text-sm">Upload failed</p>
              <p className="text-xs text-red-600 mt-0.5">{uploadError}</p>
            </div>
            <button onClick={() => setUploadError(null)} className="text-gray-300 hover:text-gray-500">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
