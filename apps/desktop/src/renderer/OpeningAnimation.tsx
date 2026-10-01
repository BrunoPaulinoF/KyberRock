import type { CSSProperties } from "react";

/**
 * Tempo da animacao de abertura ate o programa poder liberar a tela. Antes era um
 * video de 10 s (2,3 MB no instalador); agora e so CSS — opacidade e `transform`,
 * que a placa de video anima sem redesenhar a pagina. Se a sincronizacao inicial
 * ainda nao acabou, a barrinha continua correndo ate ela terminar (ou ate o teto do
 * App), entao encurtar este numero nao corta o carregamento.
 */
export const OPENING_ANIMATION_MS = 1300;

/** Duracao do esmaecimento que leva da abertura para a tela do programa. */
export const OPENING_EXIT_MS = 400;

const OPENING_CSS = `
  @keyframes krOpeningRise {
    from { opacity: 0; transform: translateY(10px) scale(0.84); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  @keyframes krOpeningGlow {
    from { opacity: 0; transform: scale(0.6); }
    to { opacity: 1; transform: scale(1); }
  }

  @keyframes krOpeningFadeUp {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @keyframes krOpeningBar {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(250%); }
  }

  .kr-opening-glow {
    animation: krOpeningGlow 700ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }

  .kr-opening-logo {
    animation: krOpeningRise 520ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }

  .kr-opening-word {
    animation: krOpeningFadeUp 480ms cubic-bezier(0.2, 0.8, 0.2, 1) 260ms both;
  }

  .kr-opening-sub {
    animation: krOpeningFadeUp 480ms cubic-bezier(0.2, 0.8, 0.2, 1) 420ms both;
  }

  .kr-opening-bar,
  .kr-opening-status {
    animation: krOpeningFadeUp 360ms ease-out 560ms both;
  }

  .kr-opening-bar-fill {
    animation: krOpeningBar 1100ms cubic-bezier(0.45, 0, 0.55, 1) infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .kr-opening-glow,
    .kr-opening-logo,
    .kr-opening-word,
    .kr-opening-sub,
    .kr-opening-bar,
    .kr-opening-bar-fill,
    .kr-opening-status {
      animation: none;
    }
  }
`;

export function OpeningAnimation({
  exiting,
  statusTitle
}: {
  exiting: boolean;
  statusTitle: string;
}) {
  return (
    <main style={styles.screen} aria-busy="true">
      <style>{OPENING_CSS}</style>
      <div
        style={{
          ...styles.content,
          opacity: exiting ? 0 : 1,
          transform: exiting ? "scale(1.04)" : "scale(1)"
        }}
      >
        <div style={styles.logoWrap}>
          <div className="kr-opening-glow" style={styles.glow} />
          <img
            className="kr-opening-logo"
            src="midia/kyberrocklogo.png"
            alt=""
            draggable={false}
            style={styles.logo}
          />
        </div>
        <div className="kr-opening-word" style={styles.word}>
          KYBERROCK
        </div>
        <div className="kr-opening-sub" style={styles.sub}>
          Sistema de pedreiras
        </div>
        <div className="kr-opening-bar" style={styles.bar}>
          <span className="kr-opening-bar-fill" style={styles.barFill} />
        </div>
        <span className="kr-opening-status" role="status" aria-live="polite" style={styles.status}>
          {statusTitle}
        </span>
      </div>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  screen: {
    position: "fixed",
    inset: 0,
    width: "100vw",
    height: "100vh",
    overflow: "hidden",
    background: "radial-gradient(circle at 50% 42%, #111c33 0%, #020617 62%)",
    display: "grid",
    placeItems: "center",
    zIndex: 9999,
    fontFamily: "inherit",
    userSelect: "none"
  },
  content: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    transition: `opacity ${OPENING_EXIT_MS}ms ease, transform ${OPENING_EXIT_MS}ms ease`
  },
  logoWrap: {
    position: "relative",
    width: "148px",
    height: "148px",
    display: "grid",
    placeItems: "center"
  },
  glow: {
    position: "absolute",
    inset: "-46px",
    borderRadius: "50%",
    background:
      "radial-gradient(circle, rgba(245, 158, 11, 0.22) 0%, rgba(148, 163, 184, 0.10) 38%, rgba(2, 6, 23, 0) 70%)",
    pointerEvents: "none"
  },
  logo: {
    position: "relative",
    width: "100%",
    height: "100%",
    objectFit: "contain",
    // O PNG da marca e preto em fundo transparente: invertido vira branco no fundo escuro.
    filter: "invert(1) drop-shadow(0 6px 18px rgba(0, 0, 0, 0.45))"
  },
  word: {
    marginTop: "18px",
    color: "#f8fafc",
    fontSize: "26px",
    fontWeight: 800,
    letterSpacing: "0.32em",
    // Compensa o espaco que o letter-spacing deixa depois da ultima letra.
    marginRight: "-0.32em"
  },
  sub: {
    marginTop: "6px",
    color: "#94a3b8",
    fontSize: "12px",
    fontWeight: 600,
    letterSpacing: "0.18em",
    textTransform: "uppercase"
  },
  bar: {
    position: "relative",
    marginTop: "26px",
    width: "148px",
    height: "3px",
    borderRadius: "999px",
    overflow: "hidden",
    background: "rgba(148, 163, 184, 0.18)"
  },
  barFill: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: "40%",
    borderRadius: "999px",
    background:
      "linear-gradient(90deg, rgba(245, 158, 11, 0) 0%, #f59e0b 50%, rgba(245, 158, 11, 0) 100%)"
  },
  status: {
    marginTop: "12px",
    minHeight: "16px",
    color: "#64748b",
    fontSize: "12px",
    fontWeight: 600
  }
};
