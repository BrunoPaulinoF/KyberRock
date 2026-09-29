import Database from "better-sqlite3";

import type { DesktopDatabase } from "../database/sqlite.js";

/**
 * Relogio da nuvem: todas as balancas carimbando a MESMA hora.
 *
 * Cada balanca carimbava `created_at`/`updated_at` com o relogio do Windows dela, e os
 * relogios nao batem: em 28/09/2026 a nuvem tinha cadastro gravado 5 a 17 min "no futuro".
 * Quem compara horario entre maquinas (o cursor do push de cadastro, o `newest` das balancas
 * principais de preco, a data da pesagem nos relatorios) decidia errado — o sintoma mais
 * visivel era o cadastro feito na balanca demorar ate 14 h para aparecer no site.
 *
 * Acertar o relogio do Windows pede administrador, que o instalador nao tem. Entao o
 * PROGRAMA passa a usar a hora da nuvem: o `desktop-status` devolve a hora do servidor a cada
 * validacao, a diferenca para o relogio daqui vira um deslocamento (`offsetMs`, gravado para
 * valer tambem sem internet) e ele e aplicado nos dois lugares que leem o relogio:
 *
 *  - o `Date` do processo principal (`installCloudClock`): `new Date()` e `Date.now()` ja
 *    saem corrigidos, sem mexer nas centenas de chamadas espalhadas pelo codigo;
 *  - o `'now'` do SQLite (`installSqliteCloudClock`): `datetime('now')`, `strftime(..., 'now')`
 *    e companhia usam o relogio do sistema operacional, nao o do JavaScript — e o pull do
 *    OMIE carimba cadastro assim. As funcoes de data sao sobrepostas por versoes que trocam
 *    `'now'` pela hora corrigida e calculam o resto numa conexao separada, sem sobreposicao.
 *
 * O deslocamento e medido contra o relogio REAL (`realNowMs`), nunca contra o `Date` ja
 * corrigido — senao a segunda medicao daria ~0 e desfaria a correcao.
 */

const RealDate = globalThis.Date;

/** Diferencas menores que isto sao ruido da rede: nao mexem no relogio (evita ele "tremer"). */
export const CLOUD_CLOCK_JITTER_MS = 2_000;
/** Deslocamento absurdo (resposta corrompida, servidor com data errada) e ignorado. */
export const CLOUD_CLOCK_MAX_OFFSET_MS = 30 * 24 * 60 * 60 * 1000;
/** A partir daqui a tela avisa que o relogio do Windows esta errado. */
export const CLOUD_CLOCK_WARNING_MS = 2 * 60 * 1000;
export const CLOUD_CLOCK_OFFSET_SETTING = "cloud_clock_offset_ms";

let offsetMs = 0;
let installed = false;

/**
 * Relogio do sistema operacional, sem correcao. Sem o relogio da nuvem instalado (testes) e
 * o `Date` do momento — que o teste pode ter trocado por um relogio falso.
 */
export function realNowMs(): number {
  return installed ? RealDate.now() : globalThis.Date.now();
}

/** Hora da nuvem, em ms. */
export function cloudNowMs(): number {
  return RealDate.now() + offsetMs;
}

export function cloudClockOffsetMs(): number {
  return offsetMs;
}

export function isCloudClockInstalled(): boolean {
  return installed;
}

export function isUsableClockOffset(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) <= CLOUD_CLOCK_MAX_OFFSET_MS
  );
}

/**
 * Troca o deslocamento. Devolve `true` se mudou — variacao dentro do ruido da rede nao muda.
 */
export function setCloudClockOffsetMs(value: unknown): boolean {
  if (!isUsableClockOffset(value)) return false;
  const rounded = Math.round(value);
  if (Math.abs(rounded - offsetMs) < CLOUD_CLOCK_JITTER_MS) return false;
  offsetMs = rounded;
  activateSqliteClockIfNeeded();
  return true;
}

/** Deslocamento entre a hora do servidor e a deste computador quando a resposta chegou. */
export function measureCloudClockOffset(
  serverTime: string | null | undefined,
  receivedAtRealMs: number
): number | null {
  const serverMs = serverTime ? RealDate.parse(serverTime) : Number.NaN;
  if (!Number.isFinite(serverMs)) return null;
  const offset = Math.round(serverMs - receivedAtRealMs);
  return isUsableClockOffset(offset) ? offset : null;
}

/**
 * Faz `new Date()` e `Date.now()` do processo principal devolverem a hora da nuvem.
 *
 * E um Proxy e nao uma subclasse de proposito: o `instanceof Date` continua verdadeiro para
 * TODA data (inclusive as criadas pelo proprio V8, pelo IPC ou por bibliotecas que guardaram
 * o `Date` original), e `Date(...)` chamado sem `new` segue devolvendo texto.
 */
