// Test local seulement.
import {autoriser} from '../limiteur-r2-experimental.mjs';
export default {async fetch(req,env){try{
 const cfg={scope:'essai',sujet:crypto.randomUUID(),limite:5,fenetreMs:60000};
 const r=await Promise.allSettled(Array.from({length:16},()=>autoriser(env.PUBLIO_R2,cfg)));
 const ok=r.filter(x=>x.status==='fulfilled'&&x.value.ok).length;
 const refused=r.filter(x=>x.status==='fulfilled'&&!x.value.ok).length;
 if(ok!==5||refused!==11)throw Error('Réservations concurrentes non sûres : '+ok+'/'+refused);
 const autre=await autoriser(env.PUBLIO_R2,{...cfg,sujet:crypto.randomUUID()});
 if(!autre.ok)throw Error('Isolation limiteur');
 return new Response('OK : limite, écritures concurrentes et isolation');
}catch(e){return new Response('ÉCHEC : '+e.message,{status:500})}}};
