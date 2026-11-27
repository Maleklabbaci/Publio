/* Limiteur expérimental avec écritures conditionnelles R2. Test local uniquement.
 * Pas de déploiement : nettoyage périodique, protections complémentaires,
 * couverture multi-région et coûts doivent être évalués avant tout usage réel.
 */
const enc=new TextEncoder();
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
async function digest(s){return hex(await crypto.subtle.digest('SHA-256',enc.encode(s)))}
export async function autoriser(bucket,{scope,sujet,limite,fenetreMs,maintenant=Date.now()}){
 if(typeof scope!=='string'||!/^[a-z0-9-]{1,32}$/.test(scope)||typeof sujet!=='string'||!sujet||sujet.length>1024||!Number.isSafeInteger(limite)||limite<1||!Number.isSafeInteger(fenetreMs)||fenetreMs<1000||!Number.isSafeInteger(maintenant)||maintenant<0)throw Error('Paramètres du limiteur invalides');
 const fenetre=Math.floor(maintenant/fenetreMs),key=`auth/limites/${scope}/${fenetre}/${await digest(sujet)}.json`;
 for(let i=0;i<20;i++){
  const obj=await bucket.get(key);let compteur=0;
  if(obj){if(obj.size>256)throw Error('Compteur invalide');let data;try{data=await obj.json()}catch{throw Error('Compteur invalide')}
   if(!data||!Number.isSafeInteger(data.count)||data.count<0)throw Error('Compteur invalide');compteur=data.count;
  }
  if(compteur>=limite)return {ok:false,retryAfter:Math.ceil(((fenetre+1)*fenetreMs-maintenant)/1000)};
  const h=new Headers();if(obj)h.set('If-Match',`"${obj.etag}"`);else h.set('If-None-Match','*');
  // Une valeur aléatoire empêche le retour accidentel d'un ETag précédent.
  const next={count:compteur+1,nonce:crypto.randomUUID()};
  const r=await bucket.put(key,JSON.stringify(next),{onlyIf:h,httpMetadata:{contentType:'application/json'}});
  if(r)return {ok:true};
 }
 throw Error('Conflit du limiteur : requête refusée');
}
