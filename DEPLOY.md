# Héberger Marbexa 2.0

Marbexa a besoin de deux choses : un **processus Node qui tourne en continu**
et un **disque persistant** (la base `db.json` + les sauvegardes quotidiennes).
Un petit serveur suffit largement : 1 vCPU / 1 Go de RAM.

Deux chemins possibles :

| | Option A — VPS (recommandé) | Option B — Railway |
|---|---|---|
| Pour qui | Contrôle total, prix fixe | Zéro administration |
| Prix | ~4-6 €/mois (Hetzner CX22, OVH VPS, Scaleway) | ~5 $/mois |
| HTTPS | Automatique via Caddy (inclus ici) | Automatique |
| Effort | ~30 min la première fois | ~10 min |

---

## Option A — VPS avec Docker (recommandé)

### 1. Louer le serveur et le domaine

- Crée un VPS chez **Hetzner** (CX22), **OVH** (VPS Starter) ou **Scaleway**,
  avec **Ubuntu 24.04**. Note son adresse IP.
- Dans la zone DNS de ton domaine, crée un enregistrement **A** :
  `marbexa.ton-domaine.fr → IP du serveur`.

### 2. Préparer le serveur (une seule fois)

Connecte-toi en SSH (`ssh root@IP`) puis :

```bash
# Docker
curl -fsSL https://get.docker.com | sh

# Pare-feu : SSH + web uniquement
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable

# Le code
git clone https://github.com/Youssef-Chkaf/Marbrerie-2.0.git
cd Marbrerie-2.0
git checkout claude/marble-shop-management-software-5in8tb
```

### 3. Configurer le domaine

Édite `Caddyfile` et remplace `marbexa.votre-domaine.fr` par ton vrai
domaine :

```bash
nano Caddyfile
```

### 4. Lancer

```bash
docker compose up -d --build
```

C'est tout : Caddy obtient le certificat HTTPS tout seul et
**https://marbexa.ton-domaine.fr** répond. La base est initialisée avec le
catalogue au premier démarrage.

### 5. Immédiatement après la mise en ligne

1. Connecte-toi en usine (`atelier@marbexa.fr` / `usine2026`) et **change le
   mot de passe** dans Réglages → Mot de passe de connexion.
2. Recrée les vrais comptes revendeurs (Revendeurs → nouveau compte) et
   supprime/désactive le compte de démonstration `cuisine@marbexa.fr`.
3. Vérifie les tarifs dans Tarifs & catalogue.

### Mise à jour du logiciel

```bash
cd Marbrerie-2.0
git pull
docker compose up -d --build
```

Les données ne bougent pas (elles vivent dans le volume `marbexa-data`,
pas dans l'image).

### Sauvegardes

- Le serveur fait déjà une **sauvegarde quotidienne tournante** (14 jours)
  dans le volume, à côté de la base.
- Pour une copie externe hebdomadaire (recommandé), depuis ton PC :

```bash
ssh root@IP "docker run --rm -v marbrerie-20_marbexa-data:/data alpine tar cz -C /data ." > marbexa-backup-$(date +%F).tar.gz
```

- Restauration : remettre `db.json` dans le volume et relancer.

---

## Option B — Railway (zéro administration)

1. Sur [railway.app](https://railway.app), *New Project → Deploy from GitHub
   repo* → choisis `Marbrerie-2.0` (branche
   `claude/marble-shop-management-software-5in8tb`). Le `Dockerfile` est
   détecté automatiquement.
2. Dans le service : *Settings → Volumes → Add volume*, monté sur **`/data`**.
3. Variables : `MARBEXA_DATA=/data/db.json`.
4. *Settings → Networking → Generate domain* (ou attache ton domaine).
5. Fais les étapes « Immédiatement après la mise en ligne » ci-dessus.

Render.com (avec « Persistent Disk ») et Fly.io (avec un volume)
fonctionnent de la même façon. **Évite** Vercel/Netlify : pas de processus
permanent ni de disque persistant.

---

## À savoir

- **Une seule instance** : le stockage est un fichier JSON — ne lance jamais
  deux serveurs sur la même base. Pour la montée en charge, la couche
  stockage (`server/lib/store.js`) est prévue pour être remplacée par
  PostgreSQL/Supabase sans toucher au reste.
- Le cookie de session passe en `Secure` automatiquement derrière HTTPS.
- La connexion est limitée à 8 tentatives / 15 min par IP + e-mail.
- Variables utiles : `PORT` (défaut 3000), `MARBEXA_DATA` (chemin de la base).
