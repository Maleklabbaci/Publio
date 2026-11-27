/**
 * PUBLIO — LA PUBLICATION
 * ------------------------------------------------------------------
 * Le seul endroit qui envoie vraiment quelque chose dehors.
 *
 * AVANT : il vérifiait, mais n'envoyait pas (pas de clés).
 * MAINTENANT : les 5 réseaux ont de VRAIS appels API câblés.
 *   Instagram  → Graph v25.0, conteneur → sonde → media_publish
 *   Facebook   → Graph v25.0, /videos ou /photos + /feed
 *   TikTok     → Content Posting API v2, FILE_UPLOAD (vidéo) ou PULL_FROM_URL (photos)
 *   LinkedIn   → REST /rest/posts, upload d'images/vidéos en 2 temps
 *   Threads    → threads v1.0, conteneur → sonde → threads_publish
 *
 * Ce qu'il faut mettre pour que ça parte, PAR CANAL (fichier .cles.json,
 * à côté du moteur) :
 *
 *   {
 *     "ig": { "access_token": "EAAG…", "ig_user_id": "17841…" },
 *     "fb": { "access_token": "EAAG…", "page_id": "1234567890" },
 *     "tt": { "access_token": "act.…", "mode": "inbox" },
 *     "li": { "access_token": "AQU…", "author": "urn:li:person:Ab…" },
 *     "th": { "access_token": "THAA…", "user_id": "17841…" }
 *   }
 *
 *   fb : la clé est celle de la PAGE (page access token), pas du profil.
 *   tt : mode "inbox" (par défaut) = la vidéo arrive en brouillon chez
 *        l'utilisateur — c'est ce que TikTok autorise sans audit.
 *        mode "direct" = publication directe (compte audité seulement).
 *   li : author = urn:li:person:<id> ou urn:li:organization:<id>
 *
 * Autres voies acceptées : PUBLIO_CLE_IG=… (token seul),
 * ou la valeur .cles.json écrite comme une simple chaîne "access_token".
 *
 * MÉDIAS
 *   Instagram et Threads exigent des médias sur une URL https publique
 *   (Meta/Threads les télécharge eux-mêmes). LinkedIn et TikTok acceptent
 *   un fichier local (le moteur l'upload lui-même). Facebook accepte les
 *   deux (vidéos : URL publique ; photos : multipart).
 *
 * `definitive` dit au moteur s'il faut réessayer :
 *     definitive:true   → token mort, média refusé : inutile d'insister
 *     definitive:false  → réseau, quota : on réessaie plus tard
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ERREURS = {
  reseau: {
    definitive:false,
    dit:'Le réseau n’a pas répondu',
    conseil:'Nouvel essai automatique dans quelques minutes.',
  },
  quota: {
    definitive:false,
    dit:'La limite d’envois de la plateforme est atteinte',
    conseil:'Nouvel essai dans une heure.',
  },
  token: {
    definitive:true,
    dit:'La connexion au compte a expiré',
    conseil:'Reconnecter le compte.',
  },
  media: {
    definitive:true,
    dit:'Le média est refusé par la plateforme',
    conseil:'Vérifier le format (Instagram : 4:5 à 1.91:1, moins de 8 Mo).',
  },
  legende: {
    definitive:true,
    dit:'La légende dépasse la limite de la plateforme',
    conseil:'Raccourcir la légende.',
  },
  inconnu: {
    definitive:false,
    dit:'Erreur inattendue',
    conseil:'Nouvel essai automatique.',
  },
};

const LIMITES = {
  ig:  { legende:2200, hashtags:30, format:['4:5','1:1','1.91:1'] },
  li:  { legende:3000, hashtags:0,  format:['1.91:1','1:1'] },
  tt:  { legende:2200, hashtags:0,  format:['9:16'] },
  fb:  { legende:63206, hashtags:0, format:['1.91:1','1:1'] },
  th:  { legende:500,  hashtags:0,  format:['4:5','1:1'] },
};

const META = 'v25.0';          // version de la Graph API (comme Postiz)
const THREADS = 'v1.0';        // threads.net
const LIEN = '202601';         // en-tête LinkedIn-Version (comme Postiz)
const TIMEOUT_MS = 30000;
const POLL_MAX = 40;           // 40 × 1,5 s = 1 min de traitement média
const POLL_PAS_MS = 1500;

/* ==================================================================
   OUTILS COMMUNS
   ================================================================== */

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const estPublique = (u) => /^https?:\/\//i.test(u || '');

/* legendeDe : la vraie légende saisie — sert à REFUSER un post vide.
   texteDe   : la légende, ou le titre en secours — sert à COMPOSER la caption. */
function legendeDe(post) {
  return String(post.legende || '').trim();
}
function texteDe(post) {
  return legendeDe(post) || String(post.titre || '').trim();
}

