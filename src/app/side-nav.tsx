"use client";

import { usePathname } from "next/navigation";

const navItems = [
  {
    href: "/",
    label: "People",
    icon: (active: boolean) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? "#7C5CFC" : "#9CA3AF"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
      </svg>
    ),
  },
  {
    href: "/reports",
    label: "Insights",
    icon: (active: boolean) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? "#7C5CFC" : "#9CA3AF"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12c0-4.97-4.03-9-9-9s-9 4.03-9 9 4.03 9 9 9" />
        <path d="M12 3v9l6 3" />
        <circle cx="19" cy="19" r="3" />
      </svg>
    ),
  },
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

export function SideNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed left-0 top-0 bottom-0 w-[72px] bg-white border-r border-bob-border flex flex-col items-center py-5 z-50">
      {/* Logo */}
      <a href="/" className="mb-8 group">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-bob-purple to-bob-coral flex items-center justify-center text-white font-bold text-sm group-hover:scale-105 transition-transform duration-200">
          A
        </div>
      </a>

      {/* Nav Items */}
      <div className="flex flex-col gap-2 flex-1">
        {navItems.map((item) => {
          const isActive = item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);

          return (
            <a
              key={item.href}
              href={item.href}
              className={`relative flex flex-col items-center gap-1 px-3 py-2.5 rounded-xl transition-all duration-200 group ${
                isActive
                  ? "bg-bob-purple-light"
                  : "hover:bg-gray-50"
              }`}
            >
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-bob-purple rounded-r-full" />
              )}
              {item.icon(isActive)}
              <span className={`text-[10px] font-medium leading-none ${
                isActive ? "text-bob-purple" : "text-gray-400 group-hover:text-gray-600"
              }`}>
                {item.label}
              </span>
            </a>
          );
        })}
      </div>

      {/* Bottom avatar */}
      <div className="mt-auto">
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-bob-teal to-bob-blue flex items-center justify-center text-white text-xs font-semibold">
          U
        </div>
      </div>
    </nav>
  );
}
