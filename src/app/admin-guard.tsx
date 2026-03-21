"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";

const ADMIN_PIN = "8787";

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [pinValue, setPinValue] = useState("");
  const [pinError, setPinError] = useState(false);
  const pinInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem("admin-unlocked");
    setUnlocked(saved === "true");
  }, []);

  function handleSubmit() {
    if (pinValue === ADMIN_PIN) {
      setUnlocked(true);
      sessionStorage.setItem("admin-unlocked", "true");
    } else {
      setPinError(true);
      setPinValue("");
      pinInputRef.current?.focus();
    }
  }

  // Loading state
  if (unlocked === null) return null;

  // Already unlocked
  if (unlocked) return <>{children}</>;

  // Show PIN prompt
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="bg-white rounded-2xl border border-bob-border shadow-sm p-8 w-96 text-center">
        <div className="w-14 h-14 rounded-full bg-bob-purple-light flex items-center justify-center mx-auto mb-4">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#7C5CFC" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-bob-text mb-1">Admin Access Required</h2>
        <p className="text-sm text-bob-text-soft mb-6">Enter your PIN to access this section</p>
        <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
          <input
            ref={pinInputRef}
            type="password"
            inputMode="numeric"
            maxLength={4}
            value={pinValue}
            onChange={(e) => {
              setPinValue(e.target.value.replace(/\D/g, ""));
              setPinError(false);
            }}
            placeholder="Enter PIN"
            className={`w-full text-center text-2xl tracking-[0.5em] font-mono py-3 rounded-xl border-2 transition-colors outline-none ${
              pinError
                ? "border-red-300 bg-red-50 text-red-600"
                : "border-bob-border focus:border-bob-purple bg-bob-bg"
            }`}
            autoFocus
          />
          {pinError && (
            <p className="text-xs text-red-500 mt-2">Incorrect PIN. Try again.</p>
          )}
          <button
            type="submit"
            disabled={pinValue.length < 4}
            className="w-full mt-4 py-2.5 rounded-xl bg-bob-purple text-white text-sm font-semibold hover:bg-bob-purple/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Unlock
          </button>
        </form>
        <button
          onClick={() => router.push("/")}
          className="mt-3 text-xs text-bob-text-soft hover:text-bob-text transition-colors"
        >
          Go back to Groups
        </button>
      </div>
    </div>
  );
}
