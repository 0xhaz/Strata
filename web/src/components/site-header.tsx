"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Logo } from "./logo";

const NAV = [
  { href: "/mantle", label: "Vaults" },
  { href: "/live", label: "Live agent" },
];

/** Sticky top nav shared across pages. `right` holds the page-specific wallet button. */
export function SiteHeader({ right }: { right?: ReactNode }) {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-5">
        <Link href="/" className="shrink-0 transition-opacity hover:opacity-80" aria-label="Strata home">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-0.5 md:flex">
          {NAV.map((n) => {
            const active = path === n.href || (n.href !== "/" && path.startsWith(n.href));
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`rounded-lg px-3 py-1.5 text-sm transition ${
                  active ? "bg-violet-500/10 text-violet-200" : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                }`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex shrink-0 items-center gap-2">{right}</div>
      </div>
    </header>
  );
}
