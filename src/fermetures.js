// Lit la liste des fermetures dans l'onglet "Fermetures" du Google Sheet, en
// interrogeant le script Apps Script déjà branché pour les commandes
// récurrentes (variables GOOGLE_SHEET_WEBHOOK_URL et GOOGLE_SHEET_WEBHOOK_SECRET).
//
// Si Google ne répond pas, on ne bloque JAMAIS les commandes : on garde la
// dernière liste connue (ou aucune fermeture) et on réessaie un peu plus tard.

const CACHE_MS = 60 * 1000;      // une lecture au plus par minute
const RETRY_MS = 15 * 1000;      // après un échec, nouvel essai au bout de 15 s
const TIMEOUT_MS = 6000;

let cache = { at: 0, list: [] };

function listeValide(brute) {
  if (!Array.isArray(brute)) return [];
  const dateOk = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  return brute
    .filter(f => f && typeof f.point === "string" && dateOk(f.du) && dateOk(f.au))
    .map(f => ({ point: f.point.trim().toLowerCase(), du: f.du, au: f.au }));
}

export async function getFermetures(env) {
  const url = env.GOOGLE_SHEET_WEBHOOK_URL;
  if (!url) return [];
  if (Date.now() - cache.at < CACHE_MS) return cache.list;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: env.GOOGLE_SHEET_WEBHOOK_SECRET || "", action: "fermetures" }),
      signal: controller.signal,
    });
    const data = await res.json();
    if (!data || data.ok !== true || !Array.isArray(data.fermetures)) {
      throw new Error("Réponse inattendue : " + JSON.stringify(data).slice(0, 200));
    }
    cache = { at: Date.now(), list: listeValide(data.fermetures) };
  } catch (err) {
    console.error("Lecture des fermetures impossible :", err);
    cache = { at: Date.now() - CACHE_MS + RETRY_MS, list: cache.list };
  } finally {
    clearTimeout(timer);
  }
  return cache.list;
}

// Renvoie la fermeture qui concerne ce point à cette date ("aaaa-mm-jj"), ou null.
export function fermetureQuiConcerne(fermetures, epicerieId, dateKey) {
  const id = String(epicerieId || "").toLowerCase();
  return (fermetures || []).find(f =>
    (f.point === "tous" || f.point === id) && f.du <= dateKey && dateKey <= f.au
  ) || null;
}
