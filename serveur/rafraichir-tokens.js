/**
 * PUBLIO — LE RAFRAÎCHISSEMENT DES JETONS
 * ------------------------------------------------------------------
 * Quand tu connecteras Instagram, LinkedIn, TikTok ou Threads, tu
 * recevras un « jeton » (une clé d'accès temporaire). Ces jetons
 * EXPIRENT :
 *
 *   Instagram / Facebook / Threads : ~60 jours
 *   LinkedIn                       : ~60 jours
 *   TikTok                         : 24 heures (le refresh dure ~365 jours)
 *
 * Sans rafraîchissement : dans quelques semaines, plus rien ne part —
 * les posts restent en échec avec « token expired ».
 *
 * Ce fichier échange le jeton contre un neuf AVANT qu'il meure, tout
 * seul, une fois par jour. Si l'échange échoue, il ne touche pas aux
 * anciennes clés : mieux vaut un vieux jeton qui marche (jusqu'à son
 * expiration) qu'une clé écrasée par une réponse vide.
 *
 * Pour que ça marche, .cles.json doit contenir les dates d'expiration
 * ET les identifiants de l'app :
 *
 *   {
 *     "ig": { "access_token": "EAAG…", "ig_user_id": "…",
 *             "token_expire": "2026-12-31T00:00:00.000Z",
 *             "app_id": "123…", "app_secret": "abc…" },
 *     "fb": { "access_token": "EAAG…", "page_id": "…",
 *             "token_expire": "2026-12-31T00:00:00.000Z",
 *             "app_id": "123…", "app_secret": "abc…" },
 *     "th": { "access_token": "THAA…", "user_id": "…",
 *             "token_expire": "2026-12-31T00:00:00.000Z" },
 *     "li": { "access_token": "AQU…", "author": "urn:li:person:…",
 *             "refresh_token": "AQU…", "client_id": "…", "client_secret": "…",
 *             "token_expire": "2026-12-31T00:00:00.000Z" },
 *     "tt": { "access_token": "act…", "mode": "inbox",
 *             "refresh_token": "act…", "client_key": "…", "client_secret": "…",
 *             "token_expire": "2026-11-21T00:00:00.000Z" }
 *   }
 *
 * Sans `token_expire`, le moteur ne touche à rien : il ne rafraîchit
 * pas « au cas où », ce qui serait dangereux pour rien.
 *
 * NOTE : ce fichier n'est pas testable contre les vraies plateformes
 * depuis la machine de build. Il est testé avec des réponses simulées
 * (mêmes formats que les docs officielles), mais pas contre Meta en
 * direct. Si un échange échoue en vrai, l'erreur est journalisée et
 * les clés restent intactes.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const FICHIER_CLES = process.env.PUBLIO_CLES || path.join(__dirname, '.cles.json');
const TIMEOUT = 15000;

/* marge avant expiration où on rafraîchit */
const MARGE_MS = 10 * 86400000;        // 10 jours (ig, fb, th, li)
const MARGE_TT_MS = 12 * 3600000;      // TikTok : jeton de 24 h, on vise 12 h de marge

const lireCles = () => {
  try { return JSON.parse(fs.readFileSync(FICHIER_CLES, 'utf8')); }
  catch (e) { return null; }
};

function ecrireCles(cles) {
  const tmp = FICHIER_CLES + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cles, null, 2));
  fs.renameSync(tmp, FICHIER_CLES);   // écriture atomique : jamais un fichier à moitié écrit
}

/* appel HTTP unique, ne lève jamais */
async function appel(url, opts = {}) {
  let body;
  if (opts.form) body = new URLSearchParams(opts.form);
  let r;
  try {
    r = await fetch(url, {
      method: opts.method || 'GET',
      headers: body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {},
      body,
      signal: AbortSignal.timeout(TIMEOUT),
    });
  } catch (e) {
    return { ok: false, erreur: String((e && e.message) || e) };
  }
  let corps = null;
  try { corps = await r.json(); } catch (e) { corps = null; }
  if (!r.ok) return { ok: false, status: r.status, corps };
  return { ok: true, status: r.status, corps };
}

const msgErreur = (r, defaut) =>
  (r.corps && (r.corps.error && (r.corps.error.message || r.corps.error.error_user_msg)))
  || (r.corps && (r.corps.error_description || r.corps.error))
  || defaut;

/* ---------- les 4 échangeurs (les mêmes que Meta font en vrai) ---------- */

/** Instagram + Facebook : un jeton longue durée s'échange contre un neuf */
async function echangerMeta(c) {
  if (!c.app_id || !c.app_secret)
    return { ok: false, erreur: 'app_id / app_secret manquants (Meta)' };
  const q = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: c.app_id,
    client_secret: c.app_secret,
    fb_exchange_token: c.access_token,
  });
  const r = await appel('https://graph.facebook.com/v25.0/oauth/access_token?' + q);
  if (!r.ok || !r.corps || !r.corps.access_token)
    return { ok: false, erreur: msgErreur(r, 'Meta a refusé l’échange') };
  return { ok: true, access_token: r.corps.access_token,
           expire_dans_s: r.corps.expires_in || 60 * 86400 };
}

