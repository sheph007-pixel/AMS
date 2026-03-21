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
    href: "/",
    label: "Groups",
    icon: (active: boolean) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? "#7C5CFC" : "#9CA3AF"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    href: "/reports",
    label: "Reports",
    icon: (active: boolean) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? "#7C5CFC" : "#9CA3AF"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12c0-4.97-4.03-9-9-9s-9 4.03-9 9 4.03 9 9 9" />
        <path d="M12 3v9l6 3" />
        <circle cx="19" cy="19" r="3" />
      </svg>
    ),
  },
];

const adminNavItems = [
  {
    href: "/import",
    label: "Upload",
    icon: (active: boolean) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? "#7C5CFC" : "#9CA3AF"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 15V3m0 0l-4 4m4-4l4 4" />
        <path d="M2 17l.621 2.485A2 2 0 0 0 4.561 21h14.878a2 2 0 0 0 1.94-1.515L22 17" />
      </svg>
    ),
  },
  {
    href: "/rules",
    label: "Rules",
    icon: (active: boolean) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? "#7C5CFC" : "#9CA3AF"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
];

const ADMIN_PIN = "8787";

// ─── SideNav ─────────────────────────────────────────────────────────────────

export function SideNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  // Load collapsed state from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("sidebar-collapsed");
    if (saved === "true") setCollapsed(true);
  }, []);

  // Load admin session
  useEffect(() => {
    const saved = sessionStorage.getItem("admin-unlocked");
    if (saved === "true") setAdminUnlocked(true);
  }, []);

  // Close mobile menu on route change
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
    // If currently on an admin page, redirect home
    if (pathname.startsWith("/import") || pathname.startsWith("/rules")) {
      router.push("/");
    }
  }

  const sidebarWidth = collapsed ? 72 : 200;
  // On mobile, sidebar is always expanded when open
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  const showLabels = isMobile || !collapsed;

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
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-bob-purple to-bob-coral flex items-center justify-center text-white font-bold text-xs">
            K
          </div>
          <span className="text-sm font-bold text-bob-text">Kennion</span>
        </div>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/30 z-[60]"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <nav
        className={`sidebar-nav fixed left-0 top-0 bottom-0 bg-white border-r border-bob-border flex flex-col py-5 z-[70] transition-all duration-300
          max-md:w-[260px] max-md:shadow-2xl
          ${mobileOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full"}
        `}
        style={{ "--sidebar-w": `${sidebarWidth}px` } as React.CSSProperties}
      >
        {/* Logo + collapse toggle */}
        <div className={`flex items-center ${!showLabels ? "justify-center" : "px-4 justify-between"} mb-6`}>
          <a href="/" className="group flex items-center gap-3" onClick={() => setMobileOpen(false)}>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-bob-purple to-bob-coral flex items-center justify-center text-white font-bold text-sm group-hover:scale-105 transition-transform duration-200 flex-shrink-0">
              K
            </div>
            {showLabels && (
              <span className="text-sm font-bold text-bob-text tracking-tight leading-tight">Kennion<br /><span className="text-[10px] font-semibold text-bob-text-soft">Program Manager</span></span>
            )}
          </a>
          {showLabels && !isMobile && (
            <button
              onClick={toggleCollapsed}
              className="w-7 h-7 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
              title="Collapse sidebar"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 3L5 8l5 5" />
              </svg>
            </button>
          )}
          {isMobile && (
            <button
              onClick={() => setMobileOpen(false)}
              className="w-7 h-7 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Expand button when collapsed (desktop only) */}
        {!showLabels && !isMobile && (
          <button
            onClick={toggleCollapsed}
            className="mx-auto mb-4 w-7 h-7 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
            title="Expand sidebar"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 3l5 5-5 5" />
            </svg>
          </button>
        )}

        {/* Main Nav */}
        <div className={`flex flex-col gap-1 ${!showLabels ? "items-center px-2" : "px-3"}`}>
          {mainNavItems.map((item) => {
            const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`relative flex items-center gap-3 ${!showLabels ? "justify-center px-2" : "px-3"} py-2.5 rounded-xl transition-all duration-200 group ${
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
          })}
        </div>

        {/* Admin Section Divider */}
        <div className={`my-4 ${!showLabels ? "px-4" : "px-5"}`}>
          <div className="border-t border-bob-border" />
        </div>

        {/* Admin Section Header */}
        <div className={`${!showLabels ? "px-2 items-center" : "px-3"} flex flex-col gap-1`}>
          {showLabels && (
            <div className="flex items-center justify-between px-3 mb-1">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Admin</span>
              {adminUnlocked && (
                <button
                  onClick={lockAdmin}
                  className="text-[10px] text-gray-400 hover:text-red-500 transition-colors"
                  title="Lock admin"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </button>
              )}
            </div>
          )}

          {adminNavItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            const locked = !adminUnlocked;

            return (
              <button
                key={item.href}
                onClick={() => handleAdminNavClick(item.href)}
                className={`relative flex items-center gap-3 ${!showLabels ? "justify-center px-2" : "px-3"} py-2.5 rounded-xl transition-all duration-200 group w-full text-left ${
                  isActive && !locked
                    ? "bg-bob-purple-light"
                    : locked
                    ? "hover:bg-gray-50 opacity-60"
                    : "hover:bg-gray-50"
                }`}
                title={!showLabels ? `${item.label}${locked ? " (locked)" : ""}` : undefined}
              >
                {isActive && !locked && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-bob-purple rounded-r-full" />
                )}
                <span className="flex-shrink-0">{item.icon(isActive && !locked)}</span>
                {showLabels && (
                  <span className={`text-sm font-medium flex-1 ${
                    isActive && !locked ? "text-bob-purple" : "text-gray-500 group-hover:text-gray-700"
                  }`}>
                    {item.label}
                  </span>
                )}
                {locked && showLabels && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                )}
                {locked && !showLabels && (
                  <div className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-gray-300 flex items-center justify-center">
                    <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bottom avatar */}
        <div className={`${!showLabels ? "flex justify-center" : "px-4"}`}>
          <div className={`flex items-center gap-3 ${!showLabels ? "" : "px-2"}`}>
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-bob-teal to-bob-blue flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
              U
            </div>
            {showLabels && (
              <div>
                <p className="text-xs font-medium text-bob-text">User</p>
                <p className="text-[10px] text-gray-400">Standard</p>
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
