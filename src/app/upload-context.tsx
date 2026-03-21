"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Period {
  year: number;
  month: number;
  groups: number;
  benefitPlans: number;
  employees: number;
  importedAt: string | null;
}

export interface ImportResult {
  year: number;
  month: number | null;
  detectedDate: string | null;
  clientsProcessed: number;
  clientsCreated: number;
  clientsUpdated: number;
  benefitPlansCreated: number;
  employeesProcessed: number;
}

export interface QueueItem {
  id: string;          // unique key for stable identity
  fileName: string;
  fileSize: number;
  year: number;
  month: number;
  dateStr: string;
  status: "pending" | "uploading" | "done" | "error";
  result?: ImportResult;
  error?: string;
}

// We store the File object separately so it doesn't leak into context serialization
type FileStore = Map<string, File>;

interface UploadContextValue {
  // Periods data
  periods: Period[];
  periodsLoading: boolean;
  fetchPeriods: () => void;
  getPeriod: (year: number, month: number) => Period | undefined;

  // Queue
  queue: QueueItem[];
  queueActive: boolean;
  enqueueFiles: (files: { file: File; year: number; month: number; dateStr: string }[]) => void;
  clearQueue: () => void;

  // Anomaly detection
  isSuspicious: (period: Period) => boolean;
}

const UploadContext = createContext<UploadContextValue | null>(null);

export function useUpload() {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error("useUpload must be used within UploadProvider");
  return ctx;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function UploadProvider({ children }: { children: React.ReactNode }) {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [periodsLoading, setPeriodsLoading] = useState(true);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [processing, setProcessing] = useState(false);
  const fileStore = useRef<FileStore>(new Map());

  // ─── Periods ────────────────────────────────────────────────────────

  const fetchPeriods = useCallback(() => {
    fetch("/api/import/periods")
      .then((r) => r.json())
      .then((data) => setPeriods(data.periods || []))
      .finally(() => setPeriodsLoading(false));
  }, []);

  useEffect(() => {
    fetchPeriods();
  }, [fetchPeriods]);

  const periodMap = new Map<string, Period>();
  for (const p of periods) {
    periodMap.set(`${p.year}-${p.month}`, p);
  }

  const getPeriod = useCallback(
    (year: number, month: number) => periodMap.get(`${year}-${month}`),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [periods]
  );

  // ─── Anomaly detection ──────────────────────────────────────────────

  const isSuspicious = useCallback(
    (period: Period): boolean => {
      // Get all periods in the same year
      const yearPeriods = periods.filter((p) => p.year === period.year && p.groups > 0);
      if (yearPeriods.length < 2) {
        // Not enough data in same year — check adjacent years
        const nearbyPeriods = periods.filter(
          (p) => Math.abs(p.year - period.year) <= 1 && p.groups > 0 && !(p.year === period.year && p.month === period.month)
        );
        if (nearbyPeriods.length < 2) return false;
        const median = getMedian(nearbyPeriods.map((p) => p.groups));
        return period.groups < median * 0.15; // less than 15% of median
      }

      const otherPeriods = yearPeriods.filter((p) => p.month !== period.month);
      if (otherPeriods.length === 0) return false;
      const median = getMedian(otherPeriods.map((p) => p.groups));
      // Suspicious if group count is less than 15% of the median for that year
      return period.groups < median * 0.15;
    },
    [periods]
  );

  // ─── Queue management ──────────────────────────────────────────────

  function enqueueFiles(files: { file: File; year: number; month: number; dateStr: string }[]) {
    const items: QueueItem[] = files.map((f) => {
      const id = `${f.year}-${f.month}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      fileStore.current.set(id, f.file);
      return {
        id,
        fileName: f.file.name,
        fileSize: f.file.size,
        year: f.year,
        month: f.month,
        dateStr: f.dateStr,
        status: "pending" as const,
      };
    });

    setQueue((prev) => [...prev, ...items]);
  }

  function clearQueue() {
    // Clean up file references
    for (const item of queue) {
      fileStore.current.delete(item.id);
    }
    setQueue([]);
  }

  // ─── Process queue sequentially (runs in background) ────────────────

  useEffect(() => {
    if (processing) return;
    const nextItem = queue.find((q) => q.status === "pending");
    if (!nextItem) return;

    setProcessing(true);

    // Mark as uploading
    setQueue((prev) =>
      prev.map((q) => (q.id === nextItem.id ? { ...q, status: "uploading" as const } : q))
    );

    const file = fileStore.current.get(nextItem.id);
    if (!file) {
      setQueue((prev) =>
        prev.map((q) =>
          q.id === nextItem.id ? { ...q, status: "error" as const, error: "File reference lost" } : q
        )
      );
      setProcessing(false);
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("year", String(nextItem.year));
    formData.append("month", String(nextItem.month));

    fetch("/api/import", { method: "POST", body: formData })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        setQueue((prev) =>
          prev.map((q) =>
            q.id === nextItem.id
              ? ok
                ? { ...q, status: "done" as const, result: data }
                : { ...q, status: "error" as const, error: data.error || "Import failed" }
              : q
          )
        );
        fileStore.current.delete(nextItem.id);
        if (ok) fetchPeriods();
      })
      .catch((err) => {
        setQueue((prev) =>
          prev.map((q) =>
            q.id === nextItem.id
              ? { ...q, status: "error" as const, error: err instanceof Error ? err.message : "Import failed" }
              : q
          )
        );
        fileStore.current.delete(nextItem.id);
      })
      .finally(() => {
        setProcessing(false);
      });
  }, [queue, processing, fetchPeriods]);

  const queueActive = queue.some((q) => q.status === "pending" || q.status === "uploading");

  return (
    <UploadContext.Provider
      value={{
        periods,
        periodsLoading,
        fetchPeriods,
        getPeriod,
        queue,
        queueActive,
        enqueueFiles,
        clearQueue,
        isSuspicious,
      }}
    >
      {children}
    </UploadContext.Provider>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
