# Tetris

PWA Tetris (HTML/CSS/JS, aucune dépendance), générée par l'app-factory.

- `public/core.js` : moteur (SRS, sac de 7, hold, ghost, lock delay) — testé : `npm test`
- `public/main.js` : rendu canvas, clavier (DAS/ARR), commandes tactiles, pause auto
- `public/sw.js` : cache hors ligne ; `manifest.webmanifest` : installable
- Déploiement : `Dockerfile` (nginx) → Dokploy → https://tetris.vizentic.cloud

Commandes : ← → déplacer · ↑/X tourner · Z tourner à gauche · ↓ descendre · Espace chute · C réserve · P pause.
Hors périmètre : T-spin, scores en ligne.
