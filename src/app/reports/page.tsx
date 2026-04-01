"use client";

import { ChevronRight } from "lucide-react";

const reports = [
  {
    id: "benefits",
    name: "Benefits Report",
    description: "Carrier-level summary of eligible/enrolled employees, plans, and costs from the latest upload",
    href: "/reports/benefits",
    color: "from-bob-purple to-bob-blue",
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
    description: "Estimated fee income from PEPM and commission carriers, auto-calculated from the latest upload",
    href: "/reports/income",
    color: "from-bob-green to-bob-teal",
    iconBg: "bg-bob-green-light",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
  },
  {
    id: "production",
    name: "Production Report",
    description: "Full production detail for Reagan Consulting — all clients, carriers, premiums, and estimated fees for fiscal years 2022–2025",
    href: "/reports/production",
    color: "from-bob-coral to-orange-400",
    iconBg: "bg-orange-50",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#F97316" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    ),
  },
];

export default function ReportsPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-bob-text">Insights</h1>
        <p className="text-bob-text-soft mt-1">
          Dive into your data with beautiful, shareable reports
        </p>
      </div>

      <div className="grid gap-4 stagger-children">
        {reports.map((report) => (
          <a
            key={report.id}
            href={report.href}
            className="group bg-white rounded-2xl border border-bob-border p-6 hover:shadow-md hover:border-bob-purple/20 transition-all duration-200 flex items-center justify-between"
          >
            <div className="flex items-center gap-5">
              <div className={`w-14 h-14 rounded-2xl ${report.iconBg} flex items-center justify-center group-hover:scale-105 transition-transform duration-200`}>
                {report.icon}
              </div>
              <div>
                <p className="font-semibold text-lg text-bob-text group-hover:text-bob-purple transition-colors duration-200">
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
