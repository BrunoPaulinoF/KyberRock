import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * Tema claro/escuro, igual ao KyberRock Desktop.
 *
 * As cores vivem em `styles.css` como variaveis `--kr-*` — os MESMOS nomes e valores de
 * `getThemeVariables` do desktop (`apps/desktop/src/renderer/App.tsx`), para o site e a
 * balanca serem lidos como um produto so. Aqui so se decide qual dos dois conjuntos vale:
 * a escolha fica em `data-theme` no `<html>` e persiste no navegador com a mesma chave do
 * desktop. Sem escolha gravada, segue o tema do sistema operacional.
 */
export type ThemeMode = "light" | "dark";

const STORAGE_KEY = "kyberrock.themeMode";

function readStoredTheme(): ThemeMode | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function systemTheme(): ThemeMode {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const ThemeContext = createContext<{ theme: ThemeMode; toggle: () => void }>({
  theme: "light",
  toggle: () => undefined
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeMode>(() => readStoredTheme() ?? systemTheme());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#0c0a09" : "#f5f5f4");
  }, [theme]);

  // Quem nunca escolheu acompanha o sistema, inclusive quando ele troca com o site aberto.
  useEffect(() => {
    if (readStoredTheme()) return;
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const onChange = () => setTheme(media.matches ? "dark" : "light");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const toggle = () => {
    setTheme((current) => {
      const next = current === "light" ? "dark" : "light";
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Navegador sem armazenamento: o tema vale so ate fechar a aba.
      }
      return next;
    });
  };

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
