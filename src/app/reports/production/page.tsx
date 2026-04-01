"use client";

import { useEffect, useState, useRef } from "react";
import {
  ArrowLeft, Search, Download, Printer, ArrowUpDown, ArrowUp, ArrowDown,
  ChevronDown, ChevronRight, Info, Sparkles, Loader2,
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
  broker: string;
  department: string;
}

interface AuditInfo {
  generatedAt: string;
  snapshotsQueried: number;
  snapshotsProcessed: number;
  snapshotsSkipped: number;
  employeesProcessed: number;
  enrollmentsProcessed: number;
  premiumCrossCheck: { summaryTotal: number; rowDetailTotal: number; match: boolean };
  feeCrossCheck: { summaryTotal: number; rowDetailTotal: number; match: boolean };
  periodCoverage: { first: string | null; last: string | null; totalMonths: number; gaps: string[] };
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
  "Agency Code", "Bill Type", "Producer", "Broker", "Department",
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
      `"${r.agencyCode}"`, `"${r.billType}"`, `"${r.producer}"`, `"${r.broker}"`, `"${r.department}"`,
    ].join(",")
  );
  return [header, ...lines].join("\n");
}

function toExcelXML(rows: ProductionRow[], summary: Summary | null, methodology: Methodology | null, audit: AuditInfo | null): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const cell = (v: string, style?: string) => `<Cell${style ? ` ss:StyleID="${style}"` : ""}><Data ss:Type="String">${esc(v)}</Data></Cell>`;
  const numCell = (v: number, style?: string) => `<Cell${style ? ` ss:StyleID="${style}"` : ""}><Data ss:Type="Number">${v}</Data></Cell>`;
  const blankRow = () => "<Row></Row>";

  let xml = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles>
 <Style ss:ID="Bold"><Font ss:Bold="1"/></Style>
 <Style ss:ID="Title"><Font ss:Bold="1" ss:Size="14"/></Style>
 <Style ss:ID="SectionHead"><Font ss:Bold="1" ss:Size="11"/></Style>
 <Style ss:ID="Currency"><NumberFormat ss:Format="$#,##0.00"/></Style>
 <Style ss:ID="CurrencyBold"><Font ss:Bold="1"/><NumberFormat ss:Format="$#,##0.00"/></Style>
 <Style ss:ID="Pct"><NumberFormat ss:Format="0.00%"/></Style>
