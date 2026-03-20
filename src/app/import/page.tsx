"use client";

import { useRef, useState } from "react";
import { Upload, CheckCircle, AlertCircle, FileText, X, Sparkles } from "lucide-react";

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

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

type ImportStatus = "idle" | "reading" | "uploading" | "processing" | "done" | "error";

const STEPS = [
  { key: "reading", label: "Reading" },
  { key: "uploading", label: "Uploading" },
  { key: "processing", label: "Processing" },
  { key: "done", label: "Done!" },
] as const;

export default function ImportPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<ImportStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    const dropped = Array.from(e.dataTransfer.files).filter((f) =>
      f.name.toLowerCase().endsWith(".xml")
    );
    if (dropped.length > 0) setFiles(dropped);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files || []);
    if (selected.length > 0) setFiles(selected);
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function handleImport() {
    if (files.length === 0) return;
    setStatus("reading");
    setProgress(10);
    setResult(null);
    setError(null);

    try {
      await new Promise((r) => setTimeout(r, 200));
      setProgress(20);

      setStatus("uploading");
      setProgress(30);

      const formData = new FormData();
      formData.append("file", files[0]);

      const res = await fetch("/api/import", { method: "POST", body: formData });
      setProgress(60);

      setStatus("processing");
      setProgress(80);

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Import failed");
      }

      setProgress(100);
      setStatus("done");
      setResult(data);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Import failed");
    }
  }

  function reset() {
    setFiles([]);
    setStatus("idle");
    setProgress(0);
    setResult(null);
    setError(null);
  }

  const currentStepIndex = STEPS.findIndex((s) => s.key === status);
  const isWorking = ["reading", "uploading", "processing"].includes(status);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-bob-text">Upload Data</h1>
        <p className="text-bob-text-soft mt-1">
          Bring your community to life — drop an XML file and we&apos;ll handle the rest
        </p>
      </div>

      {/* File Drop Zone */}
      {status === "idle" && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`bg-white rounded-3xl border-2 border-dashed transition-all duration-300 cursor-pointer p-12 ${
            dragActive
              ? "border-bob-purple bg-bob-purple-light/30 scale-[1.01]"
              : "border-bob-border hover:border-bob-purple/40 hover:bg-gray-50"
          }`}
        >
          <div className="text-center">
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 transition-all duration-300 ${
              dragActive ? "bg-bob-purple-light scale-110" : "bg-bob-bg"
            }`}>
              <Upload className={`w-7 h-7 transition-colors duration-300 ${dragActive ? "text-bob-purple" : "text-bob-text-soft"}`} />
            </div>
            <p className="text-base font-semibold text-bob-text mb-1">
              {dragActive ? "Drop it like it's hot!" : "Drop your XML here"}
            </p>
            <p className="text-sm text-bob-text-soft">
              or click to browse — Employee Navigator format
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xml"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
      )}

      {/* Selected Files */}
      {files.length > 0 && status === "idle" && (
        <div className="mt-5 space-y-3 animate-fade-in-up">
          {files.map((file, i) => (
            <div
              key={i}
              className="bg-white rounded-2xl border border-bob-border px-5 py-4 flex items-center justify-between"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-bob-blue-light flex items-center justify-center">
                  <FileText className="w-5 h-5 text-bob-blue" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-bob-text">{file.name}</p>
                  <p className="text-xs text-bob-text-soft">{formatSize(file.size)}</p>
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                className="text-gray-300 hover:text-bob-coral transition-colors duration-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          ))}

          <button
            onClick={handleImport}
            className="w-full bg-gradient-to-r from-bob-purple to-bob-blue text-white py-3.5 px-4 rounded-2xl text-sm font-semibold hover:opacity-90 transition-opacity duration-200 shadow-sm"
          >
            Start Import
          </button>
        </div>
      )}

      {/* Progress Tracker */}
      {(isWorking || status === "done") && (
        <div className="bg-white rounded-3xl border border-bob-border p-8 mt-5 animate-fade-in">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-bob-blue-light flex items-center justify-center">
              <FileText className="w-5 h-5 text-bob-blue" />
            </div>
            <span className="text-sm font-semibold text-bob-text">{files[0]?.name}</span>
          </div>

          {/* Progress bar */}
          <div className="h-2.5 bg-bob-bg rounded-full overflow-hidden mb-8">
            <div
              className={`h-full rounded-full transition-all duration-700 ease-out ${
                status === "done"
                  ? "bg-gradient-to-r from-bob-green to-bob-teal"
                  : "bg-gradient-to-r from-bob-purple to-bob-blue"
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Steps */}
          <div className="flex justify-between">
            {STEPS.map((step, i) => {
              const isActive = step.key === status;
              const isComplete = i < currentStepIndex || status === "done";
              return (
                <div key={step.key} className="flex items-center gap-2">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-all duration-300 ${
                      isComplete
                        ? "bg-bob-green text-white"
                        : isActive
                        ? "bg-bob-purple text-white animate-pulse-dot"
                        : "bg-bob-bg text-gray-400"
                    }`}
                  >
                    {isComplete ? "✓" : i + 1}
                  </div>
                  <span
                    className={`text-xs font-medium ${
                      isActive ? "text-bob-text" : isComplete ? "text-bob-green" : "text-gray-400"
                    }`}
                  >
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Success Result */}
      {status === "done" && result && (
        <div className="mt-5 bg-gradient-to-br from-bob-green-light to-bob-teal-light rounded-3xl border border-bob-green/20 p-8 animate-celebrate">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-bob-green" />
            </div>
            <div>
              <span className="font-bold text-emerald-800">All done!</span>
              {result.detectedDate && (
                <p className="text-sm text-emerald-600">
                  Detected: {result.month ? `${MONTH_NAMES[result.month]} ${result.year}` : result.year}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Groups processed", value: result.clientsProcessed },
              { label: "New groups", value: result.clientsCreated },
              { label: "Updated", value: result.clientsUpdated },
              { label: "Benefit plans", value: result.benefitPlansCreated },
              { label: "People", value: result.employeesProcessed },
            ].map((stat) => (
              <div key={stat.label} className="bg-white/80 backdrop-blur-sm rounded-2xl px-4 py-3.5">
                <p className="text-xs font-medium text-emerald-600">{stat.label}</p>
                <p className="text-xl font-bold text-emerald-800">{stat.value.toLocaleString()}</p>
              </div>
            ))}
          </div>

          <button
            onClick={reset}
            className="mt-5 w-full bg-white text-bob-text py-3 px-4 rounded-2xl text-sm font-semibold hover:bg-gray-50 transition-colors duration-200 border border-bob-border"
          >
            Upload another file
          </button>
        </div>
      )}

      {/* Error */}
      {status === "error" && (
        <div className="mt-5 bg-bob-coral-light rounded-3xl border border-bob-coral/20 p-8 animate-fade-in">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center">
              <AlertCircle className="w-5 h-5 text-bob-coral" />
            </div>
            <span className="font-bold text-red-800">Something went wrong</span>
          </div>
          <p className="text-sm text-red-700 mb-5 ml-[52px]">{error}</p>
          <button
            onClick={reset}
            className="ml-[52px] bg-white border border-bob-border text-bob-text py-2.5 px-5 rounded-2xl text-sm font-semibold hover:bg-gray-50 transition-colors duration-200"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
