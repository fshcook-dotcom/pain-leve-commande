# Le Pain Levé — outil de commande

Hébergement : **Cloudflare** (Workers + fichiers statiques), domaine **lepainleve.com**
(acheté chez OVH). Code dans le dépôt GitHub `fshcook-dotcom/pain-leve-commande`,
déployé automatiquement à chaque modification (branche `main`).

## Organisation du dépôt

- `public/` : ce que voit le client — `index.html`, `mentions-legales.html`,
  `assets/` (logo, icône). **C'est ici qu'on modifie la page.**
- `src/` : le code serveur — `checkout.js` (crée le paiement Stripe, recalcule les
  prix), `webhook.js` (reçu e-mail + récurrence), `fermetures.js` (congés),
  `stripe.js` (outils Stripe), `worker.js` (aiguillage).
- `wrangler.jsonc` : réglage Cloudflare. Ne pas toucher.
- `google-apps-script-recurrence.gs` : copie du script du Google Sheet (à coller
  dans Apps Script, il ne tourne pas sur Cloudflare).

## Réglages secrets (Cloudflare)

Cloudflare → Workers & Pages → `pain-leve-commande` → **Settings → Variables and
Secrets** (type « Secret ») :

| Nom | Valeur |
|---|---|
| `STRIPE_SECRET_KEY` | clé secrète Stripe (`sk_live_…`, ou `sk_test_…` pour tester) |
| `STRIPE_WEBHOOK_SECRET` | secret de signature du webhook Stripe (`whsec_…`) |
| `GOOGLE_SHEET_WEBHOOK_URL` | adresse `/exec` de l'application web Apps Script |
| `GOOGLE_SHEET_WEBHOOK_SECRET` | le même mot de passe que `WEBHOOK_SHARED_SECRET` dans Apps Script |

Après un changement de secret, redéployer (Deployments → ⋯ → Retry, ou une
modification quelconque sur GitHub).

## Webhook Stripe

Dashboard Stripe → Développeurs → Webhooks : adresse
`https://lepainleve.com/api/stripe-webhook`, événement `checkout.session.completed`.

## Tester

Avec une clé **test** : carte `4242 4242 4242 4242`, date future, CVC au choix. Vérifier
la commande dans Stripe → Paiements (point de retrait et date dans les métadonnées).

## Commandes récurrentes

Deux systèmes se superposent, pour deux besoins différents :

### A. "Recommander ce panier" (tous les clients, déjà actif)

C'est intégré au lien principal — celui du QR code de la carte de visite,
le même pour tout le monde. Après qu'un client a payé une fois, son panier
est mémorisé dans son navigateur. À sa prochaine visite sur ce même lien,
depuis le même appareil, la page lui propose de recommander à l'identique.
Rien à configurer, ça fonctionne déjà.

### B. Commande récurrente avec relance SMS (clients hebdomadaires)

Sur la page, une fois le panier composé, le client peut cocher **"Rendre
cette commande récurrente chaque semaine"** et laisser son numéro de mobile.
Chaque semaine ensuite (la date visée est le même jour de la semaine que son
dernier retrait, une semaine plus tard — en sautant les périodes de fermeture,
voir plus bas) :
1. Cinq jours avant cette date, il reçoit un SMS avec un lien qui pré-remplit
   son panier habituel.
2. Il clique, ajuste librement les quantités si besoin (3 pains au lieu de 2,
   etc.), choisit sa date, et paie — comme une commande normale. **Aucun
   prélèvement automatique.**
3. S'il ne confirme pas avant la date limite de commande, la récurrence est
   mise en pause automatiquement (pour ne pas fabriquer un pain non payé), et
   il reçoit un SMS l'informant de la pause avec un lien pour reprendre quand
   il veut — il suffit de recommander et de recocher la case.
4. Le panier "habituel" se met à jour à chaque paiement : la prochaine
   relance proposera ce qu'il a commandé la dernière fois, pas ce qu'il avait
   coché au départ.

Ce système repose sur trois briques, à mettre en place une fois :

#### B.1 — Un Google Sheet pour mémoriser les clients récurrents

