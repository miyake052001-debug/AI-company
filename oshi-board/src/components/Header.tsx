"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMulti } from "@/lib/client/state";
import { useHydrated } from "@/lib/client/store";

const NAV = [
  { href: "/", label: "配信" },
  { href: "/discover", label: "見つける" },
  { href: "/multi", label: "マルチビュー" },
  { href: "/clips", label: "切り抜き" },
  { href: "/channels", label: "フォロー管理" },
] as const;

export function Header() {
  const pathname = usePathname();
  const multi = useMulti();
  const hydrated = useHydrated();

  return (
    <header className="sticky top-0 z-40 h-14 shrink-0 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-full max-w-[1800px] items-center gap-3 px-3 sm:gap-6 sm:px-5">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-bold">
          <span className="grid size-7 place-items-center rounded-lg bg-accent text-sm text-white">推</span>
          <span className="hidden text-lg tracking-tight sm:inline">推しボード</span>
        </Link>
        <nav className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto">
          {NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative shrink-0 rounded-md px-2.5 py-1.5 text-sm transition-colors sm:px-3 ${
                  active ? "bg-panel-2 text-white" : "text-muted hover:bg-panel hover:text-white"
                }`}
              >
                {item.label}
                {item.href === "/multi" && hydrated && multi.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {multi.length}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
