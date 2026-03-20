"use client";

import { useEffect, useState, useRef } from "react";
import { ArrowLeft, Search, Download, Printer } from "lucide-react";

interface CarrierRow {
  carrier: string;
  eligible: number;
  enrolled: number;
  companies: number;
  plans: number;
  employeeCosts: number;
  planCosts: number;
}

interface Totals {
  eligible: number;
  enrolled: number;
  companies: number;
  plans: number;
  employeeCosts: number;
  planCosts: number;
}

function formatCurrency(val: number): string {
  return "$" + val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function toCSV(rows: CarrierRow[], totals: Totals): string {
  const header = "Carrier,Eligible Employees,Enrolled Employees,Companies,Plans,Employee Costs,Plan Costs";
  const lines = rows.map(
    (r) =>
      `"${r.carrier}",${r.eligible},${r.enrolled},${r.companies},${r.plans},${r.employeeCosts.toFixed(2)},${r.planCosts.toFixed(2)}`
  );
  lines.push(
    `"-- Total --",${totals.eligible},${totals.enrolled},${totals.companies},${totals.plans},${totals.employeeCosts.toFixed(2)},${totals.planCosts.toFixed(2)}`
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
  const headers = ["Carrier", "Eligible Employees", "Enrolled Employees", "Companies", "Plans", "Employee Costs", "Plan Costs"];

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

  // Header row
  xml += "<Row>";
  headers.forEach((h) => {
    xml += `<Cell ss:StyleID="Bold"><Data ss:Type="String">${escXml(h)}</Data></Cell>`;
  });
  xml += "</Row>";

  // Data rows
  for (const r of rows) {
    xml += "<Row>";
    xml += `<Cell><Data ss:Type="String">${escXml(r.carrier)}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="Number">${r.eligible}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="Number">${r.enrolled}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="Number">${r.companies}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="Number">${r.plans}</Data></Cell>`;
    xml += `<Cell ss:StyleID="Currency"><Data ss:Type="Number">${r.employeeCosts}</Data></Cell>`;
    xml += `<Cell ss:StyleID="Currency"><Data ss:Type="Number">${r.planCosts}</Data></Cell>`;
    xml += "</Row>";
  }

  // Totals row
  xml += "<Row>";
  xml += `<Cell ss:StyleID="Bold"><Data ss:Type="String">-- Total --</Data></Cell>`;
  xml += `<Cell ss:StyleID="Bold"><Data ss:Type="Number">${totals.eligible}</Data></Cell>`;
  xml += `<Cell ss:StyleID="Bold"><Data ss:Type="Number">${totals.enrolled}</Data></Cell>`;
  xml += `<Cell ss:StyleID="Bold"><Data ss:Type="Number">${totals.companies}</Data></Cell>`;
  xml += `<Cell ss:StyleID="Bold"><Data ss:Type="Number">${totals.plans}</Data></Cell>`;
  xml += `<Cell ss:StyleID="BoldCurrency"><Data ss:Type="Number">${totals.employeeCosts}</Data></Cell>`;
  xml += `<Cell ss:StyleID="BoldCurrency"><Data ss:Type="Number">${totals.planCosts}</Data></Cell>`;
  xml += "</Row>";

  xml += "</Table></Worksheet></Workbook>";
  return xml;
}

export default function BenefitsReportPage() {
  const [rows, setRows] = useState<CarrierRow[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/reports/benefits")
      .then((res) => res.json())
      .then((data) => {
        setRows(data.rows || []);
        setTotals(data.totals || null);
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = rows.filter(
    (r) => !search || r.carrier.toLowerCase().includes(search.toLowerCase())
  );

  // Recalculate totals for filtered rows
  const displayTotals = filtered.reduce(
    (acc, r) => ({
      eligible: acc.eligible + r.eligible,
      enrolled: acc.enrolled + r.enrolled,
      companies: acc.companies + r.companies,
      plans: acc.plans + r.plans,
      employeeCosts: acc.employeeCosts + r.employeeCosts,
      planCosts: acc.planCosts + r.planCosts,
    }),
    { eligible: 0, enrolled: 0, companies: 0, plans: 0, employeeCosts: 0, planCosts: 0 }
  );

  function handleCSV() {
    downloadFile(toCSV(filtered, displayTotals), "benefits-report.csv", "text/csv");
  }

  function handleExcel() {
    downloadFile(
      toExcelXML(filtered, displayTotals),
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
  body { font-family: Arial, sans-serif; margin: 20px; }
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
      <a href="/reports" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
        <ArrowLeft className="w-4 h-4" /> Back to Reports
      </a>
      <h1 className="text-2xl font-bold mb-1">Benefits Report</h1>
      <p className="text-sm text-gray-500 mb-6">
        Carrier-level summary based on the latest snapshot for each client. Exclusion rules are applied.
      </p>

      {/* Export buttons + search */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex gap-2">
          <button
            onClick={handleCSV}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Download className="w-4 h-4" /> CSV
          </button>
          <button
            onClick={handleExcel}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Download className="w-4 h-4" /> Excel
          </button>
          <button
            onClick={handlePrint}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Printer className="w-4 h-4" /> Print
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search Report"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
          />
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading report...</div>
      ) : (
        <div ref={tableRef} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Carrier</th>
                <th className="text-right px-5 py-3 font-medium text-gray-500">Eligible Employees</th>
                <th className="text-right px-5 py-3 font-medium text-gray-500">Enrolled Employees</th>
                <th className="text-right px-5 py-3 font-medium text-gray-500">Companies</th>
                <th className="text-right px-5 py-3 font-medium text-gray-500">Plans</th>
                <th className="text-right px-5 py-3 font-medium text-gray-500">Employee Costs</th>
                <th className="text-right px-5 py-3 font-medium text-gray-500">Plan Costs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filtered.map((row) => (
                <tr key={row.carrier} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium text-blue-700">{row.carrier}</td>
                  <td className="px-5 py-3 text-right">{row.eligible.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right">{row.enrolled.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right">{row.companies.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right">{row.plans.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right">{formatCurrency(row.employeeCosts)}</td>
                  <td className="px-5 py-3 text-right">{formatCurrency(row.planCosts)}</td>
                </tr>
              ))}
              {/* Totals row */}
              <tr className="bg-gray-50 font-semibold">
                <td className="px-5 py-3 text-gray-700">-- Total --</td>
                <td className="px-5 py-3 text-right">{displayTotals.eligible.toLocaleString()}</td>
                <td className="px-5 py-3 text-right">{displayTotals.enrolled.toLocaleString()}</td>
                <td className="px-5 py-3 text-right">{displayTotals.companies.toLocaleString()}</td>
                <td className="px-5 py-3 text-right">{displayTotals.plans.toLocaleString()}</td>
                <td className="px-5 py-3 text-right">{formatCurrency(displayTotals.employeeCosts)}</td>
                <td className="px-5 py-3 text-right">{formatCurrency(displayTotals.planCosts)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
