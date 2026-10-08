// Écoute la confirmation de paiement envoyée par Stripe (côté serveur, juste
// après que le client a payé). Deux choses à chaque paiement réussi :
//  1. Demande explicitement l'envoi du reçu par e-mail au client (le réglage
//     habituel "envoyer les reçus automatiquement" n'est pas disponible sur
//     ce compte Stripe).
//  2. Si la commande était cochée "récurrente", transmet téléphone + panier
//     au Google Sheet qui gère les relances SMS hebdomadaires — voir
//     google-apps-script-recurrence.gs pour la suite de la chaîne.

import { stripeRequest, verifyStripeSignature } from "./stripe.js";

const reply = (body, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json" },
  });

export async function handleWebhook(request, env) {
  if (request.method !== "POST") return new Response(null, { status: 405 });

  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
    console.error("Configuration serveur incomplète (clé Stripe ou secret webhook absent).");
    return reply("Configuration serveur incomplète.", 500);
  }

  // Corps brut, tel quel : Stripe signe exactement ces octets.
  let event;
  try {
    const rawBody = await request.text();
    event = await verifyStripeSignature(rawBody, request.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Signature de webhook invalide :", err.message);
    return reply(`Webhook Error: ${err.message}`, 400);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const email = session.customer_details && session.customer_details.email;
      const paymentIntentId = session.payment_intent;

      if (email && paymentIntentId) {
        // Sécurité anti-doublon : si un reçu a déjà été demandé pour ce
        // paiement, on ne redemande pas l'envoi une seconde fois.
        const paymentIntent = await stripeRequest(env, "GET", `/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`);
        if (!paymentIntent.receipt_email) {
          await stripeRequest(env, "POST", `/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`, {
            receipt_email: email,
          });
        }
      }

      const meta = session.metadata || {};

      // ---- Toute commande payée : transmission au Google Sheet ----
      // (onglets "Saisie du jour" et "Click&collect"). L'identifiant de la
      // session Stripe sert d'anti-doublon côté Sheet.
      if (env.GOOGLE_SHEET_WEBHOOK_URL && session.payment_status === "paid" && meta.epicerieId && meta.itemsEncoded) {
        try {
          await fetch(env.GOOGLE_SHEET_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              secret: env.GOOGLE_SHEET_WEBHOOK_SECRET || "",
              action: "commande",
              sessionId: session.id,
              epicerieId: meta.epicerieId,
              place: meta.epicerie,
              pickupDate: meta.pickupDate,
              itemsEncoded: meta.itemsEncoded,
              amountTotal: session.amount_total,
            }),
          });
        } catch (err) {
          // La commande est payée : on ne fait pas échouer le webhook pour ça.
          console.error("Erreur transmission de la commande vers le Google Sheet :", err);
        }
      }

      // ---- Commande récurrente : transmission au Google Sheet ----
      if (meta.recurring === "yes" && meta.recurringPhone && env.GOOGLE_SHEET_WEBHOOK_URL) {
        try {
          await fetch(env.GOOGLE_SHEET_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              secret: env.GOOGLE_SHEET_WEBHOOK_SECRET || "",
              phone: meta.recurringPhone,
              epicerieId: meta.epicerieId,
              itemsEncoded: meta.itemsEncoded,
              pickupDate: meta.pickupDate,
            }),
          });
        } catch (err) {
          // La commande est déjà payée : on ne fait surtout pas échouer le
          // webhook pour ça. C'est juste la mémorisation "récurrente" qui rate.
          console.error("Erreur transmission vers le Google Sheet :", err);
        }
      }
    }
    return reply({ received: true });
  } catch (err) {
    console.error("Erreur lors du traitement du webhook :", err);
    // On répond quand même 200 pour éviter que Stripe ne réessaie en boucle
    // une erreur qui ne se résoudra pas toute seule.
    return reply({ received: true, warning: "traitement partiel" });
  }
}
