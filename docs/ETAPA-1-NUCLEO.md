# Etapa 1 — Núcleo multiplayer autoritativo

Ordem implementada: **MatchState → Player → Squad → Loot → Combat → Elimination → Resurgence → Safe Zone → Victory**
(+ Spectator, Network e bots de teste, necessários para validar o fluxo).

```
shared/
  config.js          ← TODAS as configurações do game designer
  protocol.js        ← mensagens cliente↔servidor
server/
  index.js           ← HTTP estático + WebSocket + loop de tempo fixo
  Match.js           ← orquestra os sistemas (sem saber nada de rede)
  Player.js          ← entidade + máquina de estados do jogador
  MapData.js         ← geometria autoritativa (colisão, linha de tiro, spawn)
  core/              ← EventBus, Logger, StateMachine, Pool, SpatialGrid, math
  systems/           ← um arquivo por sistema
  net/NetworkSystem.js
client-debug/        ← cliente 2D para testar o multiplayer
tests/               ← testes headless (node:test)
```

## Princípios

| Princípio | Como foi aplicado |
|---|---|
| Server-authoritative | O cliente só envia **intenções** (teclas, mira, "quero pegar o item X"). O servidor integra o movimento, sorteia a dispersão, faz o raycast, aplica dano, decide mortes, loot, dinheiro, respawn, zona e resultado. |
| Eventos desacoplados | Os sistemas se comunicam por `ctx.bus` (EventBus). Ex.: `HealthSystem.kill()` emite `died`, e o **Resurgence** (decide o retorno), o **Loot** (drop do inventário) e o **Network** (killfeed) reagem sem se conhecer. |
| Estados explícitos | `StateMachine` com transições permitidas: impossível ir de `eliminated` para `alive` sem passar pelo respawn. |
| Gameplay ≠ apresentação | O `Match` não conhece WebSocket; o `client-debug` e o jogo 3D só desenham snapshots. |
| Testável | O `Match` roda headless com relógio próprio: `m.tick(dt)`. |

## Ciclo de vida

```
Partida: LOBBY → COUNTDOWN → DEPLOYING (aeronave) → IN_PROGRESS → ENDED
Jogador: lobby → aircraft → freefall → parachute → alive ⇄ downed
                                   alive/downed → awaiting (Resurgence) → freefall …
                                   qualquer → eliminated (definitivo, vira espectador)
```

---

## Sistemas

### 1. MatchStateSystem (`server/systems/MatchStateSystem.js`)
- **Estrutura:** máquina de estados da partida, aeronave (rota que cruza o mapa passando perto do centro), `checkVictory()`, `results()`.
- **Integração:** escuta `playerState`; chama `squad.assignAll`, `loot.spawnInitial`, `zone.start` e `inventory.init` no início. Emite `matchStarted`, `squadEliminated` e `matchEnded`.
- **Configuração:** `match.minPlayersToStart`, `lobbyCountdown`, `endScreenTime`, `map.aircraftAltitude`, `aircraftSpeed`.
- **Ponto de entrada:** o jogador escolhe o ponto de entrada saltando (Espaço) quando a aeronave está sobre o local. No fim da rota, quem sobrar é ejetado automaticamente.
- **Vitória:** uma equipe é *elegível* se tem alguém em jogo ou abatido, ou alguém aguardando um retorno que ainda vai acontecer. Quando sobra ≤ 1 equipe elegível, a partida termina.
- **Riscos de multiplayer:** a vitória é recalculada a cada troca de estado (evento), e não por polling do cliente. A lista de jogadores do lobby só muda no servidor.

### 2. Player (`server/Player.js`)
- Guarda estado, posição, input, vida, armadura, sangramento, inventário, ação em andamento e estatísticas.
- Mantém um **histórico de posições** (buffer circular de cerca de 1,3 s) para a compensação de lag: `positionAt(t)`.

### 3. SquadSystem
- **Estrutura:** `assignAll()` agrupa primeiro as parties (código no `hello`) e depois completa as vagas (humanos antes de bots).
- **Configuração:** `match.squadSize`: 1 solo, 2 duo, 3 trio, 4 squad.
- **API:** `teammates`, `standingTeammates`, `isWiped`, `areAllies` e `statusFor(p)` (status dos aliados para a HUD: estado, vida, distância, timer de retorno, sangramento).
- **Riscos:** vida e armadura de inimigos **não** vão no snapshot, só as de aliados (evita wallhack de informação).

