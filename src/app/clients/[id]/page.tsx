"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, Building2, Shield, Users, X, Calendar, MapPin, Hash } from "lucide-react";
import { normalizeCompanyName } from "@/lib/normalize-name";

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

const statusConfig: Record<string, { bg: string; text: string; dot: string }> = {
  Active: { bg: "bg-bob-green-light", text: "text-emerald-700", dot: "bg-bob-green" },
  New: { bg: "bg-bob-blue-light", text: "text-blue-700", dot: "bg-bob-blue" },
  Termed: { bg: "bg-bob-coral-light", text: "text-red-600", dot: "bg-bob-coral" },
  Returned: { bg: "bg-bob-amber-light", text: "text-amber-700", dot: "bg-bob-amber" },
};

const changeConfig: Record<string, { bg: string; text: string }> = {
  added: { bg: "bg-bob-green-light", text: "text-emerald-700" },
  termed: { bg: "bg-bob-coral-light", text: "text-red-600" },
  continued: { bg: "bg-gray-100", text: "text-gray-600" },
};

type Tab = "overview" | "benefits" | "employees";

export default function ClientDetailPage() {
  const params = useParams();
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("overview");
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
  const [drawerEmployee, setDrawerEmployee] = useState<Employee | null>(null);

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

  if (loading) return (
    <div className="text-center py-16 text-bob-text-soft">
      <div className="w-8 h-8 border-2 border-bob-purple border-t-transparent rounded-full animate-spin mx-auto mb-3" />
      Loading...
    </div>
  );
  if (!client) return (
    <div className="text-center py-16">
      <p className="text-bob-text font-semibold">Group not found</p>
      <p className="text-bob-text-soft text-sm mt-1">This group may have been removed</p>
    </div>
  );

  const snapshot = client.snapshots.find((s) => s.id === selectedSnapshotId);
  const sc = statusConfig[client.status] || statusConfig.Active;

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "overview", label: "Overview", icon: <Building2 className="w-4 h-4" /> },
    { key: "benefits", label: "Benefits", icon: <Shield className="w-4 h-4" /> },
    { key: "employees", label: "People", icon: <Users className="w-4 h-4" /> },
  ];

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <a href="/" className="inline-flex items-center gap-1.5 text-sm text-bob-text-soft hover:text-bob-purple transition-colors duration-200 mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to People
        </a>

        <div className="bg-white rounded-2xl md:rounded-3xl border border-bob-border p-4 md:p-7">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div className="flex items-center gap-4 md:gap-5">
              <div className="w-11 h-11 md:w-14 md:h-14 rounded-xl md:rounded-2xl bg-gradient-to-br from-bob-purple-light to-bob-blue-light flex items-center justify-center flex-shrink-0">
                <span className="text-lg md:text-xl font-bold text-bob-purple">
                  {normalizeCompanyName(client.groupName).charAt(0)}
                </span>
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 md:gap-3">
                  <h1 className="text-lg md:text-2xl font-bold text-bob-text truncate">{normalizeCompanyName(client.groupName)}</h1>
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 md:px-3 md:py-1 text-[10px] md:text-xs font-semibold rounded-full ${sc.bg} ${sc.text}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                    {client.status}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3 md:gap-4 mt-1.5 md:mt-2 text-xs md:text-sm text-bob-text-soft">
                  <span className="flex items-center gap-1"><Hash className="w-3.5 h-3.5" />{client.groupId}</span>
                  {client.state && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{client.state}</span>}
                  {client.sicCode && <span>SIC {client.sicCode}</span>}
                </div>
              </div>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {client.snapshots.map((s) => (
                <span key={s.id} className="px-2.5 py-1 md:px-3 md:py-1.5 text-[10px] md:text-xs font-medium bg-bob-bg text-bob-text-soft rounded-lg md:rounded-xl">
                  {s.month > 0 ? `${s.month}/${s.year}` : s.year}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-bob-bg rounded-2xl p-1.5 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-xl transition-all duration-200 ${
              tab === t.key
                ? "bg-white text-bob-purple shadow-sm"
                : "text-bob-text-soft hover:text-bob-text"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Period selector */}
      {tab !== "overview" && client.snapshots.length > 0 && (
        <div className="flex items-center gap-2 mb-5">
          <Calendar className="w-4 h-4 text-bob-text-soft" />
          <span className="text-sm text-bob-text-soft">Period:</span>
          <div className="flex gap-1.5">
            {client.snapshots.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedSnapshotId(s.id)}
                className={`px-3.5 py-1.5 text-sm font-medium rounded-xl transition-all duration-200 ${
                  selectedSnapshotId === s.id
                    ? "bg-bob-purple text-white shadow-sm"
                    : "bg-white text-bob-text-soft border border-bob-border hover:border-bob-purple/30"
                }`}
              >
                {s.month > 0 ? `${s.month}/${s.year}` : s.year}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tab content */}
      {tab === "overview" && <OverviewTab client={client} />}
      {tab === "benefits" && <BenefitsTab snapshot={snapshot} />}
      {tab === "employees" && <EmployeesTab snapshot={snapshot} onEmployeeClick={setDrawerEmployee} />}

      {/* Employee Drawer */}
      {drawerEmployee && (
        <EmployeeDrawer employee={drawerEmployee} onClose={() => setDrawerEmployee(null)} />
      )}
    </div>
  );
}

function OverviewTab({ client }: { client: ClientDetail }) {
  const latestSnapshot = client.snapshots[client.snapshots.length - 1];

  const sections = [
    {
      title: "Group Info",
      fields: [
        { label: "Group ID", value: client.groupId },
        { label: "Group Name", value: normalizeCompanyName(client.groupName) },
        { label: "State", value: client.state },
        { label: "SIC Code", value: client.sicCode },
      ],
    },
    {
      title: "Lifecycle",
      fields: [
        { label: "Status", value: client.status },
        { label: "First Year Seen", value: client.firstYear },
        { label: "Last Year Seen", value: client.lastYear },
        { label: "Years Present", value: client.years.join(", ") },
      ],
    },
    {
      title: "Coverage Details",
      fields: [
        { label: "Total Employees", value: latestSnapshot?.totalEmployees },
        { label: "Total Members", value: latestSnapshot?.totalMembers },
        { label: "Effective Date", value: latestSnapshot?.effectiveDate },
        { label: "Renewal Date", value: latestSnapshot?.renewalDate },
      ],
    },
  ];

  return (
    <div className="grid gap-4 stagger-children">
      {sections.map((section) => (
        <div key={section.title} className="bg-white rounded-2xl border border-bob-border p-6">
          <h3 className="text-sm font-semibold text-bob-text-soft uppercase tracking-wider mb-4">{section.title}</h3>
          <div className="grid grid-cols-2 gap-4">
            {section.fields.map((f) => (
              <div key={f.label}>
                <p className="text-xs font-medium text-bob-text-soft mb-1">{f.label}</p>
                <p className="text-sm font-semibold text-bob-text">{f.value ?? "—"}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function BenefitsTab({ snapshot }: { snapshot?: Snapshot }) {
  if (!snapshot) return <EmptyState message="No data for this period" />;
  if (snapshot.benefitPlans.length === 0)
    return <EmptyState message={`No benefit plans for ${snapshot.year}`} />;

  const planTypeColors: Record<string, string> = {
    Medical: "bg-bob-coral-light text-red-600",
    Dental: "bg-bob-blue-light text-blue-700",
    Vision: "bg-bob-purple-light text-bob-purple",
    Life: "bg-bob-green-light text-emerald-700",
    STD: "bg-bob-amber-light text-amber-700",
    LTD: "bg-bob-teal-light text-emerald-700",
  };

  return (
    <div className="space-y-3 stagger-children">
      {snapshot.benefitPlans.map((plan) => {
        const typeColor = planTypeColors[plan.planType] || "bg-gray-100 text-gray-700";
        return (
          <div key={plan.id} className="bg-white rounded-2xl border border-bob-border p-5 hover:shadow-sm transition-shadow duration-200">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <span className={`px-3 py-1 rounded-xl text-xs font-semibold ${typeColor}`}>
                  {plan.planType}
                </span>
                <div>
                  <p className="font-semibold text-bob-text">{plan.carrier ?? "Unknown Carrier"}</p>
                  <p className="text-sm text-bob-text-soft">{plan.planName ?? "—"}</p>
                </div>
              </div>
              <div className="flex gap-6 text-right">
                <div>
                  <p className="text-xs font-medium text-bob-text-soft">Eligible</p>
                  <p className="text-lg font-bold text-bob-text">{plan.eligible ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-bob-text-soft">Enrolled</p>
                  <p className="text-lg font-bold text-bob-purple">{plan.enrollees ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-bob-text-soft">Premium</p>
                  <p className="text-lg font-bold text-bob-text">
                    {plan.premium != null ? `$${plan.premium.toLocaleString()}` : "—"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EmployeesTab({ snapshot, onEmployeeClick }: { snapshot?: Snapshot; onEmployeeClick: (emp: Employee) => void }) {
  const [search, setSearch] = useState("");

  if (!snapshot) return <EmptyState message="No data for this period" />;

  const allEmployees = [...snapshot.employees, ...snapshot.termedEmployees];
  if (allEmployees.length === 0)
    return <EmptyState message={`No people for ${snapshot.year}`} />;

  const filtered = allEmployees.filter((emp) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      emp.firstName.toLowerCase().includes(s) ||
      emp.lastName.toLowerCase().includes(s) ||
      emp.employeeId.toLowerCase().includes(s)
    );
  });

  return (
    <div>
      <div className="relative mb-4">
        <input
          type="text"
          placeholder="Find someone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm pl-4 pr-4 py-2.5 bg-white border border-bob-border rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-bob-purple/30 focus:border-bob-purple transition-all duration-200 placeholder:text-gray-400"
        />
      </div>
      <div className="space-y-2 stagger-children">
        {filtered.map((emp) => {
          const isActive = (emp.status || "Active").toLowerCase() === "active";
          const cc = emp.changeStatus ? changeConfig[emp.changeStatus] : null;
          return (
            <button
              key={emp.employeeId}
              onClick={() => onEmployeeClick(emp)}
              className="w-full text-left bg-white rounded-2xl border border-bob-border px-5 py-4 flex items-center justify-between hover:shadow-sm hover:border-bob-purple/20 transition-all duration-200 group"
            >
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold ${
                  isActive
                    ? "bg-gradient-to-br from-bob-purple-light to-bob-blue-light text-bob-purple"
                    : "bg-gray-100 text-gray-400"
                }`}>
                  {emp.firstName.charAt(0)}{emp.lastName.charAt(0)}
                </div>
                <div>
                  <p className="font-semibold text-bob-text group-hover:text-bob-purple transition-colors duration-200">
                    {emp.firstName} {emp.lastName}
                  </p>
                  <p className="text-sm text-bob-text-soft">{emp.employeeId}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`px-2.5 py-0.5 text-xs font-medium rounded-full ${
                  isActive ? "bg-bob-green-light text-emerald-700" : "bg-bob-coral-light text-red-600"
                }`}>
                  {emp.status || "Active"}
                </span>
                {emp.coverageTier && (
                  <span className="px-2.5 py-0.5 text-xs font-medium rounded-full bg-bob-bg text-bob-text-soft">
                    {emp.coverageTier}
                  </span>
                )}
                {cc && (
                  <span className={`px-2.5 py-0.5 text-xs font-medium rounded-full ${cc.bg} ${cc.text}`}>
                    {emp.changeStatus}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EmployeeDrawer({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const isActive = (employee.status || "Active").toLowerCase() === "active";

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 animate-fade-in" onClick={onClose} />
      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 w-[420px] bg-white shadow-2xl z-50 animate-slide-in overflow-y-auto">
        <div className="p-7">
          <div className="flex items-center justify-between mb-7">
            <h2 className="text-lg font-bold text-bob-text">Person Details</h2>
            <button onClick={onClose} className="p-2 rounded-xl hover:bg-bob-bg transition-colors duration-200">
              <X className="w-5 h-5 text-bob-text-soft" />
            </button>
          </div>

          {/* Profile card */}
          <div className="text-center mb-8">
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-3 text-lg font-bold ${
              isActive
                ? "bg-gradient-to-br from-bob-purple-light to-bob-blue-light text-bob-purple"
                : "bg-gray-100 text-gray-400"
            }`}>
              {employee.firstName.charAt(0)}{employee.lastName.charAt(0)}
            </div>
            <p className="text-xl font-bold text-bob-text">{employee.firstName} {employee.lastName}</p>
            <p className="text-sm text-bob-text-soft mt-1">{employee.employeeId}</p>
          </div>

          <div className="space-y-4">
            {[
              { label: "Status", value: employee.status || "Active" },
              { label: "Coverage Tier", value: employee.coverageTier },
              { label: "Date of Birth", value: employee.dateOfBirth },
              { label: "Hire Date", value: employee.hireDate },
              { label: "Term Date", value: employee.termDate },
              { label: "Change Status", value: employee.changeStatus },
            ].map((field) => (
              <div key={field.label} className="flex items-center justify-between py-3 border-b border-bob-border-light">
                <span className="text-sm text-bob-text-soft">{field.label}</span>
                <span className="text-sm font-semibold text-bob-text">{field.value ?? "—"}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-12 animate-fade-in">
      <p className="text-bob-text-soft text-sm">{message}</p>
    </div>
  );
}
