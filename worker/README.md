# Worker Cloudflare — backend de prix

Ce Worker va chercher les prix de cryptos (CoinGecko) et de devises (Frankfurter, BCE) toutes
les 15 minutes (prix courant) et toutes les 6 heures (historique 24h/7j/mois/toujours), les
stocke dans une unique clé Cloudflare KV, et expose `GET /api/prices` qui se contente de
**lire** ce KV.

Le endpoint public ne déclenche jamais d'appel vers CoinGecko ou Frankfurter : seul le cron
le fait. Cela protège le quota API quel que soit le trafic du site.

## Pourquoi ce rythme de cron ?

Le plan Demo CoinGecko est plafonné à **10 000 appels/mois** (en plus de la limite de
100 appels/min) — voir [la doc CoinGecko](https://support.coingecko.com/hc/en-us/articles/4538771776153-What-is-the-rate-limit-for-CoinGecko-API-public-plan).
Avec 14 cryptos suivies, le détail tient dans `worker/src/index.js` :

- prix courant : 1 appel/exécution × 96 exécutions/jour (toutes les 15 min) = 96 appels/jour
- historique : 2 appels/crypto/exécution (days=7 + days=365) × 14 cryptos × 4 exécutions/jour
  (toutes les 6h) = 112 appels/jour

Soit ≈208 appels/jour, ≈6 240/mois — large marge sous les 10 000. Frankfurter n'a pas de
quota connu, donc son rythme n'est pas une contrainte.

## Pourquoi une seule clé KV ?

Le plan gratuit Cloudflare KV autorise 1000 écritures/jour. Avec 96 + 4 = 100 exécutions/jour
au total, on reste à 100 écritures/jour max en utilisant une seule clé combinée — très loin
de la limite.

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

Le KV est vide tant que le cron n'a pas tourné une première fois (`GET /api/prices`
renvoie alors `{ "updatedAt": null, "assets": {} }`). Pour ne pas attendre jusqu'à 6h,
déclenchez les deux jobs manuellement juste après le déploiement.

Le flag `--remote` est essentiel : sans lui, `wrangler dev` simule un KV **local** vide,
qui n'a aucun rapport avec le KV de production lu par le Worker déployé.

```bash
cd worker
npx wrangler dev --remote --test-scheduled
# dans un autre terminal, pendant que la commande ci-dessus tourne :
curl "http://localhost:8787/__scheduled?cron=*/15+*+*+*+*"
curl "http://localhost:8787/__scheduled?cron=0+*/6+*+*+*"
```

Ces deux appels exécutent `scheduled()` avec les vrais bindings (KV de prod, secret
`COINGECKO_API_KEY`), donc le résultat est immédiatement visible sur
`https://votre-worker.workers.dev/api/prices`. Une fois les deux `curl` terminés (le second,
qui fait ~28 appels CoinGecko, prend quelques secondes), vous pouvez fermer `wrangler dev`
(Ctrl+C) : les cron triggers réels prendront le relais automatiquement.

⚠️ Chaque déclenchement manuel du job historique consomme ~28 appels CoinGecko sur le quota
mensuel (10 000). Évitez de le relancer en boucle pendant les tests.

Alternative sans terminal : dans le dashboard Cloudflare, Workers & Pages → votre worker →
onglet **Triggers**, chaque Cron Trigger dispose d'une action permettant de le déclencher
manuellement une fois.

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
catégorie) : chaque crypto ajoutée coûte 2 appels CoinGecko par exécution du job historique
(voir le calcul de quota plus haut).

## Limites connues

- **Pas de vraie donnée "24h" pour les devises.** Frankfurter (BCE) ne publie qu'un taux par
  jour ouvré : il n'existe donc pas de granularité intra-journalière pour les devises. Le champ
  `history["24h"]` est toujours vide pour les actifs de type `"fiat"`, et le front masque le
  bouton "Aujourd'hui" sur les cartes concernées.
- **"Toujours" n'est pas un historique infini.** Pour les cryptos, le plan Demo CoinGecko limite
  l'historique disponible à 365 jours. Pour les devises, on se limite volontairement à ~5 ans
  (Frankfurter n'a pas cette limite, mais charger l'historique complet depuis 1999 n'apporterait
  rien à un graphique aussi minimaliste).
