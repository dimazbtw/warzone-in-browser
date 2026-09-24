# Etapas 2 a 5

## Etapa 2 — Movimento avançado

**Estrutura**
- `shared/geometry.js` (`MapGeometry`): caixas com `kind` (`building`, `container`, `cover`) e `climb`. Oferece `groundHeight(x,z,y)` (permite andar em telhados), `resolve()`, `obstacleAhead()`, `thickness()` e `raycast()`.
- `shared/movement.js`: funções puras `stepGround`, `stepAir` e `stepCrawl`. São **as mesmas no servidor e no cliente**.
- `server/MapData.js` gera o mapa por seed: prédios (parte escaláveis, com escada desenhada no cliente), contêineres e muretas, além dos pontos de estações e de contratos.

**Mecânicas**

| Mecânica | Como ativa | Regra |
|---|---|---|
| Sprint | Shift | Só para frente e sem mirar |
| Sprint tático | Shift duas vezes | Gasta stamina e bloqueia por `regenDelay` quando esgota |
| Agachar / Prone | C / Z | — |
| Slide | C enquanto corre | Impulso que decai (`MOVE_DEFAULTS.slide`), recarga de 1 s, cancelável com pulo |
| Pulo | Espaço | — |
| Vault | Espaço contra mureta | Obstáculo ≤ 1,3 m de altura e ≤ 1,6 m de espessura: passa por cima |
| Mantle | Espaço contra obstáculo | Até 2,8 m: sobe no topo com transição suave (smoothstep) |
| Escalada | Espaço + frente em superfície `climb` | Sobe a 3,6 m/s; no topo faz mantle; soltar a frente faz cair |

**Integração**
- O servidor consome os inputs **em fila**: cada input vira um passo com o próprio `dt`.
- O orçamento de tempo cresce só com o relógio do servidor, então mandar mais pacotes não acelera ninguém (anti speed hack).
- O snapshot envia `seq` confirmado, `vy`, `grounded`, `slide`, `mantle`, `climb`, stamina e flags de borda (`pj`, `pc`) para a reconciliação exata.

**Configuração:** `movement.*` no `config.js`. `movement.advanced` pode sobrescrever `MOVE_DEFAULTS` (slide, mantle, escalada).

**Testar:** `node --test tests/movement.test.js` cobre slide com recarga, vault, mantle e telhado, escalada, parede não escalável, stamina e determinismo (base da predição).

**Riscos de multiplayer**

| Risco | Mitigação |
|---|---|
| Divergência entre cliente e servidor | Mesma função, mesmo `dt` por input e reconciliação com replay dos inputs pendentes; o erro é suavizado |
| Pulo "perdido" entre ticks | Fila de inputs em vez de "último input vence" |
| Teleporte via mantle | O servidor calcula o destino a partir da geometria dele |

---

## Etapa 3 — Contratos e estações

### ContractSystem
- Tablets espalhados pelo mapa (`contracts.boards`). **F** ativa o tablet, com um contrato por squad por vez.

| Contrato | Objetivo | Detalhe |
|---|---|---|
| **Caçada** | Eliminar o inimigo mais próximo | A posição aproximada (±15 m) é revelada a cada 8 s. Falha se outro squad eliminar o alvo |
| **Suprimentos** | Visitar N esconderijos em sequência | O último solta loot épico e placas |
| **Domínio** | Ficar na área por X s | Pausa quando **contestada** (inimigo dentro) |
| **Resistência** | Squad sobreviver X s | — |
| **Inteligência** | Coletar N itens | Os itens são **exclusivos do squad** (outros não pegam) |

- **Recompensas:** dinheiro para cada membro, XP, `stats.contracts++` e desconto de `respawnReduction` s para aliados aguardando retorno.
- **Falha:** tempo esgotado, alvo roubado ou squad eliminado.

### BuyStationSystem
- Estações em pontos fixos do mapa. **B** abre a loja. O catálogo fica em `stations.catalog`; o efeito de cada item é uma função em `effects`.
- Itens: placas, munição, cura, granada, arma, **radar** (marca inimigos no minimapa do squad por 30 s) e **Kit de Retorno**.
- O Kit de Retorno traz um aliado aguardando **ou eliminado**, mesmo com o Resurgence desligado, até a fase `buybackUntilPhase`, com limite por partida.
- O dinheiro **só é debitado se o efeito foi aplicado**. As validações são estado, distância, saldo, item existente, limites e fase.

