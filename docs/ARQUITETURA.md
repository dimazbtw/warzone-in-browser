# Arquitetura — Zona Ressurge

```
┌──────────────── CLIENTE (navegador) ────────────────┐        ┌──────────────── SERVIDOR (Node.js) ─────────────────┐
│ InputSystem ──intenção──► NetClient ──WebSocket────────────► NetworkSystem ─► Match.handle()                       │
│      │                                                │        │                    │                               │
│      └─► Prediction (shared/movement.js) ◄─reconcilia─┤◄─snap──┤ Match.snapshotFor() ◄─ sistemas autoritativos       │
│ Interpolation (outros jogadores)                      │◄─ev────┤ EventBus  ◄──────── emitem eventos                  │
│ World · Avatars · ViewModel · Effects (Three.js)      │        │ MatchState · Squad · Movement · Inventory · Armor   │
│ HUDSystem (DOM) · AudioSystem (WebAudio)              │        │ Loot · Weapon · Damage · Health · Resurgence        │
└───────────────────────────────────────────────────────┘        │ Respawn · SafeZone · Contract · BuyStation          │
          shared/: config.js · protocol.js · geometry.js · movement.js · math.js   │ Spectator · Bots                                    │
                                                                                    └────────────────────────────────────────────────────┘
```

## Sistemas solicitados → onde estão

| Sistema | Arquivo | Papel |
|---|---|---|
| PlayerController | `client/main.js` + `client/game/InputSystem.js` | Envia intenções, câmeras, disparo, interações |
| MovementSystem | `server/systems/MovementSystem.js` + `shared/movement.js` | Física autoritativa + a mesma física no cliente (predição) |
| WeaponSystem | `server/systems/WeaponSystem.js` | Cadência, dispersão, hitscan com compensação de lag, projéteis, granadas |
| DamageSystem | `server/systems/DamageSystem.js` | Único ponto de dano (fogo amigo, abatido, armadura, vida) |
| HealthSystem | `server/systems/HealthSystem.js` | Abatido, sangramento, reviver, regeneração, wipe, crédito de abate |
| ArmorSystem | `server/systems/ArmorSystem.js` | Placas (absorção, quebra, aplicação) |
| InventorySystem | `server/systems/InventorySystem.js` | Slots, munição, placas, curas, letais, dinheiro, ações com tempo |
| LootSystem | `server/systems/LootSystem.js` | Tabela/raridade, coleta validada, coleta automática, drop ao morrer (pool + grade espacial) |
| RespawnSystem | `server/systems/RespawnSystem.js` | Ponto seguro + kit básico |
| ResurgenceSystem | `server/systems/ResurgenceSystem.js` | Timer de retorno, bônus de aliados e de abates, desativação |
| SquadSystem | `server/systems/SquadSystem.js` | Parties, solo/duo/trio/squad, status dos aliados |
| SafeZoneSystem | `server/systems/SafeZoneSystem.js` | Fases, fechamento, dano progressivo |
| ContractSystem | `server/systems/ContractSystem.js` | Caçada, Suprimentos, Domínio, Resistência, Inteligência |
| BuyStationSystem | `server/systems/BuyStationSystem.js` | Catálogo, recompra de aliado, radar |
| MatchStateSystem | `server/systems/MatchStateSystem.js` | Lobby → contagem → aeronave → partida → fim; vitória e colocação |
| SpectatorSystem | `server/systems/SpectatorSystem.js` + câmera no cliente | Alvo decidido no servidor |
| HUDSystem | `client/ui/HUDSystem.js` | Toda a interface |
| AudioSystem | `client/audio/AudioSystem.js` | Sons sintetizados e posicionais |
| NetworkSystem | `server/net/NetworkSystem.js` + `client/net/NetClient.js` | Transporte, reconexão, limite de taxa, escopo dos eventos |

## Regras de ouro
1. **O servidor decide tudo que importa**: dano, eliminações, loot, inventário, dinheiro, respawns, zona, contratos, compras e resultado. O cliente manda só intenções.
2. **Eventos em vez de chamadas cruzadas**: por exemplo, `died` → Resurgence (decide o retorno), Loot (drop), Contract (caçada) e Network (killfeed).
3. **Máquinas de estado explícitas** para o jogador e para a partida. Transição inválida é recusada.
4. **Configuração em um só lugar**: `shared/config.js`. O cliente recebe só `clientConfig()`.
5. **Gameplay separada da apresentação**: o `Match` roda headless nos testes, e os dois clientes (3D e debug 2D) só desenham.

## Etapas
| Etapa | Conteúdo | Documento |
|---|---|---|
| 1 | Núcleo: MatchState → Player → Squad → Loot → Combat → Elimination → Resurgence → Safe Zone → Victory | [ETAPA-1-NUCLEO.md](ETAPA-1-NUCLEO.md) |
| 2 | Movimento avançado + física compartilhada | [ETAPAS-2-5.md](ETAPAS-2-5.md#etapa-2--movimento-avançado) |
| 3 | Contratos + estações de compra | [ETAPAS-2-5.md](ETAPAS-2-5.md#etapa-3--contratos-e-estações) |
| 4 | Cliente 3D multiplayer | [ETAPAS-2-5.md](ETAPAS-2-5.md#etapa-4--cliente-3d-multiplayer) |
| 5 | Testes de rede/carga, revisão | [ETAPAS-2-5.md](ETAPAS-2-5.md#etapa-5--rede-desempenho-e-operação) |
