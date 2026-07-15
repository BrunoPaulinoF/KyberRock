-- Media (minutos) de tempo dos caminhoes dentro da pedreira, projetada pelo
-- desktop para o alerta de "caminhao acima da media" na tela do carregador.
-- O carregador ja tem permissao de leitura da propria unidade (RLS existente),
-- entao nao e necessaria nova policy.
alter table public.units
  add column if not exists avg_quarry_minutes numeric;
