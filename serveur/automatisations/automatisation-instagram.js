'use strict';
/* Socle non branché : authentification et normalisation d'événements Meta.
   Cette bibliothèque n'envoie aucun message et n'active aucune règle. Avant
   branchement : routage isolé par projet, dédoublonnage durable, contrôle du
   compte et de l'âge du commentaire, permissions et consentement Meta. */
const crypto = require('crypto');

/** Vérifie X-Hub-Signature-256 sur les octets bruts, avant tout JSON.parse. */
function verifierSignature(corps, signature, secret){
  if (!Buffer.isBuffer(corps) || !corps.length || typeof secret !== 'string' || !secret ||
      typeof signature !== 'string' || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const fourni = Buffer.from(signature.slice(7), 'hex');
  const attendu = crypto.createHmac('sha256', secret).update(corps).digest();
  return fourni.length === attendu.length && crypto.timingSafeEqual(fourni, attendu);
}

/** Extrait seulement les commentaires explicitement identifiés ; aucune action. */
function extraireCommentaires(corps, signature, secret){
  if (!verifierSignature(corps, signature, secret)) return {ok:false, erreur:'signature invalide'};
  let payload;
  try { payload = JSON.parse(corps.toString('utf8')); }
  catch (_) { return {ok:false, erreur:'JSON invalide'}; }
  if (!payload || payload.object !== 'instagram' || !Array.isArray(payload.entry))
    return {ok:false, erreur:'événement Instagram invalide'};
  const evenements = [];
  for (const entree of payload.entry){
    const compte = typeof entree?.id === 'string' ? entree.id : '';
    if (!/^\d{1,32}$/.test(compte) || !Array.isArray(entree.changes)) continue;
    for (const changement of entree.changes){
      const v = changement?.value;
      if (changement?.field !== 'comments' || !v || typeof v !== 'object') continue;
      const commentaire = typeof v.id === 'string' ? v.id : '';
      const auteur = typeof v.from?.id === 'string' ? v.from.id : '';
      const media = typeof v.media?.id === 'string' ? v.media.id : '';
      if (!/^\d{1,32}$/.test(commentaire) || !/^\d{1,32}$/.test(auteur) ||
          !/^\d{1,32}$/.test(media) || auteur === compte || v.from?.self_ig_scoped_id || v.is_self === true || typeof v.text !== 'string') continue;
      evenements.push({canal:'ig', compteId:compte, commentaireId:commentaire,
        auteurId:auteur, mediaId:media, texte:v.text.slice(0, 10000)});
    }
  }
  return {ok:true, evenements};
}

/** Recherche littérale insensible à la casse, jamais une expression régulière. */
function correspondMotCle(texte, mot){
  if (typeof texte !== 'string' || typeof mot !== 'string') return false;
  const cherche = mot.trim().normalize('NFC').toLocaleLowerCase('fr');
  if (!cherche || cherche.length > 200) return false;
  return texte.normalize('NFC').toLocaleLowerCase('fr').includes(cherche);
}
module.exports = { verifierSignature, extraireCommentaires, correspondMotCle };

/** Construit (sans l'envoyer) une requête Private Reply documentée par Meta.
    Le futur orchestrateur doit encore vérifier les permissions, la règle,
    le délai de 7 jours et l'unicité globale par commentaire. */
function preparerReponsePrivee({connexion,compteId,commentaireId,texte,accessToken}){
  const hotes={facebook:'graph.facebook.com',instagram:'graph.instagram.com'};
  if (!Object.hasOwn(hotes,connexion)) throw new Error('connexion Meta invalide');
  if (typeof compteId !== 'string' || !/^\d{1,32}$/.test(compteId) ||
      typeof commentaireId !== 'string' || !/^\d{1,32}$/.test(commentaireId)) throw new Error('identifiant Meta invalide');
  if (typeof texte !== 'string' || !texte.trim() || texte.length > 1000) throw new Error('message invalide');
  if (typeof accessToken !== 'string' || !accessToken.trim() || /[\r\n]/.test(accessToken)) throw new Error('jeton invalide');
  return { url:`https://${hotes[connexion]}/v25.0/${compteId}/messages`,
    options:{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+accessToken},
      body:JSON.stringify({recipient:{comment_id:commentaireId},message:{text:texte}})} };
}
module.exports.preparerReponsePrivee = preparerReponsePrivee;
