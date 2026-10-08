// Reçoit le panier composé sur la page, et crée une session de paiement
// Stripe déjà remplie avec les bons articles et le bon total. Le client n'a
// plus qu'à entrer sa carte — aucune double saisie.
//
// Sécurité : le navigateur n'envoie que des identifiants de produit et des
// quantités. Les prix ne viennent JAMAIS du navigateur — ils sont recalculés
// ici, à partir de la liste ci-dessous, qui doit rester identique à celle
// du fichier index.html.

import { stripeRequest } from "./stripe.js";
import { getFermetures, fermetureQuiConcerne } from "./fermetures.js";

// ---- Doit rester synchronisé avec la liste PRODUCTS de index.html ----
const PRODUCTS = [
  { id: "campagne700",  name: "Campagne 700 g",       price: 7.5 },
  { id: "graines700",   name: "Graines 700 g",        price: 7.5 },
  { id: "noix700",      name: "Noix 700 g",           price: 7.5 },
  { id: "complet700",   name: "Complet 700 g",        price: 7.5 },
  { id: "raisins700",   name: "Raisins 700 g",        price: 7.5 },
  { id: "epeautre500",  name: "Grand épeautre 500 g", price: 7,   days: [3,4,5,6] },
  { id: "nordique500",  name: "Nordique 500 g",       price: 7,   days: [3,5] },
  { id: "campagne2kg",  name: "Campagne 2 kg",        price: 21.4 },
  { id: "campagne3kg",  name: "Campagne 3 kg",        price: 32 },
  { id: "brioche300",   name: "Brioche 300 g",        price: 7,   days: [5] },
];

const EPICERIES = [
  { id: "fanny",     place: "Fanny pâtisserie",        days: [3,4,5,6] },
  { id: "massenzio", place: "Massenzio",               days: [3,4,5,6] },
  { id: "robec",     place: "Marché du Robec",         days: [3,4,5,6] },
  { id: "fromagerie", place: "La Fromagerie du vieux marché", days: [3,4,5,6] },
];

const MAX_QTY_PER_PRODUCT = 20;

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });

export async function handleCheckout(request, env) {
  if (request.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);

  if (!env.STRIPE_SECRET_KEY) {
    return json({ error: "Configuration serveur incomplète (clé Stripe absente)." }, 500);
  }

  try {
    let body;
    try { body = await request.json(); } catch { body = null; }
    const { items, epicerieId, pickupDate, successUrl, cancelUrl, recurring, recurringPhone } = body || {};

    // --- Validation de base ---
    if (!Array.isArray(items) || items.length === 0) return json({ error: "Panier vide." }, 400);
    if (!successUrl || !cancelUrl) return json({ error: "URLs de redirection manquantes." }, 400);
    if (recurring && (!recurringPhone || String(recurringPhone).trim().length < 6)) {
      return json({ error: "Numéro de mobile manquant pour la commande récurrente." }, 400);
    }

    const epicerie = EPICERIES.find(e => e.id === epicerieId);
    if (!epicerie) return json({ error: "Point de retrait inconnu." }, 400);

    const pickup = new Date(pickupDate + "T00:00:00Z");
    if (isNaN(pickup.getTime())) return json({ error: "Date de retrait invalide." }, 400);
    const weekday = pickup.getUTCDay();
    if (!epicerie.days.includes(weekday)) {
      return json({ error: `${epicerie.place} n'est pas ouvert ce jour-là.` }, 400);
    }

    // --- Fermetures (congés) saisies dans l'onglet "Fermetures" du Google Sheet ---
    // Clé "aaaa-mm-jj" reconstruite depuis la date validée ci-dessus (et non
    // depuis le texte reçu tel quel).
    const pickupKey = pickup.toISOString().slice(0, 10);
    const fermeture = fermetureQuiConcerne(await getFermetures(env), epicerie.id, pickupKey);
    if (fermeture) {
      const quoi = fermeture.point === "tous" ? "Fermeture exceptionnelle" : `Fermeture de ${epicerie.place}`;
      return json({ code: "ferme", error: `${quoi} à cette date de retrait. Merci de choisir une autre date.` }, 400);
    }

    // --- Construction des lignes, prix recalculés côté serveur uniquement ---
    const line_items = [];
    const itemsSummary = [];
    for (const raw of items) {
      const product = PRODUCTS.find(p => p.id === (raw && raw.id));
      if (!product) return json({ error: `Produit inconnu : ${raw && raw.id}` }, 400);
      const quantity = Number(raw.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_QTY_PER_PRODUCT) {
        return json({ error: `Quantité invalide pour ${product.name}.` }, 400);
      }
      if (product.days && !product.days.includes(weekday)) {
        return json({ error: `${product.name} n'est pas fabriqué ce jour-là.` }, 400);
      }
      line_items.push({
        price_data: {
          currency: "eur",
          product_data: { name: product.name },
          unit_amount: Math.round(product.price * 100), // prix en centimes, jamais celui du navigateur
        },
        quantity,
      });
      itemsSummary.push(`${quantity}x ${product.name}`);
    }

    const dateLabel = pickup.toLocaleDateString("fr-FR", {
      weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
    });

    // Encodage du panier au même format que le lien "recommander" du site
    // (?ep=ID&items=id1:qte1,id2:qte2) — réutilisé par les relances SMS des
    // commandes récurrentes pour reconstituer le panier habituel du client.
    const itemsEncoded = items.map(raw => `${raw.id}:${raw.quantity}`).join(",");

    const session = await stripeRequest(env, "POST", "/v1/checkout/sessions", {
      mode: "payment",
      line_items,
      client_reference_id: `${epicerie.place} | ${pickupDate}`,
      metadata: {
        epicerie: epicerie.place,
        epicerieId: epicerie.id,
        pickupDate,
        itemsEncoded,
        recurring: recurring ? "yes" : "no",
        recurringPhone: recurring ? String(recurringPhone).trim() : "",
      },
      payment_intent_data: {
        description: `Retrait ${dateLabel} chez ${epicerie.place} — ${itemsSummary.join(", ")}`
          + (recurring ? " [commande récurrente]" : ""),
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    return json({ url: session.url });
  } catch (err) {
    console.error("Erreur création session Stripe:", err);
    return json({ error: "Erreur lors de la préparation du paiement." }, 500);
  }
}
