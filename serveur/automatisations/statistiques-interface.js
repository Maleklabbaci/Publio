/* Statistiques : présentation illustrative en démo, aucune donnée réelle supposée. */
let STATS5_CANAL = '';
const STATS5_EXEMPLES = {
  ig:{abon:6420,7:{aff:15500,inter:470,clics:260},30:{aff:71200,inter:2136,clics:1120},90:{aff:192000,inter:5650,clics:3100}},
  li:{abon:3180,7:{aff:9000,inter:360,clics:150},30:{aff:38900,inter:1430,clics:640},90:{aff:105000,inter:3900,clics:1700}},
  tt:{abon:1840,7:{aff:6000,inter:300,clics:90},30:{aff:24100,inter:1260,clics:380},90:{aff:62000,inter:3100,clics:980}},
};
function stats5EstExemple(){
  // Un seul projet de démonstration, jamais un vrai compte ni un autre projet.
  return !window.PUBLIO_SESSION_CLIENT && window.PUBLIO_FORCER_PLAN === 'agence' && typeof AGENCE_ACTIF !== 'undefined' && AGENCE_ACTIF === 'demo-maison';
}
function stats5Barres(total, periode){
  const poids=periode===7?[10,12,13,15,16,16,18]:periode===90?[28,33,39]:[22,24,25,29];
  const etiquettes=periode===7?['1','2','3','4','5','6','7']:periode===90?['1–30','31–60','61–90']:['1–7','8–14','15–21','22–30'];
  let restant=total;
  const valeurs=poids.map((v,i)=>{const n=i===poids.length-1?restant:Math.round(total*v/100);restant-=n;return n;});
  const max=Math.max(...valeurs,1);
  return '<div class="st5-barres" role="img" aria-label="'+valeurs.map((v,i)=>'Jours '+etiquettes[i]+' : '+nombre(v)+' affichages').join(' ; ')+'">'+valeurs.map((v,i)=>'<span class="st5-col"><i style="height:'+Math.max(3,Math.round(v/max*100))+'%"></i><small>'+etiquettes[i]+'</small></span>').join('')+'</div>';
}
function stats5Vide(){
  return `<div class="st5-vide"><span class="st5-vide-icone" aria-hidden="true">▥</span><h2>Statistiques en préparation</h2><p>Les chiffres réels ne sont pas encore connectés. Ils pourront s’afficher lorsque les réseaux et les accès nécessaires seront mis en place.</p></div><div class="st5-kpis">${['Affichages','Interactions','Abonnés actuels','Clics'].map(t=>'<div class="st5-kpi"><span>'+t+'</span><strong>—</strong></div>').join('')}</div><p class="st5-note">Un tiret signifie « donnée indisponible », pas zéro. Les données disponibles dépendront du réseau et des autorisations.</p>`;
}
function rendreStats(periode){
  periodeStats = [7,30,90].includes(Number(periode)) ? Number(periode) : 30;
  const zone=document.getElementById('stats-contenu'); if(!zone)return;
  const sous=document.getElementById('t-sous'); if(sous && typeof ecranActif !== 'undefined' && ecranActif==='stats') sous.textContent=stats5EstExemple() ? 'Exemple fictif' : 'Données non disponibles';
  const debut='<div class="st5-entete"><h1>Tes résultats, simplement.</h1><p>Comprendre ce qui se passe sur ton canal.</p></div>';
  if(!stats5EstExemple()){zone.innerHTML=debut+stats5Vide();return;}
  const canaux=CANAUX_CONNECTES.filter(c=>c && canalParId(c.id));
  if(!canaux.some(c=>c.id===STATS5_CANAL)) STATS5_CANAL=canaux.some(c=>c.id===CANAL_ACTIF)?CANAL_ACTIF:(canaux[0]&&canaux[0].id)||'';
  const info=canalParId(STATS5_CANAL), exemple=STATS5_EXEMPLES[STATS5_CANAL], d=exemple && exemple[periodeStats];
  const options=canaux.map(c=>`<option value="${texteSecurise(c.id)}" ${c.id===STATS5_CANAL?'selected':''}>${texteSecurise(canalParId(c.id).nom)}</option>`).join('');
  const periodes=[7,30,90].map(n=>`<option value="${n}" ${n===periodeStats?'selected':''}>${n} jours</option>`).join('');
  const logo=info && ICONES_PLEINES[STATS5_CANAL] ? `<span class="st5-logo" aria-hidden="true" style="background:${info.couleur}"><svg viewBox="0 0 24 24" class="${ICONES_TRAIT[STATS5_CANAL]?'trait':''}">${ICONES_PLEINES[STATS5_CANAL]}</svg></span>` : '';
  const controles=`<div class="st5-controles"><label class="st5-canal-label${logo?' st5-avec-logo':''}">${logo}<span class="st5-visually-hidden">Canal</span><select id="st5-canal" aria-label="Choisir le canal">${options||'<option value="">Aucun canal connecté</option>'}</select></label><label><span class="st5-visually-hidden">Période</span><select id="st5-periode" aria-label="Choisir la période">${periodes}</select></label></div>`;
  let corps='';
  if(!d){corps='<div class="st5-vide"><h2>Aucun exemple pour ce canal</h2><p>Les données réelles ne sont pas encore connectées.</p></div>';}
  else {
    const comparaison=STATS5_CANAL==='ig' && periodeStats===30 ? '<p>C’est 12,4 % de plus que les 30 jours précédents.</p>' : '<p>Exemple sur '+periodeStats+' jours ; la comparaison n’est pas renseignée.</p>';
    const detail=STATS5_CANAL==='ig' && periodeStats===30 ? '<small class="st5-hausse">↗ 12,4 % par rapport aux 30 jours précédents</small>' : '<small>Pendant la période</small>';
    const carte=(label,valeur,sous)=>`<div class="st5-kpi"><span>${label}</span><strong>${valeur}</strong>${sous}</div>`;
    const meilleure=STATS5_CANAL==='ig' && (periodeStats===30||periodeStats===90)
      ? '<div class="st5-post"><span class="st5-post-icone" aria-hidden="true">✦</span><span class="st5-post-texte"><b>Nouvelle collection</b><small>Publication fictive</small></span><span class="st5-post-vues"><b>4 800</b><small>affichages</small></span></div>'
      : '<div class="st5-post st5-sans-post">Aucun exemple de publication pour cette sélection.</div>';
    corps=`<div class="st5-section-titre"><h2>Ce qu’il faut retenir</h2><small>Exemple fictif</small></div><div class="st5-resume"><span class="st5-fleche" aria-hidden="true">↗</span><div><b>Tes publications ont été affichées ${nombre(d.aff)} fois.</b>${comparaison}</div></div><div class="st5-kpis">${carte('Affichages',nombre(d.aff),detail)}${carte('Interactions',nombre(d.inter),'<small>J’aime, commentaires…</small>')}${carte('Abonnés actuels',nombre(exemple.abon),'<small>Sur ce canal</small>')}${carte('Clics',nombre(d.clics),'<small>Pendant la période</small>')}</div><div class="st5-section-titre"><h2>Affichages dans le temps</h2></div><div class="st5-graphe"><div class="st5-graphe-tete"><b>${nombre(d.aff)} affichages</b><small>Exemple · ${periodeStats} jours</small></div>${stats5Barres(d.aff,periodeStats)}<p>Un affichage peut compter plusieurs fois pour la même personne.</p></div><div class="st5-section-titre st5-post-titre"><h2>Publication la plus vue</h2><small>Exemple fictif</small></div>${meilleure}<p class="st5-pied">Chiffres, graphique et publication fictifs.</p>`;
  }
  zone.innerHTML=debut+'<div class="st5-notice"><b>Exemple fictif.</b> Les statistiques réelles ne sont pas encore connectées.</div>'+controles+corps;
  zone.querySelector('#st5-canal').addEventListener('change',e=>{STATS5_CANAL=e.target.value;rendreStats(periodeStats);document.getElementById('st5-canal')?.focus({preventScroll:true})});
  zone.querySelector('#st5-periode').addEventListener('change',e=>{rendreStats(Number(e.target.value));document.getElementById('st5-periode')?.focus({preventScroll:true})});
}
