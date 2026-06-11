"use client";

import { LogOut } from "lucide-react";

export function LogoutButton({ label }: { label: string }) {
  return (
    <button
      className="button ghost"
      type="button"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        window.location.href = "/";
      }}
    >
      <LogOut size={16} />
      {label}
    </button>
  );
}
