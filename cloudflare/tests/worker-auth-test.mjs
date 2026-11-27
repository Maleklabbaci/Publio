// Test local exclusif, ne jamais déployer.
import {creerCompte,verifierConnexion,creerSession,lireSession,supprimerSession} from '../auth-r2.mjs';
export default {async fetch(req,env){try{
 const b=env.PUBLIO_R2, email='test-'+crypto.randomUUID()+'@example.test', mdp='UnMotDePasse123';
 const c=await creerCompte(b,{nom:'Personne Test',email,motDePasse:mdp});if(!c.ok)throw Error('création');
 const d=await creerCompte(b,{nom:'Autre',email:email.toUpperCase(),motDePasse:mdp});if(d.ok||!d.existe)throw Error('doublon');
 if(await verifierConnexion(b,email,'Mauvais123'))throw Error('mauvais mot de passe');
 const user=await verifierConnexion(b,email.toUpperCase(),mdp);if(!user||user.id!==c.id)throw Error('connexion');
 const s=await creerSession(b,user);if((await lireSession(b,s.jeton))?.id!==c.id)throw Error('session');
 if(await lireSession(b,s.jeton.slice(0,-1)+'z'))throw Error('jeton invalide');
 await supprimerSession(b,s.jeton);if(await lireSession(b,s.jeton))throw Error('déconnexion');
 return new Response('OK : compte, doublon, mot de passe, session, déconnexion');
}catch(e){return new Response('ÉCHEC : '+e.message,{status:500})}}};
