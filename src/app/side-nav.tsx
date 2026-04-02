"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, createContext, useContext } from "react";
import { PinModal } from "./pin-modal";

// ─── Sidebar context for layout ──────────────────────────────────────────────

export const SidebarContext = createContext({ collapsed: false });

export function useSidebar() {
  return useContext(SidebarContext);
}

// ─── Nav items ───────────────────────────────────────────────────────────────

const mainNavItems = [
  {
    href: "/reports/production-dashboard",
    label: "Production Report",
    icon: (active: boolean) => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={active ? "#7C5CFC" : "#9CA3AF"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M9 21V9" />
      </svg>
    ),
  },
];

const adminNavItems = [
  {
    href: "/import",
    label: "Data Upload",
    icon: (active: boolean) => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={active ? "#7C5CFC" : "#9CA3AF"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 15V3m0 0l-4 4m4-4l4 4" /><path d="M2 17l.621 2.485A2 2 0 0 0 4.561 21h14.878a2 2 0 0 0 1.94-1.515L22 17" />
      </svg>
    ),
  },
  {
    href: "/schemas",
    label: "Schemas",
    icon: (active: boolean) => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={active ? "#7C5CFC" : "#9CA3AF"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v6c0 1.66 4 3 9 3s9-1.34 9-3V5" /><path d="M3 11v6c0 1.66 4 3 9 3s9-1.34 9-3v-6" />
      </svg>
    ),
  },
];

const ADMIN_PIN = "8787";

// ─── SideNav ─────────────────────────────────────────────────────────────────

function NavLink({
  item,
  isActive,
  showLabels,
  onClick,
}: {
  item: { href: string; label: string; icon: (active: boolean) => React.ReactNode };
  isActive: boolean;
  showLabels: boolean;
  onClick?: () => void;
}) {
  return (
    <a
      href={item.href}
      onClick={onClick}
      className={`relative flex items-center gap-3 ${!showLabels ? "justify-center px-2" : "px-3"} py-2 rounded-xl transition-all duration-200 group ${
        isActive ? "bg-bob-purple-light" : "hover:bg-gray-50"
      }`}
      title={!showLabels ? item.label : undefined}
    >
      {isActive && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-bob-purple rounded-r-full" />
      )}
      <span className="flex-shrink-0">{item.icon(isActive)}</span>
      {showLabels && (
        <span className={`text-sm font-medium ${
          isActive ? "text-bob-purple" : "text-gray-500 group-hover:text-gray-700"
        }`}>
          {item.label}
        </span>
      )}
    </a>
  );
}

function SectionLabel({ label, showLabels }: { label: string; showLabels: boolean }) {
  if (!showLabels) return null;
  return (
    <div className="px-3 mb-1 mt-1">
      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{label}</span>
    </div>
  );
}

