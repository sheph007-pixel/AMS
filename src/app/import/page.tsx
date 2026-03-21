"use client";

import { useRef, useState } from "react";
import {
  Upload, CheckCircle, AlertCircle, FileText, X,
  Loader2, ShieldCheck, ArrowRight, RefreshCw,
} from "lucide-react";
import { useUpload, type QueueItem } from "../upload-context";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StagedFile {
  file: File;
  parsedYear: number | null;
  parsedMonth: number | null;
  dateStr: string | null;
  conflict: boolean;
  override: boolean;
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

function parseDateFromFilename(filename: string): { year: number; month: number; dateStr: string } | null {
  const match = filename.match(/(\d{4})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  if (year < 2000 || year > 2100) return null;
  return { year, month, dateStr: `${match[1]}${match[2]}${match[3]}` };
}

function getAuditStatus(item: QueueItem): "match" | "mismatch" | "pending" {
  if (item.status !== "done" || !item.result) return "pending";
  if (item.year === item.result.year && item.month === item.result.month) return "match";
  return "mismatch";
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ImportPage() {
  const {
    periods, periodsLoading, fetchPeriods, getPeriod,
    queue, queueActive, enqueueFiles, clearQueue,
    isSuspicious,
  } = useUpload();

  const [uploading, setUploading] = useState<{ year: number; month: number } | null>(null);
  const [dragTarget, setDragTarget] = useState<{ year: number; month: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingCell, setPendingCell] = useState<{ year: number; month: number } | null>(null);
  const [overrideConfirm, setOverrideConfirm] = useState<{ year: number; month: number } | null>(null);

  // Staged files (pre-confirmation review)
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);

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
      // Cell remains for retry
    } finally {
      setUploading(null);
    }
  }

  function handleCellClick(year: number, month: number) {
    const existing = getPeriod(year, month);
    if (existing) {
      setOverrideConfirm({ year, month });
      return;
    }
    setPendingCell({ year, month });
    fileInputRef.current?.click();
  }

  function confirmCellOverride() {
    if (!overrideConfirm) return;
    setPendingCell(overrideConfirm);
    setOverrideConfirm(null);
    setTimeout(() => fileInputRef.current?.click(), 0);
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
    const file = e.dataTransfer.files[0];
    if (file && file.name.toLowerCase().endsWith(".xml")) {
      handleUpload(file, year, month);
    }
  }

  // ─── Staging ──────────────────────────────────────────────────────────

  function stageFiles(files: File[]) {
    const xmlFiles = files.filter((f) => f.name.toLowerCase().endsWith(".xml"));
    if (xmlFiles.length === 0) return;

    const items: StagedFile[] = xmlFiles.map((file) => {
      const parsed = parseDateFromFilename(file.name);
      const conflict = parsed ? !!getPeriod(parsed.year, parsed.month) : false;
      return {
        file,
        parsedYear: parsed?.year ?? null,
        parsedMonth: parsed?.month ?? null,
        dateStr: parsed?.dateStr ?? null,
        conflict,
        override: false,
      };
    });

    items.sort((a, b) => {
      if (!a.dateStr) return 1;
      if (!b.dateStr) return -1;
      return a.dateStr.localeCompare(b.dateStr);
    });

    setStaged(items);
  }

  function removeStagedFile(index: number) {
    setStaged((prev) => prev.filter((_, i) => i !== index));
  }

  function cancelStaging() {
    setStaged([]);
  }

  function toggleOverride(index: number) {
    setStaged((prev) =>
      prev.map((s, i) => (i === index ? { ...s, override: !s.override } : s))
    );
  }

  function confirmAndUpload() {
    const valid = staged.filter(
      (s) => s.parsedYear !== null && s.parsedMonth !== null && (!s.conflict || s.override)
    );

    enqueueFiles(
      valid.map((s) => ({
        file: s.file,
        year: s.parsedYear!,
        month: s.parsedMonth!,
        dateStr: s.dateStr!,
      }))
    );

    setStaged([]);
  }

  const validStaged = staged.filter(
    (s) => s.parsedYear !== null && s.parsedMonth !== null && (!s.conflict || s.override)
  );
  const invalidStaged = staged.filter(
    (s) => s.parsedYear === null || s.parsedMonth === null
  );
  const conflictStaged = staged.filter(
    (s) => s.parsedYear !== null && s.parsedMonth !== null && s.conflict && !s.override
  );

  // Queue stats
  const queueDone = queue.filter((q) => q.status === "done").length;
  const queueErrors = queue.filter((q) => q.status === "error").length;
  const queueTotal = queue.length;
  const queueFinished = queueTotal > 0 && !queueActive;

  // Stats
  const totalUploaded = periods.length;
  const totalCells = YEARS.length * 12;
  const suspiciousCount = periods.filter((p) => isSuspicious(p)).length;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-bob-text">Upload Data</h1>
        <p className="text-bob-text-soft mt-1">
          Upload XML files for each month. Date is read from the filename. Data is permanently stored once uploaded.
        </p>
      </div>

      {/* Bulk Drop Zone */}
      {staged.length === 0 && !queueActive && (
        <div className="mb-6">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              stageFiles(Array.from(e.dataTransfer.files));
            }}
            onClick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = ".xml";
              input.multiple = true;
              input.onchange = (e) => {
                const files = Array.from((e.target as HTMLInputElement).files || []);
                if (files.length > 0) stageFiles(files);
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
                Select multiple files — date is parsed from filename (e.g. Data_API_<strong>20251212</strong>_114559_16617.xml)
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ─── STEP 1: Confirmation Review ──────────────────────────────── */}
      {staged.length > 0 && (
        <div className="mb-6 bg-white rounded-2xl border border-bob-border overflow-hidden">
          <div className="px-5 py-4 bg-bob-bg border-b border-bob-border">
            <h2 className="text-sm font-semibold text-bob-text">Review File Assignments</h2>
            <p className="text-xs text-bob-text-soft mt-0.5">
              Confirm each file is mapped to the correct month before uploading.
              {invalidStaged.length > 0 && (
                <span className="text-amber-600 ml-1">
                  {invalidStaged.length} file{invalidStaged.length > 1 ? "s" : ""} could not be parsed.
                </span>
              )}
              {conflictStaged.length > 0 && (
                <span className="text-amber-600 ml-1">
                  {conflictStaged.length} file{conflictStaged.length > 1 ? "s" : ""} already uploaded — click &quot;Exists&quot; to override.
                </span>
              )}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-bob-border-light">
                <tr>
                  <th className="px-5 py-2 text-left text-xs font-medium text-bob-text-soft w-8">#</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-bob-text-soft">Filename</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-bob-text-soft w-28">Size</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-bob-text-soft w-28">Date Found</th>
                  <th className="px-3 py-2 text-center text-xs font-medium text-bob-text-soft w-8">
                    <ArrowRight className="w-3 h-3 mx-auto" />
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-bob-text-soft w-40">Assigned Slot</th>
                  <th className="px-3 py-2 text-center text-xs font-medium text-bob-text-soft w-16">Status</th>
                  <th className="px-3 py-2 w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-bob-border-light">
                {staged.map((s, i) => {
                  const hasDate = s.parsedYear !== null && s.parsedMonth !== null;
                  return (
                    <tr key={i} className={`${s.conflict && !s.override ? "bg-amber-50/30" : s.conflict && s.override ? "bg-bob-purple-light/30" : !hasDate ? "bg-amber-50/50" : "hover:bg-gray-50"}`}>
                      <td className="px-5 py-2.5 text-xs text-bob-text-soft">{i + 1}</td>
                      <td className="px-3 py-2.5">
                        <p className="text-sm text-bob-text truncate max-w-xs" title={s.file.name}>
                          {s.file.name}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-bob-text-soft">{formatSize(s.file.size)}</td>
                      <td className="px-3 py-2.5">
                        {s.dateStr ? (
                          <span className="text-xs font-mono text-bob-text">{s.dateStr}</span>
                        ) : (
                          <span className="text-xs text-amber-600">No date</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {hasDate && <ArrowRight className="w-3 h-3 text-bob-text-soft mx-auto" />}
                      </td>
                      <td className="px-3 py-2.5">
                        {hasDate ? (
                          <span className={`text-sm font-medium ${s.conflict ? "text-red-500" : "text-bob-text"}`}>
                            {MONTH_FULL[s.parsedMonth!]} {s.parsedYear}
                          </span>
                        ) : (
                          <span className="text-xs text-amber-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {s.conflict && !s.override ? (
                          <button
                            onClick={() => toggleOverride(i)}
                            className="inline-flex items-center gap-1 text-xs text-amber-600 font-medium hover:text-amber-700 transition-colors"
                            title="Click to override existing data"
                          >
                            <AlertCircle className="w-3 h-3" /> Exists
                          </button>
                        ) : s.conflict && s.override ? (
                          <button
                            onClick={() => toggleOverride(i)}
                            className="inline-flex items-center gap-1 text-xs text-bob-purple font-medium hover:text-bob-purple/80 transition-colors"
                            title="Will replace existing data — click to undo"
                          >
                            <RefreshCw className="w-3 h-3" /> Override
                          </button>
                        ) : hasDate ? (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">
                            <CheckCircle className="w-3 h-3" /> Ready
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-amber-600 font-medium">
                            <AlertCircle className="w-3 h-3" /> Skip
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <button onClick={() => removeStagedFile(i)} className="text-gray-300 hover:text-gray-500">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="px-5 py-4 bg-gray-50 border-t border-bob-border flex items-center justify-between">
            <p className="text-xs text-bob-text-soft">
              {validStaged.length} of {staged.length} file{staged.length > 1 ? "s" : ""} will be uploaded
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={cancelStaging}
                className="px-4 py-2 text-sm text-bob-text-soft hover:text-bob-text transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmAndUpload}
                disabled={validStaged.length === 0}
                className="px-5 py-2 text-sm font-semibold text-white bg-bob-purple rounded-lg hover:bg-bob-purple/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Confirm &amp; Upload {validStaged.length} File{validStaged.length !== 1 ? "s" : ""}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── STEP 2: Upload Queue + Progress ──────────────────────────── */}
      {queue.length > 0 && (
        <div className="mb-6 bg-white rounded-2xl border border-bob-border overflow-hidden">
          <div className="px-5 py-3 bg-bob-bg border-b border-bob-border flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-bob-text">
                {queueFinished ? "Upload Complete" : "Uploading..."}
              </span>
              <span className="text-xs text-bob-text-soft">
                {queueDone} of {queueTotal} complete
                {queueErrors > 0 && <span className="text-red-500 ml-1">({queueErrors} failed)</span>}
              </span>
            </div>
            {queueFinished && (
              <button onClick={clearQueue} className="text-xs text-bob-text-soft hover:text-bob-text transition-colors">
                Clear
              </button>
            )}
          </div>

          {/* Progress bar */}
          <div className="h-1.5 bg-bob-bg">
            <div
              className={`h-full transition-all duration-500 ${
                queueFinished && queueErrors === 0
                  ? "bg-gradient-to-r from-emerald-400 to-emerald-500"
                  : "bg-gradient-to-r from-bob-purple to-bob-blue"
              }`}
              style={{ width: `${queueTotal > 0 ? ((queueDone + queueErrors) / queueTotal) * 100 : 0}%` }}
            />
          </div>

          {/* File list with progress */}
          <div className="divide-y divide-bob-border-light max-h-80 overflow-y-auto">
            {queue.map((item) => {
              const audit = getAuditStatus(item);
              return (
                <div key={item.id} className="px-5 py-3 flex items-center gap-3">
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
                    <p className="text-sm text-bob-text truncate">{item.fileName}</p>
                    <p className="text-xs text-bob-text-soft">
                      {formatSize(item.fileSize)}
                      <span className="mx-1.5 text-gray-300">|</span>
                      <span className="font-mono">{item.dateStr}</span>
                      <span className="mx-1">&rarr;</span>
                      <span className="font-medium">{MONTH_FULL[item.month]} {item.year}</span>
                      {item.status === "uploading" && (
                        <span className="text-bob-purple ml-2">Processing...</span>
                      )}
                      {item.status === "done" && item.result && (
                        <span className="text-emerald-600 ml-2">
                          {item.result.clientsProcessed} groups &middot; {item.result.employeesProcessed.toLocaleString()} employees
                        </span>
                      )}
                      {item.status === "error" && (
                        <span className="text-red-500 ml-2">{item.error}</span>
                      )}
                    </p>
                  </div>
                  {item.status === "done" && (
                    <div className="flex-shrink-0">
                      {audit === "match" ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">
                          <ShieldCheck className="w-3 h-3" /> Verified
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-600 bg-red-50 px-2 py-1 rounded-full">
                          <AlertCircle className="w-3 h-3" /> Mismatch
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Post-upload Audit Summary */}
          {queueFinished && (
            <div className="px-5 py-4 bg-gray-50 border-t border-bob-border">
              <div className="flex items-center gap-2 mb-3">
                <ShieldCheck className="w-4 h-4 text-bob-text" />
                <h3 className="text-sm font-semibold text-bob-text">Audit Summary</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-bob-border-light">
                      <th className="text-left py-1.5 px-2 font-medium text-bob-text-soft">Filename</th>
                      <th className="text-left py-1.5 px-2 font-medium text-bob-text-soft">Filename Date</th>
                      <th className="text-center py-1.5 px-2 font-medium text-bob-text-soft">&rarr;</th>
                      <th className="text-left py-1.5 px-2 font-medium text-bob-text-soft">Stored As</th>
                      <th className="text-center py-1.5 px-2 font-medium text-bob-text-soft">Match</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-bob-border-light">
                    {queue.map((item) => {
                      const audit = getAuditStatus(item);
                      return (
                        <tr key={item.id}>
                          <td className="py-1.5 px-2 text-bob-text truncate max-w-[200px]">{item.fileName}</td>
                          <td className="py-1.5 px-2 font-mono text-bob-text">
                            {MONTH_FULL[item.month]} {item.year}
                          </td>
                          <td className="py-1.5 px-2 text-center text-bob-text-soft">&rarr;</td>
                          <td className="py-1.5 px-2 font-mono text-bob-text">
                            {item.status === "done" && item.result
                              ? `${item.result.month ? MONTH_FULL[item.result.month] : "?"} ${item.result.year}`
                              : item.status === "error"
                              ? "Failed"
                              : "—"}
                          </td>
                          <td className="py-1.5 px-2 text-center">
                            {item.status === "done" ? (
                              audit === "match" ? (
                                <CheckCircle className="w-3.5 h-3.5 text-emerald-500 mx-auto" />
                              ) : (
                                <AlertCircle className="w-3.5 h-3.5 text-red-500 mx-auto" />
                              )
                            ) : item.status === "error" ? (
                              <X className="w-3.5 h-3.5 text-red-400 mx-auto" />
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {queueErrors === 0 && queue.every((q) => getAuditStatus(q) === "match") ? (
                <div className="mt-3 flex items-center gap-2 text-xs text-emerald-600 font-medium">
                  <ShieldCheck className="w-4 h-4" />
                  All {queueDone} files verified — filename dates match stored periods
                </div>
              ) : (
                <div className="mt-3 flex items-center gap-2 text-xs text-amber-600 font-medium">
                  <AlertCircle className="w-4 h-4" />
                  {queueErrors > 0 ? `${queueErrors} failed. ` : ""}
                  {queue.filter((q) => getAuditStatus(q) === "mismatch").length > 0
                    ? "Some files have date mismatches — review above."
                    : ""}
                  Successful uploads: {queueDone}
                </div>
              )}
            </div>
          )}
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
        {suspiciousCount > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-red-100 border border-red-300 inline-block" />
            Needs Review ({suspiciousCount})
          </span>
        )}
      </div>

      {/* Year/Month Grid */}
      {periodsLoading ? (
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
                      const suspicious = hasData && isSuspicious(period);

                      return (
                        <td key={month} className="px-1 py-2">
                          <div
                            onClick={() => !isUploading && handleCellClick(year, month)}
                            onDragOver={(e) => {
                              e.preventDefault();
                              setDragTarget({ year, month });
                            }}
                            onDragLeave={() => setDragTarget(null)}
                            onDrop={(e) => handleCellDrop(e, year, month)}
                            className={`group relative rounded-lg px-2 py-2.5 text-center transition-all duration-200 min-h-[52px] flex flex-col items-center justify-center cursor-pointer ${
                              suspicious
                                ? "bg-red-50 border border-red-300 hover:border-red-400 hover:bg-red-50/80"
                                : hasData
                                ? "bg-emerald-50 border border-emerald-200 hover:border-bob-purple/40 hover:bg-emerald-50/60"
                                : isUploading
                                ? "bg-bob-purple-light border border-bob-purple/30"
                                : isDragOver
                                ? "bg-bob-purple-light/50 border-2 border-dashed border-bob-purple scale-105"
                                : "bg-bob-bg/50 border border-dashed border-bob-border hover:border-bob-purple/40 hover:bg-bob-purple-light/20"
                            }`}
                            title={
                              suspicious
                                ? `Needs review — only ${period.groups} group${period.groups !== 1 ? "s" : ""}, ${period.employees.toLocaleString()} employees\nMay be incomplete or failed upload\nClick to re-upload`
                                : hasData
                                ? `${period.groups} groups, ${period.employees.toLocaleString()} employees\nUploaded: ${period.importedAt ? new Date(period.importedAt).toLocaleDateString() : "—"}\nClick to replace`
                                : `Upload ${MONTH_FULL[month]} ${year}`
                            }
                          >
                            {isUploading ? (
                              <Loader2 className="w-4 h-4 animate-spin text-bob-purple" />
                            ) : suspicious ? (
                              <>
                                <AlertCircle className="w-3.5 h-3.5 text-red-500 mb-0.5 group-hover:hidden" />
                                <RefreshCw className="w-3.5 h-3.5 text-red-500 mb-0.5 hidden group-hover:block" />
                                <span className="text-[10px] font-semibold text-red-600">{period.groups}</span>
                              </>
                            ) : hasData ? (
                              <>
                                <CheckCircle className="w-3.5 h-3.5 text-emerald-500 mb-0.5 group-hover:hidden" />
                                <RefreshCw className="w-3.5 h-3.5 text-bob-purple mb-0.5 hidden group-hover:block" />
                                <span className="text-[10px] font-semibold text-emerald-700 group-hover:text-bob-purple">{period.groups}</span>
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

      {/* Override Confirmation Modal */}
      {overrideConfirm && (() => {
        const p = getPeriod(overrideConfirm.year, overrideConfirm.month);
        const susp = p && isSuspicious(p);
        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setOverrideConfirm(null)} />
            <div className="relative bg-white rounded-2xl shadow-2xl p-6 w-[380px] animate-fade-in-up">
              <div className="text-center mb-5">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3 ${susp ? "bg-red-50" : "bg-amber-50"}`}>
                  <RefreshCw className={`w-6 h-6 ${susp ? "text-red-500" : "text-amber-500"}`} />
                </div>
                <h3 className="text-lg font-semibold text-bob-text">
                  {susp ? "Replace Incomplete Data?" : "Replace Existing Data?"}
                </h3>
                <p className="text-sm text-bob-text-soft mt-1">
                  <strong>{MONTH_FULL[overrideConfirm.month]} {overrideConfirm.year}</strong>
                  {susp ? " appears incomplete." : " already has data."}
                </p>
              </div>

              {p && (
                <div className={`rounded-xl p-3 mb-5 text-sm ${susp ? "bg-red-50" : "bg-bob-bg"}`}>
                  <div className="flex justify-between text-bob-text-soft">
                    <span>Groups</span>
                    <span className={`font-medium ${susp ? "text-red-600" : "text-bob-text"}`}>{p.groups}</span>
                  </div>
                  <div className="flex justify-between text-bob-text-soft mt-1">
                    <span>Employees</span>
                    <span className={`font-medium ${susp ? "text-red-600" : "text-bob-text"}`}>{p.employees.toLocaleString()}</span>
                  </div>
                  {p.importedAt && (
                    <div className="flex justify-between text-bob-text-soft mt-1">
                      <span>Uploaded</span>
                      <span className="font-medium text-bob-text">{new Date(p.importedAt).toLocaleDateString()}</span>
                    </div>
                  )}
                  {susp && (
                    <p className="text-xs text-red-500 mt-2 pt-2 border-t border-red-200">
                      This looks like an incomplete upload — group count is much lower than neighboring months.
                    </p>
                  )}
                </div>
              )}

              <p className="text-xs text-bob-text-soft text-center mb-4">
                The existing data will be permanently replaced with the new file.
              </p>

              <div className="flex gap-3">
                <button
                  onClick={() => setOverrideConfirm(null)}
                  className="flex-1 py-2.5 text-sm text-bob-text-soft hover:text-bob-text border border-bob-border rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmCellOverride}
                  className="flex-1 py-2.5 text-sm font-semibold text-white bg-bob-purple rounded-xl hover:bg-bob-purple/90 transition-colors"
                >
                  Replace Data
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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
