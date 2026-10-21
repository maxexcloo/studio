"use client";

import { forwardRef, useRef, useEffect, useState, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { tweens } from "@/lib/springs";
import { useProximityHover } from "@/hooks/use-proximity-hover";
import { useShape } from "@/lib/shape-context";
import { SelectContentContext, useSelectContext } from "./select";

export interface SelectContentProps {
  className?: string;
  children: ReactNode;
  side?: 'top' | 'bottom';
}

export const SelectContent = forwardRef<HTMLDivElement, SelectContentProps>(
  ({ className, children, side = 'bottom' }, ref) => {
    const { open, setOpen, value, triggerRef } = useSelectContext();
    const shape = useShape();
    const containerRef = useRef<HTMLDivElement>(null);
    const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);

    const {
      activeIndex,
      setActiveIndex,
      itemRects,
      sessionRef,
      handlers,
      registerItem,
      measureItems,
    } = useProximityHover(containerRef);

    const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
    const [checkedIndex, setCheckedIndex] = useState<number | undefined>(
      undefined
    );

    // Capture trigger rect synchronously when opening
    useEffect(() => {
      if (open && triggerRef.current) {
        setTriggerRect(triggerRef.current.getBoundingClientRect());
      }
    }, [open, triggerRef]);

    // Measure items + detect checked AFTER the portal has mounted
    // triggerRect being set means the portal will render on the next commit
    useEffect(() => {
      if (!open || !triggerRect) return;
      // Double rAF: first waits for React commit, second for layout
      let outer: number;
      let inner: number;
      outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => {
          measureItems();
          const container = containerRef.current;
          if (container) {
            const items = Array.from(
              container.querySelectorAll("[data-proximity-index]")
            ) as HTMLElement[];
            const idx = items.findIndex(
              (el) => el.getAttribute("data-value") === value
            );
            if (idx !== -1) setCheckedIndex(idx);
            else setCheckedIndex(undefined);

            // Focus the container so keyboard events work;
            // don't focus an item directly to avoid showing a focus ring
            containerRef.current?.focus({ preventScroll: true });
          }
        });
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }, [open, triggerRect, measureItems, value]);

    // Close on escape
    useEffect(() => {
      if (!open) return;
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          setOpen(false);
          triggerRef.current?.focus();
        }
      };
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    }, [open, setOpen, triggerRef]);

    // Close on click outside
    useEffect(() => {
      if (!open) return;
      const onPointer = (e: MouseEvent) => {
        if (
          !containerRef.current?.contains(e.target as Node) &&
          !triggerRef.current?.contains(e.target as Node)
        ) {
          setOpen(false);
        }
      };
      document.addEventListener("mousedown", onPointer);
      return () => document.removeEventListener("mousedown", onPointer);
    }, [open, setOpen, triggerRef]);

    // Close on scroll (instead of locking body scroll, which causes layout shift)
    useEffect(() => {
      if (!open) return;
      const onScroll = () => setOpen(false);
      window.addEventListener("scroll", onScroll, { passive: true });
      return () => window.removeEventListener("scroll", onScroll);
    }, [open, setOpen]);

    // Keyboard nav inside content
    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        const items = Array.from(
          containerRef.current?.querySelectorAll(
            '[role="option"]:not([data-disabled])'
          ) ?? []
        ) as HTMLElement[];
        const currentIdx = items.indexOf(e.target as HTMLElement);

        if (
          ["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"].includes(e.key)
        ) {
          e.preventDefault();
          if (currentIdx === -1) {
            // No item focused yet — focus checked or first item
            const checked =
              value !== ""
                ? items.find((item) => item.getAttribute("data-value") === value)
                : null;
            (checked ?? items[0])?.focus();
          } else {
            const next = ["ArrowDown", "ArrowRight"].includes(e.key)
              ? (currentIdx + 1) % items.length
              : (currentIdx - 1 + items.length) % items.length;
            items[next]?.focus();
          }
        } else if (e.key === "Home") {
          e.preventDefault();
          items[0]?.focus();
        } else if (e.key === "End") {
          e.preventDefault();
          items[items.length - 1]?.focus();
        }
      },
      [value]
    );

    // Render hidden when closed so items can register labels
    if (!open) {
      return (
        <div hidden aria-hidden="true">
          {children}
        </div>
      );
    }

    if (!triggerRect) return null;

    const activeRect = activeIndex !== null ? itemRects[activeIndex] : null;
    const focusRect = focusedIndex !== null ? itemRects[focusedIndex] : null;

    return createPortal(
      <SelectContentContext.Provider
        value={{ registerItem, activeIndex, checkedIndex }}
      >
        <div
          data-open-surface
          style={{
            position: "fixed",
            top: side === 'bottom' ? triggerRect.bottom + 6 : undefined,
            bottom: side === 'top' ? window.innerHeight - triggerRect.top + 6 : undefined,
            left: triggerRect.left,
            minWidth: triggerRect.width,
            zIndex: "var(--z-popover)" as unknown as number,
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={tweens.base}
            style={{ transformOrigin: side === 'top' ? "bottom center" : "top center" }}
          >
          <div
            ref={(node) => {
              (
                containerRef as React.MutableRefObject<HTMLDivElement | null>
              ).current = node;
              if (typeof ref === "function") ref(node);
              else if (ref)
                (
                  ref as React.MutableRefObject<HTMLDivElement | null>
                ).current = node;
            }}
            role="listbox"
            tabIndex={-1}
            onMouseEnter={() => {
              handlers.onMouseEnter();
              setFocusedIndex(null);
            }}
            onMouseMove={handlers.onMouseMove}
            onMouseLeave={handlers.onMouseLeave}
            onFocus={(e) => {
              const indexAttr = (e.target as HTMLElement)
                .closest("[data-proximity-index]")
                ?.getAttribute("data-proximity-index");
              if (indexAttr != null) {
                const idx = Number(indexAttr);
                setActiveIndex(idx);
                setFocusedIndex(
                  (e.target as HTMLElement).matches(":focus-visible")
                    ? idx
                    : null
                );
              }
            }}
            onBlur={(e) => {
              if (containerRef.current?.contains(e.relatedTarget as Node))
                return;
              setFocusedIndex(null);
              setActiveIndex(null);
            }}
            onKeyDown={handleKeyDown}
            className={cn(
              `relative flex flex-col gap-0.5 max-h-[300px] overflow-y-auto ${shape.container} bg-card shadow-[0_4px_12px_rgba(0,0,0,0.02)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.5)] border border-border/60 p-1 select-none outline-none`,
              className
            )}
          >
            {/* One static highlight under the hovered or keyboard-cursor option, and
                a neutral keyboard ring; nothing glides between options. The
                selected option shows only its amber check. */}
            {activeRect && (
              <div
                className="absolute pointer-events-none"
                style={{ top: activeRect.top, left: activeRect.left, width: activeRect.width, height: activeRect.height, borderRadius: "var(--r-item)", background: "var(--cursor-bg)" }}
              />
            )}
            {focusRect && (
              <div
                className="absolute pointer-events-none z-20"
                style={{ top: focusRect.top, left: focusRect.left, width: focusRect.width, height: focusRect.height, borderRadius: "var(--r-item)", outline: "2px solid var(--icon-ring)", outlineOffset: "-2px" }}
              />
            )}

            {children}
          </div>
          </motion.div>
        </div>
      </SelectContentContext.Provider>,
      // Inside a modal, portal into it so focus trapping and outside-click handling treat the list as part of the dialog.
      triggerRef.current?.closest(".modal") ?? document.body
    );
  }
);

SelectContent.displayName = "SelectContent";

// ---------------------------------------------------------------------------
