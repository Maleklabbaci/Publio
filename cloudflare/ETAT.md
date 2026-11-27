# Adaptation Cloudflare — chantier, pas à déployer

Bucket choisi par l'utilisateur : `publio-prive`, accès public désactivé. Aucun compte ni donnée réelle n'a été créé ou lu dans ce bucket : tous les tests utilisent l'émulateur local Wrangler.

`stockage-r2.mjs` : lecture JSON isolée par compte/projet et écriture conditionnelle R2 (création et révision) ; test local `tests/worker-r2-test.mjs`. Ne gère ni transactions multi-objets, ni quotas, ni médias, ni sauvegardes, ni migration.

`auth-r2.mjs` : prototype de compte isolé avec hash PBKDF2, session et révocation R2. `auth-http-experimental.mjs` : routes de test REST bloquées hors hostname localhost/127.0.0.1 et sans variable LOCAL_TEST_ONLY=1. `tests/wrangler-http-test.jsonc` et `tests/auth-http.test.mjs` : scénario de base local validé dans workerd et R2 émulé. Les tests ne valident pas la sécurité de production ou la facturation réelle. Le test n'accède pas au bucket réel.

**Non prêt pour mise en ligne.** Le code de test ne doit pas être déployé ; pas d'anti-abus distribué, de vérification email, ni de récupération de compte, rotation et nettoyage des sessions, système de révocation de compte complet, protection contre coût excessif, migration des comptes locaux scrypt, ni audit. Les comptes expérimentaux ne sont pas compatibles avec les comptes existants et ne sont pas une migration. Aucun branchement aux pages originales ni à l'app, aucun accès réseaux sociaux, publications, paiements ou automatisations. Les médias, l'isolation multi-projets complète, les permissions et la reprise après échec doivent être intégrés et testés. L'authentification et les sessions sont des prototypes non destinés aux utilisateurs ou à de vraies données.

Pour test local, depuis la racine : `npx -p node@22 -p wrangler@4.168.0 -c 'wrangler dev --local --config cloudflare/tests/wrangler-http-test.jsonc --ip 127.0.0.1 --port 4495'`, puis dans un second terminal `node cloudflare/tests/auth-http.test.mjs`. Arrêter le serveur après. Ne jamais utiliser `wrangler deploy` sur les configurations de test.

## Suite des tests locaux

Les pages de connexion et l'espace client d'origine ont été reliés au prototype local : test navigateur réussi pour connexion et ouverture de `/app` sans erreur JS. L'API expérimentale traite les brouillons texte d'un seul projet avec contrôle de conflit et isolation entre deux comptes ; test HTTP création, modification, suppression, dates invalides et accès d'un autre compte réussi. Tests uniquement avec R2 émulé, jamais le bucket réel. Médias, canaux, autres projets, automatisations et toutes les autres API restent non branchés ; les photos de connexion ne sont pas encore servies dans ce test local. Ceci n'est pas un paquet déployable et ne remplace pas les chantiers de sécurité ci-dessus.

## Prototype local médias (non déployable)

L'API de test locale sait importer un média borné à 8 Mo, vérifier sa signature, servir sa copie seulement au compte concerné, gérer les brouillons liés et refuser sa suppression tant qu'il est référencé. Test local R2 émulé réussi pour import PNG, isolation, lecture, référence, suppression et fausse signature. Les photos des pages de connexion sont maintenant servies par le test local. Le quota, les accès et les écritures concurrentes sont des prototypes ; le traitement des objets orphelins, purges et marqueurs en attente après crash, reprise de suppression, Range vidéo, fichiers jusqu'à 64 Mo, media par projet et test navigateur complet restent à implémenter/tester. Ne pas brancher à un bucket réel, ne pas déployer en production et ne pas y mettre de vraies données. Le reste des limites de ce document reste applicable.

## Limiteur local (non déployable)

Ajout d'un limiteur expérimental R2 par fenêtre avec écritures conditionnelles et refus en cas de conflit non résolu. Test local avec 16 réservations simultanées : 5 autorisées pour une limite de 5, autres refusées. Branché en test local pour inscription et connexion, par IP. Ce n'est pas une protection suffisante en production : à revoir pour l'origine fiable de l'IP, l'anti-abus distribué, les protections par compte, le nettoyage et le coût des compteurs, et à auditer.
