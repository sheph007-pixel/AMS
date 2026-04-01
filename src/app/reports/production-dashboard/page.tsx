"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import {
  ArrowLeft, Download, Search, ArrowUpDown, ArrowUp, ArrowDown,
  Settings2, Save, Plus, Trash2, X, ChevronDown,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Row {
  month: string;
  year: number;
  monthNum: number;
  clientName: string;
  clientCode: string;
  carrier: string;
  policyNumber: string;
  planName: string;
  grouping: string;
  rate: number;
  lives: number;
  benefitAmount: number;
  monthlyPremium: number;
  incomeMethod: string;
  feeRate: number;
  feeRateDisplay: string;
  income: number;
  coverageType: string;
  transactionDate: string;
  lineOfBusiness: string;
  sourceMonth: string;
}

interface Summary {
  totalRows: number;
  totalPremium: number;
  totalIncome: number;
  totalLives: number;
  totalClients: number;
  totalCarriers: number;
  periods: number;
}

interface Filters {
  carriers: string[];
  clients: string[];
  coverageTypes: string[];
  periods: string[];
  fiscalYears: number[];
  policyNumbers: string[];
}

interface CarrierSetting {
  id: string;
  carrierName: string;
  incomeMethod: string;
  rate: number;
}

type SortKey = keyof Pick<Row,
  "month" | "clientName" | "carrier" | "policyNumber" | "planName" |
  "grouping" | "rate" | "lives" | "benefitAmount" | "monthlyPremium" |
  "incomeMethod" | "feeRate" | "income" | "coverageType"
>;

