# Le Pain Levé — outil de commande

Ce dossier contient tout ce qu'il faut : la page de commande (`index.html`)
et la petite fonction serveur qui crée le paiement Stripe déjà rempli
(`api/create-checkout-session.js`). Les deux sont hébergés ensemble, en un
seul déploiement, sur **Vercel** (gratuit pour ce volume d'usage).

## 1. Récupérer votre clé secrète Stripe

1. Connectez-vous sur [dashboard.stripe.com](https://dashboard.stripe.com)
2. Menu **Développeurs** → **Clés API**
3. Copiez la **clé secrète** (elle commence par `sk_test_...` en mode test,
   `sk_live_...` en mode réel). Cette clé ne doit **jamais** apparaître dans
   `index.html` ni être partagée — elle ne va que dans Vercel, à l'étape 3.

Commencez avec la clé **test** pour vérifier que tout fonctionne (les
paiements de test n'encaissent rien de réel), puis remplacez-la par la clé
**live** une fois prêt à recevoir de vrais paiements.

## 2. Créer un compte Vercel

Allez sur [vercel.com](https://vercel.com) et créez un compte gratuit
(le plus simple : se connecter avec un compte GitHub).

## 3. Déployer ce dossier

**Option la plus simple (sans ligne de commande) :**
1. Mettez ce dossier dans un dépôt GitHub (créez-en un sur github.com,
   glissez-y tous les fichiers de ce dossier)
2. Sur Vercel, cliquez **Add New → Project**, choisissez ce dépôt
3. Vercel détecte automatiquement la configuration, cliquez **Deploy**
4. Une fois déployé, allez dans **Settings → Environment Variables**
5. Ajoutez une variable : nom `STRIPE_SECRET_KEY`, valeur = la clé copiée à
   l'étape 1
6. Retournez dans l'onglet **Deployments** et cliquez **Redeploy** (la
   variable ne prend effet qu'après un nouveau déploiement)

Vous obtenez une adresse du type `https://pain-leve-commande.vercel.app` —
c'est le lien à donner à vos clients.

## 4. Tester avant de passer en réel

Avec la clé **test**, utilisez le numéro de carte `4242 4242 4242 4242`,
une date future, n'importe quel CVC — le paiement passera sans encaisser
de vrai argent. Vérifiez que vous recevez bien la commande dans votre
dashboard Stripe (**Paiements**), avec le bon point de retrait et la bonne
date visibles dans les métadonnées.

Une fois satisfait, remplacez la variable `STRIPE_SECRET_KEY` dans Vercel
par votre clé **live**, redéployez, et c'est en production.

## Pour toute modification (pains, prix, points de vente, jours)

Les prix et la liste des pains existent à deux endroits qui doivent rester
identiques : `index.html` (ce que voit le client) et
`api/create-checkout-session.js` (ce que le serveur vérifie avant
d'encaisser). Revenez me voir pour toute modification — je mets à jour les
deux fichiers ensemble à chaque fois, pour éviter un décalage entre ce qui
s'affiche et ce qui est facturé.
