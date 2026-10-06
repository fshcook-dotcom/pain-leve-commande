// Petits outils pour parler à Stripe depuis Cloudflare, sans bibliothèque
// externe : appels directs à l'API Stripe, et vérification de la signature
// des webhooks avec les fonctions de cryptographie intégrées à Cloudflare.

// Stripe attend des formulaires "à crochets" : line_items[0][quantity]=2
export function encodeForm(obj) {
  const params = new URLSearchParams();
  const add = (prefix, value) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => add(`${prefix}[${i}]`, v));
    } else if (typeof value === "object") {
      for (const [k, v] of Object.entries(value)) add(`${prefix}[${k}]`, v);
    } else {
      params.append(prefix, String(value));
    }
  };
  for (const [k, v] of Object.entries(obj)) add(k, v);
  return params.toString();
}

export async function stripeRequest(env, method, path, params) {
  const base = env.STRIPE_API_BASE || "https://api.stripe.com"; // STRIPE_API_BASE : réservé aux tests
  const init = {
    method,
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  };
  let url = base + path;
  if (params && method === "GET") {
    url += "?" + encodeForm(params);
  } else if (params) {
    init.headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = encodeForm(params);
  }
  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok) {
    const msg = data && data.error && data.error.message ? data.error.message : `HTTP ${res.status}`;
    throw new Error("Stripe : " + msg);
  }
  return data;
}

const hexToBytes = hex => {
  if (!/^([0-9a-f]{2})+$/i.test(hex)) return null;
  return Uint8Array.from(hex.match(/../g).map(h => parseInt(h, 16)));
};

// Vérifie l'en-tête "Stripe-Signature" : même méthode que la bibliothèque
// officielle (HMAC-SHA256 de "horodatage.corps", tolérance de 5 minutes).
export async function verifyStripeSignature(rawBody, header, secret, toleranceSec = 300) {
  if (!header) throw new Error("En-tête Stripe-Signature absent");
  const parts = header.split(",").map(p => p.trim().split("="));
  const t = (parts.find(([k]) => k === "t") || [])[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || !/^\d+$/.test(t) || sigs.length === 0) throw new Error("En-tête Stripe-Signature illisible");
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) throw new Error("Horodatage trop ancien");

  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
  );
  const data = new TextEncoder().encode(`${t}.${rawBody}`);
  for (const sig of sigs) {
    const bytes = hexToBytes(sig);
    if (bytes && (await crypto.subtle.verify("HMAC", key, bytes, data))) return JSON.parse(rawBody);
  }
  throw new Error("Signature invalide");
}
