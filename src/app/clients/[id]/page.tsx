"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, Building2, Shield, Users } from "lucide-react";

interface BenefitPlan {
  id: string;
  planType: string;
  carrier: string | null;
  planName: string | null;
  eligible: number | null;
  enrollees: number | null;
  premium: number | null;
}

interface Employee {
  id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  hireDate: string | null;
  termDate: string | null;
  status: string | null;
  coverageTier: string | null;
  changeStatus: "added" | "termed" | "continued" | null;
}

interface Snapshot {
  id: string;
  year: number;
  month: number;
  groupName: string;
  totalEmployees: number | null;
  totalMembers: number | null;
  effectiveDate: string | null;
  renewalDate: string | null;
  sicCode: string | null;
  state: string | null;
  benefitPlans: BenefitPlan[];
  employees: Employee[];
  termedEmployees: Employee[];
}

interface ClientDetail {
  id: string;
  groupId: string;
  groupName: string;
  sicCode: string | null;
  state: string | null;
  status: string;
  years: number[];
  firstYear: number | null;
  lastYear: number | null;
  systemYears: number[];
  snapshots: Snapshot[];
}

const statusColors: Record<string, string> = {
  Active: "bg-green-100 text-green-800",
  New: "bg-blue-100 text-blue-800",
  Termed: "bg-red-100 text-red-800",
  Returned: "bg-amber-100 text-amber-800",
};

const changeColors: Record<string, string> = {
  added: "bg-green-100 text-green-700",
  termed: "bg-red-100 text-red-700",
  continued: "bg-gray-100 text-gray-600",
};

type Tab = "overview" | "benefits" | "employees";

