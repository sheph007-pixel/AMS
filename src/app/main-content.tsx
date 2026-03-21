"use client";

import { useState, useEffect } from "react";

export function MainContent({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    // Read initial state
    const saved = localStorage.getItem("sidebar-collapsed");
    if (saved === "true") setCollapsed(true);

    // Listen for toggle events from sidebar
    function handleToggle(e: Event) {
      const detail = (e as CustomEvent).detail;
      setCollapsed(detail.collapsed);
    }
    window.addEventListener("sidebar-toggle", handleToggle);
    return () => window.removeEventListener("sidebar-toggle", handleToggle);
  }, []);

  return (
    <main
      className="flex-1 min-h-screen transition-all duration-300"
      style={{ marginLeft: collapsed ? 72 : 200 }}
    >
      <div className="max-w-6xl mx-auto px-8 py-8">
        {children}
      </div>
    </main>
  );
}
