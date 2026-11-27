# État vérifié : pas prêt pour une mise en production

60 tests locaux réussis. La recherche Instagram et l'envoi TikTok sont testés avec réponses simulées, pas avec de vrais comptes. Les identifiants d'applications développeur ne sont pas configurés.

## Ce qui est construit
- Le composeur client téléverse les médias privés dans le dossier du compte, limité à 64 Mo par fichier et 1 Go par projet. Formats : JPEG, PNG, WebP, MP4, MOV. Le navigateur les retrouve après rechargement. L'accès est réservé à la session propriétaire ; ces URL privées ne conviennent pas aux plateformes externes.
- Les brouillons du composeur sont enregistrés côté serveur et réapparaissent après rechargement avec médias, réseaux, date, heure, légende et choix de musique Instagram. Ils ne sont pas publiés. L'édition réenregistre le même brouillon.
- La recherche de sons Instagram utilise l'API officielle et la connexion du compte. Un Reel peut transmettre le son à Instagram via audio_configuration, mais ce chemin n'est pas branché à une programmation réelle. Disponibilité et droits selon Meta.
- L'import, les brouillons, la séparation entre clients, la lecture partielle des vidéos et le rechargement ont été testés dans le navigateur avec des comptes et réponses simulés.

## Bloquants avant ouverture aux clients
- La programmation du composeur client reste bloquée. Le moteur n'envoie pas encore ces brouillons aux réseaux. Il faut des URL de médias publiquement téléchargeables et sécurisées, une file durable, des états par réseau, protection contre les doublons, fuseaux horaires, traitement des erreurs et suivi des envois. Les règles client sont en simulation.
- Les clients peuvent supprimer un brouillon et un média non utilisé, après confirmation ; la limite et l’espace utilisé par projet sont affichés. Un média utilisé dans un brouillon ou post est protégé. La gestion des sauvegardes, les résidus après crash et la suppression du compte entier restent à traiter.
- Meta, TikTok et LinkedIn demandent des apps configurées, droits accordés, domaine HTTPS et essais sur des comptes autorisés. Meta choisit actuellement la première Page admissible ; un choix explicite est nécessaire si plusieurs Pages. Pages professionnelles LinkedIn non prises en charge par l'OAuth actuel.
- Threads et YouTube n'ont pas de connexion OAuth fonctionnelle ; YouTube n'a pas d'adaptateur de publication.
- Le renouvellement TikTok par client est préparé avant envoi, mais non testé en réel. Les renouvellements Meta et LinkedIn par client et les échecs doivent encore être traités.
- TikTok en mode brouillon envoie dans la boîte TikTok : le client termine dans TikTok. Direct Post demande notamment consentement, confidentialité choisie et accès approuvé. Le suivi ultérieur du statut reste à construire.
- Le choix du même son Meta pour Facebook et celui d'un son TikTok depuis Publio ne sont pas validés ni branchés. Ne pas extrapoler le support du Reel Instagram aux carrousels ou à Facebook.
- Vérifier les droits médias, les restrictions d'usage, l'isolation et la sécurité avant activation.

---

# Brancher les vrais réseaux — mode d'emploi

## Le principe : « Connecter mon compte » (OAuth)
Le client ne colle **jamais** de clés. Dans **Mon espace → Mes réseaux**, chaque réseau a un
bouton **« Connecter mon compte »** : la plateforme (Facebook / TikTok / LinkedIn) ouvre sa
propre page de confirmation, le client clique « Autoriser », et les jetons partent directement
dans `locataires/<slug>/cles.json` (chmod 600), jamais ailleurs. Un message en haut de la page
confirme : « connecté » ou le problème exact.

## Ce que TU dois faire une fois (toi, pas les clients)
1. Créer les 3 apps développeur (voir sections ci-dessous).
2. Remplir `/home/user/publio/serveur/.apps.json` (chmod 600, jamais affichée, jamais côté navigateur) :
   ```json
   {
     "meta":     { "client_id": "…", "client_secret": "…", "redirect": "https://<ton-domaine>/api/oauth/meta/callback" },
     "tiktok":   { "client_id": "…", "client_secret": "…" },
     "linkedin": { "client_id": "…", "client_secret": "…" }
   }
   ```
3. Enregistrer les **redirect URLs** dans chaque portail développeur :
   `https://<ton-domaine>/api/oauth/meta/callback` (idem `tiktok`, `linkedin`).
   En local/test sans ce champ, le moteur déduit le host de la requête (à enregistrer tel quel).
4. Redémarrer le moteur et tester chaque connexion sur un compte autorisé. La configuration seule ne garantit pas le fonctionnement.

## Instagram + Facebook (une seule app Meta, un seul consentement)
- Compte **Pro (Business/Créateur)** + **Page Facebook liée** — sinon l'OAuth réussit mais aucun
  compte IG n'est visible (message d'erreur clair côté client).