export default function ClientDetailPage() {
  const params = useParams();
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("overview");
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/clients/${params.id}`)
      .then((res) => res.json())
      .then((data) => {
        setClient(data);
        if (data.snapshots?.length > 0) {
          setSelectedSnapshotId(data.snapshots[data.snapshots.length - 1].id);
        }
      })
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading) return <div className="text-center py-12 text-gray-500">Loading...</div>;
  if (!client) return <div className="text-center py-12 text-gray-500">Client not found</div>;

  const snapshot = client.snapshots.find((s) => s.id === selectedSnapshotId);
  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "overview", label: "Overview", icon: <Building2 className="w-4 h-4" /> },
    { key: "benefits", label: "Benefits", icon: <Shield className="w-4 h-4" /> },
    { key: "employees", label: "Employees", icon: <Users className="w-4 h-4" /> },
  ];

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <a href="/" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
          <ArrowLeft className="w-4 h-4" /> Back to Clients
        </a>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{client.groupName}</h1>
          <span className={`px-2.5 py-0.5 text-sm font-medium rounded-full ${statusColors[client.status]}`}>
            {client.status}
          </span>
        </div>
        <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
          <span>Group ID: {client.groupId}</span>
          {client.state && <span>{client.state}</span>}
          {client.sicCode && <span>SIC: {client.sicCode}</span>}
        </div>
        <div className="flex gap-1.5 mt-3 flex-wrap">
          {client.snapshots.map((s) => (
            <span key={s.id} className="px-2.5 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded">
              {s.month > 0 ? `${s.month}/${s.year}` : s.year}
            </span>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? "border-gray-900 text-gray-900"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Year selector for benefits & employees */}
      {tab !== "overview" && client.snapshots.length > 0 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-sm text-gray-500">Period:</span>
          {client.snapshots.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedSnapshotId(s.id)}
              className={`px-3 py-1 text-sm rounded-lg border transition-colors ${
                selectedSnapshotId === s.id
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
              }`}
            >
              {s.month > 0 ? `${s.month}/${s.year}` : s.year}
            </button>
          ))}
        </div>
      )}

      {/* Tab content */}
      {tab === "overview" && <OverviewTab client={client} />}
      {tab === "benefits" && <BenefitsTab snapshot={snapshot} />}
      {tab === "employees" && <EmployeesTab snapshot={snapshot} />}
    </div>
  );
}

function OverviewTab({ client }: { client: ClientDetail }) {
  const latestSnapshot = client.snapshots[client.snapshots.length - 1];
  const fields = [
    { label: "Group ID", value: client.groupId },
    { label: "Group Name", value: client.groupName },
    { label: "State", value: client.state },
    { label: "SIC Code", value: client.sicCode },
    { label: "Lifecycle Status", value: client.status },
    { label: "First Year Seen", value: client.firstYear },
    { label: "Last Year Seen", value: client.lastYear },
    { label: "Years Present", value: client.years.join(", ") },
    { label: "Total Employees", value: latestSnapshot?.totalEmployees },
    { label: "Total Members", value: latestSnapshot?.totalMembers },
    { label: "Effective Date", value: latestSnapshot?.effectiveDate },
    { label: "Renewal Date", value: latestSnapshot?.renewalDate },
  ];

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <dl className="divide-y divide-gray-200">
        {fields.map((f) => (
          <div key={f.label} className="flex px-5 py-3">
            <dt className="w-48 text-sm font-medium text-gray-500">{f.label}</dt>
            <dd className="text-sm text-gray-900">{f.value ?? "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function BenefitsTab({ snapshot }: { snapshot?: Snapshot }) {
  if (!snapshot) return <p className="text-gray-500 text-sm">No data for this year.</p>;
  if (snapshot.benefitPlans.length === 0)
    return <p className="text-gray-500 text-sm">No benefit plans for {snapshot.year}.</p>;

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="text-left px-5 py-3 font-medium text-gray-500">Plan Type</th>
            <th className="text-left px-5 py-3 font-medium text-gray-500">Carrier</th>
            <th className="text-left px-5 py-3 font-medium text-gray-500">Plan Name</th>
            <th className="text-right px-5 py-3 font-medium text-gray-500">Eligible</th>
            <th className="text-right px-5 py-3 font-medium text-gray-500">Enrolled</th>
            <th className="text-right px-5 py-3 font-medium text-gray-500">Premium</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {snapshot.benefitPlans.map((plan) => (
            <tr key={plan.id} className="hover:bg-gray-50">
              <td className="px-5 py-3 font-medium">{plan.planType}</td>
              <td className="px-5 py-3">{plan.carrier ?? "—"}</td>
              <td className="px-5 py-3">{plan.planName ?? "—"}</td>
              <td className="px-5 py-3 text-right">{plan.eligible ?? "—"}</td>
              <td className="px-5 py-3 text-right">{plan.enrollees ?? "—"}</td>
              <td className="px-5 py-3 text-right">
                {plan.premium != null ? `$${plan.premium.toLocaleString()}` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmployeesTab({ snapshot }: { snapshot?: Snapshot }) {
  if (!snapshot) return <p className="text-gray-500 text-sm">No data for this year.</p>;

  const allEmployees = [
    ...snapshot.employees,
    ...snapshot.termedEmployees,
  ];

  if (allEmployees.length === 0)
    return <p className="text-gray-500 text-sm">No employees for {snapshot.year}.</p>;

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="text-left px-5 py-3 font-medium text-gray-500">Name</th>
            <th className="text-left px-5 py-3 font-medium text-gray-500">Employee ID</th>
            <th className="text-left px-5 py-3 font-medium text-gray-500">Status</th>
            <th className="text-left px-5 py-3 font-medium text-gray-500">Coverage</th>
            <th className="text-left px-5 py-3 font-medium text-gray-500">Hire Date</th>
            <th className="text-left px-5 py-3 font-medium text-gray-500">Change</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {allEmployees.map((emp) => (
            <tr key={emp.employeeId} className="hover:bg-gray-50">
              <td className="px-5 py-3 font-medium">
                {emp.firstName} {emp.lastName}
              </td>
              <td className="px-5 py-3">{emp.employeeId}</td>
              <td className="px-5 py-3">{emp.status ?? "—"}</td>
              <td className="px-5 py-3">{emp.coverageTier ?? "—"}</td>
              <td className="px-5 py-3">{emp.hireDate ?? "—"}</td>
              <td className="px-5 py-3">
                {emp.changeStatus ? (
                  <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${changeColors[emp.changeStatus]}`}>
                    {emp.changeStatus}
                  </span>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