/** normalise le champ média, quel que soit ce que l'app a envoyé */
function mediasDe(post) {
  let m = post.media;
  if (typeof m === 'string') { try { m = JSON.parse(m); } catch (e) { m = []; } }
  if (!Array.isArray(m)) m = [];
  return m.map((x) => {
    if (typeof x === 'string') return { url: x, type: '', alt: '' };
    return { url: x.url || x.path || x.src || '', type: x.type || x.kind || '', alt: x.alt || '' };
  }).filter((x) => x.url);
}

const estVideo = (m) =>
  m.type === 'video' || /\.(mp4|mov|webm|m4v|mkv)(\?|#|$)/i.test(m.url || '');

function contentTypeDe(u) {
  const ext = path.extname(String(u).split('?')[0] || '').toLowerCase();
  const t = {
    '.mp4':'video/mp4', '.mov':'video/quicktime', '.webm':'video/webm', '.m4v':'video/mp4', '.mkv':'video/x-matroska',
    '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.gif':'image/gif', '.webp':'image/webp',
  };
  return t[ext] || 'application/octet-stream';
}

/** lit un média (URL publique ou chemin local) dans un Buffer, plafond 64 Mo */
async function bufferDe(m) {
  try {
    if (estPublique(m.url)) {
      const r = await fetch(m.url, { signal: AbortSignal.timeout(60000) });
      if (!r.ok) return { erreur: 'média inaccessible (HTTP ' + r.status + ')' };
      const annonc = Number(r.headers.get('content-length') || 0);
      if (annonc > 64 * 1024 * 1024) return { erreur: 'média trop lourd (> 64 Mo)' };
      const b = Buffer.from(await r.arrayBuffer());
      if (b.length > 64 * 1024 * 1024) return { erreur: 'média trop lourd (> 64 Mo)' };
      return { buffer: b };
    }
    return { buffer: fs.readFileSync(m.url) };
  } catch (e) {
    return { erreur: e.code === 'ENOENT'
      ? 'fichier média introuvable : ' + m.url
      : 'lecture du média impossible : ' + (e.message || e) };
  }
}

/**
 * Appel HTTP unique. Ne lève JAMAIS : renvoie toujours un objet.
 *   { reseau:true, erreur }                    → la plateforme est injoignable
 *   { status, corps (objet|null), headers, texte }
 */
async function appel(url, opts = {}) {
  const headers = Object.assign({}, opts.headers);
  let body = opts.body;
  if (opts.jsonBody !== undefined) {
    body = JSON.stringify(opts.jsonBody);
    headers['Content-Type'] = 'application/json';
  } else if (body instanceof URLSearchParams) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  } else if (Buffer.isBuffer(body) && opts.type) {
    headers['Content-Type'] = opts.type;
  }

  let r;
  try {
    r = await fetch(url, {
      method: opts.method || 'GET',
      headers,
      body,
      signal: AbortSignal.timeout(opts.timeout || TIMEOUT_MS),
    });
  } catch (e) {
    return { reseau: true, erreur: String((e && e.message) || e), status: 0, corps: null, headers: {} };
  }

  const texte = await r.text().catch(() => '');
  let corps = null;
  try { corps = texte ? JSON.parse(texte) : null; }
  catch (e) { corps = { __brut: texte.slice(0, 400) }; }
  return { status: r.status, corps, headers: r.headers, texte: texte.slice(0, 400) };
}

