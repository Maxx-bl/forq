# forq — suivi de cours crypto / devises

Site minimaliste de suivi de cours, en HTML/CSS/JS vanilla (aucun framework, aucune
dépendance npm côté front), avec un backend Cloudflare Worker séparé qui agrège les prix
toutes les 5 minutes.

```
/                 → front statique (GitHub Pages)
  index.html
  style.css
  script.js
  config.js       → URL du Worker à configurer après déploiement
worker/           → backend Cloudflare Worker (déploiement séparé)
  wrangler.toml
  src/
  README.md       → instructions de déploiement détaillées du worker
```

## Architecture

```
CoinGecko / Frankfurter
        │  (cron, toutes les 5 et 30 min)
        ▼
  Cloudflare Worker  ──KV (cache)──►  GET /api/prices
        ▲                                    │
        │  jamais appelé directement         │  fetch (toutes les 60s)
        └────────────────────────────────────┘
                                              ▼
                                    Front statique (GitHub Pages)
```

Le Worker ne va chercher des données chez CoinGecko/Frankfurter que via son cron. Le endpoint
public `/api/prices` ne fait que lire le cache déjà rempli — les visiteurs ne déclenchent
jamais d'appel vers ces API tierces, quel que soit le trafic.

## Format des données

Le Worker renvoie un objet unique :

```json
{
  "updatedAt": "2026-06-30T12:00:00.000Z",
  "assets": {
    "bitcoin": {
      "type": "crypto",
      "symbol": "BTC",
      "name": "Bitcoin",
      "price": 65234.12,
      "change24h": 1.34,
      "history": { "24h": [[1719747600000, 65010.2], "..."], "7d": [["..."]] }
    },
    "EUR": {
      "type": "fiat",
      "symbol": "EUR",
      "name": "Euro",
      "price": 1.0832,
      "change24h": 0.05,
      "history": { "24h": [], "7d": [["..."]] }
    }
  }
}
```

- Tous les prix sont normalisés **en USD** (1 unité de l'actif = X USD), ce qui permet de
  calculer n'importe quel taux croisé côté front avec `price[A] / price[B]`.
- `history["24h"]` est toujours vide pour les actifs de type `"fiat"` : Frankfurter (taux BCE)
  ne publie qu'un taux par jour ouvré, il n'existe donc pas de vraie donnée intra-journalière.
  Le front masque le bouton 24h/7j dès qu'une devise est sélectionnée.

## Déploiement

### 1. Worker (backend)

Voir [worker/README.md](worker/README.md) pour les instructions complètes (création du
namespace KV, clé API CoinGecko, `wrangler deploy`).

### 2. Front (GitHub Pages)

1. Une fois le Worker déployé, ouvrez [config.js](config.js) et remplacez `WORKER_URL` par
   l'URL affichée par `wrangler deploy` (ex.
   `https://forq-prices-worker.votre-compte.workers.dev`).
2. Poussez le dépôt sur GitHub.
3. Dans les paramètres du dépôt GitHub → **Pages**, choisissez la branche `main` et le
   dossier `/ (root)` comme source.
4. Le site est servi à `https://votre-user.github.io/votre-repo/`.
5. Optionnel mais recommandé : revenez dans `worker/wrangler.toml` et restreignez
   `ALLOWED_ORIGIN` à ce domaine GitHub Pages exact, puis redéployez le worker
   (`npm run deploy` dans `/worker`).

## Fonctionnement du front

- Une carte affiche un actif (sélecteur, prix courant, variation 24h, graphique).
- Le bouton **+ comparer un second actif** ouvre une seconde carte à côté de la première.
- Le bouton **convertir** (actif uniquement quand deux actifs sont sélectionnés) remplace les
  deux cartes par un taux de conversion direct entre les deux (`1 BTC = X EUR` et l'inverse).
- Les actifs sélectionnés, la période (24h/7j) et le mode sont stockés dans l'URL
  (`?a=bitcoin&b=EUR&range=7d&mode=convert`), pour pouvoir partager un lien.
- Le thème (clair par défaut, sombre possible) est mémorisé dans `localStorage`.
- Aucune donnée n'est jamais demandée directement à CoinGecko ou Frankfurter depuis le
  navigateur : seul `WORKER_URL/api/prices` est appelé.

## Modifier la liste des actifs suivis

La liste (14 cryptos + 14 devises par défaut) est définie côté worker dans
[worker/src/assets.js](worker/src/assets.js). Le front l'affiche automatiquement à partir des
données reçues, aucune modification du front n'est nécessaire.
