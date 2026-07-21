import type { CSSProperties, ReactNode, SVGProps } from "react";

import { Tooltip } from "./Tooltip";
import type { TooltipPlacement } from "./Tooltip";

/**
 * Conjunto de icones (Feather-style, monocromaticos via `currentColor`, entao
 * acompanham o tema claro/escuro). Usados nos botoes de acao compactos das
 * telas de operacoes e cadastros.
 */
export type OpIconName =
  | "swap"
  | "check"
  | "ban"
  | "printer"
  | "edit"
  | "trash"
  | "retry"
  | "plus"
  | "search"
  | "close"
  | "save"
  | "list"
  | "clock"
  | "download"
  | "send"
  | "power"
  | "wifi"
  | "file-text"
  | "table"
  | "truck";

export function OpIcon({ name }: { name: OpIconName }) {
  const common: SVGProps<SVGSVGElement> = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
    focusable: false
  };
  switch (name) {
    case "swap":
      return (
        <svg {...common}>
          <polyline points="17 1 21 5 17 9" />
          <path d="M3 11V9a4 4 0 0 1 4-4h14" />
          <polyline points="7 23 3 19 7 15" />
          <path d="M21 13v2a4 4 0 0 1-4 4H3" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      );
    case "ban":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" />
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
        </svg>
      );
    case "printer":
      return (
        <svg {...common}>
          <polyline points="6 9 6 2 18 2 18 9" />
          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
          <rect x="6" y="14" width="12" height="8" />
        </svg>
      );
    case "edit":
      return (
        <svg {...common}>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
        </svg>
      );
    case "trash":
      return (
        <svg {...common}>
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <line x1="10" y1="11" x2="10" y2="17" />
          <line x1="14" y1="11" x2="14" y2="17" />
        </svg>
      );
    case "retry":
      return (
        <svg {...common}>
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
      );
    case "plus":
      return (
        <svg {...common}>
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      );
    case "close":
      return (
        <svg {...common}>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      );
    case "save":
      return (
        <svg {...common}>
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
          <polyline points="17 21 17 13 7 13 7 21" />
          <polyline points="7 3 7 8 15 8" />
        </svg>
      );
    case "list":
      return (
        <svg {...common}>
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
      );
    case "clock":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      );
    case "download":
      return (
        <svg {...common}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      );
    case "send":
      return (
        <svg {...common}>
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      );
    case "power":
      return (
        <svg {...common}>
          <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
          <line x1="12" y1="2" x2="12" y2="12" />
        </svg>
      );
    case "wifi":
      return (
        <svg {...common}>
          <path d="M5 12.55a11 11 0 0 1 14.08 0" />
          <path d="M1.42 9a16 16 0 0 1 21.16 0" />
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
          <line x1="12" y1="20" x2="12.01" y2="20" />
        </svg>
      );
    case "file-text":
      return (
        <svg {...common}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <line x1="10" y1="9" x2="8" y2="9" />
        </svg>
      );
    case "table":
      return (
        <svg {...common}>
          <path d="M12 3v18" />
          <rect width="18" height="18" x="3" y="3" rx="2" />
          <path d="M3 9h18" />
          <path d="M3 15h18" />
        </svg>
      );
    case "truck":
      return (
        <svg {...common}>
          <path d="M1 3h15v13H1z" />
          <path d="M16 8h4l3 3v5h-7V8z" />
          <circle cx="5.5" cy="18.5" r="2.5" />
          <circle cx="18.5" cy="18.5" r="2.5" />
        </svg>
      );
  }
}

export type IconButtonTone = "neutral" | "primary" | "danger";

const iconButtonBase: CSSProperties = {
  width: "30px",
  height: "30px",
  padding: 0,
  borderRadius: "8px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  flexShrink: 0,
  lineHeight: 0
};

const iconButtonTone: Record<IconButtonTone, CSSProperties> = {
  neutral: {
    border: "1px solid var(--kr-border)",
    background: "var(--kr-surface)",
    color: "var(--kr-text-strong)"
  },
  primary: {
    border: "1px solid var(--kr-primary-strong)",
    background: "var(--kr-primary-strong)",
    color: "var(--kr-primary-text)"
  },
  danger: {
    border: "1px solid var(--kr-danger-border)",
    background: "var(--kr-danger-soft)",
    color: "var(--kr-danger)"
  }
};

/**
 * Botao de acao compacto, so com icone: reduz a largura das colunas de acoes
 * (evita estouro de layout com varios botoes) e mostra, no hover/foco, uma dica
 * explicando o que o botao faz. O `label` vira o nome acessivel (aria-label).
 */
export function IconActionButton({
  icon,
  label,
  tip,
  tone = "neutral",
  placement = "top",
  disabled = false,
  onClick
}: {
  icon: OpIconName;
  label: string;
  tip?: ReactNode;
  tone?: IconButtonTone;
  placement?: TooltipPlacement;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip content={tip ?? label} placement={placement}>
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        style={{
          ...iconButtonBase,
          ...iconButtonTone[tone],
          ...(disabled ? { opacity: 0.5, cursor: "not-allowed" } : {})
        }}
      >
        <OpIcon name={icon} />
      </button>
    </Tooltip>
  );
}
