"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Upload, CheckCircle, AlertCircle, FileText, X,
  Loader2,
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

interface QueueItem {
  file: File;
  status: "pending" | "uploading" | "done" | "error";
  result?: ImportResult;
  error?: string;
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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ImportPage() {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<{ year: number; month: number } | null>(null);
  const [dragTarget, setDragTarget] = useState<{ year: number; month: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingCell, setPendingCell] = useState<{ year: number; month: number } | null>(null);

  // Batch upload queue
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [dragOver, setDragOver] = useState(false);

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

  // ─── Single cell upload ──────────────────────────────────────────────

  async function handleUpload(file: File, year: number, month: number) {
    setUploading({ year, month });

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("year", String(year));
      formData.append("month", String(month));

      const res = await fetch("/api/import", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      fetchPeriods();
    } catch {
      // Silently handle — cell will remain empty for retry
    } finally {
      setUploading(null);
    }
  }

  function handleCellClick(year: number, month: number) {
    if (getPeriod(year, month)) return;
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
    if (getPeriod(year, month)) return;
    const file = e.dataTransfer.files[0];
    if (file && file.name.toLowerCase().endsWith(".xml")) {
      handleUpload(file, year, month);
    }
  }

  // ─── Batch upload (multiple files, auto-detect dates) ────────────────

  function addFilesToQueue(files: File[]) {
    const xmlFiles = files.filter((f) => f.name.toLowerCase().endsWith(".xml"));
    if (xmlFiles.length === 0) return;

    const items: QueueItem[] = xmlFiles.map((file) => ({
      file,
      status: "pending" as const,
    }));

    setQueue((prev) => [...prev, ...items]);
  }

  // Process queue sequentially
  useEffect(() => {
    if (batchProcessing) return;
    const nextIndex = queue.findIndex((q) => q.status === "pending");
    if (nextIndex === -1) return;

    setBatchProcessing(true);

    const item = queue[nextIndex];

    // Mark as uploading
    setQueue((prev) =>
      prev.map((q, i) => (i === nextIndex ? { ...q, status: "uploading" as const } : q))
    );

    const formData = new FormData();
    formData.append("file", item.file);

    fetch("/api/import", { method: "POST", body: formData })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        setQueue((prev) =>
          prev.map((q, i) =>
            i === nextIndex
              ? ok
                ? { ...q, status: "done" as const, result: data }
                : { ...q, status: "error" as const, error: data.error || "Import failed" }
              : q
          )
        );
        if (ok) fetchPeriods();
      })
      .catch((err) => {
        setQueue((prev) =>
          prev.map((q, i) =>
            i === nextIndex
              ? { ...q, status: "error" as const, error: err instanceof Error ? err.message : "Import failed" }
              : q
          )
        );
      })
      .finally(() => {
        setBatchProcessing(false);
      });
  }, [queue, batchProcessing, fetchPeriods]);

  function clearQueue() {
    setQueue([]);
  }

  const queueDone = queue.filter((q) => q.status === "done").length;
  const queueErrors = queue.filter((q) => q.status === "error").length;
  const queueTotal = queue.length;
  const queueActive = queue.some((q) => q.status === "pending" || q.status === "uploading");

  // Stats
  const totalUploaded = periods.length;
  const totalCells = YEARS.length * 12;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-bob-text">Upload Data</h1>
        <p className="text-bob-text-soft mt-1">
          Upload XML files for each month. Date auto-detected from file. Data is locked once uploaded.
        </p>
      </div>

      {/* Bulk Drop Zone — multiple files */}
      <div className="mb-6">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            addFilesToQueue(Array.from(e.dataTransfer.files));
          }}
          onClick={() => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = ".xml";
            input.multiple = true;
            input.onchange = (e) => {
              const files = Array.from((e.target as HTMLInputElement).files || []);
              if (files.length > 0) addFilesToQueue(files);
            };
            input.click();
          }}
          className={`bg-white rounded-2xl border-2 border-dashed transition-all duration-200 cursor-pointer p-8 text-center ${
            dragOver
              ? "border-bob-purple bg-bob-purple-light/30 scale-[1.01]"
              : "border-bob-border hover:border-bob-purple/40 hover:bg-gray-50"
          }`}
        >
          <div className="flex flex-col items-center gap-2">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${
              dragOver ? "bg-bob-purple-light" : "bg-bob-bg"
            }`}>
              <Upload className={`w-6 h-6 ${dragOver ? "text-bob-purple" : "text-bob-text-soft"}`} />
            </div>
            <p className="text-sm font-semibold text-bob-text">
              {dragOver ? "Drop files here" : "Drop XML files or click to select"}
            </p>
            <p className="text-xs text-bob-text-soft">
              Select multiple files — each will auto-assign to the correct month based on the date in the XML
            </p>
          </div>
        </div>
      </div>

      {/* Batch Queue */}
      {queue.length > 0 && (
        <div className="mb-6 bg-white rounded-2xl border border-bob-border overflow-hidden">
          {/* Queue header */}
          <div className="px-5 py-3 bg-bob-bg border-b border-bob-border flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-bob-text">
                Upload Queue
              </span>
              <span className="text-xs text-bob-text-soft">
                {queueDone} of {queueTotal} complete
                {queueErrors > 0 && <span className="text-red-500 ml-1">({queueErrors} failed)</span>}
              </span>
            </div>
            {!queueActive && (
              <button
                onClick={clearQueue}
                className="text-xs text-bob-text-soft hover:text-bob-text transition-colors"
              >
                Clear
              </button>
            )}
          </div>

          {/* Progress bar */}
          <div className="h-1.5 bg-bob-bg">
            <div
              className="h-full bg-gradient-to-r from-bob-purple to-bob-blue transition-all duration-500"
              style={{ width: `${queueTotal > 0 ? ((queueDone + queueErrors) / queueTotal) * 100 : 0}%` }}
            />
          </div>

          {/* File list */}
          <div className="divide-y divide-bob-border-light max-h-64 overflow-y-auto">
            {queue.map((item, i) => (
              <div key={i} className="px-5 py-3 flex items-center gap-3">
                <div className="flex-shrink-0">
                  {item.status === "uploading" ? (
                    <Loader2 className="w-4 h-4 animate-spin text-bob-purple" />
                  ) : item.status === "done" ? (
                    <CheckCircle className="w-4 h-4 text-emerald-500" />
                  ) : item.status === "error" ? (
                    <AlertCircle className="w-4 h-4 text-red-500" />
                  ) : (
                    <FileText className="w-4 h-4 text-gray-300" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-bob-text truncate">{item.file.name}</p>
                  <p className="text-xs text-bob-text-soft">
                    {formatSize(item.file.size)}
                    {item.status === "uploading" && " — Processing..."}
                    {item.status === "done" && item.result && (
                      <span className="text-emerald-600">
                        {" — "}
                        {item.result.month ? `${MONTH_FULL[item.result.month]} ` : ""}
                        {item.result.year}
                        {" · "}
                        {item.result.clientsProcessed} groups
                        {" · "}
                        {item.result.employeesProcessed.toLocaleString()} employees
                      </span>
                    )}
                    {item.status === "error" && (
                      <span className="text-red-500">{" — "}{item.error}</span>
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
    </div>
  );
}
