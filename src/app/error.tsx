"use client";

import { useEffect } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { getCopy } from "@/lib/i18n";
import { getClientLocale } from "@/lib/preference-shared";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const copy = getCopy(getClientLocale()).errors;

  useEffect(() => {
    console.error("Root boundary caught error:", error);
  }, [error]);

  return (
    <div className="page" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
      <div className="panel" style={{ textAlign: "center", maxWidth: 400 }}>
        <AlertCircle size={48} style={{ color: "var(--error, #e53e3e)", margin: "0 auto 16px" }} />
        <h2 style={{ marginBottom: 8 }}>{copy.title}</h2>
        <p className="muted" style={{ marginBottom: 24 }}>
          {copy.description} {error.message}
        </p>
        <button className="button primary" onClick={() => reset()}>
          <RefreshCw size={16} />
          {copy.retry}
        </button>
      </div>
    </div>
  );
}
