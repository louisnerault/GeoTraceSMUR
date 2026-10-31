// Notifications push de l'appli GéoTrace SMUR (Firebase Cloud Messaging).
// Chargé par index.html, juste avant </body> :  <script type="module" src="push.js"></script>
//  - petite cloche en bas à droite : touchée, elle affiche l'état des notifications sur cet appareil
//    (chaque étape, avec l'erreur exacte en cas d'échec) et un bouton pour les activer ou les réinscrire ;
//  - bandeau « Recevoir les alertes sur cet appareil » tant que les notifications ne sont pas autorisées ;
//  - inscription de l'appareil auprès de la web app (propriétés du script, voir Notifications.gs) ;
//  - quand l'appli est ouverte, chaque notification reçue s'affiche aussi en bandeau dans l'appli.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getMessaging, getToken, isSupported } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js';

/* ===== RÉGLAGES FIREBASE — à remplir une fois (et à refaire lors de la migration) ===== */
const FIREBASE = {
  apiKey: 'AIzaSyCADQPJyEKmi5iM9r1k8WvB5RU5WBAjdjw',
  authDomain: 'geotracesmur.firebaseapp.com',
  projectId: 'geotracesmur',
  messagingSenderId: '760085842177',
  appId: '1:760085842177:web:c65e7fc15e171a4f547300'
};
const CLE_VAPID = 'BMokj393dDO5efjxgLF0B0HBO-056Nmy-Dx0PstC5jD7d0oDVTyRs1LOqKzu1gdauZsbJU7EweziV9HG0vGPGOk';
/*==========================================================================================*/

const STOCK_JETON = 'geotrace_push_jeton';
const STOCK_INSCRIT = 'geotrace_push_inscrit';     // dernière inscription réussie (ms)
const STOCK_ERREUR = 'geotrace_push_erreur';       // dernière erreur (texte)
const STOCK_PLUS_TARD = 'geotrace_push_plus_tard'; // bandeau fermé : pas avant cette date (ms)
const REINSCRIPTION_MS = 24 * 3600 * 1000;         // rappel quotidien au serveur (« Vu le »)
const PLUS_TARD_MS = 7 * 24 * 3600 * 1000;

const lireS = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
const ecrireS = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
const cleAcces = () => lireS('geotrace_cle');
const urlWebapp = () => (typeof URL_WEBAPP !== 'undefined' ? URL_WEBAPP : '');
const texteErreur = e => (e && (e.code ? e.code + ' : ' : '') + (e.message || e)) || String(e);

const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
const installee = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const reglagesRemplis = ![FIREBASE.apiKey, FIREBASE.messagingSenderId, FIREBASE.appId, CLE_VAPID]
  .some(v => !v || v === 'A_REMPLIR');

// ---------- apparence (bleu et blanc SMUR) ----------
const style = document.createElement('style');
style.textContent = `
  #push-bandeau, #push-panneau { position:fixed; z-index:20; left:8px; right:8px; top:calc(8px + env(safe-area-inset-top));
    background:#0f2847; color:#fff; border-radius:12px; padding:12px 14px; box-shadow:0 4px 18px rgba(0,0,0,.35);
    font:15px/1.35 -apple-system, system-ui, "Segoe UI", Roboto, sans-serif; display:flex; flex-direction:column; gap:10px;
    max-width:520px; margin:0 auto; }
  #push-panneau ul { margin:0; padding:0; list-style:none; display:flex; flex-direction:column; gap:4px; font-size:14px; }
  #push-panneau li { overflow-wrap:anywhere; }
  #push-panneau .erreur { background:rgba(220,38,38,.25); border-radius:8px; padding:6px 8px; font-size:13px; overflow-wrap:anywhere; }
  .push-boutons { display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap; }
  #push-bandeau button, #push-panneau button { font:inherit; font-weight:600; border:0; border-radius:8px; padding:8px 14px; }
  button.push-principal { background:#fff; color:#0f2847; }
  button.push-secondaire { background:transparent; color:#fff; border:1px solid rgba(255,255,255,.5) !important; }
  #push-cloche { position:fixed; z-index:19; right:12px; bottom:calc(12px + env(safe-area-inset-bottom));
    width:44px; height:44px; border-radius:50%; border:0; background:#0f2847; color:#fff; font-size:20px;
    box-shadow:0 2px 10px rgba(0,0,0,.35); opacity:.85; }
  #push-cloche .pastille { position:absolute; top:4px; right:4px; width:11px; height:11px; border-radius:50%;
    border:2px solid #0f2847; background:#9ca3af; }
  #push-toast { position:fixed; z-index:21; left:8px; right:8px; top:calc(8px + env(safe-area-inset-top));
    background:#fff; color:#0f2847; border-left:6px solid #1d4ed8; border-radius:12px; padding:12px 14px;
    box-shadow:0 4px 18px rgba(0,0,0,.35); font:15px/1.35 -apple-system, system-ui, "Segoe UI", Roboto, sans-serif;
    transition:opacity .4s, transform .4s; max-width:520px; margin:0 auto; }
  #push-toast b { display:block; margin-bottom:2px; }
  #push-toast.cache { opacity:0; transform:translateY(-20px); pointer-events:none; }
`;
document.head.appendChild(style);

