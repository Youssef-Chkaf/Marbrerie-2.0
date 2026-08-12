# Marbexa 2.0 — logiciel de gestion pour marbrerie

Marbexa relie le **marbrier (usine)** et ses **revendeurs** : conception des plans,
chiffrage, devis et bons de commande, envoi des commandes usine, corrections,
étapes de fabrication et fichiers DXF machine — au même endroit.

## Démarrage

Aucune dépendance à installer : Node.js ≥ 18 suffit.

```bash
npm start          # démarre sur http://localhost:3000 (variable PORT respectée)
npm run seed:reset # réinitialise la base de démonstration (data/db.json)
```

Comptes de démonstration :

| Rôle | E-mail | Mot de passe |
|---|---|---|
| Usine / marbrier | `atelier@marbexa.fr` | `usine2026` |
| Revendeur | `cuisine@marbexa.fr` | `revendeur2026` |

## Fonctionnalités

### Accès revendeur
- **Devis & projets** : création manuelle ou import automatique, chiffrage ligne
  par ligne (matière, chants, découpes, façonnage, livraison), marge appliquée par
  ligne, TVA multi-taux, lignes commerciales privées (pose, lignes libres), remise
  TTC, impression du **devis client** et du **bon de commande client**.
- **Configurateur 2D** : plans de travail, crédences, panneaux et murs ; dimensions,
  rotation (90° et angle libre), déplacement précis au mm, accrochage entre pièces ;
  matière propre par élément ; **vue Crédence de face** par mur (hauteur au sol,
  décalage) ; chants par côté (droit chanfreiné, arrondi, demi-rond, aile d'avion,
  retombées…), longueurs partielles, angles arrondis / pans coupés.
- **Création assistée des découpes** : en renseignant la **marque et la référence**
  d'un évier ou d'une table de cuisson, Marbexa retrouve les cotes d'encastrement
  dans sa base (Franke, Blanco, Bosch, Siemens, De Dietrich…), prépare la découpe
  (brute, à fleur, polie sous plan, timbre) et vérifie la distance au chant avant.
  Les cotes saisies manuellement peuvent enrichir la base.
- **Génération automatique de plans** : import **DXF 2D** (calques, polylignes,
  cercles) ou **PDF vectoriel** via le moteur IA Marbexa (détection d'échelle,
  contours → pièces, formes internes → découpes). Le brouillon est toujours marqué
  « à vérifier » avant fabrication.
- **Mes commandes** : suivi des statuts, corrections demandées par l'usine
  (modification du plan puis renvoi pour contrôle), commentaires et pièces jointes,
  **regroupement / dégroupage de livraison** (forfait partagé), archivage et
  restauration (vue Archives), **duplication d'un devis** (nouvelle référence,
  prix catalogue du jour — le figé de l'original n'est pas repris).

### Accès usine
- **Tableau de bord** : C.A., commandes à contrôler, en fabrication, panier moyen.
- **Commandes** : contrôle usine → validation / demande de correction / proposition
  d'une autre semaine ; **étapes de fabrication** (programmation, tranche, découpe,
  usinage, finition, contrôle, emballage) ; bon de commande usine, **fiche technique**
  et **DXF 2D machine** (calques CONTOUR / DECOUPES / PERCAGES / RAINURES / CHANTS / COTES).
- **Revendeurs** : création de comptes (mot de passe provisoire), suspension.
- **Tarifs & catalogue** : prix matières par épaisseur, prestations Stone/Ultra,
  activation/désactivation — répercutés immédiatement sur les nouveaux chiffrages.
- **Statistiques** : C.A. mensuel, classement produits, filtrage par période.
- **Réglages** : délai minimum, majoration finition Suede/spéciale, tranches de
  livraison kilométriques, alertes, SMTP, **changement du mot de passe usine**.

La connexion est limitée à 8 tentatives par quart d'heure (par IP + e-mail) et
le serveur conserve une **sauvegarde quotidienne tournante** de la base dans
`data/backups/` (14 jours).

L'usine ne voit jamais la marge ni les prix de vente du revendeur ; le revendeur
ne voit le DXF machine qu'après validation usine.

## Catalogue réel & règles de chiffrage e-marbrier

