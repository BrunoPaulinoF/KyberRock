import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";

export type TooltipPlacement = "top" | "bottom" | "left" | "right";

export interface TooltipProps {
  content: ReactNode;
  placement?: TooltipPlacement;
  delayMs?: number;
  shortcut?: string;
  disabled?: boolean;
  children: ReactElement;
}

const TOOLTIP_GAP = 8;
const VIEWPORT_PADDING = 8;

const placementStyle = (placement: TooltipPlacement, x: number, y: number): CSSProperties => {
  switch (placement) {
    case "bottom":
      return { top: y, left: x, transform: "translate(-50%, 0)" };
    case "left":
      return { top: y, left: x, transform: "translate(-100%, -50%)" };
    case "right":
      return { top: y, left: x, transform: "translate(0, -50%)" };
    case "top":
    default:
      return { top: y, left: x, transform: "translate(-50%, -100%)" };
  }
};

const arrowStyle = (placement: TooltipPlacement): CSSProperties => {
  const base: CSSProperties = {
    position: "absolute",
    width: 0,
    height: 0,
    borderStyle: "solid"
  };
  switch (placement) {
    case "bottom":
      return { ...base, top: -6, left: "50%", transform: "translateX(-50%)", borderWidth: "0 6px 6px 6px", borderColor: "transparent transparent var(--kr-tooltip-border) transparent" };
    case "left":
      return { ...base, right: -6, top: "50%", transform: "translateY(-50%)", borderWidth: "6px 0 6px 6px", borderColor: "transparent transparent transparent var(--kr-tooltip-border)" };
    case "right":
      return { ...base, left: -6, top: "50%", transform: "translateY(-50%)", borderWidth: "6px 6px 6px 0", borderColor: "transparent var(--kr-tooltip-border) transparent transparent" };
    case "top":
    default:
      return { ...base, bottom: -6, left: "50%", transform: "translateX(-50%)", borderWidth: "6px 6px 0 6px", borderColor: "var(--kr-tooltip-border) transparent transparent transparent" };
  }
};

function resolvePosition(
  rect: DOMRect,
  placement: TooltipPlacement,
  tooltipSize: { width: number; height: number }
): { x: number; y: number; placement: TooltipPlacement } {
  const { innerWidth, innerHeight } = window;
  let resolved: TooltipPlacement = placement;
  let x = 0;
  let y = 0;

  const fitsTop = rect.top - tooltipSize.height - TOOLTIP_GAP >= VIEWPORT_PADDING;
  const fitsBottom = rect.bottom + tooltipSize.height + TOOLTIP_GAP <= innerHeight - VIEWPORT_PADDING;
  const fitsLeft = rect.left - tooltipSize.width - TOOLTIP_GAP >= VIEWPORT_PADDING;
  const fitsRight = rect.right + tooltipSize.width + TOOLTIP_GAP <= innerWidth - VIEWPORT_PADDING;

  if (placement === "top" && !fitsTop && fitsBottom) resolved = "bottom";
  if (placement === "bottom" && !fitsBottom && fitsTop) resolved = "top";
  if (placement === "left" && !fitsLeft && fitsRight) resolved = "right";
  if (placement === "right" && !fitsRight && fitsLeft) resolved = "left";

  switch (resolved) {
    case "bottom":
      x = rect.left + rect.width / 2;
      y = rect.bottom + TOOLTIP_GAP;
      break;
    case "left":
      x = rect.left - TOOLTIP_GAP;
      y = rect.top + rect.height / 2;
      break;
    case "right":
      x = rect.right + TOOLTIP_GAP;
      y = rect.top + rect.height / 2;
      break;
    case "top":
    default:
      x = rect.left + rect.width / 2;
      y = rect.top - TOOLTIP_GAP;
      break;
  }

  const halfWidth = tooltipSize.width / 2;
  const minX = VIEWPORT_PADDING + halfWidth;
  const maxX = innerWidth - VIEWPORT_PADDING - halfWidth;
  x = Math.max(minX, Math.min(maxX, x));

  return { x, y, placement: resolved };
}

