"use client";

import { ChevronRight } from "lucide-react";

const featuredReport = {
  id: "production",
  name: "Production Report",
  description: "Full production detail — all clients, carriers, premiums, commissions, and fees for fiscal years 2022–2025. Includes data dictionary, fee methodology, and reconciliation notes.",
  href: "/reports/production",
  iconBg: "bg-gradient-to-br from-bob-purple to-bob-blue",
  icon: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  ),
};

const reports = [
  {
    id: "production-dashboard",
    name: "Production Dashboard",
    description: "Monthly production by group with carrier billing income, configurable carrier settings, and full raw export for diligence",
    href: "/reports/production-dashboard",
    iconBg: "bg-bob-teal-light",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#14B8A6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18" /><path d="M9 21V9" />
      </svg>
    ),
  },
  {
    id: "benefits",
    name: "Benefits Report",
    description: "Carrier-level summary of eligible/enrolled employees, plans, and costs with full reconciliation audit",
    href: "/reports/benefits",
    iconBg: "bg-bob-purple-light",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#7C5CFC" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M8 15V9" /><path d="M12 15v-4" /><path d="M16 15v-6" />
      </svg>
    ),
  },
  {
    id: "income",
    name: "Income Report",
    description: "Estimated fee income from PEPM and commission carriers, auto-calculated from enrollment data",
    href: "/reports/income",
    iconBg: "bg-bob-green-light",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
  },
];

export default function ReportsPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-bob-text">Reports</h1>
        <p className="text-bob-text-soft mt-1">
          Production reports, benefits analysis, and income projections — audited and export-ready
        </p>
      </div>

      {/* Featured: Production Report */}
      <a
        href={featuredReport.href}
        className="group block bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl p-6 mb-6 hover:shadow-xl transition-all duration-300"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-5">
            <div className={`w-14 h-14 rounded-2xl ${featuredReport.iconBg} flex items-center justify-center group-hover:scale-105 transition-transform duration-200`}>
              {featuredReport.icon}
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <p className="font-bold text-xl text-white group-hover:text-bob-purple-light transition-colors duration-200">
                  {featuredReport.name}
                </p>
                <span className="text-[10px] font-semibold bg-bob-purple/30 text-bob-purple-light px-2 py-0.5 rounded-full uppercase tracking-wide">
                  Primary
                </span>
              </div>
              <p className="text-sm text-gray-400 max-w-xl">{featuredReport.description}</p>
            </div>
          </div>
          <ChevronRight className="w-6 h-6 text-gray-500 group-hover:text-white group-hover:translate-x-1 transition-all duration-200" />
        </div>
      </a>

      {/* Other Reports */}
      <div className="grid gap-3 stagger-children">
        {reports.map((report) => (
          <a
            key={report.id}
            href={report.href}
            className="group bg-white rounded-2xl border border-bob-border p-5 hover:shadow-md hover:border-bob-purple/20 transition-all duration-200 flex items-center justify-between"
          >
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-xl ${report.iconBg} flex items-center justify-center group-hover:scale-105 transition-transform duration-200`}>
                {report.icon}
              </div>
              <div>
                <p className="font-semibold text-bob-text group-hover:text-bob-purple transition-colors duration-200">
                  {report.name}
                </p>
                <p className="text-sm text-bob-text-soft mt-0.5">{report.description}</p>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-bob-purple group-hover:translate-x-0.5 transition-all duration-200" />
          </a>
        ))}
      </div>
    </div>
  );
}
