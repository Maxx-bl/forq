// Point d'entrée du Worker Cloudflare.
//
// - scheduled() : exécuté par les cron triggers, va chercher les données chez CoinGecko et
//   Frankfurter, les écrit dans KV. JAMAIS appelé par un visiteur.
// - fetch()     : expose GET /api/prices, qui se contente de LIRE le KV déjà rempli par le
//   cron. C'est le seul endpoint public.

import { CRYPTOS, FIATS } from "./assets.js";
import { fetchCurrentPrices, fetchHistory7d } from "./coingecko.js";
import { fetchCurrentRates, fetchHistory as fetchFiatHistory } from "./frankfurter.js";
import { readState, writeState, applyCurrentPrices, applyCryptoHistory, applyFiatHistory } from "./kv.js";

const CRON_CURRENT_PRICES = "*/5 * * * *";
const CRON_HISTORY = "*/30 * * * *";

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

async function handleCurrentPricesJob(env) {
  const state = await readState(env.PRICES_KV);

  const cryptoPrices = await fetchCurrentPrices(CRYPTOS, env.COINGECKO_API_KEY);
  const cryptoEntries = CRYPTOS.filter((c) => cryptoPrices[c.id]).map((c) => ({
    id: c.id,
    type: "crypto",
    symbol: c.symbol,
    name: c.name,
    price: cryptoPrices[c.id].price,
    change24h: cryptoPrices[c.id].change24h,
  }));
  applyCurrentPrices(state, cryptoEntries);

  const fiatRates = await fetchCurrentRates(FIATS);
  const fiatEntries = FIATS.filter((f) => fiatRates[f.id]).map((f) => ({
    id: f.id,
    type: "fiat",
    symbol: f.symbol,
    name: f.name,
    price: fiatRates[f.id].price,
    change24h: fiatRates[f.id].change24h,
  }));
  applyCurrentPrices(state, fiatEntries);

  await writeState(env.PRICES_KV, state);
}

async function handleHistoryJob(env) {
  const state = await readState(env.PRICES_KV);

  // Un appel par crypto (days=7, granularité horaire), en parallèle : ~14 appels, large­ment
  // sous la limite de 30 appels/min du plan Demo CoinGecko. Les échecs individuels n'empêchent
  // pas la mise à jour des autres actifs.
  const cryptoResults = await Promise.allSettled(
    CRYPTOS.map((crypto) => fetchHistory7d(crypto.id, env.COINGECKO_API_KEY))
  );
  cryptoResults.forEach((result, index) => {
    if (result.status === "fulfilled") {
      applyCryptoHistory(state, CRYPTOS[index], result.value);
    } else {
      console.error(`Historique CoinGecko échoué pour ${CRYPTOS[index].id}`, result.reason);
    }
  });

  // Un seul appel Frankfurter couvre toutes les devises suivies.
  try {
    const fiatHistory = await fetchFiatHistory(FIATS, 7);
    for (const fiat of FIATS) {
      applyFiatHistory(state, fiat, fiatHistory[fiat.id] ?? []);
    }
  } catch (err) {
    console.error("Historique Frankfurter échoué", err);
  }

  await writeState(env.PRICES_KV, state);
}

export default {
  async scheduled(event, env, ctx) {
    if (event.cron === CRON_CURRENT_PRICES) {
      ctx.waitUntil(handleCurrentPricesJob(env));
    } else if (event.cron === CRON_HISTORY) {
      ctx.waitUntil(handleHistoryJob(env));
    }
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(env) });
    }

    if (url.pathname === "/api/prices" && request.method === "GET") {
      const state = await readState(env.PRICES_KV);
      return new Response(JSON.stringify(state), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=60",
          ...corsHeaders(env),
        },
      });
    }

    return new Response("Not found", { status: 404, headers: corsHeaders(env) });
  },
};