/* on ne laisse jamais passer le token dans un message d'erreur */
const nettoyer = (s) => String(s || '').replace(/access_token=[^&\s"]*/g, 'access_token=***');

const extraitMessage = (r) =>
  nettoyer((r && r.corps && r.corps.error && (r.corps.error.message || r.corps.error.error_user_msg))
    || (r && r.corps && r.corps.error && r.corps.error.error_user_title)
    || (r && r.corps && r.corps.__brut)
    || (r && r.texte)
    || ('HTTP ' + (r && r.status)));

/** classification commune des erreurs Meta (Instagram + Facebook + Threads) */
function classerMeta(r) {
  if (r.reseau) return { code:'reseau', definitive:false, erreur:'la plateforme ne répond pas (' + nettoyNet(r.erreur) + ')' };
  const e = (r.corps && r.corps.error) || {};
  const msg = nettoyer(e.message || '');
  const code = e.code;
  const sub = e.error_subcode;

  if (r.status === 401 || code === 190 || sub === 33 || sub === 2207000
      || /revoked|invalidat|access token|re-authenticate/i.test(msg))
    return { code:'token', definitive:true, erreur: msg || 'le jeton d’accès est révoqué' };

  if (r.status === 429 || [1, 2, 4, 17, 32, 341, 368, 613].includes(code)
      || /limit|too many|temporarily restricted|spam/i.test(msg))
    return { code:'quota', definitive:false, erreur: msg || 'limite de la plateforme atteinte' };

  if (/caption|length|trop long/i.test(msg))
    return { code:'legende', definitive:true, erreur: msg };

  if (/media|aspect|format|image|video|carousel|ratio|alt_text/i.test(msg))
    return { code:'media', definitive:true, erreur: msg };

  if (r.status >= 500)
    return { code:'reseau', definitive:false, erreur:'la plateforme est en panne (HTTP ' + r.status + ')' };

  return { code:'inconnu', definitive:false, erreur: msg || ('HTTP ' + r.status) };
}
const nettoyNet = (s) => nettoyer(s).split('\n')[0].slice(0, 200);

/** classification LinkedIn */
function classerLi(r) {
  if (r.reseau) return { code:'reseau', definitive:false, erreur: nettoyNet(r.erreur) };
  const msg = nettoyNet(extraitMessage(r));
  if (r.status === 401 || r.status === 403)
    return { code:'token', definitive:true, erreur: msg || 'jeton LinkedIn refusé (HTTP ' + r.status + ')' };
  if (r.status === 429)
    return { code:'quota', definitive:false, erreur: msg || 'limite LinkedIn atteinte' };
  if (/commentary|length|too long/i.test(msg))
    return { code:'legende', definitive:true, erreur: msg };
  if (r.status >= 500)
    return { code:'reseau', definitive:false, erreur:'LinkedIn est en panne (HTTP ' + r.status + ')' };
  return { code:'inconnu', definitive:false, erreur: msg || ('HTTP ' + r.status) };
}

/** classification TikTok (corps = { error: { code, message } }) */
function classerTt(r) {
  if (r.reseau) return { code:'reseau', definitive:false, erreur: nettoyNet(r.erreur) };
  const e = (r.corps && r.corps.error) || {};
  const code = String(e.code || '');
  const msg = nettoyNet(e.message || r.texte || '');

  if (r.status === 401 || /access_token|unauthorized|scope/i.test(code + ' ' + msg))
    return { code:'token', definitive:true,
      erreur: msg || 'jeton TikTok refusé',
      conseil: /scope/i.test(code + ' ' + msg)
        ? 'Le jeton n’a pas le scope video.publish — régénère-le avec ce scope.'
        : ERREURS.token.conseil };

  if (r.status === 429 || /rate_limit|spam|too_many/i.test(code + ' ' + msg))
    return { code:'quota', definitive:false, erreur: msg || 'limite TikTok atteinte' };

  if (/url_|file_|format|photo|video_pull/i.test(code + ' ' + msg))
    return { code:'media', definitive:true, erreur: msg || 'média refusé par TikTok' };

  if (r.status >= 500)
    return { code:'reseau', definitive:false, erreur:'TikTok est en panne (HTTP ' + r.status + ')' };

  return { code:'inconnu', definitive:false, erreur: msg || (code ? 'TikTok : ' + code : 'HTTP ' + r.status) };
}

const cleManquante = (champ) => ({
  ok:false, code:'token', definitive:true,
  erreur: '.cles.json : « ' + champ + ' » manquant pour ce compte',
  conseil: 'Ajoute « ' + champ + ' » dans .cles.json à côté du moteur (voir LIRE-MOI.md)',
});

const mediaPublicRequis = (raison) => ({
  ok:false, code:'media', definitive:true,
  erreur: raison,
  conseil: 'Héberge ce média sur une URL https publique (la plateforme doit pouvoir le télécharger elle-même)',
});

/* ==================================================================
   LA VÉRIFICATION COMMUNE (avant tout appel réseau)
   ================================================================== */

function verifier(post, canal, cles) {
  const lim = LIMITES[canal] || LIMITES.ig;
  const legende = legendeDe(post);

  if (legende.length > lim.legende)
    return { ok:false, code:'legende',
      erreur:'légende de ' + legende.length + ' caractères (limite ' + lim.legende + ')' };

  const medias = mediasDe(post);
  const max = canal === 'tt' ? 35 : 10;
  if (medias.length > max)
    return { ok:false, code:'media', erreur:medias.length + ' médias (maximum ' + max + ')' };

  if (!legende && !medias.length)
    return { ok:false, code:'media', erreur:'ni texte ni média' };

  if (!cles)
    return { ok:false, code:'token', erreur:'aucune clé d’API pour ce compte' };

  return { ok:true, limite: lim };
}

/* ==================================================================
   INSTAGRAM — conteneur → sonde → media_publish
   ================================================================== */

async function igPublier(post, canal) {
  const cles = post.__clés;
  const v = verifier(post, canal, cles);
  if (!v.ok) return v;

  const token = cles.access_token || cles.token;
  const igId = cles.ig_user_id;
  if (!igId) return cleManquante('ig_user_id');

  const medias = mediasDe(post);
  if (!medias.length)
    return { ok:false, code:'media', definitive:true,
      erreur:'Instagram exige au moins une image ou une vidéo',
      conseil:'Attache un média (image https publique ou vidéo) au post avant de publier' };

  const nonPub = medias.find((m) => !estPublique(m.url));
  if (nonPub) return mediaPublicRequis('Instagram n’accepte que des médias sur URL https publique');

  const texte = texteDe(post);
  const carrousel = medias.length > 1;
  let configurationAudio = null;
  if (post.musiqueInstagram != null) {
    const musique = post.musiqueInstagram;
    if (!musique || !/^\d{1,32}$/.test(String(musique.id || '')) || carrousel || post.story || !estVideo(medias[0]))
      return { ok:false, code:'media', definitive:true, erreur:'La musique Instagram est réservée à un Reel vidéo unique.' };
    configurationAudio = { audio_id:String(musique.id) };
    for (const [champ, cle] of [['volumeMusique','audio_volume'], ['volumeVideo','video_volume']]) {
      if (musique[champ] == null) continue;
      const n = musique[champ];
      if (!Number.isInteger(n) || n < 1 || n > 100)
        return { ok:false, code:'media', definitive:true, erreur:'Le volume doit être compris entre 1 et 100.' };
      configurationAudio[cle] = n;
    }
  }

  const conteneurPour = async (m, enfant) => {
    const q = new URLSearchParams();
    if (estVideo(m)) {
      q.set('media_type', enfant ? 'VIDEO' : (post.story ? 'STORIES' : 'REELS'));
      q.set('video_url', m.url);
    } else {
      if (post.story) q.set('media_type', 'STORIES');
      q.set('image_url', m.url);
    }
    if (enfant) q.set('is_carousel_item', 'true');
    else if (texte) q.set('caption', texte);
    if (!enfant && configurationAudio) q.set('audio_configuration', JSON.stringify(configurationAudio));
    if (m.alt) q.set('alt_text', String(m.alt).slice(0, 1000));
    q.set('access_token', token);
    return appel('https://graph.facebook.com/' + META + '/' + igId + '/media?' + q, { method:'POST' });
  };

  /* 1) créer le(s) conteneur(s) */
  let conteneurId;
  if (carrousel) {
    const enfants = [];
    for (const m of medias.slice(0, 10)) {
      const r = await conteneurPour(m, true);
      if (!(r.corps && r.corps.id)) return Object.assign({ ok:false }, classerMeta(r));
      enfants.push(r.corps.id);
    }
    const q = new URLSearchParams({ media_type: 'CAROUSEL', children: enfants.join(','), access_token: token });
    if (texte) q.set('caption', texte);
    const r = await appel('https://graph.facebook.com/' + META + '/' + igId + '/media?' + q, { method:'POST' });
    if (!(r.corps && r.corps.id)) return Object.assign({ ok:false }, classerMeta(r));
    conteneurId = r.corps.id;
  } else {
    const r = await conteneurPour(medias[0], false);
    if (!(r.corps && r.corps.id)) return Object.assign({ ok:false }, classerMeta(r));
    conteneurId = r.corps.id;
  }

  /* 2) attendre le traitement du média */
  for (let i = 0; i < POLL_MAX; i++) {
    const r = await appel('https://graph.facebook.com/' + META + '/' + conteneurId
      + '?fields=status_code&access_token=' + token);
    const st = r.corps && r.corps.status_code;
    if (st === 'FINISHED' || st === 'PUBLISHED') break;
    if (st === 'ERROR' || st === 'EXPIRED')
      return { ok:false, code:'media', definitive:true,
        erreur:'Instagram n’a pas réussi à traiter le média',
        conseil:'Convertis le média (MP4 H.264 / JPEG) et réessaie' };
    if (i === POLL_MAX - 1)
      return { ok:false, code:'reseau', definitive:false,
        erreur:'Instagram traite encore le média après 1 minute',
        conseil:'On réessaiera automatiquement — les conteneurs créés expirent seuls' };
    await dormir(POLL_PAS_MS);
  }

  /* 3) publier le conteneur */
  const qpub = new URLSearchParams({ creation_id: conteneurId, access_token: token });
  const pub = await appel('https://graph.facebook.com/' + META + '/' + igId + '/media_publish?' + qpub, { method:'POST' });
  if (!(pub.corps && pub.corps.id)) return Object.assign({ ok:false }, classerMeta(pub));
  const idExterne = pub.corps.id;

  /* 4) le permalien (bonus, jamais bloquant) */
  let url = 'https://www.instagram.com/';
  const p = await appel('https://graph.facebook.com/' + META + '/' + idExterne
    + '?fields=permalink&access_token=' + token);
  if (p.corps && p.corps.permalink) url = p.corps.permalink;

  return { ok:true, idExterne, url };
}

/* ==================================================================
   FACEBOOK — /videos ou /photos (multipart) + /feed
   ================================================================== */

async function fbPublier(post, canal) {
  const cles = post.__clés;
  const v = verifier(post, canal, cles);
  if (!v.ok) return v;

  const token = cles.page_access_token || cles.access_token || cles.token;
  const pageId = cles.page_id;
  if (!pageId) return cleManquante('page_id');

  const texte = texteDe(post);
  const medias = mediasDe(post);
  const premiereVideo = medias.find(estVideo);

  /* ---------- une vidéo seule ---------- */
  if (premiereVideo && medias.length === 1) {
    if (!estPublique(premiereVideo.url))
      return { ok:false, code:'media', definitive:true,
        erreur:'Facebook : la vidéo doit être sur une URL https publique',
        conseil:'Héberge le MP4 sur une URL publique (l’upload binaire de vidéos viendra plus tard)' };
    const q = new URLSearchParams({
      file_url: premiereVideo.url, description: texte, published: 'true',
      fields: 'id,permalink_url', access_token: token,
    });
    const r = await appel('https://graph.facebook.com/' + META + '/' + pageId + '/videos?' + q, { method:'POST' });
    if (r.corps && r.corps.id)
      return { ok:true, idExterne: r.corps.id, url: r.corps.permalink_url || 'https://www.facebook.com/reel/' + r.corps.id };
    return Object.assign({ ok:false }, classerMeta(r));
  }

  /* ---------- les photos ---------- */
  const ids = [];
  for (const m of medias.filter((m) => !estVideo(m)).slice(0, 10)) {
    let r;
    if (estPublique(m.url)) {
      const q = new URLSearchParams({ url: m.url, published: 'false', access_token: token });
      r = await appel('https://graph.facebook.com/' + META + '/' + pageId + '/photos?' + q, { method:'POST' });
    } else {
      const b = await bufferDe(m);
      if (b.erreur) return { ok:false, code:'media', definitive:true, erreur: b.erreur };
      const form = new FormData();
      form.append('published', 'false');
      form.append('access_token', token);
      form.append('source', new Blob([b.buffer], { type: contentTypeDe(m.url) }), path.basename(m.url) || 'photo.jpg');
      r = await appel('https://graph.facebook.com/' + META + '/' + pageId + '/photos', { method:'POST', body: form });
    }
    if (!(r.corps && r.corps.id)) return Object.assign({ ok:false }, classerMeta(r));
    ids.push(r.corps.id);
  }

  /* ---------- le post sur la page ---------- */
  const body = { message: texte, published: true };
  if (ids.length) body.attached_media = ids.map((id) => ({ media_fbid: id }));
  const r = await appel('https://graph.facebook.com/' + META + '/' + pageId + '/feed?fields=id,permalink_url&access_token=' + token,
    { method:'POST', jsonBody: body });
  if (r.corps && r.corps.id)
    return { ok:true, idExterne: r.corps.id,
      url: r.corps.permalink_url || 'https://www.facebook.com/' + pageId + '/posts/' + r.corps.id };
  return Object.assign({ ok:false }, classerMeta(r));
}

/* ==================================================================
   TIKTOK — Content Posting API v2
   Vidéo : init FILE_UPLOAD + envoi des octets.  Photos : PULL_FROM_URL.
   ================================================================== */

async function attendreTiktok(token, publishId) {
  for (let i = 0; i < 6; i++) {
    const r = await appel('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
      method:'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json; charset=UTF-8' },
      jsonBody: { publish_id: publishId },
    });
    const st = r.corps && r.corps.data && r.corps.data.status;
    if (st === 'FAILED') {
      const raison = (r.corps.data && r.corps.data.fail_reason) || 'raison inconnue';
      return { ok:false, code:'media', definitive:true, erreur:'TikTok a refusé la publication : ' + raison };
    }
    if (st === 'PUBLISH_COMPLETE') return { ok:true, idExterne: publishId, url: '' };
    if (st === 'SEND_TO_USER_INBOX') return { ok:true, idExterne: publishId, url:'', enAttenteUtilisateur:true };
    await dormir(5000);
  }
  /* encore en traitement chez TikTok : le média est remis, on ne re-poste pas */
  return { ok:true, idExterne: publishId, url:'', traitementEnCours:true, note:'traitement TikTok en cours' };
}