/** Threads : jeton long → jeton long neuf */
async function echangerThreads(c) {
  const q = new URLSearchParams({ grant_type: 'th_refresh_token', access_token: c.access_token });
  const r = await appel('https://graph.threads.net/refresh_access_token?' + q);
  if (!r.ok || !r.corps || !r.corps.access_token)
    return { ok: false, erreur: msgErreur(r, 'Threads a refusé le refresh') };
  return { ok: true, access_token: r.corps.access_token,
           expire_dans_s: r.corps.expires_in || 60 * 86400 };
}

/** LinkedIn : refresh_token → nouveau access_token (et refresh_token neuf) */
async function echangerLinkedIn(c) {
  if (!c.refresh_token || !c.client_id || !c.client_secret)
    return { ok: false, erreur: 'refresh_token / client_id / client_secret manquants' };
  const r = await appel('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    form: {
      grant_type: 'refresh_token',
      refresh_token: c.refresh_token,
      client_id: c.client_id,
      client_secret: c.client_secret,
    },
  });
  if (!r.ok || !r.corps || !r.corps.access_token)
    return { ok: false, erreur: msgErreur(r, 'LinkedIn a refusé le refresh') };
  return { ok: true, access_token: r.corps.access_token,
           refresh_token: r.corps.refresh_token || c.refresh_token,
           expire_dans_s: r.corps.expires_in || 60 * 86400 };
}

/** TikTok : refresh_token → nouveau access_token (24 h) */
async function echangerTiktok(c) {
  if (!c.refresh_token || !c.client_key || !c.client_secret)
    return { ok: false, erreur: 'refresh_token / client_key / client_secret manquants' };
  const r = await appel('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    form: {
      client_key: c.client_key,
      client_secret: c.client_secret,
      grant_type: 'refresh_token',
      refresh_token: c.refresh_token,
    },
  });
  if (!r.ok || !r.corps || !r.corps.access_token)
    return { ok: false, erreur: msgErreur(r, 'TikTok a refusé le refresh') };
  return { ok: true, access_token: r.corps.access_token,
           refresh_token: r.corps.refresh_token || c.refresh_token,
           expire_dans_s: r.corps.expires_in || 86400 };
}

const ECHANGEURS = { ig: echangerMeta, fb: echangerMeta, th: echangerThreads,
                     li: echangerLinkedIn, tt: echangerTiktok };

const margePour = (canal) => (canal === 'tt' ? MARGE_TT_MS : MARGE_MS);

const expireDe = (c) => {
  const t = Date.parse((c && c.token_expire) || '');
  return Number.isFinite(t) ? t : null;
};

/** rafraîchit UN canal si son jeton expire bientôt — mute `c` en cas de succès */
async function rafraichirCanal(canal, c) {
  if (!c || !c.access_token)
    return { canal, fait: false, dit: 'pas de access_token' };

  const expire = expireDe(c);
  if (expire === null)
    return { canal, fait: false, dit: 'token_expire absent — on ne touche pas' };

  const reste = expire - Date.now();
  if (reste > margePour(canal))
    return { canal, fait: false, dit: 'encore valide ' + Math.ceil(reste / 86400000) + ' j' };

  const echangeur = ECHANGEURS[canal];
  if (!echangeur)
    return { canal, fait: false, dit: 'aucun rafraîchissement prévu pour ce canal' };

  const r = await echangeur(c);
  if (!r.ok)
    return { canal, fait: false, erreur: r.erreur };

  c.access_token = r.access_token;
  if (r.refresh_token) c.refresh_token = r.refresh_token;
  c.token_expire = new Date(Date.now() + r.expire_dans_s * 1000).toISOString();
  return { canal, fait: true, dit: 'jeton rafraîchi pour ' + Math.round(r.expire_dans_s / 86400) + ' j' };
}

/**
 * Vérifie tous les canaux et rafraîchit ceux qui sont proches de l'expiration.
 * Écrit .cles.json UNE seule fois, et seulement si quelque chose a changé.
 */
async function rafraichirTout() {
  const cles = lireCles();
  if (!cles) return { ok: false, erreur: '.cles.json absent ou illisible', resultats: [] };

  const resultats = [];
  for (const canal of Object.keys(ECHANGEURS)) {
    const c = cles[canal];
    if (typeof c === 'string') {   // format brut : un jeton seul, rien à rafraîchir
      resultats.push({ canal, fait: false, dit: 'format simple, pas de rafraîchissement' });
      continue;
    }
    resultats.push(await rafraichirCanal(canal, c));
  }

  const changements = resultats.some((r) => r.fait);
  if (changements) ecrireCles(cles);

  return { ok: true, resultats, ecrit: changements };
}

module.exports = {
  rafraichirTout, rafraichirCanal,
  FICHIER_CLES, MARGE_MS, MARGE_TT_MS,
  ECHANGEURS,
};