1. Créez un nouveau Google Sheet (n'importe quel nom).
2. Menu **Extensions → Apps Script**.
3. Supprimez le code par défaut, collez le contenu du fichier
   `google-apps-script-recurrence.gs` fourni à côté de ce README.
4. En haut du script, changez `SITE_URL` pour l'adresse réelle de votre site.
5. Menu **Déployer → Nouveau déploiement** → type **Application Web** :
   - Exécuter en tant que : **Moi**
   - Qui a accès : **Tout le monde**
   - Cliquez **Déployer**, autorisez les permissions demandées
   - Copiez l'**URL de l'application Web** obtenue (vous en aurez besoin à
     l'étape B.3)

#### B.2 — Un compte OVH SMS (l'envoi des SMS)

1. Créez un compte sur [ovhcloud.com](https://www.ovhcloud.com/fr/sms/) et
   achetez un petit pack de SMS (100 SMS ≈ 6€, sans engagement, pour tester).
   Notez le nom du service créé (ressemble à `sms-xxxxx-1`).
2. Enregistrez un expéditeur personnalisé (ex. `LePainLeve`, 11 caractères
   max) depuis votre espace client OVH, rubrique SMS.
3. Créez des identifiants API sur
   [api.ovh.com/createToken](https://api.ovh.com/createToken/) avec les
   droits sur `/sms/*` (GET, POST). Vous obtenez une **Application Key**, une
   **Application Secret** et une **Consumer Key**.
4. Retournez dans l'éditeur Apps Script (menu ⚙️ **Paramètres du projet** →
   **Propriétés du script**) et ajoutez :
   - `OVH_APPLICATION_KEY`, `OVH_APPLICATION_SECRET`, `OVH_CONSUMER_KEY`
   - `OVH_SMS_SERVICE` (le nom du service, ex. `sms-xxxxx-1`)
   - `OVH_SMS_SENDER` (l'expéditeur enregistré à l'étape 2)
   - `WEBHOOK_SHARED_SECRET` : inventez un mot de passe long et aléatoire —
     c'est ce qui empêche n'importe qui sur Internet d'appeler votre Apps
     Script. Gardez-le, vous le reposez à l'étape B.3.

#### B.3 — Brancher Stripe, Cloudflare et le Google Sheet ensemble

1. Sur le [dashboard Stripe](https://dashboard.stripe.com) → **Développeurs
   → Webhooks → Ajouter un point de terminaison** :
   - URL : `https://lepainleve.com/api/stripe-webhook`
   - Événement à écouter : `checkout.session.completed`
   - Copiez le **secret de signature** (commence par `whsec_...`)
2. Sur Cloudflare → **Settings → Variables and Secrets**, ajoutez :
   - `STRIPE_WEBHOOK_SECRET` = le secret copié à l'étape précédente
   - `GOOGLE_SHEET_WEBHOOK_URL` = l'URL de l'application Web copiée à l'étape B.1
   - `GOOGLE_SHEET_WEBHOOK_SECRET` = le même mot de passe que `WEBHOOK_SHARED_SECRET` (étape B.2)
3. Redéployez sur Cloudflare (les nouveaux secrets ne prennent effet qu'après).
4. Dans l'éditeur Apps Script, menu **Déclencheurs** (icône horloge) → **Ajouter
   un déclencheur** :
   - Fonction : `cycleRecurrences`
   - Type d'événement : **Basé sur la durée** → **Minuteur jour** → une heure
     dans la matinée (ex. entre 8h et 9h)

#### Tester

Passez une commande test en cochant la case récurrente avec votre propre
numéro. Une fois payée, vérifiez dans le Google Sheet qu'une ligne "actif"
apparaît. La relance SMS n'arrivera que quelques jours avant votre prochaine
date de retrait éligible (`RELANCE_AVANT_JOURS` dans le script) — pour tester
plus vite, vous pouvez temporairement exécuter `cycleRecurrences` à la main
depuis l'éditeur Apps Script après avoir mis manuellement une `DateCible`
proche dans le Sheet.

#### Si vous changez les points de vente / jours d'ouverture

`EPICERIES_DAYS` et `LEAD_DAYS` dans `google-apps-script-recurrence.gs`
doivent rester identiques à `EPICERIES` et `LEAD_DAYS` dans `index.html` /
`src/checkout.js` — ce sont les mêmes informations dupliquées
à trois endroits. La liste déroulante de la colonne "Point" de l'onglet
"Fermetures" doit aussi être mise à jour. Revenez me voir pour toute
modification, je mets tout à jour ensemble.

#### Lien manuel (toujours disponible, sans rien configurer)

`https://lepainleve.com/?ep=ID_EPICERIE&items=id1:quantité1,id2:quantité2`
— utile si vous voulez renvoyer vous-même un lien ponctuel par SMS/WhatsApp,
indépendamment du système de relance automatique.

## Fermetures (congés des points de retrait, ou de la boulangerie)

Pour fermer un point de retrait sur une période, sans toucher au code : ouvrez
l'onglet **Fermetures** du Google Sheet et ajoutez une ligne.

| Point | Du (inclus) | Au (inclus) | Motif (privé) |
|---|---|---|---|
| `fanny` | 22/12/2026 | 28/12/2026 | congés de Noël |
| `tous` | 03/08/2027 | 16/08/2027 | congés d'été (boulangerie) |

- **Point** : liste déroulante — un point de retrait, ou `tous` pour fermer
  tous les points d'un coup (quand c'est la boulangerie qui est en congé).
- **Au** vide = un seul jour. Pour annuler une fermeture, effacez la ligne.
- **Motif** : pour vous seulement, jamais affiché ni envoyé au site.
- Prise en compte par le site en 1 à 3 minutes.

Effets :
- **Sur le site** : les dates concernées disparaissent pour ce point, avec un
  message qui explique la fermeture.
- **Au paiement** : le serveur refuse aussi une date fermée (même avec un vieux
  lien), avec un message clair.
- **Commandes récurrentes** : la relance SMS vise la prochaine date ouverte, en
  gardant le même jour de la semaine.

Ce que cela ne fait PAS : une commande déjà payée pour une date qui devient
fermée n'est ni annulée ni remboursée automatiquement — à traiter à la main
dans Stripe. D'où l'intérêt de saisir les fermetures dès qu'elles sont connues
(la page propose des dates jusqu'à un mois à l'avance). Et si Google ne répond
pas, le site affiche toutes les dates plutôt que de bloquer les commandes.

Mise en place (une seule fois) :
1. Apps Script : remplacer le contenu du fichier par le nouveau
   `google-apps-script-recurrence.gs` (garder `SITE_URL`), enregistrer, puis
   exécuter une fois la fonction `initialiserFermetures` (crée l'onglet).
2. Apps Script : **Déployer → Gérer les déploiements** → crayon → **Version :
   Nouvelle version** → Déployer (l'adresse de l'application Web ne change pas).
3. GitHub : déjà en place (`src/fermetures.js`). Cloudflare redéploie tout seul.

## Pour toute modification (pains, prix, points de vente, jours)

Les prix et la liste des pains existent à deux endroits qui doivent rester
identiques : `public/index.html` (ce que voit le client) et
`src/checkout.js` (ce que le serveur vérifie avant
d'encaisser). Revenez me voir pour toute modification — je mets à jour les
deux fichiers ensemble à chaque fois, pour éviter un décalage entre ce qui
s'affiche et ce qui est facturé.
