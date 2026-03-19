"use client";

import { useState } from "react";
import { Upload, CheckCircle, AlertCircle } from "lucide-react";

export default function ImportPage() {
  const [year, setYear] = useState<string>(String(new Date().getFullYear()));
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleImport() {
    if (!file || !year) return;
    setLoading(true);
    setResult(null);
    setError(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("year", year);

    try {
      const res = await fetch("/api/import", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Import failed");
      } else {
        setResult(data);
      }
    } catch {
      setError("Network error during import");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Import Annual XML</h1>
      <p className="text-sm text-gray-500 mb-6">
        Upload a complete annual XML snapshot. Each file represents one full year
        of client data. Clients are automatically deduplicated across years.
      </p>

      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Snapshot Year
          </label>
          <select
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {Array.from({ length: 5 }, (_, i) => 2022 + i).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            XML File
          </label>
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
            <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
            <input
              type="file"
              accept=".xml"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="text-sm"
            />
          </div>
        </div>

        <button
          onClick={handleImport}
          disabled={!file || loading}
          className="w-full bg-gray-900 text-white py-2 px-4 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Importing..." : "Import"}
        </button>
      </div>

      {result && (
        <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <span className="font-medium text-green-800">Import successful</span>
          </div>
          <dl className="text-sm text-green-700 space-y-1">
            <div className="flex justify-between">
              <dt>Year</dt>
              <dd>{String(result.year)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Clients processed</dt>
              <dd>{String(result.clientsProcessed)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>New clients created</dt>
              <dd>{String(result.clientsCreated)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Existing clients updated</dt>
              <dd>{String(result.clientsUpdated)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Benefit plans imported</dt>
              <dd>{String(result.benefitPlansCreated)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Employees imported</dt>
              <dd>{String(result.employeesProcessed)}</dd>
            </div>
          </dl>
        </div>
      )}

      {error && (
        <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-red-600" />
          <span className="text-sm text-red-800">{error}</span>
        </div>
      )}
    </div>
  );
}
