# Fase 7.1 - Portal de Administracao

Status: implementada.

## Entregue

- Portal de administracao em `/admin` no site loader-web.
- Login exclusivo com Google para o email `kybernantech@gmail.com`.
- Dashboard admin com lista de empresas/pedreiras.
- CRUD completo de empresas (criar, editar, ativar/desativar).
- CRUD completo de unidades por empresa.
- CRUD completo de usuarios carregadores por unidade.
- Controle de acesso: admin ve todas as pedreiras, usuarios carregadores veem apenas sua unidade.
- Regras de seguranca Firestore com separacao rigida entre admin e carregador.
- Escalavel para multiplas pedreiras.

## Limites Da Fase

- O login admin e exclusivo para o email configurado. Futuramente pode ser expandido para multiplos admins.
- A criacao de usuarios carregadores e feita apenas pelo admin. Nao existe auto-cadastro.

## Validacao

```bash
npm run build
npm run lint
npm test
```
