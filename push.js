// Notifications push de l'appli GéoTrace SMUR (Firebase Cloud Messaging).
// Chargé par index.html, juste avant </body> :  <script type="module" src="push.js"></script>
//  - bandeau « Recevoir les alertes sur cet appareil » tant que les notifications ne sont pas activées ;
//  - inscription de l'appareil auprès de la web app (onglet « Abonnés push » du Sheet) ;
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
/* ======================================================================================= */

const STOCK_JETON = 'geotrace_push_jeton';
const STOCK_INSCRIT = 'geotrace_push_inscrit';   // dernière inscription réussie (ms)
const STOCK_PLUS_TARD = 'geotrace_push_plus_tard'; // bandeau fermé : pas avant cette date (ms)
const REINSCRIPTION_MS = 24 * 3600 * 1000;       // rappel quotidien au serveur (« Vu le »)
const PLUS_TARD_MS = 7 * 24 * 3600 * 1000;

const lireS = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
const ecrireS = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
const cleAcces = () => lireS('geotrace_cle');
const urlWebapp = () => (typeof URL_WEBAPP !== 'undefined' ? URL_WEBAPP : '');

const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
const installee = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// ---------- apparence (bleu et blanc SMUR) ----------
const style = document.createElement('style');
style.textContent = `
  #push-bandeau { position:fixed; z-index:20; left:8px; right:8px; top:calc(8px + env(safe-area-inset-top));
    background:#0f2847; color:#fff; border-radius:12px; padding:12px 14px; box-shadow:0 4px 18px rgba(0,0,0,.35);
    font:15px/1.35 -apple-system, system-ui, "Segoe UI", Roboto, sans-serif; display:flex; flex-direction:column; gap:10px; }
  #push-bandeau .boutons { display:flex; gap:8px; justify-content:flex-end; }
  #push-bandeau button { font:inherit; font-weight:600; border:0; border-radius:8px; padding:8px 14px; }
  #push-bandeau button.principal { background:#fff; color:#0f2847; }
  #push-bandeau button.secondaire { background:transparent; color:#fff; border:1px solid rgba(255,255,255,.5); }
  #push-toast { position:fixed; z-index:21; left:8px; right:8px; top:calc(8px + env(safe-area-inset-top));
    background:#fff; color:#0f2847; border-left:6px solid #1d4ed8; border-radius:12px; padding:12px 14px;
    box-shadow:0 4px 18px rgba(0,0,0,.35); font:15px/1.35 -apple-system, system-ui, "Segoe UI", Roboto, sans-serif;
    transition:opacity .4s, transform .4s; }
  #push-toast b { display:block; margin-bottom:2px; }
  #push-toast.cache { opacity:0; transform:translateY(-20px); pointer-events:none; }
`;
document.head.appendChild(style);

function fermerBandeau() { document.getElementById('push-bandeau')?.remove(); }

function bandeau(texte, boutons) {
  fermerBandeau();
  const b = document.createElement('div');
  b.id = 'push-bandeau';
  const p = document.createElement('div');
  p.textContent = texte;
  const zone = document.createElement('div');
  zone.className = 'boutons';
  boutons.forEach(([libelle, classe, action]) => {
    const bt = document.createElement('button');
    bt.type = 'button';
    bt.className = classe;
    bt.textContent = libelle;
    bt.addEventListener('click', () => action(bt));
    zone.appendChild(bt);
  });
  b.append(p, zone);
  document.body.appendChild(b);
}

const plusTard = () => { ecrireS(STOCK_PLUS_TARD, String(Date.now() + PLUS_TARD_MS)); fermerBandeau(); };

function proposer() {
  bandeau('🔔 Recevoir les alertes GéoTrace SMUR sur cet appareil (recherche active, batterie critique, fin de maintenance) ?',
    [['Plus tard', 'secondaire', plusTard], ['Activer', 'principal', activer]]);
}