async function ttPublier(post, canal) {
  const cles = post.__clés;
  const v = verifier(post, canal, cles);
  if (!v.ok) return v;

  const token = cles.access_token || cles.token;
  const medias = mediasDe(post);
  const texte = texteDe(post);

  /* TikTok n'autorise la publication directe qu'aux comptes audités :
     par défaut on envoie en brouillon dans la boîte (mode inbox). */
  const direct = cles.mode === 'direct';
  const postMode = direct ? 'DIRECT_POST' : 'MEDIA_UPLOAD';
  const extraDirect = direct ? { privacy_level: cles.privacy_level || 'PUBLIC_TO_EVERYONE' } : {};

  if (!medias.length)
    return { ok:false, code:'media', definitive:true,
      erreur:'TikTok exige au moins une vidéo (ou une photo, via URL publique)',
      conseil:'Attache un MP4 au post' };

  const m = medias[0];

  /* ---------- vidéo : init + upload des octets ---------- */
  if (estVideo(m)) {
    const b = await bufferDe(m);
    if (b.erreur) return { ok:false, code:'reseau', definitive:false, erreur: b.erreur };

    const sourceInfo = { source: 'FILE_UPLOAD', video_size: b.buffer.length, chunk_size: b.buffer.length, total_chunk_count: 1 };
    const init = await appel('https://open.tiktokapis.com/v2/post/publish/' + (direct ? 'video/init/' : 'inbox/video/init/'), {
      method:'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json; charset=UTF-8' },
      jsonBody: direct ? { post_info: Object.assign({ title: texte.slice(0, 2200) }, extraDirect), source_info: sourceInfo }
                       : { source_info: sourceInfo },
    });
    const data = (init.corps && init.corps.data) || {};
    const publishId = data.publish_id, uploadUrl = data.upload_url;
    if (!publishId || !uploadUrl) return Object.assign({ ok:false }, classerTt(init));

    const put = await appel(uploadUrl, {
      method:'PUT', body: b.buffer, type: 'video/mp4', timeout: 300000,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(b.buffer.length),
        'Content-Range': 'bytes 0-' + (b.buffer.length - 1) + '/' + b.buffer.length,
      },
    });
    if (put.status < 200 || put.status >= 300)
      return { ok:false, code:'reseau', definitive:false, erreur:'envoi de la vidéo à TikTok échoué (HTTP ' + put.status + ')' };
    return attendreTiktok(token, publishId);
  }

  /* ---------- photos : PULL_FROM_URL ---------- */
  const urls = medias.map((x) => x.url);
  if (urls.some((u) => !estPublique(u)))
    return mediaPublicRequis('Les photos TikTok doivent être sur des URL https publiques');

  const init = await appel('https://open.tiktokapis.com/v2/post/publish/content/init/', {
    method:'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json; charset=UTF-8' },
    jsonBody: {
      post_mode: postMode, media_type: 'PHOTO',
      source_info: { source: 'PULL_FROM_URL', photo_cover_index: 0, photo_images: urls.slice(0, 35) },
      post_info: Object.assign({ title: texte.slice(0, 90), description: texte.slice(0, 4000) }, extraDirect),
    },
  });
  const data = (init.corps && init.corps.data) || {};
  if (!data.publish_id) return Object.assign({ ok:false }, classerTt(init));
  return attendreTiktok(token, data.publish_id);
}

