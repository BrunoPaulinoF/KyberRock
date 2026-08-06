/**
 * Supabase falso para o harness de capturas de tela do loader-web: devolve uma fila de
 * cargas ficticia sem tocar em nenhum projeto real. Substitui `src/lib/supabase` por
 * um alias do Vite (ver vite.screenshots.config.ts).
 */
type AnyRecord = Record<string, unknown>;

const UNIT_ID = "unit_pedreira_norte";
const USER_ID = "usr_carregador_01";

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

const LOADING_REQUESTS = [
  {
    id: "lr_001",
    plate: "RDX8K62",
    customer_name: "Horizonte Azul",
    driver_name: "Elton Ferraz Camargo",
    product_description: "Areia industrial",
    entry_weight_kg: 16_740,
    status: "open",
    created_at: minutesAgo(127),
    loader_completed_at: null,
    unit_id: UNIT_ID
  },
  {
    id: "lr_002",
    plate: "NHP3G09",
    customer_name: "Bandeirantes Infraestrutura",
    driver_name: "Sebastiao Correia Pinto",
    product_description: "Brita 2",
    entry_weight_kg: 19_880,
    status: "open",
    created_at: minutesAgo(63),
    loader_completed_at: null,
    unit_id: UNIT_ID
  },
  {
    id: "lr_003",
    plate: "SVA6H30",
    customer_name: "Usina Nova Aurora",
    driver_name: "Ronaldo Bastos Vieira",
    product_description: "Bica corrida",
    entry_weight_kg: 11_460,
    status: "open",
    created_at: minutesAgo(41),
    loader_completed_at: minutesAgo(9),
    unit_id: UNIT_ID
  },
  {
    id: "lr_004",
    plate: "MTQ5B17",
    customer_name: "Vale Verde Engenharia",
    driver_name: "Marcio Duarte Nogueira",
    product_description: "Brita 0",
    entry_weight_kg: 21_020,
    status: "open",
    created_at: minutesAgo(27),
    loader_completed_at: null,
    unit_id: UNIT_ID
  },
  {
    id: "lr_005",
    plate: "RKB4C21",
    customer_name: "Vale do Sol Pavimentacao",
    driver_name: "Anderson Rocha Lima",
    product_description: "Po de pedra",
    entry_weight_kg: 13_180,
    status: "open",
    created_at: minutesAgo(16),
    loader_completed_at: null,
    unit_id: UNIT_ID
  },
  {
    id: "lr_006",
    plate: "PLF2J88",
    customer_name: "Concreteira Rio Claro",
    driver_name: "Wesley Antunes Prado",
    product_description: "Brita 1",
    entry_weight_kg: 18_640,
    status: "open",
    created_at: minutesAgo(8),
    loader_completed_at: minutesAgo(3),
    unit_id: UNIT_ID
  }
];

const USER_PROFILE = {
  id: USER_ID,
  email: "carregador@serradocedro.demo",
  name: "Carregador - Patio",
  role: "loader",
  company_id: "cmp_9f3a",
  unit_id: UNIT_ID,
  is_active: true
};

const UNIT_ROW = { avg_quarry_minutes: 43, timezone: "America/Sao_Paulo" };

const TABLES: Record<string, AnyRecord[]> = {
  loading_requests: LOADING_REQUESTS,
  user_profiles: [USER_PROFILE],
  units: [{ id: UNIT_ID, ...UNIT_ROW }]
};

/** Builder encadeavel minimo: cobre select/eq/order/single/maybeSingle/update. */
function createQuery(table: string) {
  let rows = [...(TABLES[table] ?? [])];

  const query = {
    select: () => query,
    update: () => query,
    delete: () => query,
    insert: () => query,
    eq: (column: string, value: unknown) => {
      rows = rows.filter((row) => row[column] === value);
      return query;
    },
    order: () => query,
    limit: () => query,
    single: async () => ({ data: rows[0] ?? null, error: null }),
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then: (resolve: (value: { data: AnyRecord[]; error: null }) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve)
  };

  return query;
}

export const supabase = {
  from: (table: string) => createQuery(table),
  channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
  removeChannel: () => undefined
} as never;

/** `?anon=1` na URL simula o visitante deslogado, para capturar a tela de entrada. */
const anonymous =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).get("anon") === "1";

export const auth = {
  getSession: async () => ({ data: { session: anonymous ? null : { user: { id: USER_ID } } } }),
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
  signInWithPassword: async () => ({ data: { user: { id: USER_ID } }, error: null }),
  signOut: async () => ({ error: null })
} as never;
