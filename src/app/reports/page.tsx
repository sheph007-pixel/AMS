"use client";

import { FileBarChart, ChevronRight } from "lucide-react";

const reports = [
  {
    id: "benefits",
    name: "Benefits Report",
    description: "Carrier-level summary of eligible/enrolled employees, plans, and costs from the latest upload",
    href: "/reports/benefits",
  },
];

export default function ReportsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Reports</h1>
      <p className="text-sm text-gray-500 mb-6">
        Select a report to view current data summaries and export options.
      </p>

      <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200">
        {reports.map((report) => (
          <a
            key={report.id}
            href={report.href}
            className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
                <FileBarChart className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">{report.name}</p>
                <p className="text-sm text-gray-500">{report.description}</p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-400" />
          </a>
        ))}
      </div>
    </div>
  );
}