/* ==================================================================
   LINKEDIN — upload (images/vidéos) puis POST /rest/posts
   ================================================================== */

async function liArticleUpload(m, author, token) {
  const isVideo = estVideo(m);
  const endpoint = isVideo ? 'videos' : 'images';
  const init = await appel('https://api.linkedin.com/rest/' + endpoint + '?action=initializeUpload', {
    method:'POST',
    headers: {
      'LinkedIn-Version': LIEN,
      'X-Restli-Protocol-Version': '2.0.0',
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
    },
    jsonBody: { initializeUploadRequest: { owner: author } },
  });
  if (init.reseau) return { erreur: { code:'reseau', definitive:false, erreur: nettoyNet(init.erreur) } };
  const v = init.corps && init.corps.value;
  if (!v || !v.uploadUrl) return { erreur: classerLi(init) };

  const b = await bufferDe(m);
  if (b.erreur) return { erreur: { code:'media', definitive:true, erreur: b.erreur } };

  const put = await appel(v.uploadUrl, {
    method:'PUT', body: b.buffer, type: contentTypeDe(m.url), timeout: 180000,
    headers: { 'Content-Type': contentTypeDe(m.url) },
  });
  if (put.status < 200 || put.status >= 300) {
    if (put.status === 401 || put.status === 403)
      return { erreur: { code:'token', definitive:true, erreur:'LinkedIn a refusé l’upload (HTTP ' + put.status + ')' } };
    return { erreur: { code:'reseau', definitive:false, erreur:'upload LinkedIn échoué (HTTP ' + put.status + ')' } };
  }
  return { asset: v.asset || v.assetUrn || null };
}

