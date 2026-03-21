"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PinModal } from "./pin-modal";

const ADMIN_PIN = "8787";

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [unlocked, setUnlocked] = useState<boolean | null>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem("admin-unlocked");
    setUnlocked(saved === "true");
  }, []);

  // Loading state
  if (unlocked === null) return null;

  // Already unlocked
  if (unlocked) return <>{children}</>;

  // Show PIN prompt (full-page style)
  return (
    <PinModal
      fullPage
      onSubmit={(pin) => {
        if (pin === ADMIN_PIN) {
          setUnlocked(true);
          sessionStorage.setItem("admin-unlocked", "true");
          return true;
        }
        return false;
      }}
      onCancel={() => router.push("/")}
    />
  );
}
