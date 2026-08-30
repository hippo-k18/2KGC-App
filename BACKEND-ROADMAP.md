# Backend & Organizer Console — Roadmap

Rédigé le 2026-08-25. **Mis à jour le 2026-08-28** : les Phases 0, 1, 2, 3 et 4
sont closes, et une partie de la Phase 5 aussi. Voir l'état par phase ci-dessous
avant de lire le détail, qui décrit le plan tel qu'il était et non l'état actuel.

⚠️ Deux prémisses de la version d'origine étaient fausses :

- `apps/console/` **n'existe plus** — supprimé en août 2026 et remplacé par
  `apps/organizer/`. Toute référence à `apps/console` ici est historique.
- `DECISIONS.md` **existe bel et bien**, dans `whova-rebuild/DECISIONS.md`, un
  niveau au-dessus de ce dépôt. Il n'était pas absent, il était ailleurs.

## État par phase — 2026-08-28

| Phase | État |
|---|---|
| **0 — Cadrage** | ✅ Close. Le livrable demandé est `functions/SPEC.md` : chaque trigger, son déclencheur, ce qu'il écrit, ce qu'il ne doit pas faire. |
| **1 — Écrire et tester les functions** | ✅ Close. **10 fonctions** (`functions/SPEC.md` #1 `onReplyWrite` à #10 `verifyOtp`), **32 tests** verts sur l'émulateur — mis à jour le 2026-08-30 après la fusion du PR #2 (`onAnnouncementCreate`, `onSessionAgendaChange`, `requestOtp`, `verifyOtp`, portés depuis `main`). Note technique : ça correspond à **12 fichiers `.ts`** dans `functions/src/triggers/` et `functions/src/callable/`, pas 10 — les lignes #4 (`onPollVoteWrite` + `tallyPoll`) et #5 (`onQuestionWrite` + `rebuildQaBoard`) couvrent chacune deux fonctions Cloud distinctes (un trigger Firestore et la fonction séparée qu'il planifie via Cloud Tasks) sous une seule ligne de spec. Le chiffre de référence dans ce document reste 10, cohérent avec la numérotation `functions/SPEC.md` utilisée partout ailleurs dans ce projet. |
| **2 — Trous du modèle de données** | ✅ Close. |
| **3 — Écrans manquants de la console** | ✅ Close par comptage d'écrans : **173 / 173** rendent des données réelles (`npm run smoke`). Ce qui reste n'est plus des écrans mais des capacités — voir `ROADMAP.md`. |
| **4 — Sécuriser la console** | ✅ Close **par décision, pas par construction**. Le 2026-08-28 il a été décidé de garder email + passphrase : pas de SSO, pas de MFA. Le coût est écrit dans `apps/organizer/src/lib/auth.ts`. La liste d'emails « sans aucune vérification » décrite plus bas n'est plus exacte : il y a un secret partagé, un cookie HMAC de 8 h, une comparaison à temps constant et un échec fermé en production. |
| **5 — Bascule vers Blaze** | ⚠️ **À moitié faite, et pas dans l'ordre prévu.** Les règles et les 16 index **sont déployés** sur le projet réel (via `scripts/ops/deploy-rules.mjs` et `deploy-indexes.mjs` — la CLI Firebase est refusée ici avec un 403 `serviceusage`). Le projet reste sur **Spark**, donc les Cloud Functions ne sont **pas** déployées. C'est le seul point bloquant qui reste. |
| **6 — Documentation** | ✅ Faite le 2026-08-28 : ce fichier, `ROADMAP.md`, `AGENTS.md`, `README.md`, `DEMO.md`. |

Le reste du document décrit le plan d'origine. Il est conservé parce qu'il
explique *pourquoi* chaque phase existait ; `ROADMAP.md` est la mesure actuelle.

---

Tout se fait **en local, gratuitement, sur l'émulateur Firebase**, jusqu'à la
Phase 5. Rien n'oblige à passer sur Blaze avant d'y arriver.

---

## Phase 0 — Cadrage (avant d'écrire une ligne de code)

Le repo dit *quels champs* doivent être maintenus automatiquement, mais ne
spécifie nulle part la liste exacte des fonctions à écrire — `DECISIONS.md`,
qui aurait dû trancher ça, n'existe pas dans le repo cloné. Première tâche
réelle : écrire cette spec, même sommaire, avant de coder.

Champs "function-owned" identifiés dans `packages/shared/src/models.ts` et
`firestore.rules` (aucun client ne peut les écrire, une Cloud Function le
doit) :

| Champ | Collection | Événement déclencheur (à confirmer) |
| --- | --- | --- |
| `replyCount` | `communityPosts` | création d'une réponse |
| `reactionCount` | `communityPosts` | ajout/retrait d'une réaction |
| `upvoteCount` | questions de session Q&A | upvote d'une question |
| `tallies`, `totalVotes` | `PollDoc` | création d'un `PollVoteDoc` |
| `directory/{uid}` | miroir de `users/{uid}` | mise à jour du profil ou des réglages de confidentialité |
| push (`fcmTokens`) | annonces, changements de salle | création d'une annonce / changement de salle de session |

Ça fait six familles de champs ; AGENTS.md parle de « sept déclencheurs » —
le septième est probablement la fonction de vérification du code à 6
chiffres pour la connexion (`verifyOtp`), qui n'est pas un « agrégat » mais
est bloquée par le même problème de plan. À confirmer/trancher en Phase 0.

**Livrable de cette phase** : un fichier (dans `functions/` ou à la racine)
qui liste chaque fonction prévue, son déclencheur exact, ce qu'elle écrit, et
ce qu'elle NE doit pas faire. Ça peut littéralement remplacer le
`DECISIONS.md` manquant.

---

## Phase 1 — Écrire et tester les Cloud Functions en local

Tout se passe contre l'émulateur (`npm run dev:emulators`), sans carte
bancaire ni Blaze. Chaque fonction listée en Phase 0, une par une :

1. Écrire le déclencheur dans `functions/src/`.
2. Le tester contre l'émulateur avec des données seedées (`npm run seed`).
3. Vérifier qu'il respecte les règles déjà écrites — `tests/rules/firestore.test.ts`
   (143 tests aujourd’hui) doit continuer à passer, et de nouveaux tests doivent couvrir
   chaque nouveau champ.
4. Committer.

Ordre suggéré, du plus simple au plus utile en démo : `replyCount` /
`reactionCount` (logique la plus simple, visible immédiatement dans l'app
mobile) → `tallies`/`totalVotes` (sondages) → `directory/{uid}` (plus
structurant, touche à la confidentialité) → push → `verifyOtp`.

---

## Phase 2 — Combler les trous connus du modèle de données

Ces points sont indépendants des Cloud Functions et peuvent être traités
en parallèle de la Phase 1 :

- **`users/{uid}` n'est jamais créé à la vraie première connexion.** Seuls
  les comptes seedés ont un profil. C'est la différence entre « la démo
  marche » et « un vrai participant peut utiliser l'app ».
- **Les règles de check-in bloquent tout le monde, y compris les
  organisateurs, en écriture.** `checkInLists`, `checkIns`, `scanEvents` et
  `checkInStations` ont `allow write: if false` pour tout client — seul
  l'Admin SDK (donc la console) peut écrire. Note : AGENTS.md dit que ces
  collections « n'ont aucune règle du tout », ce qui est faux — les règles
  existent, elles ferment juste tout accès client. Corriger cette phrase dans
  AGENTS.md en même temps.
- ~~`users/{uid}.photoURL` n'a aucune validation de format dans
  `firestore.rules`.~~ **Correctif fusionné, déploiement en attente de
  confirmation côté collègue.** La règle `allow update` ne vérifiait que
  l'ensemble des clés changées (`changed().hasOnly([...])`), jamais la valeur
  d'aucun champ — un attendee pouvait écrire n'importe quelle chaîne dans son
  propre `photoURL`. `mirrorDirectory` (functions/SPEC.md #6) validait déjà
  que le hostname est `firebasestorage.googleapis.com` avant de copier vers
  `directory/{uid}`, mais ça ne protégeait que la projection : `users/{uid}`
  lui-même restait écrivable sans contrainte. Corrigé dans `firestore.rules`
  (même contrainte de hostname directement sur `allow create`/`allow
  update` de `users/{uid}`) et fusionné le 2026-08-30 via le PR #2
  (`port-phase1-to-live-project` → `organizer-dashboard`), avec 6 nouveaux
  tests de règles (`tests/rules/firestore.test.ts` compte 149 tests au total
  aujourd'hui). **Mais le code fusionné n'est pas le code déployé** : les
  règles réellement actives sur `kgc-conference-app-and-website` sont celles
  d'avant ce correctif, déployées via `scripts/ops/deploy-rules.mjs` avant la
  fusion — personne ne les a redéployées depuis. Le trou reste donc ouvert en
  production tant que ce redéploiement n'a pas eu lieu ; il nécessite les
  identifiants du collègue. `deploy-rules.mjs` exige deux identités
  distinctes (`scripts/ops/gtoken.mjs` pour le compte de service,
  `scripts/ops/utoken.mjs` pour un `firebase login` humain déjà stocké sur la
  machine) — aucune des deux n'existe dans cet environnement, donc le
  redéploiement ne peut pas se faire depuis ici sans intervention directe du
  collègue.

---

## Phase 3 — Construire les écrans manquants de la console

C'est le chantier le plus long. `nav.ts` encode 163 nœuds de menu ; ne pas
essayer de tous les construire. Prioriser par usage réel, dans cet ordre
suggéré :

1. Import/export d'agenda (le workflow Excel que les organisateurs
   connaissent déjà de Whova).
2. Ajout/édition de session (le Session Manager actuel est lecture seule).
3. CRUD Speaker/Sponsor (idem).
4. Ciblage des annonces par catégorie/segment.

---

## Phase 4 — Sécuriser la console avant toute mise en ligne

Rappel déjà établi : la console n'a ni SSO ni MFA, juste une liste d'emails
sans aucune vérification — son propre code dit explicitement de ne pas la
déployer en l'état. Ne pas sauter cette étape même si tout le reste
fonctionne.

---

## Phase 5 — Bascule vers Blaze

Seulement une fois les Phases 1 à 4 testées et stables en local :

1. Mettre en place une alerte de budget GCP (avant toute autre chose).
2. Passer `kgc-conference-app-and-website` sur Blaze.
3. Déployer les règles et les index (`npm run deploy:rules`) — écrits depuis
   le début, jamais appliqués en prod à ce jour.
4. Déployer les Cloud Functions.
5. Tester avec un compte réel, non seedé, de bout en bout.

---

## Phase 6 — Tenir la documentation à jour

Mettre à jour ce fichier, `AGENTS.md` et le `README.md` à chaque phase
franchie — pas à la fin. C'est exactement l'écart qu'on vient de corriger sur
le README ; ne pas le recreuser ici.