function boutons(liste) {
  const zone = document.createElement('div');
  zone.className = 'push-boutons';
  liste.forEach(([libelle, classe, action]) => {
    const bt = document.createElement('button');
    bt.type = 'button';
    bt.className = 'push-' + classe;
    bt.textContent = libelle;
    bt.addEventListener('click', () => action(bt));
    zone.appendChild(bt);
  });
  return zone;
}

function fermer() {
  document.getElementById('push-bandeau')?.remove();
  document.getElementById('push-panneau')?.remove();
}

function bandeau(texte, liste) {
  fermer();
  const b = document.createElement('div');
  b.id = 'push-bandeau';
  const p = document.createElement('div');
  p.textContent = texte;
  b.append(p, boutons(liste));
  document.body.appendChild(b);
}

const plusTard = () => { ecrireS(STOCK_PLUS_TARD, String(Date.now() + PLUS_TARD_MS)); fermer(); };

function proposer() {
  bandeau('🔔 Recevoir les alertes GéoTrace SMUR sur cet appareil (recherche active, batterie critique, fin de maintenance) ?',
    [['Plus tard', 'secondaire', plusTard], ['Activer', 'principal', activer]]);
}

// ---------- notification affichée dans l'appli ouverte ----------
let minuteurToast = 0;
function toast(m) {
  let t = document.getElementById('push-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'push-toast';
    document.body.appendChild(t);
  }
  t.replaceChildren();
  const titre = document.createElement('b');
  titre.textContent = m.titre || 'GéoTrace SMUR';
  t.append(titre, document.createTextNode(m.texte || ''));
  t.onclick = () => {
    t.classList.add('cache');
    if (m.clic && m.clic !== './') window.open(m.clic, '_blank');
  };
  t.classList.remove('cache');
  clearTimeout(minuteurToast);
  minuteurToast = setTimeout(() => t.classList.add('cache'), 10000);
}

// ---------- état et diagnostic ----------
const etat = { support: null, raisonSupport: '', etape: '' };

function inscritRecemment() { return Date.now() - Number(lireS(STOCK_INSCRIT) || 0) < REINSCRIPTION_MS * 2; }

function couleurPastille() {
  if (!reglagesRemplis || etat.support === false) return '#dc2626';
  const perm = 'Notification' in window ? Notification.permission : 'absent';
  if (perm === 'denied' || lireS(STOCK_ERREUR)) return '#dc2626';
  if (perm === 'granted' && lireS(STOCK_INSCRIT)) return '#16a34a';
  return '#f59e0b';
}

function majCloche() {
  let c = document.getElementById('push-cloche');
  if (!c) {
    c = document.createElement('button');
    c.id = 'push-cloche';
    c.type = 'button';
    c.title = 'Notifications';
    c.setAttribute('aria-label', 'Notifications');
    c.textContent = '🔔';
    const p = document.createElement('span');
    p.className = 'pastille';
    c.appendChild(p);
    c.addEventListener('click', () => (document.getElementById('push-panneau') ? fermer() : panneau()));
    document.body.appendChild(c);
  }
  c.querySelector('.pastille').style.background = couleurPastille();
}

