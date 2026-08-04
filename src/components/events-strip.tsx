import { Term } from "@/components/term";
import type { CompanyEvent, EventKind } from "@/db/schema";
import type { DatedEvent } from "@/services/fundamentals";

const KIND_LABEL: Record<EventKind, string> = {
  earnings: "Earnings",
  dividend: "Dividend",
  split: "Stock split",
  shareholder_meeting: "Annual meeting",
};

/** Concept explaining each event kind, where P1 authored one. */
const KIND_CONCEPT: Partial<Record<EventKind, string>> = {
  earnings: "earnings-call",
  dividend: "ex-dividend-date",
  split: "stock-split",
};

function formatDay(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Pure: the day count is resolved by the service, not read from the clock. */
function formatDaysAway(days: number): string {
  if (days === 0) return "today";
  if (days > 0) return `in ${days}d`;
  return `${Math.abs(days)}d ago`;
}

/** Detail lines from the provider payload, when it carried any. */
function payloadSummary(event: CompanyEvent): string | null {
  const payload = event.payload as Record<string, unknown> | null;
  if (!payload) return null;

  const parts: string[] = [];
  if (typeof payload.epsEstimate === "number") {
    parts.push(`EPS estimate $${payload.epsEstimate.toFixed(2)}`);
  }
  if (typeof payload.amount === "number") {
    parts.push(`$${payload.amount.toFixed(2)} per share`);
  }
  if (typeof payload.session === "string") parts.push(payload.session);
  if (typeof payload.type === "string") parts.push(payload.type);

  return parts.length ? parts.join(" · ") : null;
}

export async function EventsStrip({ events }: { events: DatedEvent[] }) {
  if (events.length === 0) return null;

  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {events.map((event) => {
        const concept = KIND_CONCEPT[event.kind];
        const detail = payloadSummary(event);

        return (
          <li
            key={event.id}
            className={`rounded-lg border p-3 ${
              event.isUpcoming
                ? "border-neutral-300 dark:border-neutral-700"
                : "border-neutral-200 opacity-60 dark:border-neutral-800"
            }`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">
                {concept ? (
                  <Term slug={concept}>{KIND_LABEL[event.kind]}</Term>
                ) : (
                  KIND_LABEL[event.kind]
                )}
              </span>
              <span className="shrink-0 text-xs text-neutral-400">
                {formatDaysAway(event.daysAway)}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-neutral-500">
              {formatDay(event.scheduledAt)}
              {detail && ` · ${detail}`}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
