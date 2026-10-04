// Fonction serveur (Vercel) : écoute la confirmation de paiement envoyée par
// Stripe (côté serveur, juste après que le client a payé).
// Deux choses à chaque paiement réussi :
//  1. Demande explicitement l'envoi du reçu par e-mail au client (le réglage
//     habituel "envoyer les reçus automatiquement" n'est pas disponible sur
//     ce compte Stripe).
//  2. Si la commande était cochée "récurrente", transmet téléphone + panier
//     au Google Sheet qui gère les relances SMS hebdomadaires — voir
//     google-apps-script-recurrence.gs pour la suite de la chaîne.
//
// Cette fonction doit être déclarée comme point de terminaison (« webhook »)
// sur le dashboard Stripe — voir le README pour la marche à suivre.

const Stripe = require("stripe");

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const handler = async (req, res) => {
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
        // Sécurité anti-doublon : si un reçu a déjà été demandé pour ce
        // paiement (par exemple si cette fonction est déclenchée deux fois
        // pour le même événement), on ne redemande pas l'envoi une seconde
        // fois — sinon le client reçoit le même reçu deux fois.
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        if (!paymentIntent.receipt_email) {
          await stripe.paymentIntents.update(paymentIntentId, {
            receipt_email: email,
          });
        }
      }

      // ---- Commande récurrente : transmission au Google Sheet ----
      const meta = session.metadata || {};
      if (meta.recurring === "yes" && meta.recurringPhone) {
        const sheetUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL;
        const sheetSecret = process.env.GOOGLE_SHEET_WEBHOOK_SECRET;
        if (sheetUrl) {
          try {
            await fetch(sheetUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                secret: sheetSecret || "",
                phone: meta.recurringPhone,
                epicerieId: meta.epicerieId,
                itemsEncoded: meta.itemsEncoded,
              }),
            });
          } catch (err) {
            // La commande est déjà payée : on ne fait surtout pas échouer le
            // webhook pour ça. C'est juste la mémorisation "récurrente" qui
            // rate — à surveiller si ça arrive souvent.
            console.error("Erreur transmission vers le Google Sheet :", err);
          }
        }
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

// Empêche Vercel d'interpréter le corps de la requête avant nous : Stripe a
// besoin du corps brut, tel quel, pour vérifier que la requête vient bien de
// lui (signature). Cette ligne doit venir APRÈS la définition de la
// fonction, sinon elle est perdue.
handler.config = {
  api: {
    bodyParser: false,
  },
};

module.exports = handler;
