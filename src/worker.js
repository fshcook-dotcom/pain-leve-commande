// Point d'entrée Cloudflare : aiguille les 3 adresses "/api/..." vers leur
// fonction. Tout le reste (la page, le logo, les mentions légales) est servi
// directement par Cloudflare comme fichiers statiques, sans passer ici.

import { handleCheckout } from "./checkout.js";
import { handleWebhook } from "./webhook.js";
import { getFermetures } from "./fermetures.js";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/create-checkout-session") return handleCheckout(request, env);
    if (pathname === "/api/stripe-webhook") return handleWebhook(request, env);

    if (pathname === "/api/fermetures") {
      if (request.method !== "GET") return new Response(null, { status: 405 });
      const fermetures = await getFermetures(env);
      return new Response(JSON.stringify({ fermetures }), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          // un congé ajouté dans le Sheet est pris en compte en 1 à 3 minutes
          "Cache-Control": "public, max-age=30",
        },
      });
    }

    if (pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
