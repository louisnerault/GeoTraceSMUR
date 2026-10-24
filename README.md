# GéoTrace SMUR

Suivi du matériel du SMUR d'Avignon grâce à des traceurs Bluetooth (« smart finders » compatibles réseau Localiser de Google).

Ce dépôt contient l'**appli smartphone** : une coquille web installable (PWA) qui ouvre en plein écran la web app Apps Script de GéoTrace SMUR. Il est publié par GitHub Pages ; c'est l'adresse à partager aux équipes.

## Contenu du dépôt

| Fichier | Rôle |
|---|---|
| `index.html` | Page de l'appli : charge la web app Apps Script (`URL_WEBAPP`) et gère la clé d'accès |
| `manifest.webmanifest` | Nom, couleurs, icônes et mode plein écran de l'appli installée |
| `sw.js` | Service worker : met en cache la coquille uniquement, jamais les données Google |
| `icon-*.png`, `apple-touch-icon.png` | Icônes (logo SMUR) Android, maskable et iPhone |
| `LISEZMOI.md` | Note courte sur la migration vers le compte d'exploitation |

## Installation sur un téléphone

1. Ouvrir l'adresse GitHub Pages du dépôt dans Chrome (Android) ou Safari (iPhone).
2. Android : menu ⋮ → **Installer l'application**. iPhone : Partager → **Sur l'écran d'accueil**.
3. Au premier lancement, saisir la clé d'accès. Elle est gardée sur le téléphone (`localStorage`, clé `geotrace_cle`).

Pour éviter la saisie, distribuer le lien avec la clé dans l'ancre : `https://…/#cle=LA_CLE` (la clé est enregistrée puis retirée de l'adresse).

## Vue d'ensemble du système

```
Tags Bluetooth ──► réseau Google Localiser ──► Raspberry Pi (GoogleFindMyTools, crontab)
      │                                              │  positions, batterie, clés de sonnerie
      └──► balises ESP32-S3 (dans les locaux) ──┐    ▼
                                                 └► Web app Apps Script ◄──► Google Sheet
                                                         ▲          « Historique traceurs SMUR »
                                     cette appli (PWA) ──┘
```

- **Raspberry Pi 3** : scripts Python (`export_all_locations.py`, `balises.py`, `recherche_active.py`, `alertes_batterie.py`) lancés par crontab ; notifications SMS et ntfy.
- **Balises ESP32-S3** : détectent les tags dans les locaux, remontent les captures et font sonner un tag à la demande.
- **Apps Script** : tableau de bord, positions, suivi rapproché (recherche active), maintenance, sonnerie, purge.

Ces éléments vivent hors de ce dépôt (Pi, projet Apps Script, projet Claude « Géoloc Tags SMUR »).

## Règles de travail

- Tout ce qui concerne le Raspberry Pi se fait **en ligne de commande** (blocs `bash` / heredoc prêts à coller, pas d'éditeur graphique).
- Le code Apps Script s'écrit **depuis le Pi avec clasp** :

```bash
cd ~/geotrace-appscript
clasp pull                 # récupérer la version en ligne avant toute modification
# … modifications …
clasp push -f
clasp deploy -i <ID_DU_DEPLOIEMENT> -d "Description du changement"   # même adresse /exec
```

Mettre à jour le déploiement existant (`-i`) plutôt qu'en créer un nouveau : l'URL de la web app, et donc cette appli, ne change pas.

## Mettre l'appli à jour

- **Changement de la web app seulement** : rien à faire ici, l'appli charge toujours la dernière version déployée.
- **Changement des fichiers de ce dépôt** : incrémenter `VERSION` dans `sw.js` (`geotrace-v2`, …) pour que les téléphones rechargent la coquille.

## Migration vers le compte d'exploitation

L'outil est en version alpha sur un compte personnel. Lors du passage au compte Google d'exploitation :

1. Dans `index.html`, remplacer `URL_WEBAPP` par la nouvelle adresse `/exec`.
2. Incrémenter `VERSION` dans `sw.js`.
3. L'adresse de l'appli et les icônes installées ne changent pas. Si la clé d'accès change, chaque utilisateur la ressaisit une fois (ou rouvre un lien `#cle=`).