- App Meta (type Business) : produits Instagram + Facebook Login, permissions
  `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`.
- Le moteur récupère tout seul : token long-lived (60 j) + IG User ID + Page ID + handle.
- Production réelle : **App Review Meta obligatoire** au-delà des comptes test.
- Limites : ~25 posts / 24 h par compte sous 25 k abonnés.

## TikTok
- App TikTok + produits **Login Kit** et **Content Posting API**.
- Scopes : `user.info.basic`, `user.info.profile`, `user.info.stats`, `video.upload`, `video.publish`.
- Par défaut le mode est **inbox** : la vidéo arrive en brouillon dans l'app du client,
  il publie lui-même (l'accès doit être autorisé par TikTok). Le mode « direct » demanderait un audit.
- En dev, les posts sont privés et limités (5 comptes / 24 h).

## LinkedIn
- App LinkedIn : produit **Sign In with LinkedIn** + **Share on LinkedIn**
  (`openid`, `profile`, `w_member_social` — auto-approuvés).
- Le moteur déduit tout seul l'`author` (`urn:li:person:<sub>`) via `/v2/userinfo`.
- Token 60 j. Les pages entreprise (`urn:li:organization:…`) exigent une validation LinkedIn.

## Notes moteur
- Un canal n'est « connecté » chez un client QUE si ses clés existent (OAuth ou enregistrement manuel) ;
  la publication passe alors par `publier.js` avec SES clés ; le disjoncteur est isolé par client.
- `PUT /api/mes-cles/<ig|fb|tt|li|th>` reste disponible côté serveur pour un onboarding à la main
  (clés collées par l'équipe) — aucune UI publique pour ça.
- En cas de refus/annulation : retour `/espace?reseaux=err&msg=…` avec la cause exacte.
- **Non testé en vrai réseau sans les vraies apps** — premier branchement réel = vérification obligatoire (log + post réel sur un compte de test).

## Historique : coller ses clés à la main
Tout le texte ci-dessus parlait de coller des clés. Aller d'un clic à « Connecter mon compte »
est désormais le seul chemin côté client. Les anciennes frontières restent en secours.

## Pack Agence : portefeuille multi-projets

Un compte Agence actif peut créer, renommer et activer des projets. Le projet principal conserve les données du compte existant ; les autres ont chacun un stockage privé distinct pour canaux, médias, brouillons, posts, règles, clés et statistiques. La liste de projets reste attachée au compte propriétaire ; un cookie de sélection signé est vérifié côté serveur. Changer de projet dans un autre onglet bloque les requêtes périmées et demande un rechargement. Les brouillons peuvent être enregistrés avant la connexion d'un réseau. Le benchmark reste local à ce navigateur et est séparé par projet.

L'aperçu de pack est une démonstration : ses projets et changements sont temporaires et ses comptes ne sont pas des connexions réelles. Dans les vrais espaces clients, les projets, médias et brouillons sont enregistrés sur le serveur. La connexion aux réseaux et la publication réelle ne sont pas validées : voir les limites ci-dessus. La simulation automatique côté navigateur est désactivée dans les espaces clients pour éviter d'afficher une publication fictive comme réelle. Le retour OAuth refuse un état qui ne correspond plus au projet actif ; le parcours complet reste à valider avec les identifiants officiels.

## Tarifs Algérie (configuration actuelle)

La grille affichée est : essai gratuit 30 jours, Individuel 1 900 DA/mois, Agence 4 900 DA/mois avec 5 projets (le projet principal compte), puis 700 DA/mois par projet supplémentaire. Le plafond des 5 projets est contrôlé côté serveur, y compris en cas de créations simultanées ; les projets déjà existants ne sont pas supprimés. L'achat des projets supplémentaires, la facturation et le paiement en ligne ne sont pas intégrés : aucune somme ne doit être présentée comme débitée, et la création au-delà de cinq est bloquée en attendant. Les anciens montants sans devise sont conservés comme euros ; les nouveaux comptes enregistrent la devise DZD. Le montant propre à chaque compte reste celui enregistré par l'administration, pas un prélèvement automatique.

## Vérification de l’interface et des règles

Les règles créées ou modifiées depuis un espace client sont enregistrées via l’API du projet actif ; activation, édition et suppression ne sont confirmées qu’après succès du serveur. Leur exécution réelle et leur test côté client restent en préparation : l’interface le précise. Les simulations de l’aperçu ne sont que des exemples. La programmation réelle est désactivée dans le composeur client ; les brouillons restent disponibles. Les champs de recherche globale, de récurrence et d’options non sauvegardées sont masqués en attendant leur intégration. La déconnexion d’un canal demande confirmation et ne met à jour l’interface qu’après succès serveur.
