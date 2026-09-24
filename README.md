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
