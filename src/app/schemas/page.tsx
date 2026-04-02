"use client";

import { useEffect, useState, useRef } from "react";
import { Upload, CheckCircle, XCircle, Clock, ChevronRight, Plus, FileText } from "lucide-react";

interface SchemaVersion {
  id: string;
  name: string;
  version: string;
  status: string;
  notes: string | null;
  uploadedBy: string;
  createdAt: string;
  _count: { fields: number; mappings: number; testResults: number };
}

export default function SchemasPage() {
  const [versions, setVersions] = useState<SchemaVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ name: "", version: "1.0", notes: "", mode: "xsd" });

  const load = () => {
    setLoading(true);
    fetch("/api/schema/versions")
      .then(r => r.json())
      .then(setVersions)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  async function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) { setUploadError("Select a file"); return; }
    if (!form.name.trim()) { setUploadError("Name is required"); return; }

    setUploading(true);
    setUploadError(null);

    const fd = new FormData();
    fd.append("file", file);
    fd.append("name", form.name);
    fd.append("version", form.version);
    fd.append("notes", form.notes);
    fd.append("mode", form.mode);

    try {
      const res = await fetch("/api/schema/versions", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setShowUpload(false);
      setForm({ name: "", version: "1.0", notes: "", mode: "xsd" });
      load();
    } catch (e: unknown) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function toggleStatus(id: string, currentStatus: string) {
    const newStatus = currentStatus === "active" ? "inactive" : "active";
    await fetch(`/api/schema/versions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    load();
  }

  const statusBadge = (status: string) => {
    if (status === "active") return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-green-50 text-green-700"><CheckCircle className="w-3 h-3" /> Active</span>;
    if (status === "archived") return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-gray-100 text-gray-500"><XCircle className="w-3 h-3" /> Archived</span>;
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-yellow-50 text-yellow-700"><Clock className="w-3 h-3" /> Inactive</span>;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-bob-text">Schema Management</h1>
          <p className="text-bob-text-soft mt-1">Upload, version, and manage XML schema definitions and field mappings</p>
        </div>
        <button onClick={() => setShowUpload(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-bob-purple text-white text-sm font-medium rounded-2xl hover:bg-bob-purple/90 transition-colors">
          <Plus className="w-4 h-4" /> Upload Schema
        </button>
      </div>

      {/* Upload Form */}
      {showUpload && (
        <div className="bg-white rounded-2xl border border-bob-border p-6 mb-6">
          <h2 className="text-sm font-semibold text-bob-text mb-4">Upload New Schema</h2>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-xs font-semibold text-bob-text-soft uppercase block mb-1">Name</label>
              <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full border border-bob-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-bob-purple/20"
                placeholder="e.g. EN BDX Schema" />
            </div>
            <div>
              <label className="text-xs font-semibold text-bob-text-soft uppercase block mb-1">Version</label>
              <input type="text" value={form.version} onChange={e => setForm({ ...form, version: e.target.value })}
                className="w-full border border-bob-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-bob-purple/20"
                placeholder="e.g. 1.0" />
            </div>
          </div>
          <div className="mb-4">
            <label className="text-xs font-semibold text-bob-text-soft uppercase block mb-1">Mode</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" value="xsd" checked={form.mode === "xsd"} onChange={() => setForm({ ...form, mode: "xsd" })} />
                Parse XSD Schema
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" value="infer" checked={form.mode === "infer"} onChange={() => setForm({ ...form, mode: "infer" })} />
                Infer from Sample XML
              </label>
            </div>
          </div>
          <div className="mb-4">
            <label className="text-xs font-semibold text-bob-text-soft uppercase block mb-1">File</label>
            <input ref={fileRef} type="file" accept=".xsd,.xml" className="text-sm" />
          </div>
          <div className="mb-4">
            <label className="text-xs font-semibold text-bob-text-soft uppercase block mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
              className="w-full border border-bob-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-bob-purple/20"
              rows={2} placeholder="Why was this version added?" />
          </div>
          {uploadError && <p className="text-red-500 text-xs mb-3">{uploadError}</p>}
          <div className="flex gap-2">
            <button onClick={handleUpload} disabled={uploading}
              className="px-4 py-2 bg-bob-purple text-white text-sm font-medium rounded-xl hover:bg-bob-purple/90 disabled:opacity-50 transition-colors">
              {uploading ? "Uploading..." : "Upload & Parse"}
            </button>
            <button onClick={() => { setShowUpload(false); setUploadError(null); }}
              className="px-4 py-2 text-sm text-bob-text-soft hover:text-bob-text transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Schema Versions List */}
      {loading ? (
        <div className="text-center py-16 text-bob-text-soft">
          <div className="w-8 h-8 border-2 border-bob-purple border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          Loading schemas...
        </div>
      ) : versions.length === 0 ? (
        <div className="text-center py-16">
          <Upload className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-bob-text font-semibold mb-2">No schemas uploaded</p>
          <p className="text-bob-text-soft text-sm">Upload an XSD file or infer schema from a sample XML</p>
        </div>
      ) : (
        <div className="space-y-3">
          {versions.map(v => (
            <div key={v.id} className="bg-white rounded-2xl border border-bob-border p-5 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-bob-purple-light flex items-center justify-center">
                    <FileText className="w-5 h-5 text-bob-purple" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-bob-text">{v.name}</span>
                      <span className="text-xs text-bob-text-soft">v{v.version}</span>
                      {statusBadge(v.status)}
                    </div>
                    <div className="text-xs text-bob-text-soft mt-0.5">
                      {v._count.fields} fields &middot; {v._count.mappings} mappings &middot; {v._count.testResults} tests
                      &middot; Uploaded {new Date(v.createdAt).toLocaleDateString()}
                    </div>
                    {v.notes && <p className="text-xs text-bob-text-soft mt-1 italic">{v.notes}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => toggleStatus(v.id, v.status)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                      v.status === "active"
                        ? "bg-green-50 text-green-700 hover:bg-green-100"
                        : "bg-gray-50 text-gray-600 hover:bg-gray-100"
                    }`}>
                    {v.status === "active" ? "Deactivate" : "Activate"}
                  </button>
                  <a href={`/schemas/${v.id}`} className="p-2 hover:bg-gray-50 rounded-lg transition-colors">
                    <ChevronRight className="w-4 h-4 text-gray-400" />
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
