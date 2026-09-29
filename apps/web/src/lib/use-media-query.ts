import { useEffect, useState } from "react";

/** Largura em que o site vira "celular" (o menu vira a barra do topo, `styles.css`). */
export const PHONE_QUERY = "(max-width: 800px)";

/** Se a media query casa agora, acompanhando a troca (girar o celular, redimensionar). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.(query).matches === true
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}