type SortDir = "asc" | "desc";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtCurrency(val: number): string {
  return "$" + val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtMonth(period: string): string {
  const [y, m] = period.split("-");
  return `${MONTH_NAMES[parseInt(m)]} ${y}`;
}

function fmtRate(val: number): string {
  if (!val) return "";
  return val.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
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

function escCsv(s: string | number): string {
  const str = String(s);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ─── Export ───────────────────────────────────────────────────────────────────

const EXPORT_HEADERS = [
  "Transaction Date", "Month", "Client Name", "Client Code", "Insurance Carrier",
  "Policy Number", "Plan Name", "Grouping", "Rate", "Lives", "Benefit Amount",
  "Monthly Premium", "Income Method", "Configured Rate", "Income",
  "Coverage Type", "Line of Business", "Source Month",
];

function rowsToCSV(rows: Row[]): string {
  const header = EXPORT_HEADERS.map(h => escCsv(h)).join(",");
  const lines = rows.map(r => [
    r.transactionDate, r.month, escCsv(r.clientName), escCsv(r.clientCode),
    escCsv(r.carrier), escCsv(r.policyNumber), escCsv(r.planName),
    escCsv(r.grouping), r.rate.toFixed(3), r.lives, r.benefitAmount.toFixed(2),
    r.monthlyPremium.toFixed(2), r.incomeMethod, r.feeRate, r.income.toFixed(2),
    escCsv(r.coverageType), escCsv(r.lineOfBusiness), r.sourceMonth,
  ].join(","));
  return [header, ...lines].join("\n");
}

function rowsToExcelXML(rows: Row[]): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let xml = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles>
 <Style ss:ID="B"><Font ss:Bold="1"/></Style>
 <Style ss:ID="C"><NumberFormat ss:Format="$#,##0.00"/></Style>
 <Style ss:ID="R"><NumberFormat ss:Format="#,##0.000"/></Style>
</Styles>
<Worksheet ss:Name="Production Detail">
<Table>`;
  xml += "<Row>";
  EXPORT_HEADERS.forEach(h => { xml += `<Cell ss:StyleID="B"><Data ss:Type="String">${esc(h)}</Data></Cell>`; });
  xml += "</Row>";
  for (const r of rows) {
    xml += "<Row>";
    xml += `<Cell><Data ss:Type="String">${esc(r.transactionDate)}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${esc(r.month)}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${esc(r.clientName)}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${esc(r.clientCode)}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${esc(r.carrier)}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${esc(r.policyNumber)}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${esc(r.planName)}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${esc(r.grouping)}</Data></Cell>`;
    xml += `<Cell ss:StyleID="R"><Data ss:Type="Number">${r.rate}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="Number">${r.lives}</Data></Cell>`;
    xml += `<Cell ss:StyleID="C"><Data ss:Type="Number">${r.benefitAmount}</Data></Cell>`;
    xml += `<Cell ss:StyleID="C"><Data ss:Type="Number">${r.monthlyPremium}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${esc(r.incomeMethod)}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="Number">${r.feeRate}</Data></Cell>`;
    xml += `<Cell ss:StyleID="C"><Data ss:Type="Number">${r.income}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${esc(r.coverageType)}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${esc(r.lineOfBusiness)}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${esc(r.sourceMonth)}</Data></Cell>`;
    xml += "</Row>";
  }
  xml += "</Table></Worksheet></Workbook>";
  return xml;
}

// ─── Filter Dropdown ─────────────────────────────────────────────────────────

function FilterDropdown({
  label, value, options, onChange, allLabel = "All",
}: {
  label: string; value: string; options: string[]; onChange: (v: string) => void; allLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-semibold text-bob-text-soft uppercase tracking-wider">{label}</label>
      <div className="relative">
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="appearance-none w-full bg-white border border-bob-border rounded-xl px-3 py-2 pr-8 text-sm text-bob-text cursor-pointer hover:border-bob-purple/30 transition-colors focus:outline-none focus:ring-2 focus:ring-bob-purple/20 focus:border-bob-purple/40"
        >
          <option value="">{allLabel}</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
      </div>
    </div>
  );
}

// ─── Carrier Settings Panel ──────────────────────────────────────────────────

function CarrierSettingsPanel({
  settings, onSave, onDelete,
}: {
  settings: CarrierSetting[];
  onSave: (s: { carrierName: string; incomeMethod: string; rate: number }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [editRow, setEditRow] = useState<{ carrierName: string; incomeMethod: string; rate: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!editRow?.carrierName) return;
    setSaving(true);
    await onSave({
      carrierName: editRow.carrierName,
      incomeMethod: editRow.incomeMethod,
      rate: parseFloat(editRow.rate) || 0,
    });
    setEditRow(null);
    setSaving(false);
  }

  return (
    <div className="bg-white rounded-2xl border border-bob-border overflow-hidden mb-6">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-bob-text-soft" />
          <span className="text-sm font-semibold text-bob-text">Carrier Settings</span>
          <span className="text-xs text-bob-text-soft">({settings.length} configured)</span>
        </div>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-bob-border px-5 py-4">
          <p className="text-xs text-bob-text-soft mb-4">
            Each carrier uses one income method: PEPM ($ per employee per month), PERCENT_PREMIUM (% of premium), or NONE.
          </p>
          <table className="w-full text-sm mb-4">
            <thead>
              <tr className="border-b border-bob-border">
                <th className="text-left py-2 px-2 text-xs font-semibold text-bob-text-soft">Carrier</th>
                <th className="text-left py-2 px-2 text-xs font-semibold text-bob-text-soft">Method</th>
                <th className="text-left py-2 px-2 text-xs font-semibold text-bob-text-soft">Rate</th>
                <th className="text-right py-2 px-2 text-xs font-semibold text-bob-text-soft w-20">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bob-border-light">
              {settings.map(s => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="py-2 px-2 font-medium text-bob-text">{s.carrierName}</td>
                  <td className="py-2 px-2">
                    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${
                      s.incomeMethod === "PEPM" ? "bg-blue-50 text-blue-700" :
                      s.incomeMethod === "PERCENT_PREMIUM" ? "bg-purple-50 text-purple-700" :
                      "bg-gray-100 text-gray-500"
                    }`}>{s.incomeMethod}</span>
                  </td>
                  <td className="py-2 px-2 text-bob-text">
                    {s.incomeMethod === "PEPM" ? `$${s.rate}` :
                     s.incomeMethod === "PERCENT_PREMIUM" ? `${s.rate}%` : "\u2014"}
                  </td>
                  <td className="py-2 px-2 text-right">
                    <button onClick={() => setEditRow({ carrierName: s.carrierName, incomeMethod: s.incomeMethod, rate: String(s.rate) })}
                      className="text-xs text-bob-purple hover:underline mr-2">Edit</button>
                    <button onClick={() => onDelete(s.id)} className="text-xs text-red-400 hover:text-red-600">
                      <Trash2 className="w-3.5 h-3.5 inline" />
                    </button>
                  </td>
                </tr>
              ))}
              {settings.length === 0 && (
                <tr><td colSpan={4} className="py-4 text-center text-bob-text-soft text-xs">No carrier settings configured</td></tr>
              )}
            </tbody>
          </table>

          {editRow ? (
            <div className="flex items-end gap-3 bg-gray-50 rounded-xl p-3">
              <div className="flex-1">
                <label className="text-[10px] font-semibold text-bob-text-soft uppercase">Carrier</label>
                <input type="text" value={editRow.carrierName}
                  onChange={e => setEditRow({ ...editRow, carrierName: e.target.value })}
                  className="w-full border border-bob-border rounded-lg px-3 py-1.5 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-bob-purple/20"
                  placeholder="e.g. Guardian" />
              </div>
              <div className="w-48">
                <label className="text-[10px] font-semibold text-bob-text-soft uppercase">Method</label>
                <select value={editRow.incomeMethod}
                  onChange={e => setEditRow({ ...editRow, incomeMethod: e.target.value })}
                  className="w-full border border-bob-border rounded-lg px-3 py-1.5 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-bob-purple/20">
                  <option value="PEPM">PEPM</option>
                  <option value="PERCENT_PREMIUM">PERCENT_PREMIUM</option>
                  <option value="NONE">NONE</option>
                </select>
              </div>
              <div className="w-28">
                <label className="text-[10px] font-semibold text-bob-text-soft uppercase">Rate</label>
                <input type="number" step="0.01" value={editRow.rate}
                  onChange={e => setEditRow({ ...editRow, rate: e.target.value })}
                  className="w-full border border-bob-border rounded-lg px-3 py-1.5 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-bob-purple/20"
                  placeholder="e.g. 20" />
              </div>
              <button onClick={handleSave} disabled={saving || !editRow.carrierName}
                className="px-4 py-1.5 bg-bob-purple text-white text-sm font-medium rounded-lg hover:bg-bob-purple/90 disabled:opacity-50 transition-colors flex items-center gap-1.5">
                <Save className="w-3.5 h-3.5" /> {saving ? "..." : "Save"}
              </button>
              <button onClick={() => setEditRow(null)} className="p-1.5 text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button onClick={() => setEditRow({ carrierName: "", incomeMethod: "PEPM", rate: "0" })}
              className="inline-flex items-center gap-1.5 text-xs text-bob-purple font-medium hover:underline">
              <Plus className="w-3.5 h-3.5" /> Add Carrier Setting
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 100;

export default function ProductionDashboardPage() {
  const [allRows, setAllRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filterOptions, setFilterOptions] = useState<Filters | null>(null);
  const [carrierSettings, setCarrierSettings] = useState<CarrierSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [filterMonth, setFilterMonth] = useState("");
  const [filterYear, setFilterYear] = useState("");
  const [filterClient, setFilterClient] = useState("");
  const [filterCarrier, setFilterCarrier] = useState("");
  const [filterPolicy, setFilterPolicy] = useState("");
  const [filterCoverage, setFilterCoverage] = useState("");

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>("month");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Pagination
  const [page, setPage] = useState(0);
  const tableRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch("/api/reports/production-dashboard")
      .then(res => { if (!res.ok) throw new Error(`Server error (${res.status})`); return res.json(); })
      .then(data => {
        setAllRows(data.rows || []);
        setSummary(data.summary || null);
        setFilterOptions(data.filters || null);
        setCarrierSettings(data.carrierSettings || []);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Filtering
  const filtered = useMemo(() => {
    let result = allRows;
    if (filterMonth) result = result.filter(r => r.month === filterMonth);
    if (filterYear) result = result.filter(r => r.year === parseInt(filterYear));
    if (filterClient) result = result.filter(r => r.clientName === filterClient);
    if (filterCarrier) result = result.filter(r => r.carrier === filterCarrier);
    if (filterPolicy) result = result.filter(r => r.policyNumber === filterPolicy);
    if (filterCoverage) result = result.filter(r => r.coverageType === filterCoverage);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(r =>
        r.clientName.toLowerCase().includes(q) || r.carrier.toLowerCase().includes(q) ||
        r.planName.toLowerCase().includes(q) || r.policyNumber.toLowerCase().includes(q) ||
        r.grouping.toLowerCase().includes(q)
      );
    }
    return result;
  }, [allRows, filterMonth, filterYear, filterClient, filterCarrier, filterPolicy, filterCoverage, search]);

  // Sorting
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortDir === "asc" ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
  }, [filtered, sortKey, sortDir]);

  // Pagination
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const paged = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  useEffect(() => { setPage(0); }, [filterMonth, filterYear, filterClient, filterCarrier, filterPolicy, filterCoverage, search]);

  // Filtered summary
  const filteredSummary = useMemo(() => ({
    rows: filtered.length,
    lives: filtered.reduce((s, r) => s + r.lives, 0),
    premium: Math.round(filtered.reduce((s, r) => s + r.monthlyPremium, 0) * 100) / 100,
    income: Math.round(filtered.reduce((s, r) => s + r.income, 0) * 100) / 100,
  }), [filtered]);

  function handleSort(key: SortKey) {
    if (sortKey === key) { setSortDir(sortDir === "asc" ? "desc" : "asc"); }
    else { setSortKey(key); setSortDir(key === "lives" || key === "monthlyPremium" || key === "income" || key === "rate" || key === "benefitAmount" ? "desc" : "asc"); }
  }

  function SortIcon({ column }: { column: SortKey }) {
    if (sortKey !== column) return <ArrowUpDown className="w-3 h-3 text-gray-400 ml-0.5 inline" />;
    return sortDir === "asc"
      ? <ArrowUp className="w-3 h-3 text-bob-purple ml-0.5 inline" />
      : <ArrowDown className="w-3 h-3 text-bob-purple ml-0.5 inline" />;
  }

  async function handleSaveSetting(s: { carrierName: string; incomeMethod: string; rate: number }) {
    await fetch("/api/carrier-settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
    loadData();
  }
  async function handleDeleteSetting(id: string) {
    await fetch(`/api/carrier-settings?id=${id}`, { method: "DELETE" });
    loadData();
  }

  const hasFilters = !!(filterMonth || filterYear || filterClient || filterCarrier || filterPolicy || filterCoverage || search);

  function clearFilters() {
    setSearch(""); setFilterMonth(""); setFilterYear(""); setFilterClient("");
    setFilterCarrier(""); setFilterPolicy(""); setFilterCoverage("");
  }

  // Table columns
  const columns: { key: SortKey; label: string; align: string }[] = [
    { key: "month", label: "Month", align: "text-left" },
    { key: "clientName", label: "Client Name", align: "text-left" },
    { key: "carrier", label: "Carrier", align: "text-left" },
    { key: "policyNumber", label: "Policy Number", align: "text-left" },
    { key: "planName", label: "Plan Name", align: "text-left" },
    { key: "grouping", label: "Grouping", align: "text-left" },
    { key: "rate", label: "Rate", align: "text-right" },
    { key: "lives", label: "Lives", align: "text-right" },
    { key: "benefitAmount", label: "Benefit Amount", align: "text-right" },
    { key: "monthlyPremium", label: "Monthly Premium", align: "text-right" },
    { key: "incomeMethod", label: "Income Method", align: "text-left" },
    { key: "feeRate", label: "Fee/Comm Rate", align: "text-right" },
    { key: "income", label: "Income", align: "text-right" },
    { key: "coverageType", label: "Coverage Type", align: "text-left" },
  ];

  return (
    <div>
      <a href="/reports" className="inline-flex items-center gap-1.5 text-sm text-bob-text-soft hover:text-bob-purple transition-colors duration-200 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to Reports
      </a>

      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-bob-text">Production Report</h1>
        <p className="text-bob-text-soft mt-1">
          Monthly production by group and coverage tier with carrier billing income — 2022 to current
        </p>
      </div>

      {/* Summary Cards */}
      {!loading && summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: `${hasFilters ? "Filtered" : "Total"} Rows`, value: filteredSummary.rows.toLocaleString(), color: "text-bob-text" },
            { label: `${hasFilters ? "Filtered" : "Total"} Lives`, value: filteredSummary.lives.toLocaleString(), color: "text-bob-text" },
            { label: `${hasFilters ? "Filtered" : "Total"} Premium`, value: fmtCurrency(filteredSummary.premium), color: "text-bob-text" },
            { label: `${hasFilters ? "Filtered" : "Total"} Income`, value: fmtCurrency(filteredSummary.income), color: "text-bob-purple" },
          ].map(card => (
            <div key={card.label} className="bg-white rounded-2xl border border-bob-border p-4">
              <div className="text-[10px] text-bob-text-soft uppercase tracking-wider mb-1">{card.label}</div>
              <div className={`text-xl font-bold ${card.color}`}>{card.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Carrier Settings */}
      {!loading && (
        <CarrierSettingsPanel settings={carrierSettings} onSave={handleSaveSetting} onDelete={handleDeleteSetting} />
      )}

      {/* Filters */}
      {!loading && filterOptions && (
        <div className="bg-white rounded-2xl border border-bob-border p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-bob-text-soft uppercase tracking-wider">Filters</span>
            {hasFilters && (
              <button onClick={clearFilters} className="text-xs text-bob-purple hover:underline flex items-center gap-1">
                <X className="w-3 h-3" /> Clear all
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <FilterDropdown label="Month" value={filterMonth} options={filterOptions.periods} onChange={setFilterMonth} allLabel="All Months" />
            <FilterDropdown label="Fiscal Year" value={filterYear} options={filterOptions.fiscalYears.map(String)} onChange={setFilterYear} allLabel="All Years" />
            <FilterDropdown label="Client" value={filterClient} options={filterOptions.clients} onChange={setFilterClient} allLabel="All Clients" />
            <FilterDropdown label="Carrier" value={filterCarrier} options={filterOptions.carriers} onChange={setFilterCarrier} allLabel="All Carriers" />
            <FilterDropdown label="Policy Number" value={filterPolicy} options={filterOptions.policyNumbers} onChange={setFilterPolicy} allLabel="All Policies" />
            <FilterDropdown label="Coverage Type" value={filterCoverage} options={filterOptions.coverageTypes} onChange={setFilterCoverage} allLabel="All Types" />
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-bob-text-soft uppercase tracking-wider">Search</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..."
                  className="w-full bg-white border border-bob-border rounded-xl pl-9 pr-3 py-2 text-sm text-bob-text hover:border-bob-purple/30 transition-colors focus:outline-none focus:ring-2 focus:ring-bob-purple/20 focus:border-bob-purple/40" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Export + Row Count */}
      {!loading && (
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <button onClick={() => downloadFile(rowsToCSV(sorted), "production-detail.csv", "text/csv")}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-bob-border text-bob-text text-sm font-medium rounded-2xl hover:border-bob-purple/30 hover:text-bob-purple transition-all duration-200">
              <Download className="w-4 h-4" /> CSV
            </button>
            <button onClick={() => downloadFile(rowsToExcelXML(sorted), "production-detail.xls", "application/vnd.ms-excel")}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-bob-border text-bob-text text-sm font-medium rounded-2xl hover:border-bob-purple/30 hover:text-bob-purple transition-all duration-200">
              <Download className="w-4 h-4" /> Excel
            </button>
          </div>
          <div className="text-xs text-bob-text-soft">
            Showing {paged.length.toLocaleString()} of {sorted.length.toLocaleString()} rows
            {hasFilters && <span className="ml-1">(filtered from {allRows.length.toLocaleString()})</span>}
          </div>
        </div>
      )}

      {/* Main Table */}
      {loading ? (
        <div className="text-center py-16 text-bob-text-soft">
          <div className="w-8 h-8 border-2 border-bob-purple border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          Loading production data...
        </div>
      ) : error ? (
        <div className="text-center py-16">
          <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4"><span className="text-red-600 text-xl">!</span></div>
          <p className="text-bob-text font-semibold mb-2">Failed to load report</p>
          <p className="text-bob-text-soft text-sm mb-4">{error}</p>
          <button onClick={loadData} className="px-4 py-2 bg-bob-purple text-white rounded-lg text-sm font-medium hover:bg-bob-purple/90 transition-colors">Retry</button>
        </div>
      ) : (
        <>
          <div ref={tableRef} className="bg-white rounded-2xl border border-bob-border overflow-hidden mb-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead className="bg-bob-bg border-b border-bob-border">
                  <tr>
                    {columns.map(col => (
                      <th key={col.key}
                        className={`${col.align} px-4 py-3 font-semibold text-bob-text-soft cursor-pointer hover:text-bob-text select-none transition-colors text-xs`}
                        onClick={() => handleSort(col.key)}>
                        {col.label} <SortIcon column={col.key} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-bob-border-light">
                  {paged.map((row, i) => (
                    <tr key={`${row.month}-${row.clientCode}-${row.policyNumber}-${row.planName}-${row.grouping}-${i}`}
                      className="hover:bg-bob-bg/50 transition-colors duration-100">
                      <td className="px-4 py-2.5 text-bob-text font-medium text-xs">{fmtMonth(row.month)}</td>
                      <td className="px-4 py-2.5 text-bob-text font-medium max-w-[180px] truncate" title={row.clientName}>{row.clientName}</td>
                      <td className="px-4 py-2.5 text-bob-text text-xs">{row.carrier}</td>
                      <td className="px-4 py-2.5 text-bob-text-soft font-mono text-xs">{row.policyNumber || "\u2014"}</td>
                      <td className="px-4 py-2.5 text-bob-text text-xs max-w-[180px] truncate" title={row.planName}>{row.planName || "\u2014"}</td>
                      <td className="px-4 py-2.5 text-bob-text-soft text-xs">{row.grouping}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-xs">{row.rate ? fmtRate(row.rate) : "\u2014"}</td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{row.lives}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-xs text-bob-text-soft">
                        {row.benefitAmount > 0 ? fmtCurrency(row.benefitAmount) : "\u2014"}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{fmtCurrency(row.monthlyPremium)}</td>
                      <td className="px-4 py-2.5">
                        {row.incomeMethod !== "NONE" ? (
                          <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded-full ${
                            row.incomeMethod === "PEPM" ? "bg-blue-50 text-blue-700" :
                            "bg-purple-50 text-purple-700"
                          }`}>{row.incomeMethod}</span>
                        ) : <span className="text-gray-300 text-xs">{"\u2014"}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right text-bob-text-soft tabular-nums text-xs">{row.feeRateDisplay || "\u2014"}</td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-bob-green">
                        {row.income > 0 ? fmtCurrency(row.income) : <span className="text-gray-300">{"\u2014"}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-bob-text-soft text-xs">{row.coverageType}</td>
                    </tr>
                  ))}
                  {paged.length === 0 && (
                    <tr><td colSpan={columns.length} className="px-4 py-12 text-center text-bob-text-soft">
                      {hasFilters ? "No rows match your filters" : "No production data available"}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mb-8">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                className="px-3 py-1.5 text-sm font-medium text-bob-text bg-white border border-bob-border rounded-lg disabled:opacity-40 hover:border-bob-purple/30 transition-colors">
                Previous
              </button>
              <span className="text-xs text-bob-text-soft">Page {page + 1} of {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                className="px-3 py-1.5 text-sm font-medium text-bob-text bg-white border border-bob-border rounded-lg disabled:opacity-40 hover:border-bob-purple/30 transition-colors">
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
