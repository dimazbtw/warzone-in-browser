# Resurgence Zone

Battle royale estilo **Warzone Resurgência** que roda no navegador (Three.js, sem build).

- 20 operadores (você + 19 bots com IA que também lutam entre si)
- Queda de paraquedas, gás que fecha em 6 fases
- **Ressurgimento**: morreu, volta em 12s — até a fase 4, quando os retornos são desligados
- Armadura com 3 placas, baús de suprimentos, 5 armas, dinheiro, minimapa com pings de tiros
- Arte do menu gerada com **Higgsfield** (GPT Image 2.5)

## Rodar
```bash
python3 -m http.server 8000
# abra http://localhost:8000
```
Controles: WASD, mouse, clique (atirar), botão direito (mirar), Shift, Espaço, C, R, 1/2, E, Q, M.

## Novidades
- **Loadout**: 4 operadores (retratos gerados no Higgsfield), primária/secundária, 5 camuflagens, vantagens (Double Time, Amped, Tune Up, Ghost), letal (Frag/Semtex). Salvo no navegador.
- **Loadout Drop**: tecla **B** por $5000 — caixa desce de paraquedas com fumaça verde.
- **HUD estilo Warzone**: minimapa circular rotativo com cone de visão e pings vermelhos de tiros, bússola com marcador do gás, painel de esquadrão com dinheiro e placas, munição + silhueta da arma, luneta de sniper.
- **Skins/armas**: soldados com colete, mochila, capacete/máscara por operador, animação de pernas e paraquedas; armas em primeira pessoa detalhadas (trilho, red dot, guarda-mão, carregadores) com braços e luvas do operador.
- **Shaders**: céu procedural (FBM de nuvens + sol), bloom, gradação cinematográfica, aberração cromática, granulação, vinheta, efeito de dano e de gás.
