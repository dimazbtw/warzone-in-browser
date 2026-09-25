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

Modelos 3D em `assets/models/`: os operadores **Caveira** (`operator_1.glb`) e **Duna** (`operator_2.glb`) e a aeronave KC-10 (`aircraft.glb`). O fuzil de 1ª pessoa vem do CDN do Higgsfield.
Armas (`assets/models/weapons/`): 10 modelos enviados pelo usuário, otimizados com gltf-transform (texturas WebP ≤1024 px, AK simplificado; 81 MB → 14 MB). O `RealWeapons` normaliza a orientação e o tamanho de cada uma (confira em `tools/weapons.html`). Arsenal: Vespa 9, Sagui 9, Onça .45 (pistolas); Colibri, Morcego, Quati (SMGs); Carcará AR, Jaguar AK; Harpia DMR, Gavião SR (com luneta); Tatu 12 (escopeta procedural).
Braços de 1ª pessoa (`arms.glb`, espelhado para a mão esquerda) com FOV próprio de 50° (`tools/viewmodel.html`) e paraquedas (`parachute.glb`).
Os operadores são malhas estáticas. O `AutoRig` cria o esqueleto de 24 ossos na hora de carregar, então pernas, quadril, tronco e cabeça são animados por IK, e braços e fuzil ficam presos ao peito. Os retratos do menu são renderizados dos próprios modelos (`tools/portrait.html`). Sem os arquivos, o jogo usa um humanoide procedural.
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
