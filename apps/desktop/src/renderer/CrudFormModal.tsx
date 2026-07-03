import { useEffect } from "react";
import type { CSSProperties, ReactNode } from "react";

interface CrudFormModalProps {
  onClose: () => void;
  children: ReactNode;
  maxWidth?: number;
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: "rgba(15,23,42,0.6)",
  backdropFilter: "blur(3px)",
  WebkitBackdropFilter: "blur(3px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px",
  zIndex: 1100,
  animation: "krFadeIn 120ms ease-out"
};

const panelBaseStyle: CSSProperties = {
  position: "relative",
  background: "var(--kr-surface)",
  border: "1px solid var(--kr-border)",
  borderRadius: "16px",
  boxShadow: "0 25px 60px rgba(0,0,0,0.45)",
  width: "100%",
  maxHeight: "92vh",
  overflowY: "auto",
  overflowX: "hidden",
  animation: "krModalPop 140ms ease-out"
};

const closeButtonStyle: CSSProperties = {
  position: "absolute",
  top: "10px",
  right: "12px",
  width: "30px",
  height: "30px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "8px",
  border: "1px solid var(--kr-border)",
  background: "var(--kr-surface-soft)",
  color: "var(--kr-muted)",
  cursor: "pointer",
  fontSize: "18px",
  lineHeight: 1,
  padding: 0,
  zIndex: 5,
  transition: "background 120ms ease, color 120ms ease"
};

export function CrudFormModal({ onClose, children, maxWidth = 920 }: CrudFormModalProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div className="kr-modal-overlay" style={overlayStyle} onClick={onClose} role="presentation">
      <div
        className="kr-modal-panel"
        style={{ ...panelBaseStyle, maxWidth }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <button
          type="button"
          onClick={onClose}
          style={closeButtonStyle}
          aria-label="Fechar formulario"
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#fee2e2";
            e.currentTarget.style.color = "#b91c1c";
            e.currentTarget.style.borderColor = "#fecaca";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "var(--kr-surface-soft)";
            e.currentTarget.style.color = "var(--kr-muted)";
            e.currentTarget.style.borderColor = "var(--kr-border)";
          }}
        >
          ×
        </button>
        {children}
      </div>
      <style>{`
        @keyframes krFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes krModalPop {
          from { opacity: 0; transform: translateY(8px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .kr-modal-overlay,
          .kr-modal-panel {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
