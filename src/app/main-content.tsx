"use client";

import { useState, useEffect } from "react";

export function MainContent({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("sidebar-collapsed");
    if (saved === "true") setCollapsed(true);

    function handleToggle(e: Event) {
      const detail = (e as CustomEvent).detail;
      setCollapsed(detail.collapsed);
    }
    window.addEventListener("sidebar-toggle", handleToggle);
    return () => window.removeEventListener("sidebar-toggle", handleToggle);
  }, []);

  return (
    <main
      className="flex-1 min-h-screen transition-all duration-300 md:ml-[var(--sidebar-ml)]"
      style={{ "--sidebar-ml": `${collapsed ? 72 : 200}px` } as React.CSSProperties}
    >
      {/* On mobile: no margin-left, top padding for fixed header bar */}
      <div className="px-4 py-4 pt-[72px] md:px-6 md:py-6 md:pt-6">
        {children}
      </div>
    </main>
  );
}