async function liPublier(post, canal) {
  const cles = post.__clés;
  const v = verifier(post, canal, cles);
  if (!v.ok) return v;

  const token = cles.access_token || cles.token;
  let author = cles.author;
  if (!author && cles.author_id)
    author = (cles.author_type === 'organization' ? 'urn:li:organization:' : 'urn:li:person:') + cles.author_id;
  if (!author) return cleManquante('author (ex : "urn:li:person:Ab12Cd…")');

  const texte = texteDe(post);
  const medias = mediasDe(post);

  /* 1) uploader les médias */
  const assets = [];
  for (const m of medias.slice(0, 9)) {
    const r = await liArticleUpload(m, author, token);
    if (r.erreur) return Object.assign({ ok:false }, r.erreur);
    if (r.asset) assets.push(r.asset);
  }

  /* 2) créer le post */
  const payload = {
    author,
    commentary: texte,
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  };
  if (assets.length === 1) payload.content = { media: { id: assets[0] } };
  else if (assets.length > 1) payload.content = { multiImage: { images: assets.map((id) => ({ id })) } };

  const r = await appel('https://api.linkedin.com/rest/posts', {
    method:'POST',
    headers: {
      'LinkedIn-Version': LIEN,
      'X-Restli-Protocol-Version': '2.0.0',
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
    },
    jsonBody: payload,
  });
  if (r.status === 201 || r.status === 200) {
    const id = (r.headers && r.headers.get && r.headers.get('x-restli-id')) || (r.corps && r.corps.id) || '';
    return { ok:true, idExterne: id || null,
      url: id ? 'https://www.linkedin.com/feed/update/' + id : 'https://www.linkedin.com/feed/' };
  }
  return Object.assign({ ok:false }, classerLi(r));
}

