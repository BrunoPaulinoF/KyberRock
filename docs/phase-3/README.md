# Fase 3 - Desktop Base Offline-First

Status: em andamento.

## Primeira Entrega

Fundacao local offline-first do desktop:

- SQLite local com `better-sqlite3`;
- caminho padrao planejado em `%ProgramData%\\KyberRock\\data\\kyberrock.sqlite3`;
- runner de migrations versionadas;
- schema inicial com empresas, unidades, dispositivos, cadastros operacionais, operacoes de pesagem, carregamentos, cupons, fila de sincronizacao, auditoria, logs tecnicos e configuracoes locais;
- bootstrap de empresa, unidade, dispositivo e `installation_id`;
- fila local idempotente para Firebase/OMIE;
- backup automatico do SQLite;
- exportacao manual de backup;
- restauracao controlada com `integrity_check`;
- testes para migrations, persistencia local, fila e backup.

## Ainda Pendente Na Fase 3

- App Electron inicial abrindo no Windows;
- interface React inicial;
- indicadores visuais de internet, balanca, Firebase, OMIE, fila pendente e ultimo backup;
- rotina agendada de backup automatico dentro do runtime Electron;
- tela/fluxo controlado para exportacao e restauracao manual.

## Comandos De Validacao

```bash
npm run build
npm run lint
npm test
```
