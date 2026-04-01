"use client";

import { useEffect, useState, useRef } from "react";
import {
  ArrowLeft, Download, Printer, CheckCircle, Info,
  ArrowUpDown, ArrowUp, ArrowDown,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface IncomeRow {
  carrier: string;
  feeType: "PEPM" | "Commission";
  enrolled: number;
  monthlyPremium: number;
  rate: string;
  monthlyIncome: number;
  annualIncome: number;
}

interface Totals {
  monthlyIncome: number;
  annualIncome: number;
}

interface Audit {
  pepmRate: number;
  commissionRate: number;
  pepmCarriers: string[];
  commissionCarriers: string[];
  note: string;
}

type SortKey = "carrier" | "feeType" | "enrolled" | "monthlyPremium" | "rate" | "monthlyIncome" | "annualIncome";
type SortDir = "asc" | "desc";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(val: number): string {
  return "$" + val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

function toCSV(rows: IncomeRow[], totals: Totals): string {
  const header = "Carrier,Fee Type,Enrolled Employees,Monthly Premium,Rate,Est. Monthly Income,Est. Annual Income";
  const lines = rows.map((r) =>
    `"${r.carrier}","${r.feeType}",${r.enrolled},${r.monthlyPremium.toFixed(2)},"${r.rate}",${r.monthlyIncome.toFixed(2)},${r.annualIncome.toFixed(2)}`
  );
  lines.push(`"-- Total --","","","","",${totals.monthlyIncome.toFixed(2)},${totals.annualIncome.toFixed(2)}`);
  return [header, ...lines].join("\n");
}

function toExcelXML(rows: IncomeRow[], totals: Totals): string {
  const escXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const headers = ["Carrier", "Fee Type", "Enrolled Employees", "Monthly Premium", "Rate", "Est. Monthly Income", "Est. Annual Income"];

  let xml = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles>
 <Style ss:ID="Bold"><Font ss:Bold="1"/></Style>
 <Style ss:ID="Currency"><NumberFormat ss:Format="$#,##0.00"/></Style>
 <Style ss:ID="BoldCurrency"><Font ss:Bold="1"/><NumberFormat ss:Format="$#,##0.00"/></Style>
</Styles>
<Worksheet ss:Name="Income Report">
<Table>`;
  xml += "<Row>";
  headers.forEach((h) => { xml += `<Cell ss:StyleID="Bold"><Data ss:Type="String">${escXml(h)}</Data></Cell>`; });
  xml += "</Row>";
  for (const r of rows) {
    xml += "<Row>";
    xml += `<Cell><Data ss:Type="String">${escXml(r.carrier)}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${escXml(r.feeType)}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="Number">${r.enrolled}</Data></Cell>`;
    xml += `<Cell ss:StyleID="Currency"><Data ss:Type="Number">${r.monthlyPremium}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${escXml(r.rate)}</Data></Cell>`;
    xml += `<Cell ss:StyleID="Currency"><Data ss:Type="Number">${r.monthlyIncome}</Data></Cell>`;
    xml += `<Cell ss:StyleID="Currency"><Data ss:Type="Number">${r.annualIncome}</Data></Cell>`;
    xml += "</Row>";
  }
  xml += "<Row>";
  xml += `<Cell ss:StyleID="Bold"><Data ss:Type="String">Total</Data></Cell>`;
  xml += `<Cell><Data ss:Type="String"></Data></Cell>`;
  xml += `<Cell><Data ss:Type="String"></Data></Cell>`;
  xml += `<Cell><Data ss:Type="String"></Data></Cell>`;
  xml += `<Cell><Data ss:Type="String"></Data></Cell>`;
  xml += `<Cell ss:StyleID="BoldCurrency"><Data ss:Type="Number">${totals.monthlyIncome}</Data></Cell>`;
  xml += `<Cell ss:StyleID="BoldCurrency"><Data ss:Type="Number">${totals.annualIncome}</Data></Cell>`;
  xml += "</Row>";
  xml += "</Table></Worksheet></Workbook>";
  return xml;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function IncomeReportPage() {
  const [rows, setRows] = useState<IncomeRow[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [dataPeriod, setDataPeriod] = useState<string | null>(null);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("annualIncome");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const tableRef = useRef<HTMLDivElement>(null);

  const loadData = () => {
    setLoading(true);
    setError(null);
    fetch("/api/reports/income")
      .then((res) => { if (!res.ok) throw new Error(`Server error (${res.status})`); return res.json(); })
      .then((data) => {
        setRows(data.rows || []);
        setTotals(data.totals || null);
        setDataPeriod(data.dataPeriod || null);
        setAudit(data.audit || null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sorted = [...rows].sort((a, b) => {
    const aVal = a[sortKey];
    const bVal = b[sortKey];
    if (typeof aVal === "string" && typeof bVal === "string") {
      return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    const diff = (aVal as number) - (bVal as number);
    return sortDir === "asc" ? diff : -diff;
  });

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "carrier" || key === "feeType" || key === "rate" ? "asc" : "desc");
    }
  }

  function SortIcon({ column }: { column: SortKey }) {
    if (sortKey !== column) return <ArrowUpDown className="w-3.5 h-3.5 text-gray-400 ml-1 inline" />;
    return sortDir === "asc"
      ? <ArrowUp className="w-3.5 h-3.5 text-bob-purple ml-1 inline" />
      : <ArrowDown className="w-3.5 h-3.5 text-bob-purple ml-1 inline" />;
  }

  function handleCSV() {
    if (totals) downloadFile(toCSV(sorted, totals), "income-report.csv", "text/csv");
  }

  function handleExcel() {
    if (totals) downloadFile(toExcelXML(sorted, totals), "income-report.xls", "application/vnd.ms-excel");
  }

  function handlePrint() {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    const tableHTML = tableRef.current?.querySelector("table")?.outerHTML || "";
    printWindow.document.write(`<!DOCTYPE html><html><head><title>Income Report</title>
<style>
  body { font-family: Inter, Arial, sans-serif; margin: 20px; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  p.subtitle { font-size: 12px; color: #666; margin-bottom: 16px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
  th { background: #f5f5f5; font-weight: 600; }
  tr:last-child { font-weight: bold; }
  .text-right { text-align: right; }
</style></head><body>
<h1>Income Report — ${dataPeriod || ""}</h1>
<p class="subtitle">Estimated fee income. PEPM = $20/enrolled/mo. Commission = 10% of premium.</p>
${tableHTML}
</body></html>`);
    printWindow.document.close();
    printWindow.print();
  }

  const columns: { key: SortKey; label: string; align: string }[] = [
    { key: "carrier", label: "Carrier", align: "text-left" },
    { key: "feeType", label: "Fee Type", align: "text-left" },
    { key: "enrolled", label: "Enrolled Employees", align: "text-right" },
    { key: "monthlyPremium", label: "Monthly Premium", align: "text-right" },
    { key: "rate", label: "Rate", align: "text-right" },
    { key: "monthlyIncome", label: "Est. Monthly Income", align: "text-right" },
    { key: "annualIncome", label: "Est. Annual Income", align: "text-right" },
  ];

  // Summary cards
  const pepmRows = rows.filter((r) => r.feeType === "PEPM");
  const commissionRows = rows.filter((r) => r.feeType === "Commission");
  const pepmMonthly = pepmRows.reduce((s, r) => s + r.monthlyIncome, 0);
  const commissionMonthly = commissionRows.reduce((s, r) => s + r.monthlyIncome, 0);

  return (
    <div>
      <a href="/reports" className="inline-flex items-center gap-1.5 text-sm text-bob-text-soft hover:text-bob-purple transition-colors duration-200 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to Insights
      </a>

      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-bob-text">Income Report</h1>
        <p className="text-bob-text-soft mt-1">
          Estimated fee income — auto-calculated from latest XML upload
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
            <span className="ml-2">
              — Enrolled counts and premiums match Benefits Report. This is an estimate, not exact fee income.
            </span>
          </div>
        </div>
      )}

      {/* Summary cards */}
      {totals && !loading && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-2xl border border-bob-border p-5">
            <div className="text-xs text-bob-text-soft uppercase tracking-wide mb-1">PEPM Income</div>
            <div className="text-2xl font-bold text-bob-text">{formatCurrency(pepmMonthly)}<span className="text-sm font-normal text-bob-text-soft">/mo</span></div>
            <div className="text-sm text-bob-text-soft mt-1">{formatCurrency(pepmMonthly * 12)}/yr</div>
          </div>
          <div className="bg-white rounded-2xl border border-bob-border p-5">
            <div className="text-xs text-bob-text-soft uppercase tracking-wide mb-1">Commission Income</div>
            <div className="text-2xl font-bold text-bob-text">{formatCurrency(commissionMonthly)}<span className="text-sm font-normal text-bob-text-soft">/mo</span></div>
            <div className="text-sm text-bob-text-soft mt-1">{formatCurrency(commissionMonthly * 12)}/yr</div>
          </div>
          <div className="bg-white rounded-2xl border border-bob-border p-5">
            <div className="text-xs text-bob-text-soft uppercase tracking-wide mb-1">Total Est. Income</div>
            <div className="text-2xl font-bold text-bob-purple">{formatCurrency(totals.monthlyIncome)}<span className="text-sm font-normal text-bob-text-soft">/mo</span></div>
            <div className="text-sm text-bob-text-soft mt-1">{formatCurrency(totals.annualIncome)}/yr</div>
          </div>
        </div>
      )}

      {/* Export buttons */}
      <div className="flex items-center gap-2 mb-5">
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

      {/* Main Table */}
      {loading ? (
        <div className="text-center py-16 text-bob-text-soft">
          <div className="w-8 h-8 border-2 border-bob-purple border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          Loading report...
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
          <div ref={tableRef} className="bg-white rounded-2xl border border-bob-border overflow-hidden mb-8">
            <table className="w-full text-sm">
              <thead className="bg-bob-bg border-b border-bob-border">
                <tr>
                  {columns.map((col) => (
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
                    <td className="px-6 py-4 font-semibold text-bob-text">{row.carrier}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-full ${
                        row.feeType === "PEPM"
                          ? "bg-bob-blue-light text-blue-700"
                          : "bg-bob-purple-light text-bob-purple"
                      }`}>
                        {row.feeType}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right font-medium tabular-nums">{row.enrolled.toLocaleString()}</td>
                    <td className="px-6 py-4 text-right font-medium tabular-nums">{formatCurrency(row.monthlyPremium)}</td>
                    <td className="px-6 py-4 text-right font-medium text-bob-text-soft">{row.rate}</td>
                    <td className="px-6 py-4 text-right font-semibold tabular-nums text-bob-green">{formatCurrency(row.monthlyIncome)}</td>
                    <td className="px-6 py-4 text-right font-semibold tabular-nums text-bob-green">{formatCurrency(row.annualIncome)}</td>
                  </tr>
                ))}
                {/* Total row */}
                {totals && (
                  <tr className="bg-bob-bg font-bold">
                    <td className="px-6 py-4 text-bob-text">Total</td>
                    <td className="px-6 py-4"></td>
                    <td className="px-6 py-4"></td>
                    <td className="px-6 py-4"></td>
                    <td className="px-6 py-4"></td>
                    <td className="px-6 py-4 text-right text-bob-purple">{formatCurrency(totals.monthlyIncome)}</td>
                    <td className="px-6 py-4 text-right text-bob-purple">{formatCurrency(totals.annualIncome)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Audit / Methodology */}
          {audit && (
            <div className="bg-white rounded-2xl border border-bob-border p-6 mb-8">
              <div className="flex items-center gap-2 mb-4">
                <Info className="w-4 h-4 text-bob-text-soft" />
                <h2 className="text-sm font-semibold text-bob-text">Methodology & Audit</h2>
              </div>
              <div className="space-y-3 text-sm text-gray-600">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="font-semibold text-bob-text mb-2">PEPM Carriers</div>
                    <div className="space-y-1">
                      {audit.pepmCarriers.map((c) => {
                        const row = rows.find((r) => r.carrier === c);
                        return (
                          <div key={c} className="flex justify-between">
                            <span>{c}</span>
                            <span className="font-mono">
                              {row ? `${row.enrolled.toLocaleString()} enrolled × $${audit.pepmRate} = ${formatCurrency(row.monthlyIncome)}/mo` : "No data"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="font-semibold text-bob-text mb-2">Commission Carriers</div>
                    <div className="space-y-1">
                      {audit.commissionCarriers.map((c) => {
                        const row = rows.find((r) => r.carrier === c);
                        return (
                          <div key={c} className="flex justify-between">
                            <span>{c}</span>
                            <span className="font-mono">
                              {row ? `${formatCurrency(row.monthlyPremium)} × ${audit.commissionRate * 100}% = ${formatCurrency(row.monthlyIncome)}/mo` : "No data"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-3">
                  {audit.note}
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
