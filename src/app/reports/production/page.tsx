"use client";

import { useEffect, useState, useRef } from "react";
import {
  ArrowLeft, Search, Download, Printer, ArrowUpDown, ArrowUp, ArrowDown,
  ChevronDown, ChevronRight, Info,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProductionRow {
  year: number;
  month: number;
  transactionDate: string;
  clientName: string;
  clientCode: string;
  sicCode: string;
  state: string;
  carrier: string;
  lineOfBusiness: string;
  planName: string;
  coverageType: string;
  eligible: number;
  enrolled: number;
  monthlyPremium: number;
  feeType: string;
  rate: string;
  estMonthlyFee: number;
  estAnnualFee: number;
  agencyCode: string;
  billType: string;
  producer: string;
  department: string;
}

interface Summary {
  totalClients: number;
  totalPeriods: number;
  totalRows: number;
  totalPremium: number;
  totalEstIncome: number;
}

interface Methodology {
  dataSource: string;
  pepmCarriers: string[];
  commissionCarriers: string[];
  pepmRate: number;
  commissionRate: number;
  note: string;
}

type SortKey = keyof ProductionRow;
type SortDir = "asc" | "desc";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(val: number): string {
  return "$" + val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function monthName(m: number): string {
  const names = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return names[m] || String(m);
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

const CSV_HEADERS = [
  "Year", "Month", "Transaction Date", "Client Name", "Client Code", "SIC Code", "State",
  "Insurance Carrier", "Line of Business", "Plan Name", "Coverage Type",
  "Eligible Employees", "Enrolled Employees", "Monthly Premium",
  "Fee Type", "Rate", "Est. Monthly Commission/Fee", "Est. Annual Commission/Fee",
  "Agency Code", "Bill Type", "Producer", "Department",
];

function toCSV(rows: ProductionRow[]): string {
  const header = CSV_HEADERS.map(h => `"${h}"`).join(",");
  const lines = rows.map(r =>
    [
      r.year, monthName(r.month), r.transactionDate,
      `"${r.clientName.replace(/"/g, '""')}"`, `"${r.clientCode}"`,
      `"${r.sicCode}"`, `"${r.state}"`,
      `"${r.carrier.replace(/"/g, '""')}"`, `"${r.lineOfBusiness}"`,
      `"${r.planName.replace(/"/g, '""')}"`, `"${r.coverageType}"`,
      r.eligible, r.enrolled, r.monthlyPremium.toFixed(2),
      `"${r.feeType}"`, `"${r.rate}"`,
      r.estMonthlyFee.toFixed(2), r.estAnnualFee.toFixed(2),
      `"${r.agencyCode}"`, `"${r.billType}"`, `"${r.producer}"`, `"${r.department}"`,
    ].join(",")
  );
  return [header, ...lines].join("\n");
}

function toExcelXML(rows: ProductionRow[]): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  let xml = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles>
 <Style ss:ID="Bold"><Font ss:Bold="1"/></Style>
 <Style ss:ID="Currency"><NumberFormat ss:Format="$#,##0.00"/></Style>
</Styles>
<Worksheet ss:Name="Production Report">
<Table>`;

  // Header row
  xml += "<Row>";
  CSV_HEADERS.forEach(h => { xml += `<Cell ss:StyleID="Bold"><Data ss:Type="String">${esc(h)}</Data></Cell>`; });
  xml += "</Row>";

  // Data rows
  for (const r of rows) {
    xml += "<Row>";
    xml += `<Cell><Data ss:Type="Number">${r.year}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${monthName(r.month)}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${r.transactionDate}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${esc(r.clientName)}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${esc(r.clientCode)}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${esc(r.sicCode)}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${esc(r.state)}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${esc(r.carrier)}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${esc(r.lineOfBusiness)}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${esc(r.planName)}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${r.coverageType}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="Number">${r.eligible}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="Number">${r.enrolled}</Data></Cell>`;
    xml += `<Cell ss:StyleID="Currency"><Data ss:Type="Number">${r.monthlyPremium}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${r.feeType}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${r.rate}</Data></Cell>`;
    xml += `<Cell ss:StyleID="Currency"><Data ss:Type="Number">${r.estMonthlyFee}</Data></Cell>`;
    xml += `<Cell ss:StyleID="Currency"><Data ss:Type="Number">${r.estAnnualFee}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${r.agencyCode}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${r.billType}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${r.producer}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${r.department}</Data></Cell>`;
    xml += "</Row>";
  }

  xml += "</Table></Worksheet></Workbook>";
  return xml;
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

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ProductionReportPage() {
  const [rows, setRows] = useState<ProductionRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [methodology, setMethodology] = useState<Methodology | null>(null);
  const [periods, setPeriods] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("transactionDate");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [exportOpen, setExportOpen] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/reports/production")
      .then((res) => res.json())
      .then((data) => {
        setRows(data.rows || []);
        setSummary(data.summary || null);
        setMethodology(data.methodology || null);
        setPeriods(data.periods || []);
      })
      .finally(() => setLoading(false));
  }, []);

  // Available years for filter
  const years = Array.from(new Set(rows.map(r => r.year))).sort();

  const filtered = rows.filter(r => {
    if (yearFilter !== "all" && r.year !== Number(yearFilter)) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.clientName.toLowerCase().includes(q) ||
      r.clientCode.toLowerCase().includes(q) ||
      r.carrier.toLowerCase().includes(q) ||
      r.lineOfBusiness.toLowerCase().includes(q) ||
      r.planName.toLowerCase().includes(q) ||
      r.state.toLowerCase().includes(q)
    );
  });

  const sorted = [...filtered].sort((a, b) => {
    const aVal = a[sortKey];
    const bVal = b[sortKey];
    if (typeof aVal === "string" && typeof bVal === "string") {
      return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    const diff = (aVal as number) - (bVal as number);
    return sortDir === "asc" ? diff : -diff;
  });

  // Filtered totals
  const filteredTotals = filtered.reduce(
    (acc, r) => ({
      premium: acc.premium + r.monthlyPremium,
      estIncome: acc.estIncome + r.estMonthlyFee,
      enrolled: acc.enrolled + r.enrolled,
    }),
    { premium: 0, estIncome: 0, enrolled: 0 }
  );

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "clientName" || key === "carrier" || key === "transactionDate" ? "asc" : "desc");
    }
  }

  function SortIcon({ column }: { column: SortKey }) {
    if (sortKey !== column) return <ArrowUpDown className="w-3.5 h-3.5 text-gray-400 ml-1 inline" />;
    return sortDir === "asc"
      ? <ArrowUp className="w-3.5 h-3.5 text-bob-purple ml-1 inline" />
      : <ArrowDown className="w-3.5 h-3.5 text-bob-purple ml-1 inline" />;
  }

  function handleCSV() {
    downloadFile(toCSV(sorted), "kennion-ams-production-report.csv", "text/csv");
    setExportOpen(false);
  }

  function handleExcel() {
    downloadFile(toExcelXML(sorted), "kennion-ams-production-report.xls", "application/vnd.ms-excel");
    setExportOpen(false);
  }

  function handlePrint() {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    const tableHTML = tableRef.current?.querySelector("table")?.outerHTML || "";
    printWindow.document.write(`
      <html><head><title>Production Report — Kennion AMS</title>
      <style>
        body { font-family: system-ui, sans-serif; padding: 20px; }
        h1 { font-size: 18px; margin-bottom: 4px; }
        .sub { color: #666; font-size: 13px; margin-bottom: 16px; }
        table { border-collapse: collapse; width: 100%; font-size: 11px; }
        th, td { border: 1px solid #ddd; padding: 4px 8px; text-align: left; }
        th { background: #f5f5f5; font-weight: 600; }
        @media print { body { padding: 0; } }
      </style></head><body>
      <h1>Production Report — Kennion AMS</h1>
      <div class="sub">Fiscal Years 2022–2025 | Kennion Benefits / NIA</div>
      ${tableHTML}
      </body></html>
    `);
    printWindow.document.close();
    printWindow.print();
    setExportOpen(false);
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-bob-coral border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-bob-text-soft text-sm">Loading production report...</p>
          <p className="text-bob-text-soft text-xs mt-1">Processing all fiscal years — this may take a moment</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <a href="/reports" className="inline-flex items-center gap-1.5 text-sm text-bob-text-soft hover:text-bob-purple transition-colors mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to Reports
        </a>
        <h1 className="text-3xl font-bold tracking-tight text-bob-text">Production Report</h1>
        <p className="text-bob-text-soft mt-1">
          Full production detail — all carriers, clients, premiums, and fees across fiscal years 2022–present
        </p>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <div className="bg-white rounded-xl border border-bob-border p-4">
            <p className="text-xs font-medium text-bob-text-soft uppercase tracking-wide">Clients</p>
            <p className="text-2xl font-bold text-bob-text mt-1">{summary.totalClients.toLocaleString()}</p>
          </div>
          <div className="bg-white rounded-xl border border-bob-border p-4">
            <p className="text-xs font-medium text-bob-text-soft uppercase tracking-wide">Months</p>
            <p className="text-2xl font-bold text-bob-text mt-1">{summary.totalPeriods}</p>
          </div>
          <div className="bg-white rounded-xl border border-bob-border p-4">
            <p className="text-xs font-medium text-bob-text-soft uppercase tracking-wide">Detail Rows</p>
            <p className="text-2xl font-bold text-bob-text mt-1">{summary.totalRows.toLocaleString()}</p>
          </div>
          <div className="bg-white rounded-xl border border-bob-border p-4">
            <p className="text-xs font-medium text-bob-text-soft uppercase tracking-wide">Total Premium</p>
            <p className="text-2xl font-bold text-bob-text mt-1">{formatCurrency(summary.totalPremium)}</p>
          </div>
          <div className="bg-white rounded-xl border border-bob-border p-4">
            <p className="text-xs font-medium text-bob-text-soft uppercase tracking-wide">Est. Fee Income</p>
            <p className="text-2xl font-bold text-bob-green mt-1">{formatCurrency(summary.totalEstIncome)}</p>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by client, carrier, LOB, state..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-bob-border bg-white text-sm text-bob-text placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-bob-purple/30 focus:border-bob-purple transition-all"
          />
        </div>
        {/* Year filter */}
        <select
          value={yearFilter}
          onChange={(e) => setYearFilter(e.target.value)}
          className="px-4 py-2.5 rounded-xl border border-bob-border bg-white text-sm text-bob-text focus:outline-none focus:ring-2 focus:ring-bob-purple/30"
        >
          <option value="all">All Years</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        {/* Export dropdown */}
        <div className="relative">
          <button
            onClick={() => setExportOpen(!exportOpen)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-bob-border bg-white text-sm font-medium text-bob-text hover:bg-gray-50 transition-colors"
          >
            <Download className="w-4 h-4" /> Export <ChevronDown className="w-3.5 h-3.5" />
          </button>
          {exportOpen && (
            <div className="absolute right-0 top-full mt-1 bg-white border border-bob-border rounded-xl shadow-lg z-20 py-1 min-w-[160px]">
              <button onClick={handleCSV} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 transition-colors">
                Download CSV
              </button>
              <button onClick={handleExcel} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 transition-colors">
                Download Excel
              </button>
              <button onClick={handlePrint} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 transition-colors flex items-center gap-2">
                <Printer className="w-3.5 h-3.5" /> Print
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Filtered count */}
      <div className="text-xs text-bob-text-soft mb-2">
        Showing {filtered.length.toLocaleString()} of {rows.length.toLocaleString()} rows
        {yearFilter !== "all" && ` for ${yearFilter}`}
        {search && ` matching "${search}"`}
        {" | "}Premium: {formatCurrency(filteredTotals.premium)} | Est. Fee: {formatCurrency(filteredTotals.estIncome)}
      </div>

      {/* Data Table */}
      <div ref={tableRef} className="bg-white rounded-2xl border border-bob-border overflow-hidden mb-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gradient-to-r from-gray-50 to-gray-100 border-b border-bob-border">
                {([
                  ["transactionDate", "Date"],
                  ["clientName", "Client"],
                  ["clientCode", "Code"],
                  ["state", "State"],
                  ["carrier", "Carrier"],
                  ["lineOfBusiness", "LOB"],
                  ["planName", "Plan"],
                  ["enrolled", "Enrolled"],
                  ["monthlyPremium", "Premium"],
                  ["feeType", "Fee Type"],
                  ["estMonthlyFee", "Est. Fee"],
                ] as [SortKey, string][]).map(([key, label]) => (
                  <th
                    key={key}
                    onClick={() => handleSort(key)}
                    className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-bob-purple transition-colors select-none"
                  >
                    {label} <SortIcon column={key} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sorted.slice(0, 500).map((r, i) => (
                <tr key={i} className="hover:bg-purple-50/30 transition-colors">
                  <td className="px-4 py-3 whitespace-nowrap text-bob-text-soft">{`${monthName(r.month)} ${r.year}`}</td>
                  <td className="px-4 py-3 font-medium text-bob-text max-w-[200px] truncate" title={r.clientName}>{r.clientName}</td>
                  <td className="px-4 py-3 text-bob-text-soft font-mono text-xs">{r.clientCode}</td>
                  <td className="px-4 py-3 text-bob-text-soft">{r.state}</td>
                  <td className="px-4 py-3 text-bob-text">{r.carrier}</td>
                  <td className="px-4 py-3 text-bob-text-soft">{r.lineOfBusiness}</td>
                  <td className="px-4 py-3 text-bob-text-soft max-w-[160px] truncate" title={r.planName}>{r.planName}</td>
                  <td className="px-4 py-3 text-right text-bob-text">{r.enrolled.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-medium text-bob-text">{formatCurrency(r.monthlyPremium)}</td>
                  <td className="px-4 py-3 text-bob-text-soft">{r.feeType || "—"}</td>
                  <td className="px-4 py-3 text-right text-bob-green font-medium">{r.estMonthlyFee > 0 ? formatCurrency(r.estMonthlyFee) : "—"}</td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-bob-text-soft">
                    No data found for the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {sorted.length > 500 && (
          <div className="px-4 py-3 bg-gray-50 border-t border-bob-border text-center text-xs text-bob-text-soft">
            Showing first 500 rows of {sorted.length.toLocaleString()} — use Export to download full dataset
          </div>
        )}
      </div>

      {/* Data Source Note */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 flex gap-3">
        <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-blue-900">
          <p className="font-semibold mb-1">Data Source & Reconciliation</p>
          <p>
            Production data is sourced from Employee Navigator — the enrollment and billing platform used to
            administer all client benefit plans. Premium figures represent monthly billing amounts. Estimated
            commissions and fees use our standard fee schedule: PEPM carriers at $20/enrolled employee/month,
            commission carriers at 10% of premium. <strong>Actual collected revenue is recorded in
            Kennion/NIA financial statements</strong> and may differ due to timing, retroactive adjustments,
            mid-month enrollment changes, and carrier payment cycles.
          </p>
        </div>
      </div>

      {/* Methodology & Data Dictionary */}
      <div className="space-y-3 mb-6">
        <Section title="Methodology & Fee Model" defaultOpen={false}>
          {methodology && (
            <div className="text-sm text-bob-text space-y-3">
              <p><strong>Data Source:</strong> {methodology.dataSource}</p>
              <p><strong>Periods Covered:</strong> {periods.length} months ({periods[0]} through {periods[periods.length - 1]})</p>
              <div>
                <p className="font-semibold mb-1">Fee Model:</p>
                <ul className="list-disc list-inside space-y-1 text-bob-text-soft">
                  <li><strong>PEPM Carriers</strong> ({methodology.pepmCarriers.join(", ")}): Enrolled employees x ${methodology.pepmRate}/month</li>
                  <li><strong>Commission Carriers</strong> ({methodology.commissionCarriers.join(", ")}): Monthly premium x {methodology.commissionRate * 100}%</li>
                  <li>Carriers not in either category show no estimated fee — actual fees are in the financial statements</li>
                </ul>
              </div>
              <p className="text-bob-text-soft italic">{methodology.note}</p>
            </div>
          )}
        </Section>

        <Section title="Column Descriptions (Data Dictionary)" defaultOpen={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="px-3 py-2 text-left font-semibold text-gray-500">Column</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500">Description</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {[
                  ["Year", "Fiscal year of the billing period", "XML filename date"],
                  ["Month", "Month of the billing period (1-12)", "XML filename date"],
                  ["Transaction Date", "First day of the billing month (YYYY-MM-01)", "Derived from year/month"],
                  ["Client Name", "Legal name of the group/company", "Employee Navigator XML — EntityName"],
                  ["Client Code", "Unique group identifier", "Employee Navigator XML — CompanyIdentifier"],
                  ["SIC Code", "Standard Industrial Classification code", "Employee Navigator XML — SICCode"],
                  ["State", "Situs state of the group", "Employee Navigator XML — SitusState"],
                  ["Insurance Carrier", "Name of the insurance carrier/vendor", "Employee Navigator XML — Carrier field on plan"],
                  ["Line of Business", "Plan type classification", "Derived from CarrierPlanTypeCode (Medical, Dental, Vision, Life, etc.)"],
                  ["Plan Name", "Specific plan name/identifier", "Employee Navigator XML — PlanName"],
                  ["Coverage Type", "Group or Individual", "All records are 'Group' (employer-sponsored)"],
                  ["Eligible Employees", "Employees with an enrollment record for this plan", "Count from Employee Navigator enrollments"],
                  ["Enrolled Employees", "Actively enrolled employees (Current status)", "Count from Employee Navigator enrollments"],
                  ["Monthly Premium", "Total monthly premium billed", "Sum of PlanCost from enrollment records"],
                  ["Fee Type", "PEPM or Commission (if applicable)", "Based on carrier classification"],
                  ["Rate", "Fee rate applied ($20 PEPM or 10%)", "Standard fee schedule"],
                  ["Est. Monthly Commission/Fee", "Estimated monthly fee income", "Enrolled x PEPM rate, or Premium x Commission %"],
                  ["Est. Annual Commission/Fee", "Estimated annual fee income", "Monthly fee x 12"],
                  ["Agency Code", "Agency identifier", "KENNION (single agency)"],
                  ["Bill Type", "How the client is billed", "Direct (billed through Employee Navigator)"],
                  ["Producer", "Producing broker/agent", "Kennion Benefits (house account)"],
                  ["Department", "Internal department code", "Not tracked in enrollment system"],
                ].map(([col, desc, src], i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-3 py-1.5 font-medium text-bob-text whitespace-nowrap">{col}</td>
                    <td className="px-3 py-1.5 text-bob-text-soft">{desc}</td>
                    <td className="px-3 py-1.5 text-bob-text-soft">{src}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>

      {/* Close export dropdown when clicking outside */}
      {exportOpen && (
        <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
      )}
    </div>
  );
}
