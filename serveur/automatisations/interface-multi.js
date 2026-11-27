/* Éditeur de règles multi-actions : uniquement des brouillons, jamais exécutés. */
(function(){
'use strict';
const evenements={
 commentaire:{titre:'Quelqu’un commente une publication',canaux:['ig','fb','li','th','yt'],actions:['reponse_publique','alerte']},
 mot_cle:{titre:'Un commentaire contient un mot',canaux:['ig','fb','li','th','yt'],actions:['reponse_publique','alerte']},
 message:{titre:'Je reçois un message privé',canaux:['ig','fb'],actions:['reponse_message','alerte']},
 mention:{titre:'Mon compte est mentionné',canaux:['ig','fb','li','th'],actions:['alerte']},
 vues:{titre:'Une publication atteint un objectif de vues',canaux:['ig','fb','li','th','tt','yt'],actions:['alerte','proposer_brouillon']},
 erreur:{titre:'Une publication rencontre une erreur',canaux:['ig','fb','li','th','tt','yt'],actions:['alerte']},
 publie:{titre:'Une publication est terminée',canaux:['ig','fb','li','th','tt','yt'],actions:['alerte']},
 semaine:{titre:'Chaque semaine',canaux:['ig','fb','li','th','tt','yt'],actions:['rapport']}
};
const actions={
 reponse_publique:{titre:'Répondre publiquement',champ:'Réponse publique'},
 reponse_privee:{titre:'Envoyer une réponse privée',champ:'Message privé'},
 reponse_message:{titre:'Répondre au message privé',champ:'Réponse au message'},
 alerte:{titre:'Me prévenir dans Publio'},
 proposer_brouillon:{titre:'Proposer un nouveau brouillon'},
 rapport:{titre:'Préparer un résumé des résultats'}
};
function listeActions(evenement,canal){
 const e=evenements[evenement]; if(!e||!e.canaux.includes(canal))return [];
 const ids=e.actions.slice(); if(['commentaire','mot_cle'].includes(evenement)&&['ig','fb'].includes(canal)) ids.splice(1,0,'reponse_privee');
 return ids;
}
const ech=texteSecurise;
function estMulti(r){return !!(r && r.p && r.p.multi && r.p.multi.version===1)}
let courant=null;
function ouvrirMulti(id,canal){
 if(!AUTO_CANAL||AUTO_CANAL!==canal||!CANAUX_CONNECTES.some(c=>c.id===canal))return;
 const r=id ? CARTES.find(x=>x.id===id && x.canaux===canal && estMulti(x)):null;
 if(id&&!r)return;
 courant={id:r?r.id:null,canal,nom:r?r.nom:'',multi:r?JSON.parse(JSON.stringify(r.p.multi)):{version:1,quand:'',mot:'',seuil:1000,actions:[]}};
 dessinerMulti(); panneauEl().classList.add('on');
}
function resume(m){const e=evenements[m.quand];return (e?e.titre:'Choisir un déclencheur')+(m.quand==='mot_cle'&&m.mot?' : « '+m.mot+' »':'')+(m.quand==='vues'?' : '+m.seuil+' vues':'');}
function dessinerMulti(){
 if(!courant)return; const f=document.getElementById('panneau-auto-f'), m=courant.multi, canal=courant.canal;
 const disponibles=listeActions(m.quand,canal); const info=CANAUX_CONNECTES.find(c=>c.id===canal);
 f.innerHTML=`<div class="pa-tete"><span class="ico" aria-hidden="true">✦</span><div class="tt"><h3 id="auto-h">Créer une automatisation</h3><p>Un déclencheur · une ou plusieurs actions</p></div><button class="pa-fermer" id="multi-fermer" aria-label="Fermer">✕</button></div>
 <div class="pa-corps multi-corps"><div class="multi-canal"><small>CANAL SÉLECTIONNÉ</small><b>${ech(NOMS_RES_ICI[canal] || canal)} · ${ech(info?info.compte:'')}</b></div><p class="multi-note">Brouillon uniquement · Exécution réelle et alertes en préparation. Les fonctions proposées restent à valider selon les accès du réseau.</p>
 <label class="multi-label" for="multi-nom">Nom de l’automatisation</label><input id="multi-nom" maxlength="80" placeholder="Ex. : Suivre mes messages" value="${ech(courant.nom)}">
 <section class="multi-bloc"><h4><span>1</span> Quand…</h4><p>Qu’est-ce qui déclenche l’automatisation ?</p><select id="multi-quand" aria-label="Quand"><option value="">Choisir un déclencheur</option>${Object.entries(evenements).filter(([,e])=>e.canaux.includes(canal)).map(([id,e])=>`<option value="${id}" ${id===m.quand?'selected':''}>${ech(e.titre)}</option>`).join('')}</select>
 ${m.quand==='mot_cle'?`<label class="multi-label" for="multi-mot">Mot à détecter</label><input id="multi-mot" maxlength="100" value="${ech(m.mot)}" placeholder="Ex. : prix">`:''}
 ${m.quand==='vues'?`<label class="multi-label" for="multi-seuil">Objectif de vues</label><input id="multi-seuil" type="number" min="1" max="100000000" value="${Number(m.seuil)||1000}">`:''}</section>
 <div class="multi-fleche">↓</div><section class="multi-bloc"><h4><span>2</span> Actions</h4><p>Choisis une ou plusieurs actions.</p>
 ${m.actions.map((a,i)=>`<div class="multi-action"><div class="multi-action-head"><b>ACTION ${i+1}</b><button type="button" data-multi-retirer="${i}">Retirer</button></div><strong>${ech(actions[a.type]?.titre||'Action inconnue')}</strong>${actions[a.type]?.champ?`<label class="multi-label" for="multi-texte-${i}">${ech(actions[a.type].champ)}</label><textarea id="multi-texte-${i}" data-multi-texte="${i}" maxlength="640" rows="2" placeholder="Écris ton message ici">${ech(a.texte||'')}</textarea>`:''}${a.type==='reponse_privee'?`<label class="multi-label" for="multi-bouton-${i}">Bouton (facultatif · à confirmer)</label><input id="multi-bouton-${i}" data-multi-bouton="${i}" maxlength="20" value="${ech(a.bouton||'')}" placeholder="Ex. : Voir le produit"><label class="multi-label" for="multi-lien-${i}">Lien sécurisé du bouton</label><input id="multi-lien-${i}" data-multi-lien="${i}" maxlength="500" type="url" value="${ech(a.lien||'')}" placeholder="https://…"><p class="multi-hint">Bouton dans le premier message : compatibilité à confirmer avant activation.</p>`:''}</div>`).join('')}
 ${m.quand?`<label class="multi-label" for="multi-ajout-choix">Ajouter une action</label><select id="multi-ajout-choix"><option value="">Choisir une action</option>${disponibles.filter(id=>!m.actions.some(a=>a.type===id)).map(id=>`<option value="${id}">${ech(actions[id].titre)}</option>`).join('')}</select>`:'<p class="multi-hint">Choisis d’abord le déclencheur.</p>'}</section>
 <div class="multi-resume"><b>EN RÉSUMÉ</b><p>Quand ${ech(resume(m))}${m.actions.length?' → '+m.actions.map(a=>ech(actions[a.type]?.titre||a.type)).join(' + '):' → choisis une action.'}</p></div><div id="multi-test-result" class="multi-test-result" role="status" hidden></div>
 </div><div class="pa-pied multi-pied"><button type="button" class="btn" id="multi-tester">Tester en simulation</button><button type="button" class="btn pa-valider" id="multi-sauver">Enregistrer le brouillon</button>${courant.id?'<button type="button" class="btn" id="multi-supprimer">Supprimer</button>':''}</div>`;
 f.querySelector('#multi-nom').addEventListener('input',e=>{courant.nom=e.target.value});
 f.querySelector('#multi-quand').addEventListener('change',e=>{m.quand=e.target.value;m.actions=m.actions.filter(a=>listeActions(m.quand,canal).includes(a.type));dessinerMulti()});
 f.querySelector('#multi-mot')?.addEventListener('input',e=>{m.mot=e.target.value});
 f.querySelector('#multi-seuil')?.addEventListener('input',e=>{m.seuil=+e.target.value});
 f.querySelectorAll('[data-multi-texte]').forEach(t=>t.addEventListener('input',e=>{m.actions[+t.dataset.multiTexte].texte=e.target.value}));
 f.querySelectorAll('[data-multi-bouton]').forEach(t=>t.addEventListener('input',e=>{m.actions[+t.dataset.multiBouton].bouton=e.target.value}));
 f.querySelectorAll('[data-multi-lien]').forEach(t=>t.addEventListener('input',e=>{m.actions[+t.dataset.multiLien].lien=e.target.value}));
 f.querySelectorAll('[data-multi-retirer]').forEach(b=>b.addEventListener('click',()=>{m.actions.splice(+b.dataset.multiRetirer,1);dessinerMulti()}));
 f.querySelector('#multi-ajout-choix')?.addEventListener('change',e=>{if(e.target.value&&disponibles.includes(e.target.value)){m.actions.push({type:e.target.value,texte:''});dessinerMulti()}});
 f.querySelector('#multi-fermer').onclick=()=>{courant=null;fermer()};
 f.querySelector('#multi-tester').onclick=()=>{const erreur=validation(m,canal);const zone=f.querySelector('#multi-test-result');zone.hidden=false;zone.textContent=erreur||('Simulation : '+resume(m)+' → '+m.actions.map(a=>actions[a.type].titre).join(' + ')+'. Aucun envoi réel.');};
 f.querySelector('#multi-sauver').onclick=async e=>{const erreur=validation(m,canal);if(erreur){const z=f.querySelector('#multi-test-result');z.hidden=false;z.textContent=erreur;return}if(AUTO_CANAL!==canal||!CANAUX_CONNECTES.some(c=>c.id===canal)){avis('Choisis un canal connecté.');return}
 const r={id:courant.id||('m'+Date.now()),nom:(courant.nom.trim()||resume(m)).slice(0,80),actif:false,canaux:canal,declencheur:'commentaire',action:'prevenir',p:{multi:JSON.parse(JSON.stringify(m))}};
 const b=e.currentTarget;b.disabled=true;try{const recu=await sauvegarderRegleProjet(courant.id?'PUT':'POST',r);const x=Object.assign({},r,recu);const i=CARTES.findIndex(c=>c.id===courant.id);if(i>=0)CARTES[i]=x;else CARTES.push(x);sauverCartes();courant=null;fermer();rafraichirParCanal();avis('Brouillon enregistré. Aucune exécution réelle.')}catch(err){avis(err.message||'Enregistrement impossible.')}finally{b.disabled=false}};
 f.querySelector('#multi-supprimer')?.addEventListener('click',async e=>{const r=CARTES.find(x=>x.id===courant.id);if(!r||!confirm('Supprimer ce brouillon d’automatisation ?'))return;e.currentTarget.disabled=true;try{await sauvegarderRegleProjet('DELETE',r);CARTES=CARTES.filter(x=>x.id!==r.id);sauverCartes();courant=null;fermer();rafraichirParCanal();avis('Brouillon supprimé.')}catch(err){avis(err.message||'Suppression impossible.');e.currentTarget.disabled=false}});
}
function validation(m,canal){if(!m.quand||!evenements[m.quand]?.canaux.includes(canal))return 'Choisis un déclencheur disponible pour ce canal.';if(m.quand==='mot_cle'&&!m.mot.trim())return 'Ajoute un mot à détecter.';if(m.quand==='vues'&&(!Number.isFinite(m.seuil)||m.seuil<1||m.seuil>100000000))return 'Indique un objectif de vues valide.';if(!m.actions.length)return 'Ajoute au moins une action.';if(m.actions.some(a=>!listeActions(m.quand,canal).includes(a.type)))return 'Une action ne correspond pas à ce canal.';if(m.actions.some(a=>actions[a.type]?.champ&&!String(a.texte||'').trim()))return 'Écris le texte de chaque réponse.';for(const a of m.actions){if(a.type==='reponse_privee'&&(a.bouton||a.lien)){if(!String(a.bouton||'').trim())return 'Indique le texte du bouton.';try{if(new URL(a.lien).protocol!=='https:')throw Error()}catch(_){return 'Indique un lien HTTPS valide pour le bouton.'}}}return '';}
const carteAvant=carteRegle;carteRegle=function(r){if(!estMulti(r))return carteAvant(r);const m=r.p.multi;return `<div class="carte-regle" data-carte="${ech(r.id)}"><div class="cr-haut"><span class="ico">✦</span><span class="nom">${ech(r.nom)}</span><span class="multi-badge">Brouillon</span></div><div class="cr"><div class="cr-ligne q"><span class="cr-mot">Quand</span><div class="cr-phrase">${ech(resume(m))}</div></div><div class="cr-ligne a"><span class="cr-mot">Actions</span><div class="cr-phrase">${(m.actions||[]).map(a=>ech(actions[a.type]?.titre||a.type)).join(' + ')}</div></div></div><div class="cr-pied"><span class="quand">Aucune exécution réelle</span><button class="lien" data-regler="${ech(r.id)}">Régler</button></div></div>`};
const ouvrirAvant=ouvrir;ouvrir=function(id){const r=CARTES.find(x=>x.id===id);if(estMulti(r)){ouvrirMulti(id,r.canaux);return}ouvrirAvant(id)};
ouvrirNeuf=function(_modele,canal){ouvrirMulti(null,canal)};
})();