export function installCloudClock(): void {
  if (installed) return;
  installed = true;
  globalThis.Date = new Proxy(RealDate, {
    construct(target, args, newTarget) {
      if (args.length === 0) {
        return Reflect.construct(target, [RealDate.now() + offsetMs], newTarget);
      }
      return Reflect.construct(target, args, newTarget);
    },
    apply(target, _thisArg, args) {
      // `Date()` sem `new` ignora os argumentos e devolve a hora atual em texto.
      void args;
      return new target(RealDate.now() + offsetMs).toString();
    },
    get(target, property, receiver) {
      if (property === "now") return () => RealDate.now() + offsetMs;
      return Reflect.get(target, property, receiver);
    }
  });
}

/** So para testes: devolve o `Date` original e zera o deslocamento. */
export function uninstallCloudClockForTests(): void {
  globalThis.Date = RealDate;
  installed = false;
  offsetMs = 0;
  sqliteConnections.clear();
}

/** Funcoes de data do SQLite que aceitam `'now'` como valor de tempo. */
const SQLITE_TIME_FUNCTIONS = ["datetime", "date", "time", "julianday", "unixepoch"] as const;

let calculator: DesktopDatabase | null = null;

/** Conexao em memoria SEM sobreposicao: e nela que as funcoes originais do SQLite rodam. */
function sqliteCalculator(): DesktopDatabase {
  calculator ??= new Database(":memory:");
  return calculator;
}

/** `'now'` como o SQLite entende, mas na hora da nuvem (com milissegundos, para o `%f`). */
function sqliteNowValue(): string {
  return new RealDate(RealDate.now() + offsetMs).toISOString().replace("T", " ").slice(0, 23);
}

function isNow(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "now";
}

/** Um `SELECT fn(?, ?...)` preparado por funcao e quantidade de argumentos. */
const originalStatements = new Map<string, Database.Statement>();

function callOriginal(name: string, args: unknown[]): unknown {
  const key = `${name}/${args.length}`;
  let statement = originalStatements.get(key);
  if (!statement) {
    const placeholders = args.map(() => "?").join(", ");
    statement = sqliteCalculator().prepare(`SELECT ${name}(${placeholders})`).pluck();
    originalStatements.set(key, statement);
  }
  return statement.get(...args);
}

/**
 * Conexoes abertas com o relogio instalado. A sobreposicao so e ligada nelas quando o relogio
 * deste computador esta de fato errado: a funcao sobreposta passa por JavaScript e custa ~18x
 * mais que a nativa (medido: 20 mil `date()` em 68 ms contra 4 ms) — preco que so vale pagar
 * onde ha o que corrigir. Uma vez ligada, fica ate fechar o programa (o SQLite nao devolve a
 * funcao original).
 */
const sqliteConnections = new Set<WeakRef<DesktopDatabase>>();
const sqliteActivated = new WeakSet<DesktopDatabase>();

function sqliteClockNeeded(): boolean {
  return Math.abs(offsetMs) >= CLOUD_CLOCK_JITTER_MS;
}

function activateSqliteClockIfNeeded(): void {
  if (!installed || !sqliteClockNeeded()) return;
  for (const ref of sqliteConnections) {
    const database = ref.deref();
    if (!database || !database.open) {
      sqliteConnections.delete(ref);
      continue;
    }
    overrideSqliteTimeFunctions(database);
  }
}

/**
 * Faz `'now'` (e a forma sem argumento, que tambem e "agora") desta conexao usar a hora da
 * nuvem. Qualquer outro valor passa intacto para a funcao original. So age com o relogio do
 * processo instalado — em teste o SQLite fica como e — e so quando ha diferenca a corrigir.
 */
export function installSqliteCloudClock(database: DesktopDatabase): void {
  if (!installed) return;
  sqliteConnections.add(new WeakRef(database));
  if (sqliteClockNeeded()) overrideSqliteTimeFunctions(database);
}

function overrideSqliteTimeFunctions(database: DesktopDatabase): void {
  if (sqliteActivated.has(database)) return;
  sqliteActivated.add(database);
  for (const name of SQLITE_TIME_FUNCTIONS) {
    database.function(name, { varargs: true, deterministic: false }, (...args: unknown[]) => {
      const values = args.length === 0 ? ["now"] : args;
      return callOriginal(
        name,
        values.map((value) => (isNow(value) ? sqliteNowValue() : value))
      );
    });
  }
  database.function("strftime", { varargs: true, deterministic: false }, (...args: unknown[]) => {
    // strftime(formato) sem valor de tempo tambem e "agora".
    const values = args.length === 1 ? [args[0], "now"] : args;
    return callOriginal(
      "strftime",
      values.map((value, index) => (index > 0 && isNow(value) ? sqliteNowValue() : value))
    );
  });
}