function ligne(ok, texte) {
  const li = document.createElement('li');
  li.textContent = (ok === true ? '✅ ' : ok === false ? '❌ ' : '⏳ ') + texte;
  return li;
}

function panneau() {
  fermer();
  const b = document.createElement('div');
  b.id = 'push-panneau';
  const titre = document.createElement('b');
  titre.textContent = '🔔 Notifications sur cet appareil';
  const ul = document.createElement('ul');
  const perm = 'Notification' in window ? Notification.permission : 'absent';
  const inscrit = Number(lireS(STOCK_INSCRIT) || 0);
  ul.append(
    ligne(reglagesRemplis, reglagesRemplis ? 'Réglages Firebase présents' : 'Réglages Firebase non remplis dans push.js (A_REMPLIR)'),
    ligne(!!(cleAcces() && urlWebapp()), cleAcces() ? 'Clé d\'accès GéoTrace enregistrée' : 'Clé d\'accès GéoTrace absente'),
    ligne(etat.support, etat.support === false ? 'Notifications non prises en charge : ' + etat.raisonSupport
      : etat.support ? 'Notifications prises en charge par ce navigateur' : 'Vérification du navigateur…'),
    ligne(perm === 'granted' ? true : perm === 'default' ? null : false,
      { granted: 'Autorisées sur ce téléphone', default: 'Pas encore autorisées', denied: 'Bloquées dans les réglages du téléphone',
        absent: 'Notifications indisponibles ici' }[perm] || perm),
    ligne(inscrit ? true : null, inscrit ? 'Inscrit auprès de GéoTrace le ' + new Date(inscrit).toLocaleString('fr-FR')
      : 'Pas encore inscrit auprès de GéoTrace'),
    ligne(null, 'Appareil : ' + appareil())
  );
  if (etat.etape) ul.append(ligne(null, etat.etape));
  b.append(titre, ul);
  const err = lireS(STOCK_ERREUR);
  if (err) {
    const e = document.createElement('div');
    e.className = 'erreur';
    e.textContent = 'Dernière erreur : ' + err;
    b.appendChild(e);
  }
  if (ios && !installee) {
    const p = document.createElement('div');
    p.textContent = 'Sur iPhone : touchez Partager puis « Sur l\'écran d\'accueil », et ouvrez GéoTrace depuis son icône.';
    b.appendChild(p);
  }
  const liste = [['Fermer', 'secondaire', fermer]];
  if (reglagesRemplis && etat.support && perm !== 'denied') {
    liste.push([perm === 'granted' ? 'Réinscrire' : 'Activer', 'principal', activer]);
  }
  b.appendChild(boutons(liste));
  document.body.appendChild(b);
}

function rafraichir() {
  majCloche();
  if (document.getElementById('push-panneau')) panneau();
}

// ---------- inscription ----------
function appareil() {
  const ua = navigator.userAgent;
  const type = /Android/.test(ua) ? 'Android' : ios ? 'iPhone/iPad' : 'Ordinateur';
  return type + (installee ? ' (appli)' : ' (navigateur)');
}

async function appelWebapp(corps, essais = 3) {
  // text/plain (par défaut) : pas de requête préalable CORS, accepté par Apps Script
  for (let essai = 1; ; essai++) {
    let rep;
    try {
      const r = await fetch(urlWebapp(), { method: 'POST', body: JSON.stringify(corps) });
      const brut = await r.text();
      try { rep = JSON.parse(brut); } catch (e) {
        throw new Error('réponse inattendue de la web app (déploiement à jour ? 4 lignes ajoutées dans doPost ?) : '
          + brut.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160));
      }
    } catch (e) {
      if (essai >= essais) throw e;
      await new Promise(fin => setTimeout(fin, 3000 * essai));
      continue;
    }
    if (rep.ok) return rep;
    if (!/verrou|occup/i.test(rep.error || '') || essai >= essais) {
      throw new Error('web app : ' + (rep.error || JSON.stringify(rep)));
    }
    await new Promise(fin => setTimeout(fin, 4000 * essai));
  }
}

