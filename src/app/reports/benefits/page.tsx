"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  ArrowLeft, Search, Download, Printer, ArrowUpDown, ArrowUp, ArrowDown,
  CheckCircle, ChevronDown, ChevronRight, Info, X,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CarrierRow {
  carrier: string;
  groups: number;
  eligible: number;
  enrolled: number;
  monthlyPremium: number;
}

interface Totals {
  groups: number;
  eligible: number;
  enrolled: number;
  monthlyPremium: number;
}

interface CarrierAuditRow {
  carrier: string;
  eligible: number;
  enrolled: number;
  enrollmentRows: number;
  monthlyPremium: number;
}

interface CompanyEligibilityRow {
  carrier: string;
  companyId: string;
  companyName: string;
  activeEmployees: number;
  hasCarrierPlan: boolean;
  eligibleContributed: number;
}

interface CompanyEnrollmentRow {
  carrier: string;
  companyId: string;
  companyName: string;
  enrolled: number;
  enrollmentRows: number;
  premium: number;
}

interface Exceptions {
  missingPlanIdentifier: number;
  unmatchedPlanIdentifier: number;
  fallbackPlanNameMatch: number;
  currentEnrollmentsWithEndDate: number;
  blankOrInvalidPlanCost: number;
}

interface Reconciliation {
  totalActiveEmployees: number;
  totalCompanies: number;
  totalPlansInMap: number;
  carrierAudit: CarrierAuditRow[];
  companyEligibility: CompanyEligibilityRow[];
  companyEnrollment: CompanyEnrollmentRow[];
  exceptions: Exceptions;
}

interface ModalData {
  title: string;
  columns: string[];
  rows: (string | number)[][];
}

type SortKey = keyof CarrierRow;
type SortDir = "asc" | "desc";
type DetailType = "groups" | "eligible" | "enrolled" | "premium";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(val: number): string {
  return "$" + val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function toCSV(rows: CarrierRow[], totals: Totals): string {
  const header = "Carrier,# Groups,Eligible Employees,Enrolled Employees,Monthly Premium";
  const lines = rows.map(
    (r) => `"${r.carrier}",${r.groups},${r.eligible},${r.enrolled},${r.monthlyPremium.toFixed(2)}`
  );
  lines.push(`"-- Total --",${totals.groups},${totals.eligible},${totals.enrolled},${totals.monthlyPremium.toFixed(2)}`);
  return [header, ...lines].join("\n");
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toExcelXML(rows: CarrierRow[], totals: Totals): string {
  const escXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const headers = ["Carrier", "# Groups", "Eligible Employees", "Enrolled Employees", "Monthly Premium"];

  let xml = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles>
 <Style ss:ID="Bold"><Font ss:Bold="1"/></Style>
 <Style ss:ID="Currency"><NumberFormat ss:Format="$#,##0.00"/></Style>
 <Style ss:ID="BoldCurrency"><Font ss:Bold="1"/><NumberFormat ss:Format="$#,##0.00"/></Style>
</Styles>
<Worksheet ss:Name="Benefits Report">
<Table>`;
  xml += "<Row>";
  headers.forEach((h) => { xml += `<Cell ss:StyleID="Bold"><Data ss:Type="String">${escXml(h)}</Data></Cell>`; });
  xml += "</Row>";
  for (const r of rows) {
    xml += "<Row>";
    xml += `<Cell><Data ss:Type="String">${escXml(r.carrier)}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="Number">${r.groups}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="Number">${r.eligible}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="Number">${r.enrolled}</Data></Cell>`;
    xml += `<Cell ss:StyleID="Currency"><Data ss:Type="Number">${r.monthlyPremium}</Data></Cell>`;
    xml += "</Row>";
  }
  xml += "<Row>";
  xml += `<Cell ss:StyleID="Bold"><Data ss:Type="String">-- Total --</Data></Cell>`;
  xml += `<Cell ss:StyleID="Bold"><Data ss:Type="Number">${totals.groups}</Data></Cell>`;
  xml += `<Cell ss:StyleID="Bold"><Data ss:Type="Number">${totals.eligible}</Data></Cell>`;
  xml += `<Cell ss:StyleID="Bold"><Data ss:Type="Number">${totals.enrolled}</Data></Cell>`;
  xml += `<Cell ss:StyleID="BoldCurrency"><Data ss:Type="Number">${totals.monthlyPremium}</Data></Cell>`;
  xml += "</Row>";
  xml += "</Table></Worksheet></Workbook>";
  return xml;
}

function modalDataToCSV(data: ModalData): string {
  const header = data.columns.map((c) => `"${c}"`).join(",");
  const lines = data.rows.map((row) =>
    row.map((cell) => typeof cell === "string" ? `"${cell.replace(/"/g, '""')}"` : cell).join(",")
  );
  return [header, ...lines].join("\n");
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────

