# Inventario Do Ambiente - Fase 0

Data: 2026-06-06

## Ambiente Atual Do Projeto

Este inventario foi coletado na maquina onde o projeto esta aberto. Esta maquina nao e o PC real da balanca.

| Item | Valor |
| --- | --- |
| Sistema operacional | Microsoft Windows 11 Pro |
| Versao Windows | 10.0.26200 |
| Build Windows | 26200 |
| Node.js | v24.13.0 |
| npm | 11.8.0 |
| Git | Repositorio inicializado em `main` |
| Conectividade OMIE | `api.omie.com.br:443` OK |

## Portas Seriais Detectadas

Nenhuma porta serial foi retornada por `[System.IO.Ports.SerialPort]::GetPortNames()` no ambiente atual. Como esta nao e a maquina da balanca, este resultado nao valida nem invalida a conexao real da Toledo 950 IDLCG 2.

Validar no PC real da balanca:

- se a Toledo esta conectada por serial RS-232, USB serial, TCP/IP ou outro adaptador;
- nome da porta, por exemplo `COM1`, `COM3`, `COM4`;
- baud rate;
- data bits;
- stop bits;
- parity;
- handshake/flow control;
- permissao do usuario Windows para acessar a porta.

## Impressoras Instaladas No Ambiente Atual

| Nome | Driver | Porta | Compartilhada |
| --- | --- | --- | --- |
| OneNote (Desktop) | Send to Microsoft OneNote 16 Driver | `nul:` | Nao |
| Microsoft Print to PDF | Microsoft Print To PDF | `PORTPROMPT:` | Nao |
| HP LaserJet Professional P 1102w | HP LaserJet Professional P 1102w | `IP_192.168.0.240_2` | Sim |
| ELGIN L42PRO FULL | ELGIN L42PRO FULL | `192.168.0.35` | Sim |
| Brother HL-L3240CDW series | Brother HL-L3240CDW series | `BRW44FA66E52A21` | Nao |
| Brother DCP-L2540DW series Printer | Microsoft IPP Class Driver | `WSD-3654d2bc-cf3a-4818-86b5-2414225c36b5` | Nao |

Observacao: `ELGIN L42PRO FULL` parece ser candidata a impressora termica, mas ainda precisa de teste de cupom 80 mm.

## Caminhos Recomendados No Windows

Diretorios iniciais propostos para producao local:

| Finalidade | Caminho |
| --- | --- |
| Banco SQLite | `%ProgramData%\\KyberRock\\data\\kyberrock.sqlite3` |
| Backups locais | `%ProgramData%\\KyberRock\\backups` |
| Logs | `%ProgramData%\\KyberRock\\logs` |
| Configuracao local sem segredo sensivel | `%ProgramData%\\KyberRock\\config` |

Credenciais sensiveis nao devem ficar nesses caminhos em texto puro.

## Dados Ainda Pendentes Do PC Real Da Balanca

- Coletar inventario diretamente no PC da balanca.
- Confirmar versao do Windows no PC da balanca.
- Confirmar usuario Windows usado na operacao e permissoes.
- Confirmar portas seriais/USB/TCP disponiveis.
- Confirmar como a Toledo 950 IDLCG 2 esta fisicamente conectada.
- Confirmar impressora termica real e nome exato no Windows.
- Confirmar conectividade com internet no local da balanca.
- Confirmar se firewall/antivirus bloqueia porta serial, impressao ou HTTPS externo.