Le catalogue vient de l'export Supabase du projet e-marbrier, **trié sur
décision usine** : seules les marques Cosentino (**Silestone**, **Dekton**) et
**Neolith** (collections Classtone, Colorfeel, Fusion, Iron, Steel, Timber,
regroupées sous la marque Neolith) sont conservées, en **12 et 20 mm**
uniquement — soit **168 produits** et 441 variantes (doublons de casse
fusionnés vers le Title Case le moins cher). Arklam et Eclos sont écartés.
Le tri se règle en tête de `scripts/import-emarbrier.mjs`
(`KEPT_BRANDS`, `KEPT_THICKNESSES`).
Réimport : placer les CSV dans `server/data-seed/source/` puis
`node scripts/import-emarbrier.mjs` et `npm run seed:reset`.

Règles de calcul validées par les tests (`npm test` : 20 cas de chiffrage
calculés à la main + 10 tests d'intégration API sur serveur réel) :

- **surface jamais arrondie** : `L × l / 1 000 000` en pleine précision ;
- **double arrondi** : P.U. vente = `round(achat × coef, 2)` **avant** la
  multiplication par la quantité, puis montant arrondi.
  `120,06 × 2,10 = 252,126 → 252,13 ; × 1,3 = 327,77` (pas 327,76) ;
- **coef matière 2,10** = marge revendeur de 110 % appliquée ligne à ligne ;
- **snapshot** : les prix sont figés à la création du devis (`priceSnapshot`).
  Un changement de tarif catalogue ne touche que les nouveaux devis ; tous les
  documents (devis, BC, PDF) lisent le snapshot, jamais le catalogue courant ;
- **façonnage serveur** : grille e-marbrier sur les angles — découpe 90° 28,00 €,
  pan coupé 34,19 €, extrémité arrondie 67,77 € (prix d'achat, forfaits) ;
  chants au ml, découpes au forfait. ⚠️ Grille à faire valider par l'usine.

## Architecture

```
server/            Serveur HTTP Node sans dépendances
  index.js         Statique + routage API
  api.js           Toutes les routes /api et /print
  seed.js          Données de démonstration (comptes, catalogue, appareils)
  lib/store.js     Base JSON à écriture atomique (data/db.json)
  lib/dxf-writer.js  Export DXF R12 machine
  lib/dxf-parser.js  Import DXF 2D → pièces éditables
  lib/pdf-plan.js    Moteur IA Marbexa : analyse de PDF vectoriels
  lib/documents.js   Devis, BC client, BC usine, fiche technique (HTML imprimable)
shared/            Modules partagés navigateur + serveur
  pricing.js       Moteur de chiffrage (source de vérité unique)
  plan.js          Modèle pièces/découpes/chants + contrôles de faisabilité
  constants.js     Statuts, transitions, étapes de fabrication
public/            SPA sans build (modules ES natifs)
  js/views/        Vues (dashboards, commandes, projets, catalogue…)
  js/configurator/ Configurateur (canvas, inspecteur, découpes, crédence, chiffrage)
```

Le DXF machine comprend les calques CONTOUR / DECOUPES / PERCAGES / RAINURES /
**DEFONCAGE** (poses à fleur et égouttoirs décaissés, avec profondeur) / CHANTS /
COTES ; la rotation des découpes et les encoches ouvertes (3 côtés + angles E1/E2
travaillés) sont reproduites fidèlement.

La base d'appareils (`server/data-seed/appliances.json`) contient des cotes
**indicatives** issues des notices fabricants : toujours vérifier la notice du
modèle exact avant fabrication.

## Décisions en attente / production

- **Grille de façonnage** (28,00 / 34,19 / 67,77 € + prestations Bazin) : à faire
  valider par l'usine avant mise en production.
- **Facturation des angles E1/E2 d'encoche** : alignée sur la grille des angles
  du plan (90° / pan coupé / arrondi) — à confirmer par l'usine.
- **Numérotation** : Marbexa émet `DEV-AAAA-NNNN` / `MBX-AAAA-NNNNN` ;
  l'ancien e-marbrier utilisait `D-AAAA-XXXX` / `C-AAAA-XXXX`. À trancher.
- **Règle de livraison groupée** : actuellement le forfait de la distance la plus
  longue est partagé entre les commandes du groupe. À confirmer.
- **Moteur IA v2** (PNG / JPG / PDF scannés via l'API Claude) : conception prête,
  mise en œuvre en attente.
- **Hébergement & base de production** : le stockage JSON (`lib/store.js`) est
  volontairement isolé pour être remplacé par PostgreSQL/Supabase sans toucher au
  reste ; prévoir HTTPS (reverse proxy) et variable `MARBEXA_DATA` pour le chemin
  de la base.
