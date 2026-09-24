// Fonction serveur (Vercel) : reçoit le panier composé sur la page, et crée
// une session de paiement Stripe déjà remplie avec les bons articles et le
// bon total. Le client n'a plus qu'à entrer sa carte — aucune double saisie.
//
// Sécurité : le navigateur n'envoie que des identifiants de produit et des
// quantités. Les prix ne viennent JAMAIS du navigateur — ils sont recalculés
// ici, à partir de la liste ci-dessous, qui doit rester identique à celle
// du fichier index.html.

const Stripe = require("stripe");

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
  { id: "repere",    place: "Le repère des vignerons", days: [3,4,5,6] },
];

const MAX_QTY_PER_PRODUCT = 20;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Méthode non autorisée." });
    return;
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    res.status(500).json({ error: "Configuration serveur incomplète (clé Stripe absente)." });
    return;
  }
  const stripe = Stripe(secretKey);

  try {
    const { items, epicerieId, pickupDate, successUrl, cancelUrl } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "Panier vide." });
      return;
    }
    if (!successUrl || !cancelUrl) {
      res.status(400).json({ error: "URLs de redirection manquantes." });
      return;
    }

    const epicerie = EPICERIES.find(e => e.id === epicerieId);
    if (!epicerie) {
      res.status(400).json({ error: "Point de retrait inconnu." });
      return;
    }

    const pickup = new Date(pickupDate + "T00:00:00");
    if (isNaN(pickup.getTime())) {
      res.status(400).json({ error: "Date de retrait invalide." });
      return;
    }
    const weekday = pickup.getDay();
    if (!epicerie.days.includes(weekday)) {
      res.status(400).json({ error: `${epicerie.place} n'est pas ouvert ce jour-là.` });
      return;
    }

    const line_items = [];
    for (const raw of items) {
      const product = PRODUCTS.find(p => p.id === raw?.id);
      if (!product) {
        res.status(400).json({ error: `Produit inconnu : ${raw && raw.id}` });
        return;
      }
      const quantity = Number(raw.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_QTY_PER_PRODUCT) {
        res.status(400).json({ error: `Quantité invalide pour ${product.name}.` });
        return;
      }
      if (product.days && !product.days.includes(weekday)) {
        res.status(400).json({ error: `${product.name} n'est pas fabriqué ce jour-là.` });
        return;
      }
      line_items.push({
        price_data: {
          currency: "eur",
          product_data: { name: product.name },
          unit_amount: Math.round(product.price * 100),
        },
        quantity,
      });
    }

    const dateLabel = pickup.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items,
      client_reference_id: `${epicerie.place} | ${pickupDate}`,
      metadata: {
        epicerie: epicerie.place,
        pickupDate,
      },
      payment_intent_data: {
        description: `Le Pain Levé — retrait ${dateLabel} chez ${epicerie.place}`,
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Erreur création session Stripe:", err);
    res.status(500).json({ error: "Erreur lors de la préparation du paiement." });
  }
};