/* ==================================================================
   THREADS — conteneur → sonde → threads_publish
   ================================================================== */

async function thPublier(post, canal) {
  const cles = post.__clés;
  const v = verifier(post, canal, cles);
  if (!v.ok) return v;

  const token = cles.access_token || cles.token;
  const userId = cles.user_id;
  if (!userId) return cleManquante('user_id');

  const texte = texteDe(post);
  const medias = mediasDe(post);

  const nonPub = medias.find((m) => !estPublique(m.url));
  if (nonPub) return mediaPublicRequis('Threads n’accepte que des médias sur URL https publique');

  const creerPour = async (m, enfant) => {
    const q = new URLSearchParams();
    if (m) {
      q.set('media_type', estVideo(m) ? 'VIDEO' : 'IMAGE');
      q.set(estVideo(m) ? 'video_url' : 'image_url', m.url);
      if (enfant) q.set('is_carousel_item', 'true');
      else q.set('text', texte);
    } else {
      q.set('media_type', 'TEXT');
      q.set('text', texte);
    }
    q.set('access_token', token);
    return appel('https://graph.threads.net/' + THREADS + '/' + userId + '/threads?' + q, { method:'POST' });
  };

  let conteneurId;
  if (!medias.length) {
    const r = await creerPour(null);
    if (!(r.corps && r.corps.id)) return Object.assign({ ok:false }, classerMeta(r));
    conteneurId = r.corps.id;
  } else if (medias.length === 1) {
    const r = await creerPour(medias[0]);
    if (!(r.corps && r.corps.id)) return Object.assign({ ok:false }, classerMeta(r));
    conteneurId = r.corps.id;
  } else {
    const enfants = [];
    for (const m of medias.slice(0, 10)) {
      const r = await creerPour(m, true);
      if (!(r.corps && r.corps.id)) return Object.assign({ ok:false }, classerMeta(r));
      enfants.push(r.corps.id);
    }
    await Promise.all(enfants.map((enfant) =>
      appel('https://graph.threads.net/' + THREADS + '/' + userId + '/threads/' + enfant
        + '?fields=status&access_token=' + token)));
    const q = new URLSearchParams({
      media_type: 'CAROUSEL', children: enfants.join(','), text: texte, access_token: token,
    });
    const r = await appel('https://graph.threads.net/' + THREADS + '/' + userId + '/threads?' + q, { method:'POST' });
    if (!(r.corps && r.corps.id)) return Object.assign({ ok:false }, classerMeta(r));
    conteneurId = r.corps.id;
  }

  /* attendre que le conteneur soit prêt */
  for (let i = 0; i < 24; i++) {
    const r = await appel('https://graph.threads.net/' + THREADS + '/' + conteneurId
      + '?fields=status,error_message&access_token=' + token);
    const st = r.corps && r.corps.status;
    if (st === 'FINISHED') break;
    if (st === 'ERROR')
      return { ok:false, code:'media', definitive:true,
        erreur:'Threads : ' + ((r.corps && r.corps.error_message) || 'média refusé') };
    if (i === 23)
      return { ok:false, code:'reseau', definitive:false, erreur:'Threads traite encore le média' };
    await dormir(2500);
  }

  const r = await appel('https://graph.threads.net/' + THREADS + '/' + userId
    + '/threads_publish?creation_id=' + conteneurId + '&access_token=' + token, { method:'POST' });
  if (r.corps && r.corps.id) {
    const idExterne = r.corps.id;
    let url = 'https://www.threads.net/';
    const p = await appel('https://graph.threads.net/' + THREADS + '/' + idExterne
      + '?fields=permalink&access_token=' + token);
    if (p.corps && p.corps.permalink) url = p.corps.permalink;
    return { ok:true, idExterne, url };
  }
  return Object.assign({ ok:false }, classerMeta(r));
}

