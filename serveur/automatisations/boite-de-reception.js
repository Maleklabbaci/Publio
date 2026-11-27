/* Boîte de réception : interface et exemples fictifs ; aucune connexion réelle. */
let BOITE_FILTRE = 'tout', BOITE_CANAL = '', BOITE_DETAIL = null;
const BOITE_PHOTOS = {sara:'__DATA_AVATAR_DEMO__',amine:'__DATA_AVATAR_AMINE__',lina:'__DATA_AVATAR_LINA__'};
const BOITE_EXEMPLES = [
 {id:'demo-1',nom:'Sara B.',canal:'ig',type:'message',texte:'Bonjour, vous livrez à Alger ?',heure:'il y a 5 min',etat:'À traiter',photo:'sara'},
 {id:'demo-2',nom:'Amine K.',canal:'li',type:'commentaire',texte:'Bonjour, est-ce possible d’avoir plus d’informations ?',heure:'il y a 20 min',etat:'Réponse simulée',photo:'amine'},
 {id:'demo-3',nom:'Lina M.',canal:'ig',type:'story',texte:'Trop joli ! Vous le vendez en ligne ?',heure:'hier',etat:'Traité en démo',photo:'lina'},
];
function boiteDonnees(){
  // Les exemples ne doivent jamais apparaître dans un compte client ou un autre projet.
  if (!window.PUBLIO_SESSION_CLIENT && window.PUBLIO_FORCER_PLAN && (window.PUBLIO_FORCER_PLAN !== 'agence' || (typeof AGENCE_ACTIF !== 'undefined' && AGENCE_ACTIF === 'demo-maison'))) return BOITE_EXEMPLES;
  return [];
}
function boiteType(m){ return ({message:'Message privé',commentaire:'Commentaire',story:'Réponse à une story'})[m.type] || 'Échange'; }
function boiteAvatar(m){
  const info=canalParId(m.canal)||{nom:m.canal,couleur:'#666'};
  const initiale=String(m.nom||'?').trim().charAt(0).toUpperCase()||'?';
  // Seule la photo fictive intégrée est utilisée aujourd'hui ; pas de chargement réseau.
  const photoData=BOITE_PHOTOS[m.photo];
  const photo=photoData ? `<img src="${photoData}" alt="" onerror="this.hidden=true">` : '';
  return `<span class="br-avatar" aria-label="${texteSecurise(m.nom)} sur ${texteSecurise(info.nom)}"><span class="br-initiale">${texteSecurise(initiale)}</span>${photo}<span class="br-reseau" style="background:${texteSecurise(info.couleur)}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONES_PLEINES[m.canal]||''}</svg></span></span>`;
}
function rendreBoite(){
  const zone=document.getElementById('boite-contenu'); if(!zone)return;
  const donnees=boiteDonnees(), estDemo=donnees.length>0;
  const item=BOITE_DETAIL && donnees.find(x=>x.id===BOITE_DETAIL);
  if (BOITE_DETAIL && !item) BOITE_DETAIL=null;
  const entete=`<div class="br-en-tete"><div><div class="ec-titre">Boîte de réception</div><div class="ec-sous">Les échanges de ton projet au même endroit.</div></div></div>`;
  const notice=estDemo ? '<div class="br-notice">Démo : ces échanges et ces photos sont fictifs. Aucun message n’est envoyé.</div>' : '<div class="br-notice">La réception et l’envoi réels sont en préparation. Les photos dépendront des accès accordés par chaque réseau.</div>';
  if(item){
    zone.innerHTML=entete+notice+`<button type="button" class="br-retour" data-br-retour>‹ &nbsp;Tous les échanges</button><div class="br-detail-tete">${boiteAvatar(item)}<div><b>${texteSecurise(item.nom)}</b><small>${boiteType(item)} · exemple fictif</small></div></div><div class="br-fil"><div class="br-bulle"><span>${texteSecurise(item.texte)}</span><small>Message fictif · ${texteSecurise(item.heure)}</small></div>${item.etat==='Réponse simulée'?'<div class="br-bulle br-bulle-sortante">Merci pour votre message !<small>Réponse simulée, non envoyée</small></div>':''}</div><label class="br-label" for="br-reponse">Ta réponse</label><textarea id="br-reponse" placeholder="Envoi réel en préparation" disabled></textarea><button class="br-envoyer" type="button" disabled>Envoyer · bientôt disponible</button><p class="br-aide">Lecture et réponse réelles à brancher selon les autorisations du réseau.</p>`;
    zone.querySelector('[data-br-retour]').onclick=()=>{BOITE_DETAIL=null;rendreBoite()};
    return;
  }
  const filtres=[['tout','Tout'],['message','Messages'],['commentaire','Commentaires']];
  const canauxDisponibles = CANAUX_CONNECTES.filter(c=>c && canalParId(c.id));
  if (BOITE_CANAL && !canauxDisponibles.some(c=>c.id===BOITE_CANAL)) BOITE_CANAL='';
  const disponibles=donnees.filter(x=>(!BOITE_CANAL || x.canal===BOITE_CANAL) && (BOITE_FILTRE==='tout'||x.type===BOITE_FILTRE||(BOITE_FILTRE==='message'&&x.type==='story')));
  const choixCanal=`<div class="br-canaux"><label for="br-canal-filtre">Canal</label><select id="br-canal-filtre" aria-label="Filtrer par canal"><option value="">Tous les canaux</option>${canauxDisponibles.map(c=>`<option value="${texteSecurise(c.id)}" ${BOITE_CANAL===c.id?'selected':''}>${texteSecurise(canalParId(c.id).nom)}</option>`).join('')}</select></div>`;
  const tabs=`<div class="br-filtres" role="group" aria-label="Filtrer les échanges">${filtres.map(([id,nom])=>`<button type="button" data-br-filtre="${id}" class="${BOITE_FILTRE===id?'on':''}" aria-pressed="${BOITE_FILTRE===id}">${nom}</button>`).join('')}</div>`;
  const cartes=disponibles.length?disponibles.map(m=>`<button type="button" class="br-carte" data-br-ouvrir="${texteSecurise(m.id)}">${boiteAvatar(m)}<span class="br-carte-corps"><span class="br-ligne"><b>${texteSecurise(m.nom)}</b><small>${texteSecurise(m.heure)}</small></span><span class="br-meta">${boiteType(m)}</span><span class="br-apercu">${texteSecurise(m.texte)}</span><span class="br-etat ${m.etat==='À traiter'?'br-a-traiter':'br-traite'}">${texteSecurise(m.etat)}</span></span><span class="br-chevron" aria-hidden="true">›</span></button>`).join(''):(estDemo?'<div class="br-vide"><b>Aucun exemple dans cette catégorie</b><p>Essaie un autre filtre.</p></div>':'<div class="br-vide"><b>Boîte de réception en préparation</b><p>Les messages et commentaires de tes réseaux ne sont pas encore synchronisés ici.</p></div>');
  zone.innerHTML=entete+notice+tabs+choixCanal+'<div class="br-liste-titre"><b>Échanges récents</b>'+(estDemo?'<small>Exemples fictifs</small>':'')+'</div><div class="br-liste">'+cartes+'</div>';
  zone.querySelectorAll('[data-br-filtre]').forEach(b=>b.onclick=()=>{BOITE_FILTRE=b.dataset.brFiltre;BOITE_DETAIL=null;rendreBoite()});
  zone.querySelector('#br-canal-filtre').onchange=e=>{BOITE_CANAL=e.target.value;BOITE_DETAIL=null;rendreBoite()};
  zone.querySelectorAll('[data-br-ouvrir]').forEach(b=>b.onclick=()=>{BOITE_DETAIL=b.dataset.brOuvrir;rendreBoite();document.getElementById('vue-boite')?.scrollTo({top:0,behavior:'auto'})});
}
