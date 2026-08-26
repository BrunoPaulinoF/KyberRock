-- Memoria dos pedidos/OS que nao existem mais no OMIE.
--
-- A conferencia de faturamento pergunta ao OMIE, documento por documento, se ele ja foi
-- faturado. Quando alguem exclui o pedido la, a resposta vira "OS nao cadastrada para o
-- Codigo [...]" — e ela e definitiva, porque o OMIE nao reaproveita o codigo interno de um
-- registro excluido. O desktop nao guardava esse fato, entao a mesma pesagem voltava para o
-- rodizio a cada passada: 24 documentos excluidos renderam 3.133 consultas recusadas em 24h,
-- e foi esse volume que fez o OMIE bloquear a integracao da pedreira inteira por "consumo
-- indevido" (HTTP 425).
--
-- O desktop ja passa a parar sozinho (`omie_billing_status = 'missing_in_omie'`), mas a
-- correcao dele so vale para a balanca que atualizou. Esta tabela e o freio que nao depende
-- disso: a Edge Function anota aqui o documento que o OMIE deu por inexistente e, na proxima
-- vez que perguntarem por ele, responde da memoria em vez de gastar uma chamada. Uma
-- instalacao antiga continua perguntando o quanto quiser — o OMIE e que nao ouve mais.
create table if not exists public.omie_missing_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  -- 'sales' (pedido de venda) ou 'service' (ordem de servico), como o desktop os nomeia.
  order_type text not null check (order_type in ('sales', 'service')),
  -- O codigo INTERNO do OMIE (nCodPed / nCodOS) — o mesmo que a consulta usa.
  omie_order_id bigint not null,
  -- Serve para achar a pesagem correspondente quando alguem for investigar o caso.
  operation_id uuid,
  detected_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- Uma linha por documento: a anotacao e um fato, e reanota-lo so atualiza o last_seen_at.
create unique index if not exists idx_omie_missing_documents_document
  on public.omie_missing_documents(company_id, order_type, omie_order_id);

alter table public.omie_missing_documents enable row level security;

-- So o service_role das Edge Functions escreve e le: e memoria da integracao, nao dado de
-- operacao, e nenhuma tela do desktop ou do loader-web precisa dela.
create policy "no direct client access"
  on public.omie_missing_documents for all
  to anon, authenticated
  using (false)
  with check (false);
