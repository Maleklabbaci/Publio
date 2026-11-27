// Socle interne d'accès à R2. Pas de routes HTTP et pas d'authentification.
// À ne pas exposer directement au navigateur.
const MAX_OCTETS = 1024 * 1024;
const slugOk = x => typeof x === 'string' && /^[a-z0-9][a-z0-9-]{1,63}$/.test(x);
export function cleProjet(compte, projet){
  if (!slugOk(compte) || !slugOk(projet)) throw new Error('Contexte de projet invalide');
  return `comptes/${compte}/projets/${projet}/donnees.json`;
}
export async function lireProjet(bucket, compte, projet){
  const objet = await bucket.get(cleProjet(compte, projet));
  if (!objet) return {existe:false, etag:null, donnees:null};
  if (objet.size > MAX_OCTETS) throw new Error('Données du projet trop volumineuses');
  let donnees;
  try { donnees = await objet.json(); } catch { throw new Error('Données du projet invalides'); }
  if (!donnees || typeof donnees !== 'object' || Array.isArray(donnees)) throw new Error('Données du projet invalides');
  return {existe:true, etag:objet.etag, donnees};
}
// Revision null = créer seulement si absent ; sinon modifier seulement la version lue.
export async function ecrireProjet(bucket, compte, projet, donnees, revision){
  const key = cleProjet(compte, projet);
  if (!donnees || typeof donnees !== 'object' || Array.isArray(donnees)) throw new Error('Données du projet invalides');
  if (revision !== null && (typeof revision !== 'string' || !/^[a-f0-9]{32}$/i.test(revision))) throw new Error('Révision invalide');
  const texte = JSON.stringify(donnees);
  if (new TextEncoder().encode(texte).length > MAX_OCTETS) throw new Error('Données du projet trop volumineuses');
  const headers = new Headers();
  if (revision === null) headers.set('If-None-Match', '*');
  else headers.set('If-Match', `"${revision}"`);
  const result = await bucket.put(key, texte, {onlyIf:headers, httpMetadata:{contentType:'application/json'}});
  if (!result) return {ok:false, conflit:true};
  return {ok:true, etag:result.etag};
}
