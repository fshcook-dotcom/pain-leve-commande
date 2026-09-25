// Fonction serveur (Vercel) : écoute la confirmation de paiement envoyée par
// Stripe (côté serveur, juste après que le client a payé) et demande
// explicitement l'envoi du reçu par e-mail au client. On fait ça ici, en
// code, car le réglage habituel "envoyer les reçus automatiquement" n'est
// pas disponible sur ce compte Stripe.
//
// Cette fonction doit être déclarée comme point de terminaison (« webhook »)
// sur le dashboard Stripe — voir le README pour la marche à suivre.

const Stripe = require("stripe");

// Empêche Vercel d'interpréter le corps de la requête avant nous : Stripe a
// besoin du corps brut, tel quel, pour vérifier que la requête vient bien de
// lui (signature).
module.exports.config = {
  api: {
    bodyParser: false,
  },
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) {
    console.error("Configuration serveur incomplète (clé Stripe ou secret webhook absent).");
    res.status(500).send("Configuration serveur incomplète.");
    return;
  }
  const stripe = Stripe(secretKey);

  let event;
  try {
    const rawBody = await readRawBody(req);
    const signature = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("Signature de webhook invalide :", err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const email = session.customer_details && session.customer_details.email;
      const paymentIntentId = session.payment_intent;

      if (email && paymentIntentId) {
        await stripe.paymentIntents.update(paymentIntentId, {
          receipt_email: email,
        });
      }
    }
    res.status(200).json({ received: true });
  } catch (err) {
    console.error("Erreur lors du traitement du webhook :", err);
    // On répond quand même 200 pour éviter que Stripe ne réessaie en boucle
    // une erreur qui ne se résoudra pas toute seule.
    res.status(200).json({ received: true, warning: "traitement partiel" });
  }
};
