import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "S&S Company Affairs",
  description: "A personal stock watchlist that explains itself.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <header className="mb-10 flex items-baseline justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">
                S&amp;S Company Affairs
              </h1>
              <p className="mt-1 text-sm text-neutral-500">
                A personal stock watchlist that explains itself.
              </p>
            </div>
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
