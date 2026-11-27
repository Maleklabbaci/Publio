// Test local UNIQUEMENT ; ne jamais déployer ce worker.
import {cleProjet, lireProjet, ecrireProjet} from '../stockage-r2.mjs';
export default {async fetch(req, env){
 try {
  const a='compte-test', p='principal';
  await env.PUBLIO_R2.delete(cleProjet(a,p));
  const absent=await lireProjet(env.PUBLIO_R2,a,p);
  if(absent.existe)throw Error('Objet présent');
  const first=await ecrireProjet(env.PUBLIO_R2,a,p,{valeur:1},null);
  const doublon=await ecrireProjet(env.PUBLIO_R2,a,p,{valeur:2},null);
  const lu=await lireProjet(env.PUBLIO_R2,a,p);
  const modif=await ecrireProjet(env.PUBLIO_R2,a,p,{valeur:3},lu.etag);
  const obsolete=await ecrireProjet(env.PUBLIO_R2,a,p,{valeur:4},lu.etag);
  const fin=await lireProjet(env.PUBLIO_R2,a,p);
  const autre=await lireProjet(env.PUBLIO_R2,'autre-compte',p);
  if(!first.ok||doublon.ok||lu.donnees.valeur!==1||!modif.ok||obsolete.ok||fin.donnees.valeur!==3||autre.existe)throw Error('Échec scénario R2');
  await env.PUBLIO_R2.put(cleProjet(a,'corrompu'),'{invalide');
  let refuse=false; try{await lireProjet(env.PUBLIO_R2,a,'corrompu')}catch{refuse=true}
  if(!refuse)throw Error('Objet corrompu accepté');
  await env.PUBLIO_R2.delete([cleProjet(a,p),cleProjet(a,'corrompu')]);
  return new Response('OK : création, isolation, conflits et corruption refusée');
 }catch(e){return new Response('ÉCHEC : '+e.message,{status:500})}
}};