### 4. MovementSystem
- **Estado atual:** andar, sprint, sprint tático com stamina, agachar, prone, pulo, queda livre, paraquedas (manual ou automático) e rastejar abatido.
- **Anti-cheat:** `sanitize()` normaliza o vetor de movimento e força booleanos. Inputs com `seq` antigo são descartados. Como o servidor integra a física, speed hack e teleporte são impossíveis.
- **Configuração:** `movement.*` (velocidades, gravidade, stamina).
- **Atualizado na Etapa 2:** slide, mantle/vault, escalada e fila de inputs com física compartilhada (veja ETAPAS-2-5.md).

### 5. InventorySystem + ArmorSystem
- Slots primária e secundária, munição por tipo, placas, curas, letais e dinheiro (mantido entre vidas).
- **Ações com duração** (recarregar, placa, cura, reviver) são iniciadas por pedido e **concluídas pelo servidor** no tick. O cliente nunca "termina" uma ação.
- A armadura é contada em pontos (`hpPerPlate` por placa) e emite `plateBroken` e `plateApplied`.
- **Configuração:** `health.plates.*`, `health.healItem.*`.

### 6. LootSystem
- Spawn ponderado (`loot.table`) com raridade (`loot.rarityWeights`). Os objetos saem de um **Pool** e ficam numa **SpatialGrid** (consultas rápidas).
- **Coleta validada:** estado, distância (`pickupRange`) e existência do item. Numa corrida entre dois jogadores, o primeiro pedido processado vence e o outro recebe `pickupFailed: gone`.
- A coleta automática de dinheiro, munição e placas é configurável.
- Ao morrer, o jogador larga armas, munição, placas e metade do dinheiro (`dropOnDeath`).

### 7. WeaponSystem + DamageSystem
- **Validação:** estado, munição e cadência (8% de tolerância para jitter). 100 pedidos no mesmo tick resultam em 1 disparo.
- **Dispersão sorteada no servidor:** muda com hip/ADS, movimento, estar no ar e postura.
- **Hitscan com compensação de lag:** rebobina os alvos para `agora − (latência + interpolationDelay)`, com limite de `lagCompensationMax`. Hitboxes: esfera na cabeça e cápsula no corpo. Membros ficam abaixo de 0,8 m.
- **Modo projétil** (`combat.mode = 'projectile'`) com gravidade e pool de projéteis.
- **Dano por distância:** curva `falloff` por arma. Multiplicadores por parte do corpo: `combat.bodyMultipliers` e `headMultiplier` por arma.
- **Paredes bloqueiam tiros** (raycast contra `MapData`).
- **DamageSystem:** fogo amigo desligado → abatido consome o sangramento → armadura → vida → HealthSystem. O dano da zona ignora a armadura.
- **Granada de fragmentação** com pavio e dano radial.

### 8. HealthSystem (abatido / reviver / eliminação)
- Vida zerada vira **abatido** se o modo não é solo e existe um aliado de pé. Caso contrário, é **eliminação**.
- Abatido sangra (`bleedoutTime`). Um aliado revive segurando interagir dentro de `reviveRange` por `reviveTime`. Se o reviver se afasta ou solta a tecla, o revive é cancelado.
- **Squad wipe:** se ninguém do squad está de pé, os abatidos morrem (`wipeEliminatesDowned`).
- **Crédito do abate:** vai para o último atacante (até 15 s atrás) mesmo se a vítima morreu no gás ou por sangramento. O abate rende `loot.killCash`.
- `kill()` só emite `died`. **Quem decide se a morte é definitiva é o Resurgence.**

### 9. ResurgenceSystem + RespawnSystem
- **Ao morrer:** com o Resurgence ativo e (solo, ou algum aliado de pé ou abatido), o jogador vai para `awaiting`. Senão, é eliminado.
- **Relógio:** anda a `1 + allyAliveSpeedup × aliados de pé` por segundo. Cada abate do squad desconta `killReduction` s, respeitando `minTime`.
- **Wipe:** se o squad inteiro está fora de jogo, quem aguardava é eliminado.
- **Desativação:** ao começar a fase `disableAtPhase` da zona. `onDisable` decide se quem já aguardava ainda volta (`respawn_pending`) ou é eliminado (`eliminate_pending`).
- **Spawn seguro:** metade das tentativas perto de um aliado e o resto dentro da **próxima** zona. Pontos em obstáculos são rejeitados. Exige `minEnemyDistance` até o inimigo mais próximo. Se nenhum ponto passar, escolhe o mais distante dos inimigos.
- **Retorno:** o jogador volta em queda livre (`respawnAltitude`) com o `basicKit`.

### 10. SafeZoneSystem
- `zone.phases[]`: `radius`, `wait`, `close` e `dps` de cada fase. O novo centro é sorteado dentro da zona atual (`centerBias`) e respeita os limites do mapa.
- A última fase tem raio 0, o que força o confronto final.
- Para a HUD: `distanceInfo(pos)` devolve a distância até a borda e a direção.