function expliquerIos() {
  bandeau('🔔 Sur iPhone, les alertes ne fonctionnent que dans l\'appli installée : touchez Partager puis « Sur l\'écran d\'accueil », et ouvrez GéoTrace depuis son icône.',
    [['OK', 'principal', plusTard]]);
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

// ---------- inscription ----------
function appareil() {
  const ua = navigator.userAgent;
  const type = /Android/.test(ua) ? 'Android' : ios ? 'iPhone/iPad' : 'Ordinateur';
  return type + (installee ? ' (appli)' : ' (navigateur)') + ' - ' + new Date().toLocaleDateString('fr-FR');
}

async function appelWebapp(corps) {
  // text/plain (par défaut) : pas de requête préalable CORS, accepté par Apps Script
  const r = await fetch(urlWebapp(), { method: 'POST', body: JSON.stringify(corps) });
  const rep = await r.json();
  if (!rep.ok) throw new Error(rep.error || 'refus du serveur');
  return rep;
}

async function inscrire(jeton) {
  await appelWebapp({ action: 'abonnerPush', cle: cleAcces(), jeton, appareil: appareil() });
  ecrireS(STOCK_JETON, jeton);
  ecrireS(STOCK_INSCRIT, String(Date.now()));
}

let messaging = null;
async function jetonFcm() {
  const reg = await navigator.serviceWorker.ready;
  return getToken(messaging, { vapidKey: CLE_VAPID, serviceWorkerRegistration: reg });
}

async function activer(bouton) {
  if (bouton) { bouton.disabled = true; bouton.textContent = 'Activation…'; }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      bandeau('Notifications refusées. Pour les recevoir, autorisez-les pour GéoTrace dans les réglages du téléphone.',
        [['OK', 'principal', plusTard]]);
      return;
    }
    await inscrire(await jetonFcm());
    fermerBandeau();
    toast({ titre: 'Notifications activées', texte: 'Cet appareil recevra les alertes GéoTrace SMUR.' });
  } catch (e) {
    console.warn('[push] activation impossible', e);
    bandeau('Activation impossible : ' + (e && e.message ? e.message : e),
      [['Fermer', 'secondaire', fermerBandeau], ['Réessayer', 'principal', activer]]);
  }
}

// ---------- démarrage ----------
let demarre = false;
async function demarrer() {
  if (demarre || !cleAcces() || !urlWebapp()) return;   // clé pas encore saisie : on attendra le formulaire
  demarre = true;
  if (FIREBASE.apiKey === 'A_REMPLIR' || CLE_VAPID === 'A_REMPLIR') {
    console.warn('[push] Réglages Firebase non remplis dans push.js : notifications désactivées.');
    return;
  }
  const aSuivre = Date.now() > Number(lireS(STOCK_PLUS_TARD) || 0);
  const possible = 'serviceWorker' in navigator && 'Notification' in window && await isSupported().catch(() => false);
  if (!possible) {
    if (ios && !installee && aSuivre) expliquerIos();
    return;
  }
  messaging = getMessaging(initializeApp(FIREBASE));

  // Le service worker relaie chaque notification reçue : bandeau dans l'appli si elle est ouverte
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data && e.data.type === 'geotrace-push' && !document.hidden) toast(e.data);
  });

  if (Notification.permission === 'granted') {
    try {   // le jeton peut changer : on le renvoie s'il est nouveau, et une fois par jour
      const jeton = await jetonFcm();
      const ancien = Date.now() - Number(lireS(STOCK_INSCRIT) || 0) > REINSCRIPTION_MS;
      if (jeton !== lireS(STOCK_JETON) || ancien) await inscrire(jeton);
    } catch (e) {
      console.warn('[push] réinscription impossible', e);
    }
  } else if (Notification.permission === 'default' && aSuivre) {
    proposer();
  }
  // 'denied' : rien à faire depuis la page (réglages du téléphone)
}

document.getElementById('cle')?.addEventListener('submit', () => setTimeout(demarrer, 300));
demarrer();
