import type { Metadata } from "next";
import Link from "next/link";
import {
  deleteRuleAction,
  markAllReadAction,
  markReadAction,
  toggleRuleAction,
} from "@/app/alerts/actions";
import { KIND_INFO } from "@/alerts/rules";
import { AlertRuleForm } from "@/components/alert-rule-form";
import { Term } from "@/components/term";
import { formatRelativeTime } from "@/lib/format";
import { isEmailConfigured } from "@/providers/registry";
import { countUnread, listEvents, listRules } from "@/services/alerts";
import { listWatchlist } from "@/services/watchlist";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Alerts · S&S Company Affairs",
  description: "What you asked to be told about, and what has happened.",
};

export default async function AlertsPage() {
  const [rules, events, watchlist, unread] = await Promise.all([
    listRules(),
    listEvents(),
    listWatchlist(),
    countUnread(),
  ]);

  const emailConfigured = isEmailConfigured();

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold tracking-tight">Alerts</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Every rule fires on the <em>change</em>, not on the state. A price
          above your level is one alert, not one every fifteen minutes until it
          comes back down — and a rule watches from the moment you write it
          rather than searching what is already stored.
        </p>
      </div>

      <section className="mb-10">
        <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
          New alert
        </h3>
        <p className="mb-3 text-xs text-neutral-400">
          {emailConfigured
            ? "Email is configured, so either channel will reach you."
            : "Email is not configured, so alerts sent that way are only printed to the job log. This page always works."}
        </p>
        <AlertRuleForm
          tickers={watchlist.map((w) => w.ticker)}
          emailConfigured={emailConfigured}
        />
      </section>

      {rules.length > 0 && (
        <section className="mb-10">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-500">
            Watching for
          </h3>
          <ul className="space-y-2">
            {rules.map((rule) => (
              <li
                key={rule.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-neutral-100 pb-2 last:border-0 dark:border-neutral-900"
              >
                <div className="min-w-0">
                  {/*
                    Not wrapped in a <Term>: the sentence contains no jargon,
                    and underlining a whole line to explain "price" is noise.
                    The concept hangs off the kind label in the feed below,
                    the same way the news feed explains an event badge.
                  */}
                  <p
                    className={`text-sm ${
                      rule.enabled
                        ? ""
                        : "text-neutral-400 line-through decoration-neutral-300"
                    }`}
                  >
                    {rule.description}
                  </p>
                  <p className="mt-0.5 text-xs text-neutral-400">
                    {rule.channel === "email" ? "By email" : "On this page"} ·{" "}
                    {rule.firedCount === 0
                      ? "not fired yet"
                      : `fired ${rule.firedCount}×, last ${formatRelativeTime(rule.lastFiredAt)}`}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {/*
                    Disable is the prominent one. Deleting takes the firings
                    with it by cascade, and "AAPL rose above the level you set"
                    means nothing once the level is gone.
                  */}
                  <form action={toggleRuleAction}>
                    <input type="hidden" name="ruleId" value={rule.id} />
                    <input
                      type="hidden"
                      name="enabled"
                      value={String(!rule.enabled)}
                    />
                    <button
                      type="submit"
                      className="rounded px-2 py-1 text-xs text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
                    >
                      {rule.enabled ? "Pause" : "Resume"}
                    </button>
                  </form>
                  <form action={deleteRuleAction}>
                    <input type="hidden" name="ruleId" value={rule.id} />
                    <button
                      type="submit"
                      aria-label={`Delete alert: ${rule.description}`}
                      className="rounded px-2 py-1 text-xs text-neutral-400 transition hover:bg-neutral-100 hover:text-down dark:hover:bg-neutral-900"
                    >
                      Delete
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            What has fired
          </h3>
          {unread > 0 && (
            <form action={markAllReadAction}>
              <button
                type="submit"
                className="text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                Mark all {unread} read
              </button>
            </form>
          )}
        </div>

        {events.length === 0 ? (
          <div className="rounded-lg border border-dashed border-neutral-300 px-6 py-10 text-center dark:border-neutral-700">
            <p className="text-sm text-neutral-500">
              Nothing has fired yet. Rules are checked by{" "}
              <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs dark:bg-neutral-800">
                npm run alerts
              </code>{" "}
              and by the scheduled job.
            </p>
          </div>
        ) : (
          <ul>
            {events.map((event) => (
              <li
                key={event.id}
                className="flex items-start gap-3 border-b border-neutral-100 py-3 last:border-0 dark:border-neutral-900"
              >
                {/*
                  Unread is a dot rather than a background wash: the feed is
                  read top to bottom and a block of highlighted rows is harder
                  to scan than the plain text it is meant to draw attention to.
                */}
                <span
                  aria-hidden
                  className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
                    event.readAt ? "bg-transparent" : "bg-neutral-900 dark:bg-white"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium leading-snug">
                    {event.url ? (
                      event.url.startsWith("/") ? (
                        <Link
                          href={event.url}
                          className="underline-offset-4 hover:underline"
                        >
                          {event.title}
                        </Link>
                      ) : (
                        <a
                          href={event.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline-offset-4 hover:underline"
                        >
                          {event.title}
                        </a>
                      )
                    ) : (
                      event.title
                    )}
                  </p>
                  <p className="mt-0.5 text-sm leading-relaxed text-neutral-500">
                    {event.body}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-neutral-400">
                    <span>
                      {KIND_INFO[event.kind].concept ? (
                        <Term slug={KIND_INFO[event.kind].concept!}>
                          {KIND_INFO[event.kind].label}
                        </Term>
                      ) : (
                        KIND_INFO[event.kind].label
                      )}
                    </span>
                    <span aria-hidden>·</span>
                    <time dateTime={event.firedAt.toISOString()}>
                      {formatRelativeTime(event.firedAt)}
                    </time>
                    {event.deliveryError && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="text-down">
                          not delivered: {event.deliveryError}
                        </span>
                      </>
                    )}
                  </p>
                </div>

                {!event.readAt && (
                  <form action={markReadAction} className="shrink-0">
                    <input type="hidden" name="eventId" value={event.id} />
                    <button
                      type="submit"
                      aria-label={`Mark read: ${event.title}`}
                      className="rounded px-2 py-1 text-xs text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-900"
                    >
                      Read
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
