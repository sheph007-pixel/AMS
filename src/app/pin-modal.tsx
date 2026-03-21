"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface PinModalProps {
  /** Return true if PIN is correct, false to show error */
  onSubmit: (pin: string) => boolean;
  onCancel: () => void;
  /** Show as full-page instead of overlay modal */
  fullPage?: boolean;
}

export function PinModal({ onSubmit, onCancel, fullPage }: PinModalProps) {
  const [digits, setDigits] = useState(["", "", "", ""]);
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);
  const inputRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];

  useEffect(() => {
    inputRefs[0].current?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const trySubmit = useCallback((allDigits: string[]) => {
    const pin = allDigits.join("");
    if (pin.length === 4) {
      const correct = onSubmit(pin);
      if (!correct) {
        setError(true);
        setShake(true);
        setTimeout(() => {
          setShake(false);
          setDigits(["", "", "", ""]);
          inputRefs[0].current?.focus();
        }, 500);
      }
    }
  }, [onSubmit]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleDigitChange(index: number, value: string) {
    const digit = value.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = digit;
    setDigits(next);
    setError(false);

    if (digit && index < 3) {
      inputRefs[index + 1].current?.focus();
    }

    // Auto-submit when all 4 digits entered
    if (digit && index === 3) {
      trySubmit(next);
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs[index - 1].current?.focus();
    }
    if (e.key === "Escape") {
      onCancel();
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 4);
    if (pasted.length === 0) return;
    const next = ["", "", "", ""];
    for (let i = 0; i < pasted.length; i++) {
      next[i] = pasted[i];
    }
    setDigits(next);
    if (pasted.length === 4) {
      trySubmit(next);
    } else {
      inputRefs[Math.min(pasted.length, 3)].current?.focus();
    }
  }

  const content = (
    <div className={`bg-white rounded-2xl shadow-2xl p-8 w-[340px] ${shake ? "animate-shake" : "animate-fade-in-up"}`}>
      <div className="text-center mb-6">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-bob-purple/10 to-bob-purple/5 flex items-center justify-center mx-auto mb-4">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#7C5CFC" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-bob-text">Admin Access</h3>
        <p className="text-sm text-bob-text-soft mt-1">Enter your 4-digit PIN</p>
      </div>

      {/* 4 digit boxes */}
      <div className="flex justify-center gap-3 mb-5">
        {digits.map((digit, i) => (
          <input
            key={i}
            ref={inputRefs[i]}
            type="password"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            onChange={(e) => handleDigitChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={i === 0 ? handlePaste : undefined}
            className={`w-14 h-14 text-center text-xl font-semibold rounded-xl border-2 outline-none transition-all duration-200 ${
              error
                ? "border-red-300 bg-red-50 text-red-600"
                : digit
                ? "border-bob-purple bg-bob-purple-light/30 text-bob-text"
                : "border-bob-border bg-bob-bg text-bob-text focus:border-bob-purple focus:bg-white"
            }`}
          />
        ))}
      </div>

      {error && (
        <p className="text-sm text-red-500 text-center mb-4">Incorrect PIN. Try again.</p>
      )}

      <button
        onClick={onCancel}
        className="w-full py-2 text-sm text-bob-text-soft hover:text-bob-text transition-colors"
      >
        Cancel
      </button>
    </div>
  );

  if (fullPage) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        {content}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onCancel}
      />
      <div className="relative">
        {content}
      </div>
    </div>
  );
}