/* ==================================================================
   LES ADAPTATEURS
   ================================================================== */

const ADAPTATEURS = {
  _verifier: verifier,
  ig: { nom: 'Instagram', publier: igPublier   },
  fb: { nom: 'Facebook',  publier: fbPublier   },
  tt: { nom: 'TikTok',    publier: ttPublier   },
  li: { nom: 'LinkedIn',  publier: liPublier   },
  th: { nom: 'Threads',   publier: thPublier   },
};

/* ==================================================================
   LA POLITIQUE D'ESSAI
   ================================================================== */

const MAX_ESSAIS = 3;
const DELAIS = [60, 300, 900];       // 1 min, 5 min, 15 min (secondes)

/**
 * @param post   l'objet post de la base
 * @param canal  l'id du canal (ig, li, tt…)
 * @param cles   les clés d'API du compte, ou null
 */
async function publier(post, canal, cles) {
  const adaptateur = ADAPTATEURS[canal];
  if (!adaptateur)
    return { ok:false, code:'inconnu', definitive:true,
      erreur:'aucun adaptateur pour ' + canal };

  const essai = (post.essais || 0) + 1;
  let res;

  try {
    res = await adaptateur.publier(Object.assign({}, post, { __clés: cles }), canal);
  } catch (e) {
    res = { ok:false, code:'inconnu', erreur: e && e.message ? e.message : String(e) };
  }

  if (res.ok) {
    delete post.essais;
    delete post.derniereErreur;
    delete post.prochainEssai;
    return res;
  }

  /* ---------- l'échec : on décide s'il faut réessayer ---------- */
  const info = ERREURS[res.code] || ERREURS.inconnu;
  const definitive = res.definitive !== undefined ? res.definitive : info.definitive;

  post.essais = essai;
  post.derniereErreur = res.erreur || info.dit;
  post.codeErreur = res.code || 'inconnu';
  post.conseil = res.conseil || info.conseil;

  if (definitive || essai >= MAX_ESSAIS) {
    post.etat = 'echoue';
    delete post.prochainEssai;
    return Object.assign({}, res, {
      definitive:true, essai, code: res.code,
      dit:'abandonné après ' + essai + ' essai' + (essai > 1 ? 's' : '') + ' · ' + post.derniereErreur,
    });
  }

  const delai = DELAIS[Math.min(essai - 1, DELAIS.length - 1)];
  post.prochainEssai = new Date(Date.now() + delai * 1000).toISOString();
  return Object.assign({}, res, {
    definitive:false, essai, code: res.code,
    dit:'échec n°' + essai + ' · ' + post.derniereErreur + ' · on réessaie dans '
      + (delai < 60 ? delai + ' s' : Math.round(delai / 60) + ' min'),
  });
}

/* est-ce que ce post peut être retenté maintenant ? */
function peutReessayer(post) {
  if (post.etat !== 'echoue' && !post.prochainEssai) return false;
  if (post.etat === 'echoue') return true;         // on peut relancer à la main
  if (!post.prochainEssai) return true;
  return new Date(post.prochainEssai).getTime() <= Date.now();
}

/* ---------- les clés d'API, par canal ---------- */
function clesDe(canal) {
  if (!clesDe._cache) clesDe._cache = {};
  if (clesDe._cache[canal] !== undefined) return clesDe._cache[canal];

  /* 1. variable d'environnement  PUBLIO_CLE_IG=… */
  const env = process.env['PUBLIO_CLE_' + String(canal).toUpperCase()];
  if (env) return (clesDe._cache[canal] = { access_token: env });

  /* 2. fichier .cles.json à côté du moteur */
  try {
    const f = path.join(__dirname, '.cles.json');
    if (fs.existsSync(f)) {
      const tout = JSON.parse(fs.readFileSync(f, 'utf8'));
      let c = tout[canal];
      if (c) {
        if (typeof c === 'string') c = { access_token: c };
        return (clesDe._cache[canal] = c);
      }
    }
  } catch (e) { /* fichier absent ou illisible : pas de clés */ }

  return (clesDe._cache[canal] = null);
}
function oublierCles() { delete clesDe._cache; }

module.exports = {
  publier, peutReessayer, clesDe, oublierCles,
  ERREURS, LIMITES, ADAPTATEURS, MAX_ESSAIS, DELAIS,
};
