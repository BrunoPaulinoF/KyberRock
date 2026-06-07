# Fase 3 - Desktop Base Offline-First

Status: concluida.

## Entregue

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
- app Electron inicial abrindo a interface local;
- preload seguro com `contextIsolation`, `nodeIntegration` desativado e IPC controlado;
- interface React inicial;
- indicadores visuais de internet, balanca, Firebase, OMIE, fila pendente e ultimo backup;
- rotina agendada de backup automatico dentro do runtime Electron;
- fluxo controlado de exportacao manual de backup;
- fluxo controlado de restauracao local com confirmacao.

## Limites Da Fase

- A balanca real ainda nao e testada nesta fase; a validacao fisica continua pendente na Fase 0 e a balanca simulada entra na Fase 4.
- O instalador Windows com `electron-builder` fica para fase posterior de empacotamento.
- Firebase e OMIE aparecem como indicadores/configuracoes pendentes porque as credenciais reais seguem fora do Git.

## Execucao Local Do Desktop

```bash
npm run start --workspace @kyberrock/desktop
```

## Comandos De Validacao

```bash
npm run build
npm run lint
npm test
```