let messaging = null;
async function jetonFcm() {
  etat.etape = 'Préparation du service worker…'; rafraichir();
  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, non) => setTimeout(() => non(new Error('service worker absent (sw.js non chargé ?)')), 15000))
  ]);
  etat.etape = 'Demande du jeton à Firebase…'; rafraichir();
  try {
    return await getToken(messaging, { vapidKey: CLE_VAPID, serviceWorkerRegistration: reg });
  } catch (e) {
    throw new Error('Firebase : ' + texteErreur(e));
  }
}

async function inscrire(jeton) {
  if (!jeton) throw new Error('Firebase n\'a pas fourni de jeton');
  etat.etape = 'Inscription auprès de GéoTrace…'; rafraichir();
  await appelWebapp({ action: 'abonnerPush', cle: cleAcces(), jeton, appareil: appareil() + ' - ' + new Date().toLocaleDateString('fr-FR') });
  ecrireS(STOCK_JETON, jeton);
  ecrireS(STOCK_INSCRIT, String(Date.now()));
  ecrireS(STOCK_ERREUR, '');
}

let enCours = false;
async function activer(bouton) {
  if (enCours) return;
  enCours = true;
  if (bouton) { bouton.disabled = true; bouton.textContent = 'Activation…'; }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('notifications refusées : autorisez-les pour GéoTrace dans les réglages du téléphone');
    await inscrire(await jetonFcm());
    etat.etape = '';
    fermer();
    toast({ titre: 'Notifications activées', texte: 'Cet appareil recevra les alertes GéoTrace SMUR.' });
  } catch (e) {
    console.warn('[push] activation impossible', e);
    ecrireS(STOCK_ERREUR, texteErreur(e));
    etat.etape = '';
    panneau();
  } finally {
    enCours = false;
    majCloche();
  }
}

// ---------- démarrage ----------
let demarre = false;
async function demarrer() {
  majCloche();
  if (demarre || !cleAcces() || !urlWebapp()) return;   // clé pas encore saisie : on attendra le formulaire
  demarre = true;
  if (!reglagesRemplis) { rafraichir(); return; }

  if (!('serviceWorker' in navigator)) { etat.support = false; etat.raisonSupport = 'pas de service worker'; }
  else if (!('Notification' in window)) {
    etat.support = false;
    etat.raisonSupport = ios && !installee ? 'sur iPhone, ouvrez GéoTrace depuis l\'icône de l\'écran d\'accueil' : 'navigateur trop ancien';
  } else {
    etat.support = await isSupported().catch(() => false);
    if (!etat.support) etat.raisonSupport = 'Firebase Messaging indisponible dans ce navigateur';
  }
  if (!etat.support) { rafraichir(); return; }

  try {
    messaging = getMessaging(initializeApp(FIREBASE));
  } catch (e) {
    ecrireS(STOCK_ERREUR, 'Firebase : ' + texteErreur(e));
    etat.support = false; etat.raisonSupport = 'initialisation Firebase impossible';
    rafraichir();
    return;
  }

  // Le service worker relaie chaque notification reçue : bandeau dans l'appli si elle est ouverte
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data && e.data.type === 'geotrace-push' && !document.hidden) toast(e.data);
  });

  if (Notification.permission === 'granted') {
    try {   // le jeton peut changer : on le renvoie s'il est nouveau, ou si la dernière inscription date
      const jeton = await jetonFcm();
      if (jeton !== lireS(STOCK_JETON) || !inscritRecemment() || lireS(STOCK_ERREUR)) await inscrire(jeton);
    } catch (e) {
      console.warn('[push] réinscription impossible', e);
      ecrireS(STOCK_ERREUR, texteErreur(e));
    }
    etat.etape = '';
  } else if (Notification.permission === 'default' && Date.now() > Number(lireS(STOCK_PLUS_TARD) || 0)) {
    proposer();
  }
  rafraichir();
}

document.getElementById('cle')?.addEventListener('submit', () => setTimeout(demarrer, 300));
demarrer();