export function Tooltip({
  content,
  placement = "top",
  delayMs = 350,
  shortcut,
  disabled = false,
  children
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ x: number; y: number; placement: TooltipPlacement } | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const showTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const tooltipId = useId();

  const clearTimers = () => {
    if (showTimerRef.current !== null) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  useEffect(() => {
    if (!open) return;
    function update() {
      const trigger = triggerRef.current;
      const tooltip = tooltipRef.current;
      if (!trigger || !tooltip) return;
      const rect = trigger.getBoundingClientRect();
      const size = { width: tooltip.offsetWidth, height: tooltip.offsetHeight };
      setCoords(resolvePosition(rect, placement, size));
    }
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, placement]);

  useEffect(() => () => clearTimers(), []);

  if (!isValidElement(children)) {
    throw new Error("Tooltip: children must be a single React element.");
  }

  if (disabled || !content) {
    return children;
  }

  const handleShow = () => {
    if (disabled) return;
    clearTimers();
    showTimerRef.current = window.setTimeout(() => setOpen(true), delayMs);
  };

  const handleHide = () => {
    clearTimers();
    hideTimerRef.current = window.setTimeout(() => setOpen(false), 80);
  };

  const childProps = children.props as {
    onMouseEnter?: (event: React.MouseEvent) => void;
    onMouseLeave?: (event: React.MouseEvent) => void;
    onFocus?: (event: React.FocusEvent) => void;
    onBlur?: (event: React.FocusEvent) => void;
    "aria-describedby"?: string;
    ref?: React.Ref<HTMLElement>;
  };

  const enhanced = cloneElement(children, {
    onMouseEnter: (event: React.MouseEvent) => {
      handleShow();
      childProps.onMouseEnter?.(event);
    },
    onMouseLeave: (event: React.MouseEvent) => {
      handleHide();
      childProps.onMouseLeave?.(event);
    },
    onFocus: (event: React.FocusEvent) => {
      handleShow();
      childProps.onFocus?.(event);
    },
    onBlur: (event: React.FocusEvent) => {
      handleHide();
      childProps.onBlur?.(event);
    },
    "aria-describedby": open ? tooltipId : childProps["aria-describedby"],
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node;
      const existingRef = childProps.ref;
      if (typeof existingRef === "function") existingRef(node);
      else if (existingRef && typeof existingRef === "object" && "current" in existingRef) {
        (existingRef as React.MutableRefObject<HTMLElement | null>).current = node;
      }
    }
  } as Partial<typeof childProps>);

  return (
    <>
      {enhanced}
      {open ? (
        <div
          ref={tooltipRef}
          role="tooltip"
          id={tooltipId}
          style={{
            position: "fixed",
            zIndex: 9999,
            maxWidth: "320px",
            padding: "8px 10px",
            background: "var(--kr-tooltip-bg)",
            color: "var(--kr-tooltip-text)",
            border: "1px solid var(--kr-tooltip-border)",
            borderRadius: "8px",
            fontSize: "12px",
            lineHeight: 1.4,
            fontWeight: 500,
            boxShadow: "0 8px 24px rgba(30, 58, 138, 0.45)",
            pointerEvents: "none",
            ...(coords ? placementStyle(coords.placement, coords.x, coords.y) : { top: -9999, left: -9999 })
          }}
        >
          <div>{content}</div>
          {shortcut ? (
            <div
              style={{
                marginTop: "4px",
                fontSize: "11px",
                color: "var(--kr-tooltip-shortcut)",
                fontWeight: 600,
                letterSpacing: "0.02em"
              }}
            >
              Atalho: <kbd style={kbdStyle}>{shortcut}</kbd>
            </div>
          ) : null}
          <span style={arrowStyle(coords?.placement ?? placement)} />
        </div>
      ) : null}
    </>
  );
}

const kbdStyle: CSSProperties = {
  display: "inline-block",
  padding: "1px 5px",
  background: "var(--kr-tooltip-kbd-bg)",
  border: "1px solid var(--kr-tooltip-kbd-border)",
  borderRadius: "4px",
  fontSize: "10px",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  color: "var(--kr-tooltip-text)"
};

export interface HelpTooltipProps {
  content: ReactNode;
  placement?: TooltipPlacement;
  shortcut?: string;
  size?: number;
  className?: string;
  ariaLabel?: string;
  style?: CSSProperties;
}

export function HelpTooltip({
  content,
  placement = "top",
  shortcut,
  size = 14,
  className,
  ariaLabel,
  style
}: HelpTooltipProps) {
  return (
    <Tooltip content={content} placement={placement} shortcut={shortcut}>
      <span
        role="img"
        aria-label={ariaLabel ?? "Dica"}
        className={className}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: `${size}px`,
          height: `${size}px`,
          verticalAlign: "middle",
          cursor: "help",
          opacity: 0.42,
          borderRadius: "999px",
          transition: "opacity 160ms ease, transform 160ms ease, background 160ms ease",
          ...style
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.opacity = "0.9";
          event.currentTarget.style.transform = "translateY(-1px) scale(1.08)";
          event.currentTarget.style.background = "color-mix(in srgb, var(--kr-chart-1) 12%, transparent)";
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.opacity = "0.42";
          event.currentTarget.style.transform = "translateY(0) scale(1)";
          event.currentTarget.style.background = "transparent";
        }}
      >
        <img
          src="midia/dica.png"
          alt=""
          width={size}
          height={size}
          style={{ display: "block", width: `${size}px`, height: `${size}px` }}
        />
      </span>
    </Tooltip>
  );
}
