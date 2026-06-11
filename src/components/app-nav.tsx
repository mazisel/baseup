"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BarChart3, Plus, Settings } from "lucide-react";
import type { AppCopy } from "@/lib/i18n";
import type { AppUser } from "@/types/domain";

export function AppNav({ copy, user }: { copy: AppCopy; user: AppUser }) {
  const pathname = usePathname();

  const links = [
    {
      href: "/app",
      icon: BarChart3,
      label: copy.nav.dashboard,
      visible: true,
      exact: true,
    },
    {
      href: "/app/new-job",
      icon: Plus,
      label: copy.nav.newJob,
      visible: user.role !== "viewer",
    },
    {
      href: "/app/monitors",
      icon: Activity,
      label: "Monitors",
      visible: user.role !== "viewer",
    },
    {
      href: "/app/settings",
      icon: Settings,
      label: copy.nav.settings,
      visible: true,
    },
  ];

  return (
    <nav className="side-nav" aria-label={copy.nav.dashboard}>
      {links.filter(link => link.visible).map(link => {
        const Icon = link.icon;
        const isActive = link.exact ? pathname === link.href : pathname.startsWith(link.href);

        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            className={isActive ? "active" : undefined}
            href={link.href}
            key={link.href}
          >
            <Icon size={18} />
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