</Styles>`;

  // ─── Tab 1: Cover Sheet ─────────────────────────────────────────────
  xml += `<Worksheet ss:Name="Cover Sheet"><Table>`;
  xml += `<Row>${cell("KENNION AMS — PRODUCTION REPORT", "Title")}</Row>`;
  xml += blankRow();
  xml += `<Row>${cell("Report Generated:", "Bold")}${cell(new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }))}</Row>`;
  xml += `<Row>${cell("Prepared By:", "Bold")}${cell("Kennion Agency Management System")}</Row>`;
  xml += `<Row>${cell("Agency:", "Bold")}${cell("Kennion")}</Row>`;
  if (summary) {
    xml += `<Row>${cell("Period Covered:", "Bold")}${cell(`${summary.totalPeriods} months of enrollment data`)}</Row>`;
    xml += `<Row>${cell("Total Clients:", "Bold")}${cell(String(summary.totalClients))}</Row>`;
    xml += `<Row>${cell("Total Detail Rows:", "Bold")}${cell(summary.totalRows.toLocaleString())}</Row>`;
  }
  xml += blankRow();
  xml += `<Row>${cell("DATA SOURCE & METHODOLOGY", "SectionHead")}</Row>`;
  xml += blankRow();
  xml += `<Row>${cell("Data Source:")}</Row>`;
  xml += `<Row>${cell("Employee Navigator — the enrollment and billing platform used to administer all client benefit plans.")}</Row>`;
  xml += `<Row>${cell("Premium figures represent monthly billing amounts from Employee Navigator enrollment records.")}</Row>`;
  xml += blankRow();
  xml += `<Row>${cell("Fee Model:", "Bold")}</Row>`;
  if (methodology) {
    xml += `<Row>${cell(`  PEPM Carriers (${methodology.pepmCarriers.join(", ")}): Enrolled employees x $${methodology.pepmRate}/month`)}</Row>`;
    xml += `<Row>${cell(`  Commission Carriers (${methodology.commissionCarriers.join(", ")}): Monthly premium x ${methodology.commissionRate * 100}%`)}</Row>`;
    xml += `<Row>${cell("  Carriers not in either category: No estimated fee (actual fees tracked in financial statements)")}</Row>`;
  }
  xml += blankRow();
  xml += `<Row>${cell("RECONCILIATION NOTE", "SectionHead")}</Row>`;
  xml += blankRow();
  xml += `<Row>${cell("Actual collected revenue is recorded in Kennion/NIA financial statements and may differ from estimated")}</Row>`;
  xml += `<Row>${cell("fees shown here due to timing, retroactive adjustments, mid-month enrollment changes, and carrier payment cycles.")}</Row>`;
  xml += `<Row>${cell("This report reflects billing-level data from the enrollment system, not cash receipts.")}</Row>`;
  // Audit info on cover sheet
  if (audit) {
    xml += blankRow();
    xml += `<Row>${cell("DATA INTEGRITY AUDIT", "SectionHead")}</Row>`;
    xml += blankRow();
    xml += `<Row>${cell("Snapshots Queried:", "Bold")}${cell(String(audit.snapshotsQueried))}</Row>`;
    xml += `<Row>${cell("Snapshots Processed:", "Bold")}${cell(String(audit.snapshotsProcessed))}</Row>`;
    xml += `<Row>${cell("Employees Processed:", "Bold")}${cell(audit.employeesProcessed.toLocaleString())}</Row>`;
    xml += `<Row>${cell("Enrollments Processed:", "Bold")}${cell(audit.enrollmentsProcessed.toLocaleString())}</Row>`;
    xml += `<Row>${cell("Premium Cross-Check:", "Bold")}${cell(audit.premiumCrossCheck.match ? "PASS — summary matches detail rows" : "MISMATCH — review required")}</Row>`;
    xml += `<Row>${cell("Fee Cross-Check:", "Bold")}${cell(audit.feeCrossCheck.match ? "PASS — summary matches detail rows" : "MISMATCH — review required")}</Row>`;
    xml += `<Row>${cell("Period Gaps:", "Bold")}${cell(audit.periodCoverage.gaps.length === 0 ? "None — continuous coverage" : audit.periodCoverage.gaps.join(", "))}</Row>`;
  }
  xml += blankRow();
  xml += `<Row>${cell("DATA DICTIONARY", "SectionHead")}</Row>`;
  xml += blankRow();
  xml += `<Row>${cell("Column", "Bold")}${cell("Description", "Bold")}${cell("Source", "Bold")}</Row>`;
  const dictEntries: [string, string, string][] = [
    ["Year", "Fiscal year of the billing period", "XML filename date"],
    ["Month", "Month of the billing period", "XML filename date"],
    ["Transaction Date", "First day of billing month (YYYY-MM-01)", "Derived"],
    ["Client Name", "Legal name of the group/company", "EN XML — EntityName"],
    ["Client Code", "Unique group identifier", "EN XML — CompanyIdentifier"],
    ["SIC Code", "Standard Industrial Classification", "EN XML — SICCode"],
    ["State", "Situs state of the group", "EN XML — SitusState"],
    ["Insurance Carrier", "Carrier/vendor name", "EN XML — Carrier on plan"],
    ["Line of Business", "Plan type (Medical, Dental, etc.)", "EN XML — CarrierPlanTypeCode"],
    ["Plan Name", "Specific plan identifier", "EN XML — PlanName"],
    ["Coverage Type", "Group or Individual", "All records are Group"],
    ["Eligible Employees", "Employees with enrollment record", "EN enrollment count"],
    ["Enrolled Employees", "Actively enrolled (Current status)", "EN enrollment count"],
    ["Monthly Premium", "Total monthly premium billed", "Sum of PlanCost"],
    ["Fee Type", "PEPM or Commission", "Carrier classification"],
    ["Rate", "Fee rate applied", "Standard fee schedule"],
    ["Est. Monthly Commission/Fee", "Estimated monthly fee income", "Calculated"],
    ["Est. Annual Commission/Fee", "Monthly fee x 12", "Calculated"],
    ["Agency Code", "Agency identifier", "KENNION"],
    ["Bill Type", "Billing method", "Direct"],
    ["Producer", "Producing agent", "Kennion Benefits"],
    ["Broker", "Broker of record", "Kennion"],
    ["Department", "Internal department", "Not tracked in EN"],
  ];
  for (const [col, desc, src] of dictEntries) {
    xml += `<Row>${cell(col)}${cell(desc)}${cell(src)}</Row>`;
  }
  xml += `</Table></Worksheet>`;

  // ─── Tab 2: Production Data ─────────────────────────────────────────
  xml += `<Worksheet ss:Name="Production Data"><Table>`;
  xml += "<Row>";
  CSV_HEADERS.forEach(h => { xml += `<Cell ss:StyleID="Bold"><Data ss:Type="String">${esc(h)}</Data></Cell>`; });
  xml += "</Row>";

  for (const r of rows) {
    xml += "<Row>";
    xml += numCell(r.year);
    xml += cell(monthName(r.month));
    xml += cell(r.transactionDate);
    xml += cell(r.clientName);
    xml += cell(r.clientCode);
    xml += cell(r.sicCode);
    xml += cell(r.state);
    xml += cell(r.carrier);
    xml += cell(r.lineOfBusiness);
    xml += cell(r.planName);
    xml += cell(r.coverageType);
    xml += numCell(r.eligible);
    xml += numCell(r.enrolled);
    xml += numCell(r.monthlyPremium, "Currency");
    xml += cell(r.feeType);
    xml += cell(r.rate);
    xml += numCell(r.estMonthlyFee, "Currency");
    xml += numCell(r.estAnnualFee, "Currency");
    xml += cell(r.agencyCode);
    xml += cell(r.billType);
    xml += cell(r.producer);
    xml += cell(r.broker);
    xml += cell(r.department);
    xml += "</Row>";
  }
  xml += `</Table></Worksheet>`;

  // ─── Tab 3: Summary by Year ─────────────────────────────────────────
  const yearMap = new Map<number, { clients: Set<string>; enrolled: number; premium: number; estFee: number; rows: number }>();
  for (const r of rows) {
    let y = yearMap.get(r.year);
    if (!y) { y = { clients: new Set(), enrolled: 0, premium: 0, estFee: 0, rows: 0 }; yearMap.set(r.year, y); }
    y.clients.add(r.clientCode);
    y.enrolled += r.enrolled;
    y.premium += r.monthlyPremium;
    y.estFee += r.estMonthlyFee;
    y.rows++;
  }

  xml += `<Worksheet ss:Name="Summary by Year"><Table>`;
  xml += `<Row>${cell("Fiscal Year", "Bold")}${cell("Clients", "Bold")}${cell("Detail Rows", "Bold")}${cell("Total Enrolled", "Bold")}${cell("Total Premium", "Bold")}${cell("Est. Fee Income", "Bold")}${cell("Effective Margin", "Bold")}</Row>`;
  let grandPremium = 0, grandFee = 0;
  for (const [year, data] of Array.from(yearMap.entries()).sort((a, b) => a[0] - b[0])) {
    const margin = data.premium > 0 ? data.estFee / data.premium : 0;
    xml += `<Row>${numCell(year)}${numCell(data.clients.size)}${numCell(data.rows)}${numCell(data.enrolled)}${numCell(Math.round(data.premium * 100) / 100, "Currency")}${numCell(Math.round(data.estFee * 100) / 100, "Currency")}${numCell(Math.round(margin * 10000) / 10000, "Pct")}</Row>`;
    grandPremium += data.premium;
    grandFee += data.estFee;
  }
  xml += `<Row>${cell("TOTAL", "Bold")}${cell("")}${numCell(rows.length)}${cell("")}${numCell(Math.round(grandPremium * 100) / 100, "CurrencyBold")}${numCell(Math.round(grandFee * 100) / 100, "CurrencyBold")}${numCell(grandPremium > 0 ? Math.round((grandFee / grandPremium) * 10000) / 10000 : 0, "Pct")}</Row>`;
  xml += `</Table></Worksheet>`;

  // ─── Tab 4: Summary by Carrier ──────────────────────────────────────
  const carrierMap = new Map<string, { clients: Set<string>; enrolled: number; premium: number; estFee: number; rows: number }>();
  for (const r of rows) {
    let c = carrierMap.get(r.carrier);
    if (!c) { c = { clients: new Set(), enrolled: 0, premium: 0, estFee: 0, rows: 0 }; carrierMap.set(r.carrier, c); }
    c.clients.add(r.clientCode);
    c.enrolled += r.enrolled;
    c.premium += r.monthlyPremium;
    c.estFee += r.estMonthlyFee;
    c.rows++;
  }

  xml += `<Worksheet ss:Name="Summary by Carrier"><Table>`;
  xml += `<Row>${cell("Insurance Carrier", "Bold")}${cell("Clients", "Bold")}${cell("Detail Rows", "Bold")}${cell("Total Enrolled", "Bold")}${cell("Total Premium", "Bold")}${cell("Est. Fee Income", "Bold")}${cell("Fee Type", "Bold")}</Row>`;
  for (const [carrier, data] of Array.from(carrierMap.entries()).sort((a, b) => b[1].premium - a[1].premium)) {
    const isPEPM = PEPM_CARRIERS.some(c => carrier.toLowerCase().includes(c.toLowerCase()));
    const isComm = COMMISSION_CARRIERS.some(c => carrier.toLowerCase().includes(c.toLowerCase()));
    const feeType = isPEPM ? "PEPM" : isComm ? "Commission" : "N/A";
    xml += `<Row>${cell(carrier)}${numCell(data.clients.size)}${numCell(data.rows)}${numCell(data.enrolled)}${numCell(Math.round(data.premium * 100) / 100, "Currency")}${numCell(Math.round(data.estFee * 100) / 100, "Currency")}${cell(feeType)}</Row>`;
  }
  xml += `<Row>${cell("TOTAL", "Bold")}${cell("")}${numCell(rows.length)}${cell("")}${numCell(Math.round(grandPremium * 100) / 100, "CurrencyBold")}${numCell(Math.round(grandFee * 100) / 100, "CurrencyBold")}${cell("")}</Row>`;
  xml += `</Table></Worksheet>`;

  xml += "</Workbook>";
  return xml;
}

const PEPM_CARRIERS = ["EBPA", "HealthEZ"];
const COMMISSION_CARRIERS = ["Guardian", "VSP"];

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
  const [audit, setAudit] = useState<AuditInfo | null>(null);
  const [search, setSearch] = useState("");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("transactionDate");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [exportOpen, setExportOpen] = useState(false);
  const [aiAudit, setAiAudit] = useState<string | null>(null);
  const [aiAuditLoading, setAiAuditLoading] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);

  const loadData = () => {
    setLoading(true);
    setError(null);
    fetch("/api/reports/production")
      .then((res) => { if (!res.ok) throw new Error(`Server error (${res.status})`); return res.json(); })
      .then((data) => {
        setRows(data.rows || []);
        setSummary(data.summary || null);
        setMethodology(data.methodology || null);
        setPeriods(data.periods || []);
        setAudit(data.audit || null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    downloadFile(toExcelXML(sorted, summary, methodology, audit), "kennion-ams-production-report.xls", "application/vnd.ms-excel");
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
      <div class="sub">Fiscal Years 2022–2025 | Kennion</div>
      ${tableHTML}
      </body></html>
    `);
    printWindow.document.close();
    printWindow.print();
    setExportOpen(false);
  }

  async function runAiAudit() {
    if (!summary || !audit || !methodology || aiAuditLoading) return;
    setAiAuditLoading(true);
    setAiAudit(null);

    // Build year breakdown
    const yearMap = new Map<number, { clients: Set<string>; premium: number; fee: number; enrolled: number }>();
    for (const r of rows) {
      let y = yearMap.get(r.year);
      if (!y) { y = { clients: new Set(), premium: 0, fee: 0, enrolled: 0 }; yearMap.set(r.year, y); }
      y.clients.add(r.clientCode);
      y.premium += r.monthlyPremium;
      y.fee += r.estMonthlyFee;
      y.enrolled += r.enrolled;
    }
    const yearBreakdown = Array.from(yearMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([year, d]) => `${year}: ${d.clients.size} clients, $${d.premium.toFixed(2)} premium, $${d.fee.toFixed(2)} fees, ${d.enrolled} enrolled`)
      .join("\n");

    // Build carrier breakdown
    const carrierMap = new Map<string, { premium: number; fee: number; enrolled: number }>();
    for (const r of rows) {
      let c = carrierMap.get(r.carrier);
      if (!c) { c = { premium: 0, fee: 0, enrolled: 0 }; carrierMap.set(r.carrier, c); }
      c.premium += r.monthlyPremium;
      c.fee += r.estMonthlyFee;
      c.enrolled += r.enrolled;
    }
    const carrierBreakdown = Array.from(carrierMap.entries())
      .sort((a, b) => b[1].premium - a[1].premium)
      .map(([carrier, d]) => `${carrier}: $${d.premium.toFixed(2)} premium, $${d.fee.toFixed(2)} fees, ${d.enrolled} enrolled`)
      .join("\n");

    try {
      const res = await fetch("/api/ai/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary, audit, methodology, yearBreakdown, carrierBreakdown }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setAiAudit(data.analysis);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to run AI audit";
      setAiAudit(`Error: ${msg}`);
    } finally {
      setAiAuditLoading(false);
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-bob-coral border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-bob-text-soft text-sm">Loading production report...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center max-w-md">
          <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4"><span className="text-red-600 text-xl">!</span></div>
          <p className="text-bob-text font-semibold mb-2">Failed to load production report</p>
          <p className="text-bob-text-soft text-sm mb-4">{error}</p>
          <button onClick={loadData} className="px-4 py-2 bg-bob-purple text-white rounded-lg text-sm font-medium hover:bg-bob-purple/90 transition-colors">Retry</button>
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

      {/* Data Integrity Audit */}
      {audit && (
        <div className="bg-white rounded-2xl border border-bob-border overflow-hidden mb-6">
          <div className="px-5 py-4 border-b border-bob-border flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-bob-text">Data Integrity Audit</h2>
              <p className="text-xs text-bob-text-soft">Generated {new Date(audit.generatedAt).toLocaleString()}</p>
            </div>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div>
                <p className="text-xs font-medium text-bob-text-soft uppercase tracking-wide">Snapshots Queried</p>
                <p className="text-lg font-bold text-bob-text">{audit.snapshotsQueried.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-bob-text-soft uppercase tracking-wide">Snapshots Processed</p>
                <p className="text-lg font-bold text-bob-text">{audit.snapshotsProcessed.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-bob-text-soft uppercase tracking-wide">Employees Processed</p>
                <p className="text-lg font-bold text-bob-text">{audit.employeesProcessed.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-bob-text-soft uppercase tracking-wide">Enrollments Processed</p>
                <p className="text-lg font-bold text-bob-text">{audit.enrollmentsProcessed.toLocaleString()}</p>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold ${audit.premiumCrossCheck.match ? "bg-green-500" : "bg-red-500"}`}>
                  {audit.premiumCrossCheck.match ? "✓" : "!"}
                </span>
                <span className="text-bob-text">Premium cross-check: Summary ({formatCurrency(audit.premiumCrossCheck.summaryTotal)}) vs detail rows ({formatCurrency(audit.premiumCrossCheck.rowDetailTotal)}) — <strong className={audit.premiumCrossCheck.match ? "text-green-600" : "text-red-600"}>{audit.premiumCrossCheck.match ? "MATCH" : "MISMATCH"}</strong></span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold ${audit.feeCrossCheck.match ? "bg-green-500" : "bg-red-500"}`}>
                  {audit.feeCrossCheck.match ? "✓" : "!"}
                </span>
                <span className="text-bob-text">Fee income cross-check: Summary ({formatCurrency(audit.feeCrossCheck.summaryTotal)}) vs detail rows ({formatCurrency(audit.feeCrossCheck.rowDetailTotal)}) — <strong className={audit.feeCrossCheck.match ? "text-green-600" : "text-red-600"}>{audit.feeCrossCheck.match ? "MATCH" : "MISMATCH"}</strong></span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold ${audit.periodCoverage.gaps.length === 0 ? "bg-green-500" : "bg-yellow-500"}`}>
                  {audit.periodCoverage.gaps.length === 0 ? "✓" : "!"}
                </span>
                <span className="text-bob-text">
                  Period coverage: {audit.periodCoverage.first} through {audit.periodCoverage.last} ({audit.periodCoverage.totalMonths} months)
                  {audit.periodCoverage.gaps.length === 0
                    ? " — continuous, no gaps"
                    : ` — ${audit.periodCoverage.gaps.length} gap(s): ${audit.periodCoverage.gaps.join(", ")}`}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI-Powered Audit */}
      <div className="bg-white rounded-2xl border border-bob-border overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-bob-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-bob-purple/20 to-bob-blue/20 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-bob-purple" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-bob-text">AI Audit Analysis</h2>
              <p className="text-xs text-bob-text-soft">GPT-4o reviews your production data for quality, trends, and insights</p>
            </div>
          </div>
          <button
            onClick={runAiAudit}
            disabled={aiAuditLoading || !summary || !audit}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-200 ${
              aiAuditLoading
                ? "bg-gray-100 text-gray-400"
                : "bg-gradient-to-r from-bob-purple to-bob-blue text-white hover:shadow-md hover:scale-[1.02]"
            }`}
          >
            {aiAuditLoading ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Analyzing...</>
            ) : aiAudit ? (
              <><Sparkles className="w-3.5 h-3.5" /> Re-run Audit</>
            ) : (
              <><Sparkles className="w-3.5 h-3.5" /> Run AI Audit</>
            )}
          </button>
        </div>
        {aiAudit && (
          <div className="p-5">
            <div
              className="prose-sm max-w-none text-sm text-bob-text [&_h1]:text-base [&_h1]:font-bold [&_h1]:mt-4 [&_h1]:mb-2 [&_h2]:text-sm [&_h2]:font-bold [&_h2]:mt-3 [&_h2]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_strong]:font-semibold [&_li]:ml-4 [&_li]:list-disc [&_p]:mb-2"
              dangerouslySetInnerHTML={{
                __html: aiAudit
                  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
                  .replace(/^### (.+)$/gm, '<h3>$1</h3>')
                  .replace(/^## (.+)$/gm, '<h2>$1</h2>')
                  .replace(/^# (.+)$/gm, '<h1>$1</h1>')
                  .replace(/^- (.+)$/gm, '<li>$1</li>')
                  .replace(/^\d+\. (.+)$/gm, '<li style="list-style-type:decimal">$1</li>')
                  .replace(/\n\n/g, '</p><p>')
                  .replace(/\n/g, '<br/>'),
              }}
            />
          </div>
        )}
        {!aiAudit && !aiAuditLoading && (
          <div className="px-5 py-8 text-center text-sm text-bob-text-soft">
            Click &ldquo;Run AI Audit&rdquo; to have GPT-4o analyze your production data for quality, trends, and due diligence insights.
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
                  ["Broker", "Broker of record for the group", "Kennion"],
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