**Rede:** eventos de contrato e de compra vão só para o squad. Falhas de compra e de coleta vão só para o jogador.

**Testar:** `node --test tests/economy.test.js` (10 casos).

**Riscos de multiplayer**

| Risco | Mitigação |
|---|---|
| Duplicar dinheiro | Débito atômico após o efeito, tudo no servidor |
| Comprar de longe | Distância validada com a posição do servidor |
| Contrato em dobro | Um ativo por squad; tablet marcado como `taken` |
| Wallhack via contrato | A Caçada revela posição aproximada, não exata |

---

## Etapa 4 — Cliente 3D multiplayer

**Estrutura (`client/`)**
- `net/NetClient.js`: reconexão com backoff, token em `sessionStorage`, RTT (ping/pong), estimativa do relógio do servidor.
- `game/Prediction.js`: predição a 30 Hz com a física compartilhada. No snapshot volta ao estado autoritativo e reaplica os inputs pendentes. Correções pequenas são suavizadas e correções grandes (> 4 m ou troca de estado) são aplicadas na hora.
- `game/Interpolation.js`: outros jogadores são desenhados 100 ms no passado, entre dois snapshots.
- `game/InputSystem.js`: teclado e mouse viram intenção. Teclas em `KEYMAP`.
- `render/World.js`:
  - Mapa gerado da mesma `MapGeometry`, com texturas do Higgsfield e fallback procedural.
  - Parede da zona com shader animado e círculo da próxima zona.
  - Loot com pool e feixe de raridade, estações, tablets, aeronave e marcador do contrato.
  - Céu em shader e pós-processamento (bloom, gradação, aberração, grão, vinheta, efeitos de dano, gás e abatido).
- `render/Avatars.js`: soldados por squad com placa de nome para aliados, poses por estado (queda livre, paraquedas, abatido, prone, slide), animação de pernas e marcador de radar.
- `render/ViewModel.js`: arma e braços em primeira pessoa, com bob, sway, recuo, flash e animações de recarga, placa, cura e reviver.
- `render/Effects.js`: traçantes, faíscas e explosões, todos com pool.
- `audio/AudioSystem.js`: sons sintetizados e posicionais (HRTF), vento na queda.
- `ui/HUDSystem.js`: vida, armadura (3 placas), stamina, munição, arma equipada e reserva, inventário, dinheiro, minimapa rotativo, mapa grande (M), bússola com zona e contrato, estado e distância dos aliados, timer do Resurgence, distância e direção da zona, killfeed, mensagens, contrato, loja, espectador, placar (Tab) e tela final.

**Câmeras:** primeira pessoa (altura por postura e slide), terceira pessoa na aeronave, na queda e no paraquedas, e espectador em terceira pessoa atrás do aliado assistido.

**Testar:** `npm start`, abrir `http://localhost:8080` em duas abas com o mesmo código de party. O rodapé mostra ping e número de correções de predição.

---

## Etapa 5 — Rede, desempenho e operação

**Testes (`npm test`, 46 casos)**
- `core.test.js` (23): núcleo da etapa 1.
- `movement.test.js` (7): física.
- `economy.test.js` (10): contratos e estações.
- `network.test.js` (6): WebSocket real (handshake, config sem vazamento, reconexão por token no meio da partida, bloqueio de quem entra atrasado, limite de taxa, escopo de eventos, mensagens malformadas) e **carga com 60 jogadores** (tick médio < 8 ms com snapshot por humano).

**Desconexão e reconexão**
- No lobby, quem desconecta sai.
- Na partida, o corpo fica parado por `reconnectGrace` s. Reconectar com o token retoma o mesmo jogador e reenvia `matchStart`. Depois do prazo, o jogador é eliminado.
- Uma sessão duplicada derruba a anterior.

**Otimização**
- Grade espacial (loot, interesse).
- Pools (loot, projéteis, efeitos, malhas de loot no cliente).
- Snapshot filtrado por raio e por privacidade.
- Eventos `near` (tiros, explosões, movimento) só para quem está a até 220 m.
- Tick fixo com aviso de "tick lento" no log.

**Logs:** `LOG_LEVEL=debug npm start` mostra todas as transições de estado e todos os eventos do bus.

**Próximos passos sugeridos para produção**
- Serialização binária ou delta dos snapshots.
- Várias partidas por processo (matchmaker).
- Sessões em Redis para escalar horizontalmente.
- Linha de visão no filtro de interesse.
- Heurísticas anti-aimbot.
- Animações esqueléticas para os avatares.
