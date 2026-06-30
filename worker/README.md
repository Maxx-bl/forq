# Worker Cloudflare — backend de prix

Ce Worker va chercher les prix de cryptos (CoinGecko) et de devises (Frankfurter, BCE) toutes
les 5 minutes (prix courant) et toutes les 30 minutes (historique), les stocke dans une
unique clé Cloudflare KV, et expose `GET /api/prices` qui se contente de **lire** ce KV.

Le endpoint public ne déclenche jamais d'appel vers CoinGecko ou Frankfurter : seul le cron
le fait. Cela protège le quota API quel que soit le trafic du site.

## Pourquoi une seule clé KV ?

Le plan gratuit Cloudflare KV autorise 1000 écritures/jour. Avec un cron toutes les 5 min
(288 exécutions/jour) + un cron toutes les 30 min (48 exécutions/jour), on reste à
**336 écritures/jour max** en utilisant une seule clé combinée — très loin de la limite.

## Prérequis

- Un compte Cloudflare (gratuit).
- [Node.js](https://nodejs.org/) et `npm`.
- Une clé API CoinGecko **Demo** (gratuite) : créer un compte sur
  [coingecko.com](https://www.coingecko.com/en/developers/dashboard) puis générer une clé
  "Demo API Key".

## Déploiement

```bash
cd worker
npm install

# Connexion à votre compte Cloudflare (ouvre le navigateur)
npx wrangler login

# Création du namespace KV
npx wrangler kv namespace create PRICES_KV
```

La commande précédente affiche un `id`. Copiez-le dans `wrangler.toml`, à la place de
`REMPLACER_AVEC_ID_NAMESPACE_KV` :

```toml
[[kv_namespaces]]
binding = "PRICES_KV"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

Ajoutez ensuite votre clé CoinGecko en secret (jamais en clair dans le code) :

```bash
npx wrangler secret put COINGECKO_API_KEY
# coller la clé quand demandé
```

Optionnel mais recommandé une fois le front déployé sur GitHub Pages : restreindre le CORS
au domaine du front en éditant `ALLOWED_ORIGIN` dans `wrangler.toml` (par défaut `"*"`) :

```toml
[vars]
ALLOWED_ORIGIN = "https://votre-user.github.io"
```

Déployez :

```bash
npm run deploy
```

Wrangler affiche l'URL du Worker (ex. `https://forq-prices-worker.votre-compte.workers.dev`).
Reportez cette URL dans `config.js` à la racine du projet (`WORKER_URL`).

## Premier remplissage du cache

Le KV est vide tant que le cron n'a pas tourné une première fois. Pour ne pas attendre,
déclenchez les deux jobs manuellement juste après le déploiement :

```bash
npx wrangler dev --test-scheduled
# dans un autre terminal :
curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"
curl "http://localhost:8787/__scheduled?cron=*/30+*+*+*+*"
```

Ou plus simplement, attendez jusqu'à 30 minutes après le déploiement en production : les
deux cron triggers se déclenchent automatiquement.

## Vérifier que ça fonctionne

```bash
curl https://votre-worker.workers.dev/api/prices
```

Doit retourner un JSON avec `updatedAt` et `assets`. Voir le format détaillé dans le
[README.md racine](../README.md#format-des-données).

## Modifier la liste des actifs suivis

Éditer `src/assets.js` (tableaux `CRYPTOS` et `FIATS`). Les `id` des cryptos doivent
correspondre aux identifiants CoinGecko (visibles dans l'URL de la page de chaque crypto sur
coingecko.com, ex. `bitcoin`, `avalanche-2`). Garder une liste raisonnable (10-15 par
catégorie) pour respecter le quota CoinGecko (30 appels/min en plan Demo).

## Limite connue : pas de vraie donnée "24h" pour les devises

Frankfurter (BCE) ne publie qu'un taux par jour ouvré. Il n'existe donc pas de granularité
intra-journalière pour les devises. Le champ `history["24h"]` est donc toujours vide pour les
actifs de type `"fiat"`, et le front masque le bouton de bascule 24h/7j sur les cartes
concernées.
