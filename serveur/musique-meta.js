/** Recherche des sons Instagram autorisés aux applications tierces.
 * Le jeton reste sur le serveur. Pas d'hypothèse sur Facebook ou TikTok. */
'use strict';
const GRAPH = 'https://graph.facebook.com/v25.0/ig_audio';
async function rechercher(cles, terme, type = 'music') {
  if (!cles || !cles.access_token || !cles.ig_user_id)
    return { ok:false, code:'connexion', erreur:'Connecte ton compte Instagram professionnel pour chercher une musique.' };
  if (!['music', 'original_sound'].includes(type))
    return { ok:false, code:'parametre', erreur:'Type de son invalide.' };
  const q = new URLSearchParams({ audio_type:type, user_id:String(cles.ig_user_id), access_token:cles.access_token });
  const mot = String(terme || '').trim().slice(0, 100);
  if (mot) q.set('search_query', mot);
  try {
    const r = await fetch(GRAPH + '?' + q, { signal:AbortSignal.timeout(15000), headers:{Accept:'application/json'} });
    const j = await r.json();
    if (!r.ok || j.error) return { ok:false, code:'meta', erreur:'Instagram ne donne pas accès aux musiques pour ce compte. Vérifie la connexion et les autorisations.' };
    if (!Array.isArray(j.audio)) return { ok:false, code:'meta', erreur:'Réponse musicale Instagram inattendue. Réessaie plus tard.' };
    const https = u => { try { const v = new URL(u); return v.protocol === 'https:' ? v.href : null; } catch (_) { return null; } };
    const pistes = j.audio.slice(0, 30).filter(x => x && /^\d{1,32}$/.test(String(x.audio_id || ''))).map(x => ({
      id:String(x.audio_id), titre:String(x.title || 'Son Instagram').slice(0, 200),
      artiste:String(x.display_artist || x.ig_username || '').slice(0, 120),
      duree:Number.isFinite(x.duration_in_ms) ? x.duration_in_ms : null,
      apercu:https(x.download_url), lienInstagram:https(x.on_platform_audio_preview_link),
    }));
    return { ok:true, pistes };
  } catch (_) { return { ok:false, code:'reseau', erreur:'La recherche Instagram ne répond pas. Réessaie.' }; }
}
module.exports = { rechercher };
