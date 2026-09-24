# Zona Ressurge

Battle royale multiplayer com mecânica de **ressurgimento** (retorno por tempo), feito para o navegador.
Servidor autoritativo em Node.js, cliente 3D em Three.js. Todo o conteúdo é original: nomes, armas, mapa, interface, sons e código.

## Rodar
```bash
npm install
npm start            # http://localhost:8080   (PORT=xxxx para mudar)
npm test             # 56 testes
```
**Sem servidor:** abra `index.html` servido por qualquer servidor estático (ex.: `python3 -m http.server`) e escolha *Jogar offline*. A simulação inteira do servidor roda num Web Worker, com bots e 3 dificuldades.

Os modelos 3D reais (operador rigado e fuzil gerados no Higgsfield) vêm do CDN. Se quiser uma cópia local, coloque-os em `assets/models/soldier.glb` e `rifle.glb`. Sem eles, o jogo usa modelos procedurais com o mesmo esqueleto.
- `/`: cliente 3D multiplayer
- `/client-debug/`: cliente 2D para depurar o servidor
- `/offline/`: protótipo single-player antigo

Abra várias abas ou máquinas. Quem usa o mesmo **código de party** fica no mesmo squad. Bots completam o lobby.

## Controles
| Tecla | Ação | Tecla | Ação |
|---|---|---|---|
| WASD | mover | Clique / Botão dir. | atirar / mirar |
| Shift (2× = tático) | correr | R · 1/2 · roda | recarregar · trocar arma |
| C | agachar (correndo = slide) | Q | placa (segure para várias) |
| Z | prone | H · G | cura · granada |
| Espaço | pular · mantle · vault · escalar · saltar da aeronave · paraquedas | E | pegar · segure para reviver |
| F | aceitar contrato | B | estação de compra |
| M · Tab | mapa · inventário | [ ] | trocar espectador |
| V | faca / finalizar abatido | T | granada de fumaça |
| X · botão do meio | ping (inimigo / item / destino) | Esc | pausa |

## Mecânicas
- Lobby com party, contagem, aeronave com escolha do ponto de salto, queda livre e paraquedas.
- Movimento: sprint, sprint tático com stamina, agachar, prone, slide, pulo, mantle, vault, escalada e telhados.
- Loot com raridade, coleta automática opcional, inventário rápido e drop ao morrer.
- Combate:
  - Hitscan com compensação de lag, ou projétil (configurável).
  - Dano por distância, multiplicadores por parte do corpo, headshot.
  - Recuo, ADS e hip fire.
  - Placas de armadura, estado de abatido e reviver.
- **Resurgence:** o retorno é mais rápido com aliados vivos e com abates do squad. Volta num ponto seguro com kit básico e desliga numa fase da zona. Um squad inteiro morto fica fora.
- Zona com fases (centro aleatório, espera, fechamento, dano progressivo) e final de raio 0.
- Contratos: Caçada, Suprimentos, Domínio, Resistência e Inteligência.
- Estações: placas, munição, cura, granada, arma, radar e **Kit de Retorno** do aliado.
- Faca com finalização de abatidos, fumaça que bloqueia a visão dos bots, pings de esquadrão.
- Armas com raridade: dano, dispersão, recuo, alcance, pente e recarga.
- Personagens com animação procedural por IK: passo, mira, sprint, slide, mantle, prone, paraquedas, abatido e morte.
- Primeira pessoa com recuo por padrão, recarga animada, bob e tilt de câmera, pouso, passos por superfície e reverb.
- Espectador, placar e tela final com estatísticas (eliminações, dano, tempo, contratos, dinheiro, posição).

## Documentação
- [Arquitetura e mapa dos sistemas](docs/ARQUITETURA.md)
- [Etapa 1: núcleo multiplayer](docs/ETAPA-1-NUCLEO.md)
- [Etapas 2 a 5](docs/ETAPAS-2-5.md)

Todo o balanceamento fica em **`shared/config.js`**.
