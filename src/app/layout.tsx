import type { Metadata } from "next";
import Link from "next/link";
import { countUnread } from "@/services/alerts";
import "./globals.css";

export const metadata: Metadata = {
  title: "S&S Company Affairs",
  description: "A personal stock watchlist that explains itself.",
};

const NAV_LINK =
  "text-neutral-600 underline-offset-4 hover:underline dark:text-neutral-400";

/**
 * Unread count beside the alerts link.
 *
 * Read on every page, which is the point — an alerting feature that only
 * tells you something when you visit its own page is one you forget exists.
 * Kept to a count rather than a preview: the number is the signal, and
 * anything richer in a header competes with the page.
 *
 * Failure here degrades to no badge rather than an error page. The header is
 * not worth taking the site down for, and an empty database during setup is
 * the most likely cause.
 */
async function AlertsLink() {
  const unread = await countUnread().catch(() => 0);

  return (
    <Link href="/alerts" className={`${NAV_LINK} inline-flex items-center gap-1.5`}>
      Alerts
      {unread > 0 && (
        <span
          className="tnum rounded-full bg-neutral-900 px-1.5 py-0.5 text-[10px] font-medium leading-none text-white dark:bg-white dark:text-neutral-900"
          aria-label={`${unread} unread`}
        >
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <header className="mb-10 flex flex-wrap items-baseline justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">
                <Link href="/">S&amp;S Company Affairs</Link>
              </h1>
              <p className="mt-1 text-sm text-neutral-500">
                A personal stock watchlist that explains itself.
              </p>
            </div>
            <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <Link href="/" className={NAV_LINK}>
                Watchlist
              </Link>
              <Link href="/news" className={NAV_LINK}>
                News
              </Link>
              <Link href="/portfolio" className={NAV_LINK}>
                Portfolio
              </Link>
              <AlertsLink />
              <Link href="/digest" className={NAV_LINK}>
                Digest
              </Link>
              <Link href="/learn" className={NAV_LINK}>
                Learn
              </Link>
            </nav>
          </header>
          <main>{children}</main>
          <footer className="mt-16 border-t border-neutral-200 pt-6 text-xs text-neutral-500 dark:border-neutral-800">
            Personal research tool. Not investment advice. Market data is
            delayed and may be inaccurate.
          </footer>
        </div>
      </body>
    </html>
  );
}
