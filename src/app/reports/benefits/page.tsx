"use client";

import { useEffect, useState, useRef } from "react";
import { ArrowLeft, Search, Download, Printer, ArrowUpDown, ArrowUp, ArrowDown, CheckCircle } from "lucide-react";

interface CarrierRow {
  carrier: string;
  enrolled: number;
  companies: number;
  plans: number;
  totalPremium: number;
}

interface Totals {
  enrolled: number;
  companies: number;
  plans: number;
  totalPremium: number;
}

type SortKey = keyof CarrierRow;
type SortDir = "asc" | "desc";

function formatCurrency(val: number): string {
  return "$" + val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function toCSV(rows: CarrierRow[], totals: Totals): string {
  const header = "Carrier,Enrolled Employees,Companies,Plans,Total Premium";
  const lines = rows.map(
    (r) =>
      `"${r.carrier}",${r.enrolled},${r.companies},${r.plans},${r.totalPremium.toFixed(2)}`
  );
  lines.push(
    `"-- Total --",${totals.enrolled},${totals.companies},${totals.plans},${totals.totalPremium.toFixed(2)}`
  );
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
  const headers = ["Carrier", "Enrolled Employees", "Companies", "Plans", "Total Premium"];

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
  headers.forEach((h) => {
    xml += `<Cell ss:StyleID="Bold"><Data ss:Type="String">${escXml(h)}</Data></Cell>`;
  });
  xml += "</Row>";

  for (const r of rows) {
    xml += "<Row>";
    xml += `<Cell><Data ss:Type="String">${escXml(r.carrier)}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="Number">${r.enrolled}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="Number">${r.companies}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="Number">${r.plans}</Data></Cell>`;
    xml += `<Cell ss:StyleID="Currency"><Data ss:Type="Number">${r.totalPremium}</Data></Cell>`;
    xml += "</Row>";
  }

  xml += "<Row>";
  xml += `<Cell ss:StyleID="Bold"><Data ss:Type="String">-- Total --</Data></Cell>`;
  xml += `<Cell ss:StyleID="Bold"><Data ss:Type="Number">${totals.enrolled}</Data></Cell>`;
  xml += `<Cell ss:StyleID="Bold"><Data ss:Type="Number">${totals.companies}</Data></Cell>`;
  xml += `<Cell ss:StyleID="Bold"><Data ss:Type="Number">${totals.plans}</Data></Cell>`;
  xml += `<Cell ss:StyleID="BoldCurrency"><Data ss:Type="Number">${totals.totalPremium}</Data></Cell>`;
  xml += "</Row>";

  xml += "</Table></Worksheet></Workbook>";
  return xml;
}

export default function BenefitsReportPage() {
  const [rows, setRows] = useState<CarrierRow[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [lastUpload, setLastUpload] = useState<string | null>(null);
  const [dataPeriod, setDataPeriod] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("carrier");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/reports/benefits")
      .then((res) => res.json())
      .then((data) => {
        setRows(data.rows || []);
        setTotals(data.totals || null);
        setLastUpload(data.lastUpload || null);
        setDataPeriod(data.dataPeriod || null);
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

  const displayTotals = filtered.reduce(
    (acc, r) => ({
      enrolled: acc.enrolled + r.enrolled,
      companies: acc.companies + r.companies,
      plans: acc.plans + r.plans,
      totalPremium: acc.totalPremium + r.totalPremium,
    }),
    { enrolled: 0, companies: 0, plans: 0, totalPremium: 0 }
  );

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
    downloadFile(
      toExcelXML(sorted, displayTotals),
      "benefits-report.xls",
      "application/vnd.ms-excel"
    );
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
<h1>Benefits Report</h1>
${tableHTML}
</body></html>`);
    printWindow.document.close();
    printWindow.print();
  }

  return (
    <div>
      <a href="/reports" className="inline-flex items-center gap-1.5 text-sm text-bob-text-soft hover:text-bob-purple transition-colors duration-200 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to Insights
      </a>

      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-bob-text">Benefits Report</h1>
        <p className="text-bob-text-soft mt-1">
          Carrier-level summary of actively enrolled employees and premiums
        </p>
      </div>

      {/* Verified banner */}
      {dataPeriod && (
        <div className="flex items-center gap-3 bg-bob-green-light/50 border border-bob-green/20 rounded-2xl px-5 py-3.5 mb-6">
          <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center flex-shrink-0">
            <CheckCircle className="w-4 h-4 text-bob-green" />
          </div>
          <span className="text-sm text-emerald-800">
            <span className="font-semibold">Verified</span> — Data period: {dataPeriod}. Showing active enrolled employees only. Exclusion rules applied.
          </span>
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

      {/* Table */}
      {loading ? (
        <div className="text-center py-16 text-bob-text-soft">
          <div className="w-8 h-8 border-2 border-bob-purple border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          Loading report...
        </div>
      ) : (
        <div ref={tableRef} className="bg-white rounded-2xl border border-bob-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bob-bg border-b border-bob-border">
              <tr>
                {([
                  { key: "carrier" as SortKey, label: "Carrier", align: "text-left" },
                  { key: "enrolled" as SortKey, label: "Enrolled Employees", align: "text-right" },
                  { key: "companies" as SortKey, label: "Companies", align: "text-right" },
                  { key: "plans" as SortKey, label: "Plans", align: "text-right" },
                  { key: "totalPremium" as SortKey, label: "Total Premium", align: "text-right" },
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
                  <td className="px-6 py-4 font-semibold text-bob-purple">{row.carrier}</td>
                  <td className="px-6 py-4 text-right font-medium">{row.enrolled.toLocaleString()}</td>
                  <td className="px-6 py-4 text-right font-medium">{row.companies.toLocaleString()}</td>
                  <td className="px-6 py-4 text-right font-medium">{row.plans.toLocaleString()}</td>
                  <td className="px-6 py-4 text-right font-semibold">{formatCurrency(row.totalPremium)}</td>
                </tr>
              ))}
              {/* Totals row */}
              <tr className="bg-bob-bg font-bold">
                <td className="px-6 py-4 text-bob-text">Total</td>
                <td className="px-6 py-4 text-right">{displayTotals.enrolled.toLocaleString()}</td>
                <td className="px-6 py-4 text-right">{displayTotals.companies.toLocaleString()}</td>
                <td className="px-6 py-4 text-right">{displayTotals.plans.toLocaleString()}</td>
                <td className="px-6 py-4 text-right">{formatCurrency(displayTotals.totalPremium)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
