-- As funcoes de aviso sao de GATILHO: so o banco as chama, ao gravar cadastro
-- (`ping_cadastro_change`, 202609220001) ou pedido de pesagem do site (`ping_operation_request`,
-- 202609250001). Como sao SECURITY DEFINER e estao no schema publico, o verificador do Supabase
-- as lista como chamaveis por `anon`/`authenticated` via `/rest/v1/rpc`. Chamar funcao de
-- gatilho fora de gatilho ja falha, mas nao ha motivo para deixar a porta aberta.
--
-- Tirar o EXECUTE nao afeta o gatilho: o Postgres confere esse privilegio so ao CRIAR o
-- gatilho, nao a cada disparo.

revoke execute on function public.ping_cadastro_change() from public, anon, authenticated;
revoke execute on function public.ping_operation_request() from public, anon, authenticated;