### 11. SpectatorSystem
- Prioridade de alvo: aliados de pé, depois aliados abatidos. Quem foi eliminado de vez pode assistir qualquer jogador em jogo.
- Quando o alvo morre, a câmera troca automaticamente. `[` e `]` alternam o alvo.
- O snapshot usa o **ponto de vista do alvo** para filtrar por interesse.

### 12. NetworkSystem
- WebSocket JSON com handshake e **token de reconexão**: `hello {token}` retoma o mesmo jogador, e uma sessão duplicada derruba a antiga.
- **Desconexão:** no lobby, o jogador sai. Na partida, o corpo fica parado por até `reconnectGrace` s e depois é eliminado.
- **Limites:** token bucket (`rateLimit`) e `maxMessageBytes`.
- **Snapshots:** enviados a `snapshotRate` Hz, cada um filtrado por jogador (`interestRadius`). Os dados privados (inventário, dinheiro) vão só para o próprio jogador.
- **Eventos:** `damage` só vai para os envolvidos. Killfeed, zona e loot vão em broadcast.
- **Latência:** o ping servidor→cliente (`ping2`/`pong2`) mede a latência usada na compensação de lag.

### 13. BotSystem
- Os bots usam a **mesma interface** dos humanos (`match.handle`), então exercitam todas as validações do servidor.
- Configuração: `match.fillWithBots` e `botFillTarget`. Só completam o lobby quando há pelo menos 1 humano.

---

## Como testar

### Testes automatizados (23 casos)
```bash
npm install
npm test
```
Cobrem: ciclo da partida, bloqueio de entrada com a partida em andamento, reconexão, tempo de graça da desconexão, parties, limite de velocidade, `seq` antigo, alcance e disputa de loot, coleta automática, headshot, armadura, falloff, parede, cadência, fogo amigo, abatido e revive, sangramento, relógio do Resurgence, desconto por abate, kit básico, squad wipe, vitória e colocação, desativação do Resurgence, solo, dano da zona, espectador, privacidade do snapshot e **uma partida inteira com bots até o vencedor**.

### Teste manual multiplayer
```bash
npm start            # porta 8080 (PORT=xxxx para mudar)
```
1. Abra `http://localhost:8080/client-debug/` em **duas ou mais abas** (ou máquinas na mesma rede).
2. Use o mesmo código de party nas duas para ficarem no mesmo squad. Os bots completam o lobby.
3. Espaço salta da aeronave (escolha o ponto de entrada), E pega loot e segurar E revive. [ ] troca o espectador.
4. **Roteiro sugerido:**
   - Deixe um aliado ser abatido e reviva-o.
   - Morra com o aliado vivo e veja o timer de retorno e o espectador.
   - Espere a fase 4: o aviso "Ressurgimento desativado" aparece e a próxima morte é definitiva.
   - Feche uma aba no meio da partida e reabra: o jogador reconecta com o mesmo token.
5. `npm run dev` mostra logs de debug de todos os eventos.

## Problemas de multiplayer previstos e mitigação

| Problema | Mitigação nesta etapa | Próximas etapas |
|---|---|---|
| Speed hack / teleporte | Servidor integra o movimento a partir de intenções | Predição + reconciliação no cliente para esconder a latência |
| Aimbot / tiro por trás da parede | Raycast com paredes, dispersão sorteada no servidor, cadência validada | Heurísticas de precisão/snap por jogador |
| "Atirei primeiro e morri" | Compensação de lag com limite de 250 ms | Mostrar hitbox rebobinada no debug |
| Dupla coleta de loot | Processamento sequencial por tick + remoção atômica | — |
| Vazamento de informação (wallhack de dados) | Snapshot filtrado por raio e sem vida de inimigos | Filtrar por linha de visão |
| Flood de mensagens | Token bucket + tamanho máximo de mensagem | Kick após abuso repetido |
| Queda de conexão | Token de reconexão + tempo de graça | Persistir a sessão em Redis para múltiplos processos |
| Muitos jogadores | SpatialGrid, pools, snapshot por interesse, tick fixo com alerta de tick lento | Delta compression / binário, várias partidas por processo |

## Próximas etapas (sugestão)
2. **Movimento avançado** (slide, mantle/vault, escalada) + predição no cliente.
3. **Contratos** (caça, suprimentos, captura, sobrevivência, coleta) + **Estações de compra** (placas, munição, kit de retorno de aliado).
4. **Integração do cliente 3D** (`game.js`) com o servidor, substituindo a simulação local.
5. **HUD 3D completa, áudio posicional e espectador em 3D.**