function DetailModal({
  data,
  loading,
  onClose,
}: {
  data: ModalData | null;
  loading: boolean;
  onClose: () => void;
}) {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  function handleExportCSV() {
    if (!data) return;
    const csv = modalDataToCSV(data);
    const safeName = data.title.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "_").substring(0, 50);
    downloadFile(csv, `${safeName}.csv`, "text/csv");
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-12 px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={modalRef}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[80vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-bob-text truncate">
            {loading ? "Loading..." : data?.title || "Detail"}
          </h3>
          <div className="flex items-center gap-2">
            {data && !loading && (
              <button
                onClick={handleExportCSV}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-bob-border rounded-lg hover:border-bob-purple/30 hover:text-bob-purple transition-colors"
              >
                <Download className="w-3.5 h-3.5" /> Export CSV
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-bob-purple border-t-transparent rounded-full animate-spin" />
            </div>
          ) : data ? (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  {data.columns.map((col, i) => (
                    <th key={i} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.rows.map((row, ri) => (
                  <tr key={ri} className="hover:bg-gray-50">
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-4 py-2 text-sm text-gray-700 whitespace-nowrap">
                        {typeof cell === "number" ? cell.toLocaleString() : cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-center py-16 text-gray-400">No data</div>
          )}
        </div>

        {/* Footer */}
        {data && !loading && (
          <div className="px-6 py-3 border-t border-gray-200 text-xs text-gray-500">
            {data.rows.length.toLocaleString()} rows
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Clickable Cell ───────────────────────────────────────────────────────────

function ClickableCell({
  value,
  carrier,
  type,
  onClick,
  isCurrency,
  className,
}: {
  value: string | number;
  carrier: string;
  type: DetailType;
  onClick: (carrier: string, type: DetailType) => void;
  isCurrency?: boolean;
  className?: string;
}) {
  const display = isCurrency
    ? formatCurrency(value as number)
    : typeof value === "number"
      ? value.toLocaleString()
      : value;

  return (
    <td className={`px-6 py-4 ${className || ""}`}>
      <button
        onClick={() => onClick(carrier, type)}
        className="text-bob-text hover:text-bob-purple hover:underline transition-colors cursor-pointer"
      >
        {display}
      </button>
    </td>
  );
}

// ─── Collapsible Section ──────────────────────────────────────────────────────

function Section({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div className="border border-bob-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-gray-50 hover:bg-gray-100 text-left text-sm font-semibold text-bob-text transition-colors"
      >
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        {title}
      </button>
      {open && <div className="p-4 bg-white">{children}</div>}
    </div>
  );
}

// ─── Mini Table ───────────────────────────────────────────────────────────────

function MiniTable({ headers, rows }: { headers: { label: string; align?: string }[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="border-b border-gray-200">
            {headers.map((h, i) => (
              <th key={i} className={`px-3 py-2 font-semibold text-gray-500 ${h.align === "right" ? "text-right" : "text-left"}`}>
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row, ri) => (
            <tr key={ri} className="hover:bg-gray-50">
              {row.map((cell, ci) => (
                <td key={ci} className={`px-3 py-1.5 ${headers[ci]?.align === "right" ? "text-right" : "text-left"}`}>
                  {typeof cell === "number" ? cell.toLocaleString() : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BenefitsReportPage() {
  const [rows, setRows] = useState<CarrierRow[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [lastUpload, setLastUpload] = useState<string | null>(null);
  const [dataPeriod, setDataPeriod] = useState<string | null>(null);
  const [reconciliation, setReconciliation] = useState<Reconciliation | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("monthlyPremium");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const tableRef = useRef<HTMLDivElement>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalData, setModalData] = useState<ModalData | null>(null);

  useEffect(() => {
    fetch("/api/reports/benefits")
      .then((res) => res.json())
      .then((data) => {
        setRows(data.rows || []);
        setTotals(data.totals || null);
        setLastUpload(data.lastUpload || null);
        setDataPeriod(data.dataPeriod || null);
        setReconciliation(data.reconciliation || null);
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = rows.filter(
    (r) => !search || r.carrier.toLowerCase().includes(search.toLowerCase())
  );

  const sorted = [...filtered].sort((a, b) => {
    const aVal = a[sortKey];
    const bVal = b[sortKey];
    if (typeof aVal === "string" && typeof bVal === "string") {
      return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    const diff = (aVal as number) - (bVal as number);
    return sortDir === "asc" ? diff : -diff;
  });

  const isFiltered = search.length > 0;
  const displayTotals = isFiltered
    ? filtered.reduce(
        (acc, r) => ({
          groups: acc.groups + r.groups,
          eligible: acc.eligible + r.eligible,
          enrolled: acc.enrolled + r.enrolled,
          monthlyPremium: acc.monthlyPremium + r.monthlyPremium,
        }),
        { groups: 0, eligible: 0, enrolled: 0, monthlyPremium: 0 }
      )
    : totals || { groups: 0, eligible: 0, enrolled: 0, monthlyPremium: 0 };

  // Open detail modal for any cell
  const openDetail = useCallback(async (carrier: string, type: DetailType) => {
    setModalOpen(true);
    setModalLoading(true);
    setModalData(null);
    try {
      const res = await fetch(
        `/api/reports/benefits/detail?carrier=${encodeURIComponent(carrier)}&type=${type}`
      );
      const data = await res.json();
      setModalData(data);
    } catch (err) {
      console.error("Detail fetch error:", err);
      setModalData({ title: "Error loading detail", columns: [], rows: [] });
    } finally {
      setModalLoading(false);
    }
  }, []);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setModalData(null);
  }, []);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "carrier" ? "asc" : "desc");
    }
  }

  function SortIcon({ column }: { column: SortKey }) {
    if (sortKey !== column) return <ArrowUpDown className="w-3.5 h-3.5 text-gray-400 ml-1 inline" />;
    return sortDir === "asc"
      ? <ArrowUp className="w-3.5 h-3.5 text-bob-purple ml-1 inline" />
      : <ArrowDown className="w-3.5 h-3.5 text-bob-purple ml-1 inline" />;
  }

  function handleCSV() {
    downloadFile(toCSV(sorted, displayTotals), "benefits-report.csv", "text/csv");
  }

  function handleExcel() {
    downloadFile(toExcelXML(sorted, displayTotals), "benefits-report.xls", "application/vnd.ms-excel");
  }

  function handlePrint() {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    const tableHTML = tableRef.current?.querySelector("table")?.outerHTML || "";
    printWindow.document.write(`<!DOCTYPE html><html><head><title>Benefits Report</title>
<style>
  body { font-family: Inter, Arial, sans-serif; margin: 20px; }
  h1 { font-size: 18px; margin-bottom: 16px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
  th { background: #f5f5f5; font-weight: 600; }
  tr:last-child { font-weight: bold; }
  .text-right { text-align: right; }
</style></head><body>
<h1>Benefits Report — ${dataPeriod || ""}</h1>
${tableHTML}
</body></html>`);
    printWindow.document.close();
    printWindow.print();
  }

  return (
    <div>
      {/* Detail Modal */}
      {modalOpen && (
        <DetailModal data={modalData} loading={modalLoading} onClose={closeModal} />
      )}

      <a href="/reports" className="inline-flex items-center gap-1.5 text-sm text-bob-text-soft hover:text-bob-purple transition-colors duration-200 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to Insights
      </a>

      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-bob-text">Benefits Report</h1>
        <p className="text-bob-text-soft mt-1">
          Carrier-level summary — auto-validated against latest XML upload
        </p>
      </div>

      {/* Data period banner */}
      {dataPeriod && (
        <div className="flex items-center gap-3 bg-bob-green-light/50 border border-bob-green/20 rounded-2xl px-5 py-3.5 mb-4">
          <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center flex-shrink-0">
            <CheckCircle className="w-4 h-4 text-bob-green" />
          </div>
          <div className="text-sm text-emerald-800">
            <span className="font-semibold">Data period: {dataPeriod}</span>
            {reconciliation && (
              <span className="ml-2">
                — {reconciliation.totalActiveEmployees.toLocaleString()} active employees across {reconciliation.totalCompanies.toLocaleString()} companies.
                Premium from PlanCost. Exclusion rules applied.
              </span>
            )}
          </div>
        </div>
      )}

      {/* Export buttons + search */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex gap-2">
          {[
            { label: "CSV", icon: <Download className="w-4 h-4" />, action: handleCSV },
            { label: "Excel", icon: <Download className="w-4 h-4" />, action: handleExcel },
            { label: "Print", icon: <Printer className="w-4 h-4" />, action: handlePrint },
          ].map((btn) => (
            <button
              key={btn.label}
              onClick={btn.action}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-bob-border text-bob-text text-sm font-medium rounded-2xl hover:border-bob-purple/30 hover:text-bob-purple transition-all duration-200"
            >
              {btn.icon} {btn.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-bob-text-soft" />
          <input
            type="text"
            placeholder="Search carriers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-11 pr-4 py-2.5 bg-white border border-bob-border rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-bob-purple/30 focus:border-bob-purple transition-all duration-200 w-64 placeholder:text-gray-400"
          />
        </div>
      </div>

      {/* Main Table */}
      {loading ? (
        <div className="text-center py-16 text-bob-text-soft">
          <div className="w-8 h-8 border-2 border-bob-purple border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          Loading report...
        </div>
      ) : (
        <>
          <div ref={tableRef} className="bg-white rounded-2xl border border-bob-border overflow-hidden mb-8">
            <table className="w-full text-sm">
              <thead className="bg-bob-bg border-b border-bob-border">
                <tr>
                  {([
                    { key: "carrier" as SortKey, label: "Carrier", align: "text-left" },
                    { key: "groups" as SortKey, label: "# Groups", align: "text-right" },
                    { key: "eligible" as SortKey, label: "Eligible Employees", align: "text-right" },
                    { key: "enrolled" as SortKey, label: "Enrolled Employees", align: "text-right" },
                    { key: "monthlyPremium" as SortKey, label: "Monthly Premium", align: "text-right" },
                  ]).map((col) => (
                    <th
                      key={col.key}
                      className={`${col.align} px-6 py-4 font-semibold text-bob-text-soft cursor-pointer hover:text-bob-text select-none transition-colors duration-200`}
                      onClick={() => handleSort(col.key)}
                    >
                      {col.label} <SortIcon column={col.key} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-bob-border-light">
                {sorted.map((row) => (
                  <tr key={row.carrier} className="hover:bg-bob-bg/50 transition-colors duration-150">
                    {/* Carrier name */}
                    <td className="px-6 py-4 font-semibold">
                      <button
                        onClick={() => openDetail(row.carrier, "enrolled")}
                        className="text-bob-purple hover:underline hover:text-bob-purple/80 transition-colors cursor-pointer"
                      >
                        {row.carrier}
                      </button>
                    </td>
                    {/* # Groups */}
                    <ClickableCell value={row.groups} carrier={row.carrier} type="groups" onClick={openDetail} className="text-right font-medium" />
                    {/* Eligible */}
                    <ClickableCell value={row.eligible} carrier={row.carrier} type="eligible" onClick={openDetail} className="text-right font-medium" />
                    {/* Enrolled */}
                    <ClickableCell value={row.enrolled} carrier={row.carrier} type="enrolled" onClick={openDetail} className="text-right font-medium" />
                    {/* Monthly Premium */}
                    <ClickableCell value={row.monthlyPremium} carrier={row.carrier} type="premium" onClick={openDetail} isCurrency className="text-right font-semibold" />
                  </tr>
                ))}
                {/* Totals row — also clickable */}
                <tr className="bg-bob-bg font-bold">
                  <td className="px-6 py-4 text-bob-text">Total</td>
                  <ClickableCell value={displayTotals.groups} carrier="__all__" type="groups" onClick={openDetail} className="text-right" />
                  <ClickableCell value={displayTotals.eligible} carrier="__all__" type="eligible" onClick={openDetail} className="text-right" />
                  <ClickableCell value={displayTotals.enrolled} carrier="__all__" type="enrolled" onClick={openDetail} className="text-right" />
                  <ClickableCell value={displayTotals.monthlyPremium} carrier="__all__" type="premium" onClick={openDetail} isCurrency className="text-right" />
                </tr>
              </tbody>
            </table>
          </div>

          {/* ── Reconciliation / Audit Section ── */}
          {reconciliation && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 mb-2">
                <Info className="w-4 h-4 text-bob-text-soft" />
                <h2 className="text-lg font-semibold text-bob-text">Reconciliation & Audit</h2>
              </div>

              <Section title="A. Data Summary" defaultOpen>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-xs text-gray-500 uppercase tracking-wide">Active Employees</div>
                    <div className="text-xl font-bold mt-1">{reconciliation.totalActiveEmployees.toLocaleString()}</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-xs text-gray-500 uppercase tracking-wide">Companies</div>
                    <div className="text-xl font-bold mt-1">{reconciliation.totalCompanies.toLocaleString()}</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-xs text-gray-500 uppercase tracking-wide">Plans Mapped</div>
                    <div className="text-xl font-bold mt-1">{reconciliation.totalPlansInMap.toLocaleString()}</div>
                  </div>
                </div>
              </Section>

              <Section title="B. Carrier Audit (with enrollment row counts)">
                <MiniTable
                  headers={[
                    { label: "Carrier" },
                    { label: "Eligible", align: "right" },
                    { label: "Enrolled", align: "right" },
                    { label: "Enrollment Rows", align: "right" },
                    { label: "Monthly Premium", align: "right" },
                  ]}
                  rows={reconciliation.carrierAudit.map((r) => [
                    r.carrier, r.eligible, r.enrolled, r.enrollmentRows, formatCurrency(r.monthlyPremium),
                  ])}
                />
              </Section>

              <Section title="C. Company-Level Eligibility by Carrier">
                <p className="text-xs text-gray-500 mb-2">
                  Shows which companies contribute eligible employees to each carrier.
                  If counts are higher than a broker report, specific companies may be excluded from the carrier&apos;s billing.
                </p>
                <MiniTable
                  headers={[
                    { label: "Carrier" },
                    { label: "Company" },
                    { label: "Active Emps", align: "right" },
                    { label: "Has Plan?", align: "right" },
                    { label: "Eligible Contrib.", align: "right" },
                  ]}
                  rows={reconciliation.companyEligibility.map((r) => [
                    r.carrier, r.companyName, r.activeEmployees, r.hasCarrierPlan ? "Yes" : "No", r.eligibleContributed,
                  ])}
                />
              </Section>

              <Section title="D. Company-Level Enrollment by Carrier">
                <MiniTable
                  headers={[
                    { label: "Carrier" },
                    { label: "Company" },
                    { label: "Enrolled", align: "right" },
                    { label: "Enroll Rows", align: "right" },
                    { label: "Premium", align: "right" },
                  ]}
                  rows={reconciliation.companyEnrollment.map((r) => [
                    r.carrier, r.companyName, r.enrolled, r.enrollmentRows, formatCurrency(r.premium),
                  ])}
                />
              </Section>

              <Section title="E. Exception / Audit Counts" defaultOpen>
                <div className="space-y-2 text-sm">
                  <ExceptionRow label="Enrollments missing PlanIdentifier" value={reconciliation.exceptions.missingPlanIdentifier} />
                  <ExceptionRow label="Enrollments with unmatched PlanIdentifier" value={reconciliation.exceptions.unmatchedPlanIdentifier} warn />
                  <ExceptionRow label="Enrollments matched by fallback plan name" value={reconciliation.exceptions.fallbackPlanNameMatch} warn />
                  <ExceptionRow label="Current enrollments with EndDate populated" value={reconciliation.exceptions.currentEnrollmentsWithEndDate} />
                  <ExceptionRow label="Premium rows with blank/invalid PlanCost (treated as $0)" value={reconciliation.exceptions.blankOrInvalidPlanCost} warn />
                </div>
              </Section>

              <Section title="F. Reconciliation Note">
                <p className="text-sm text-gray-600 leading-relaxed">
                  If eligible counts appear materially higher than an external broker report,
                  the likely cause is <strong>carrier-specific company exclusions</strong>, billing filters,
                  or plan-availability rules that are <strong>not encoded in the Employee Navigator XML</strong>.
                  Use sections C and D above to identify which companies/carriers may be contributing to the delta.
                </p>
              </Section>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ExceptionRow({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  const isNonZero = value > 0;
  return (
    <div className="flex items-center justify-between py-1 px-3 rounded-lg bg-gray-50">
      <span className="text-gray-600">{label}</span>
      <span className={`font-mono font-semibold ${isNonZero && warn ? "text-amber-600" : isNonZero ? "text-gray-700" : "text-gray-400"}`}>
        {value.toLocaleString()}
      </span>
    </div>
  );
}
