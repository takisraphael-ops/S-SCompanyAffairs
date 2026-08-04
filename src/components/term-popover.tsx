"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ConceptLevel } from "@/db/schema";

const PANEL_WIDTH = 288;
const GAP = 8;
/** Grace period so the pointer can travel from the term into the panel. */
const CLOSE_DELAY_MS = 140;

interface Props {
  slug: string;
  term: string;
  oneLiner: string;
  level: ConceptLevel;
  /** How visible the affordance is; beginners get a stronger hint. */
  emphasis: "subtle" | "clear";
  children: React.ReactNode;
}

export function TermPopover({
  slug,
  term,
  oneLiner,
  level,
  emphasis,
  children,
}: Props) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /*
   * Whether the panel was already open when this interaction began.
   *
   * Both hover and focus open the panel, and both fire before `click`. Without
   * capturing the prior state at pointerdown, a plain toggle-on-click would
   * see the panel it just opened and immediately close it — the tap-does-
   * nothing bug. pointerdown lands before the focus event, so this is the
   * genuine pre-interaction state.
   */
  const wasOpenAtPointerDown = useRef(false);
  const panelId = useId();

  /*
   * Fixed positioning, computed from the trigger's viewport rect.
   *
   * This is deliberate: terms appear inside the watchlist table, which is an
   * `overflow-x-auto` scroll container. An absolutely positioned panel would
   * be clipped by it. A fixed one is positioned against the viewport instead,
   * so it escapes — at the cost of having to track scroll and resize.
   */
  const place = useCallback(() => {
    const trigger = buttonRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const panelHeight = panelRef.current?.offsetHeight ?? 120;

    const room = window.innerHeight - rect.bottom;
    const top =
      room < panelHeight + GAP && rect.top > panelHeight + GAP
        ? rect.top - panelHeight - GAP // flip above when there is no room below
        : rect.bottom + GAP;

    const left = Math.min(
      Math.max(GAP, rect.left),
      window.innerWidth - PANEL_WIDTH - GAP,
    );

    setCoords({ top, left });
  }, []);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }, [cancelClose]);

  const show = useCallback(() => {
    cancelClose();
    place();
    setOpen(true);
  }, [cancelClose, place]);

  // Reposition rather than close while scrolling, so the panel tracks its term.
  useEffect(() => {
    if (!open) return;

    const onScroll = () => place();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        !buttonRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };

    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);

    // The first paint uses an estimated height; correct it now that it is real.
    place();

    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, place]);

  useEffect(() => cancelClose, [cancelClose]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-describedby={open ? panelId : undefined}
        aria-expanded={open}
        /*
         * Hover is gated to actual mouse pointers. Touch browsers synthesise a
         * mouseenter immediately before click, so an ungated hover handler
         * opens the panel and the click handler then toggles it straight back
         * shut — a tap that visibly does nothing. Filtering on pointerType
         * leaves touch with a clean open-on-tap, close-on-tap-again.
         */
        onPointerEnter={(e) => {
          if (e.pointerType === "mouse") show();
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") scheduleClose();
        }}
        onFocus={show}
        onBlur={scheduleClose}
        onPointerDown={() => {
          wasOpenAtPointerDown.current = open;
        }}
        onClick={() => {
          if (wasOpenAtPointerDown.current) setOpen(false);
          else show();
        }}
        /*
         * `[text-transform:inherit]` restores what Tailwind's preflight resets
         * on buttons. A term must look like the text it sits in — inside an
         * uppercase table header it should read as uppercase like its sibling
         * headers, and as normal prose in a paragraph.
         */
        className={`cursor-help underline decoration-dotted underline-offset-4 transition-colors [text-transform:inherit] hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:hover:text-neutral-100 ${
          emphasis === "clear"
            ? "decoration-neutral-400"
            : "decoration-neutral-300 dark:decoration-neutral-700"
        }`}
      >
        {children}
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="tooltip"
          // Keeps the panel alive while the pointer travels into it, so the
          // "Read more" link is actually reachable with a mouse.
          onPointerEnter={(e) => {
            if (e.pointerType === "mouse") cancelClose();
          }}
          onPointerLeave={(e) => {
            if (e.pointerType === "mouse") scheduleClose();
          }}
          style={{
            position: "fixed",
            top: coords.top,
            left: coords.left,
            width: PANEL_WIDTH,
          }}
          /*
           * The panel is visually detached but still a DOM descendant of
           * whatever it annotates, so it inherits that context's typography.
           * Anchored in a table header it would otherwise render the whole
           * explanation in spaced-out uppercase. Reset the inherited text
           * styling explicitly rather than relying on where it is used.
           */
          className="z-50 rounded-lg border border-neutral-200 bg-white p-3 text-left normal-case tracking-normal shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        >
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="text-sm font-semibold">{term}</span>
            <span className="shrink-0 text-[10px] uppercase tracking-wide text-neutral-400">
              {level}
            </span>
          </div>
          <p className="text-xs leading-relaxed text-neutral-600 dark:text-neutral-300">
            {oneLiner}
          </p>
          <Link
            href={`/learn/${slug}`}
            className="mt-2 inline-block text-xs font-medium text-neutral-900 underline underline-offset-2 hover:opacity-70 dark:text-neutral-100"
          >
            Read more
          </Link>
        </div>
      )}
    </>
  );
}