export function SideNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("sidebar-collapsed");
    if (saved === "true") setCollapsed(true);
  }, []);

  useEffect(() => {
    const saved = sessionStorage.getItem("admin-unlocked");
    if (saved === "true") setAdminUnlocked(true);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("sidebar-collapsed", String(next));
    window.dispatchEvent(new CustomEvent("sidebar-toggle", { detail: { collapsed: next } }));
  }

  function handleAdminNavClick(href: string) {
    if (adminUnlocked) {
      router.push(href);
      return;
    }
    setPendingHref(href);
    setShowPinModal(true);
  }

  function lockAdmin() {
    setAdminUnlocked(false);
    sessionStorage.removeItem("admin-unlocked");
    if (pathname.startsWith("/import") || pathname.startsWith("/rules")) {
      router.push("/");
    }
  }

  const sidebarWidth = collapsed ? 72 : 220;
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  const showLabels = isMobile || !collapsed;

  function isActive(href: string, matchExact?: boolean) {
    if (matchExact) return pathname === href;
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <>
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-white border-b border-bob-border z-50 flex items-center px-4 gap-3">
        <button
          onClick={() => setMobileOpen(true)}
          className="w-9 h-9 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-600"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12h18M3 6h18M3 18h18" />
          </svg>
        </button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-bob-purple to-bob-blue flex items-center justify-center text-white font-bold text-xs">
            K
          </div>
          <span className="text-sm font-bold text-bob-text tracking-tight">Kennion AMS</span>
        </div>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 bg-black/30 z-[60]" onClick={() => setMobileOpen(false)} />
      )}

      <nav
        className={`sidebar-nav fixed left-0 top-0 bottom-0 bg-white border-r border-bob-border flex flex-col py-5 z-[70] transition-all duration-300
          max-md:w-[280px] max-md:shadow-2xl
          ${mobileOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full"}
        `}
        style={{ "--sidebar-w": `${sidebarWidth}px` } as React.CSSProperties}
      >
        {/* Logo */}
        <div className={`flex items-center ${!showLabels ? "justify-center" : "px-4 justify-between"} mb-6`}>
          <a href="/" className="group flex items-center gap-3" onClick={() => setMobileOpen(false)}>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-bob-purple to-bob-blue flex items-center justify-center text-white font-bold text-sm group-hover:scale-105 transition-transform duration-200 flex-shrink-0">
              K
            </div>
            {showLabels && (
              <div className="leading-tight">
                <span className="text-sm font-bold text-bob-text tracking-tight">Kennion</span>
                <br />
                <span className="text-[10px] font-semibold text-bob-text-soft tracking-wide uppercase">Agency Management</span>
              </div>
            )}
          </a>
          {showLabels && !isMobile && (
            <button onClick={toggleCollapsed} className="w-7 h-7 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors" title="Collapse sidebar">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3L5 8l5 5" /></svg>
            </button>
          )}
          {isMobile && (
            <button onClick={() => setMobileOpen(false)} className="w-7 h-7 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          )}
        </div>

        {/* Expand button when collapsed */}
        {!showLabels && !isMobile && (
          <button onClick={toggleCollapsed} className="mx-auto mb-4 w-7 h-7 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors" title="Expand sidebar">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3l5 5-5 5" /></svg>
          </button>
        )}

        {/* Main Nav */}
        <div className={`flex flex-col gap-0.5 ${!showLabels ? "items-center px-2" : "px-3"}`}>
          {mainNavItems.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              isActive={isActive(item.href)}
              showLabels={showLabels}
              onClick={() => setMobileOpen(false)}
            />
          ))}
        </div>

        {/* ADMIN Section */}
        <div className={`my-3 ${!showLabels ? "px-4" : "px-5"}`}>
          <div className="border-t border-bob-border" />
        </div>
        <div className={`${!showLabels ? "px-2 items-center" : "px-3"} flex flex-col gap-0.5`}>
          {showLabels && (
            <div className="flex items-center justify-between px-3 mb-1">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Admin</span>
              {adminUnlocked && (
                <button onClick={lockAdmin} className="text-[10px] text-gray-400 hover:text-red-500 transition-colors" title="Lock admin">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </button>
              )}
            </div>
          )}
          {adminNavItems.map((item) => {
            const active = pathname.startsWith(item.href);
            const locked = !adminUnlocked;
            return (
              <button
                key={item.href}
                onClick={() => handleAdminNavClick(item.href)}
                className={`relative flex items-center gap-3 ${!showLabels ? "justify-center px-2" : "px-3"} py-2 rounded-xl transition-all duration-200 group w-full text-left ${
                  active && !locked ? "bg-bob-purple-light" : locked ? "hover:bg-gray-50 opacity-60" : "hover:bg-gray-50"
                }`}
                title={!showLabels ? `${item.label}${locked ? " (locked)" : ""}` : undefined}
              >
                {active && !locked && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-bob-purple rounded-r-full" />
                )}
                <span className="flex-shrink-0">{item.icon(active && !locked)}</span>
                {showLabels && (
                  <span className={`text-sm font-medium flex-1 ${
                    active && !locked ? "text-bob-purple" : "text-gray-500 group-hover:text-gray-700"
                  }`}>{item.label}</span>
                )}
                {locked && showLabels && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                )}
                {locked && !showLabels && (
                  <div className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-gray-300 flex items-center justify-center">
                    <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bottom user */}
        <div className={`${!showLabels ? "flex justify-center" : "px-4"}`}>
          <div className={`flex items-center gap-3 ${!showLabels ? "" : "px-2"}`}>
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-bob-purple to-bob-blue flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
              K
            </div>
            {showLabels && (
              <div>
                <p className="text-xs font-medium text-bob-text">Kennion</p>
                <p className="text-[10px] text-gray-400">Program Manager</p>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* PIN Modal */}
      {showPinModal && (
        <PinModal
          onSubmit={(pin) => {
            if (pin === ADMIN_PIN) {
              setAdminUnlocked(true);
              sessionStorage.setItem("admin-unlocked", "true");
              setShowPinModal(false);
              if (pendingHref) {
                router.push(pendingHref);
                setPendingHref(null);
              }
              return true;
            }
            return false;
          }}
          onCancel={() => { setShowPinModal(false); setPendingHref(null); }}
        />
      )}
    </>
  );
}
