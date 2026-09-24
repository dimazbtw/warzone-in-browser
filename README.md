# Zona Ressurge

Battle royale com mecânica de **ressurgimento** (retorno por tempo), feito para o navegador.
Todo o conteúdo é original: nomes, armas, mapa, interface e código.

## Estrutura
| Parte | O que é |
|---|---|
| `server/` + `shared/` | **Servidor multiplayer autoritativo** (Node.js + WebSocket) |
| `client-debug/` | Cliente 2D para testar o multiplayer |
| `index.html`, `game.js` | Protótipo 3D single-player (Three.js), que ainda vai ser ligado ao servidor |
| `tests/` | Testes automatizados do núcleo |
| `docs/` | Documentação das etapas |

## Rodar
```bash
npm install
npm test          # 23 testes do núcleo
npm start         # http://localhost:8080  (3D)  e  http://localhost:8080/client-debug/  (multiplayer)
```

Todas as configurações de balanceamento estão em `shared/config.js`.
Detalhes de cada sistema, como testar e riscos de multiplayer: [`docs/ETAPA-1-NUCLEO.md`](docs/ETAPA-1-NUCLEO.md).
