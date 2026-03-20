"use client";

import { useRef, useState } from "react";
import { Upload, CheckCircle, AlertCircle, FileText, X } from "lucide-react";

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
  { key: "reading", label: "Reading file" },
  { key: "uploading", label: "Uploading" },
  { key: "processing", label: "Processing data" },
  { key: "done", label: "Complete" },
] as const;

export default function ImportPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<ImportStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
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
      // Step 1: Read file
      await new Promise((r) => setTimeout(r, 200));
      setProgress(20);

      // Step 2: Upload
      setStatus("uploading");
      setProgress(30);

      const formData = new FormData();
      formData.append("file", files[0]);
      // Don't send year/month — let the server auto-detect from XML

      const res = await fetch("/api/import", { method: "POST", body: formData });
      setProgress(60);

      // Step 3: Processing
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
      <h1 className="text-2xl font-bold mb-1">Import XML Data</h1>
      <p className="text-sm text-gray-500 mb-8">
        Upload an Employee Navigator XML export. The date is automatically detected
        from the file. Clients are deduplicated across imports.
      </p>

      {/* File Drop Zone */}
      {status === "idle" && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className="bg-white rounded-xl border-2 border-dashed border-gray-300 hover:border-gray-400 hover:bg-gray-50 transition-colors cursor-pointer p-10"
        >
          <div className="text-center">
            <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Upload className="w-6 h-6 text-gray-500" />
            </div>
            <p className="text-sm font-medium text-gray-700 mb-1">
              Drop XML file here or click to browse
            </p>
            <p className="text-xs text-gray-400">
              Supports Employee Navigator Broker Data Exchange format
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
        <div className="mt-4 space-y-2">
          {files.map((file, i) => (
            <div
              key={i}
              className="bg-white rounded-lg border border-gray-200 px-4 py-3 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-blue-500" />
                <div>
                  <p className="text-sm font-medium text-gray-900">{file.name}</p>
                  <p className="text-xs text-gray-400">{formatSize(file.size)}</p>
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}

          <button
            onClick={handleImport}
            className="w-full bg-gray-900 text-white py-3 px-4 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors mt-4"
          >
            Import File
          </button>
        </div>
      )}

      {/* Progress Tracker */}
      {(isWorking || status === "done") && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mt-4">
          {/* File info */}
          <div className="flex items-center gap-3 mb-6">
            <FileText className="w-5 h-5 text-blue-500" />
            <span className="text-sm font-medium text-gray-700">{files[0]?.name}</span>
          </div>

          {/* Progress bar */}
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-6">
            <div
              className={`h-full rounded-full transition-all duration-500 ease-out ${
                status === "done" ? "bg-green-500" : "bg-blue-500"
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
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                      isComplete
                        ? "bg-green-500 text-white"
                        : isActive
                        ? "bg-blue-500 text-white"
                        : "bg-gray-100 text-gray-400"
                    }`}
                  >
                    {isComplete ? "✓" : i + 1}
                  </div>
                  <span
                    className={`text-xs ${
                      isActive ? "text-gray-900 font-medium" : isComplete ? "text-green-700" : "text-gray-400"
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
        <div className="mt-4 bg-green-50 border border-green-200 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <span className="font-semibold text-green-800">Import Complete</span>
          </div>

          {result.detectedDate && (
            <p className="text-sm text-green-700 mb-4">
              Detected date: <span className="font-medium">
                {result.month ? `${MONTH_NAMES[result.month]} ${result.year}` : result.year}
              </span>
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Clients processed", value: result.clientsProcessed },
              { label: "New clients", value: result.clientsCreated },
              { label: "Updated clients", value: result.clientsUpdated },
              { label: "Benefit plans", value: result.benefitPlansCreated },
              { label: "Employees", value: result.employeesProcessed },
            ].map((stat) => (
              <div key={stat.label} className="bg-white rounded-lg border border-green-200 px-4 py-3">
                <p className="text-xs text-green-600">{stat.label}</p>
                <p className="text-lg font-bold text-green-800">{stat.value.toLocaleString()}</p>
              </div>
            ))}
          </div>

          <button
            onClick={reset}
            className="mt-4 w-full bg-white border border-gray-300 text-gray-700 py-2.5 px-4 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Import Another File
          </button>
        </div>
      )}

      {/* Error */}
      {status === "error" && (
        <div className="mt-4 bg-red-50 border border-red-200 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="w-5 h-5 text-red-600" />
            <span className="font-medium text-red-800">Import Failed</span>
          </div>
          <p className="text-sm text-red-700 mb-4">{error}</p>
          <button
            onClick={reset}
            className="bg-white border border-gray-300 text-gray-700 py-2 px-4 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}
