/* Code de test local uniquement. Téléversement R2 non prêt pour publication. */
const TYPES=new Set(['image/jpeg','image/png','image/webp','video/mp4','video/quicktime']);
const MAX=8*1024*1024; // limite volontairement réduite pour le prototype local
const enc=new TextEncoder();
function sig(b,m){
 if(m==='image/jpeg')return b.length>=3&&b[0]===255&&b[1]===216&&b[2]===255;
 if(m==='image/png')return b.length>=8&&[137,80,78,71,13,10,26,10].every((x,i)=>x===b[i]);
 if(m==='image/webp')return b.length>=12&&String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP';
 if(m==='video/mp4'||m==='video/quicktime')return b.length>=12&&String.fromCharCode(...b.slice(4,8))==='ftyp';
 return false;
}
export function cleMedia(compte,id){
 if(!/^u-[a-f0-9]{32}$/.test(compte)||!/^[a-f0-9]{32}$/.test(id))throw Error('Identifiant invalide');
 return `comptes/${compte}/projets/principal/medias/${id}`;
}
export async function lireFichier(req){
 const mime=(req.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
 if(!TYPES.has(mime))return {ok:false,code:415,erreur:'Format non accepté.'};
 const h=req.headers.get('content-length');if(h&&(!/^\d+$/.test(h)||Number(h)>MAX))return {ok:false,code:413,erreur:'Fichier trop volumineux pour le test.'};
 const reader=req.body?.getReader();if(!reader)return {ok:false,code:400,erreur:'Fichier manquant.'};
 const parties=[];let taille=0;for(;;){const r=await reader.read();if(r.done)break;taille+=r.value.byteLength;if(taille>MAX){await reader.cancel();return {ok:false,code:413,erreur:'Fichier trop volumineux pour le test.'}}parties.push(r.value)}
 const octets=new Uint8Array(taille);let pos=0;for(const p of parties){octets.set(p,pos);pos+=p.length}
 if(!sig(octets,mime))return {ok:false,code:415,erreur:'Le fichier ne correspond pas au format indiqué.'};
 let nom='';try{nom=decodeURIComponent(req.headers.get('x-filename')||'')}catch{}
 nom=nom.replace(/[\x00-\x1f\x7f/\\]/g,'').trim().slice(0,160)||(mime.startsWith('video/')?'Vidéo':'Image');
 return {ok:true,octets,media:{nom,mime,taille,type:mime.startsWith('video/')?'video':'image',cree:new Date().toISOString(),canaux:[]}};
}
export async function ecrireObjet(bucket,compte,id,octets,mime){
 const cond=new Headers({'If-None-Match':'*'});
 const objet=await bucket.put(cleMedia(compte,id),octets,{onlyIf:cond,httpMetadata:{contentType:mime}});
 return !!objet;
}
