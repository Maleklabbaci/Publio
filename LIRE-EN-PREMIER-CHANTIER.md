# Publio — chantier Cloudflare (incomplet)

**Ne pas déployer cette version pour des utilisateurs réels.** Ce ZIP est une sauvegarde du travail en cours, pas le ZIP Cloudflare fonctionnel demandé. Le serveur Node existant ne fonctionne pas directement en Cloudflare Workers. Les modules du dossier `cloudflare/` sont des prototypes réservés aux tests locaux avec un faux R2 ; ils ne sont pas branchés au Worker public. Ne jamais déployer les fichiers de configuration `cloudflare/tests/` : ils servent uniquement aux tests. Ne pas entrer de vraies données.

Ce qui est testé localement : un prototype de création de compte/connexion, de session, de brouillons et d'import de médias, avec un seul projet, et un limiteur expérimental. Aucun de ces tests ne valide la sécurité ni le fonctionnement en ligne. La migration des comptes existants, la vérification d'email, la récupération, la protection complète contre les abus, la gestion des médias après interruption, le multi-projets et les autres API restent à faire. Les connexions réseaux, publications, automatisations et paiements réels ne sont pas opérationnels.

Voir `cloudflare/ETAT.md` pour les limites et les tests. Le bucket `publio-prive` doit rester privé ; aucun accès au vrai bucket n'est configuré dans ce ZIP.

L'aperçu local d'origine reste disponible avec `node compte-test.js`, instructions et identifiants dans README.md. Cet aperçu ne doit pas être exposé comme un vrai service client.
