import type { CSSProperties } from "react";

/**
 * Contorno de montanha minimalista (identidade de pedreira/mineracao) desenhado
 * apenas com traco ambar. Usado como marca decorativa no lugar de gradientes
 * pesados — some naturalmente no fundo sem competir com o conteudo.
 */
export function MountainOutline({
  style,
  stroke = "#f59e0b",
  opacity = 0.9
}: {
  style?: CSSProperties;
  stroke?: string;
  opacity?: number;
}) {
  return (
    <svg
      viewBox="0 0 240 90"
      fill="none"
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMax meet"
      style={style}
    >
      <g
        stroke={stroke}
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={opacity}
      >
        {/* cadeia principal */}
        <path d="M0 84 L46 40 L74 62 L118 18 L150 50 L188 26 L240 72" />
        {/* cadeia de fundo, mais leve */}
        <path d="M0 84 L60 56 L96 72 L134 46 L172 66 L214 48 L240 62" opacity={0.5} />
        {/* topo nevado do pico principal */}
        <path d="M104 32 L118 18 L132 34" opacity={0.85} />
      </g>
    </svg>
  );
}
