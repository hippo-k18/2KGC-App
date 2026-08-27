# Backend & Organizer Console — Roadmap

Rédigé le 2026-08-25, à partir d'un audit croisé de `AGENTS.md`, `firestore.rules`,
`apps/console/src/lib/nav.ts` et du code réel de `app/`. Objectif : combler le
vide laissé par `DECISIONS.md` et `whova-rebuild/research/`, cités partout dans
le code mais absents du repo. À tenir à jour au fil de l'avancement — sinon ce
fichier deviendra aussi trompeur que l'était l'ancien README.

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
   (134 tests) doit continuer à passer, et de nouveaux tests doivent couvrir
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

- ~~`users/{uid}` n'est jamais créé à la vraie première connexion.~~ **Déjà
  résolu, pas un trou.** `AuthProvider` (`useCreateProfileOnFirstSignIn`,
  `app/src/lib/auth/auth-provider.tsx`) l'écrit depuis le commit `fadee27`
  (« Close the gaps an adversarial audit found in the rules and data
  layer », 2026-08-16) — avant même le début de la Phase 0 de ce fichier.
  Cette ligne était fausse depuis le premier jour de ce document ; découvert
  le 2026-08-26 en vérifiant si le fan-out de la fonction #7
  (`onAnnouncementCreate`) pouvait atteindre un vrai participant non seedé.
  C'est le cas — aucune étape de cette phase ne bloque plus #7.
- ~~Les règles de check-in bloquent tout le monde, y compris les
  organisateurs, en écriture.~~ **C'était déjà le comportement voulu, pas un
  trou.** `checkInLists`, `checkIns`, `scanEvents` et `checkInStations` ont
  `allow write: if false` pour tout client — seul l'Admin SDK (donc la
  console) peut écrire, et c'est documenté comme intentionnel directement
  dans `firestore.rules` ("EVERY WRITE ON THIS PATH IS DENIED TO EVERY
  CLIENT, INCLUDING ORGANIZERS... That is not an oversight, it is the
  design"). Le seul vrai trou était la phrase d'AGENTS.md prétendant que ces
  collections « n'ont aucune règle du tout » — corrigée le 2026-08-27
  (branche `phase-2-checkin-rules`) : AGENTS.md a maintenant une entrée
  « Check-in rules are resolved, not a gap » dans Known gaps, et l'ancienne
  entrée correspondante dans Suggested next steps a été retirée. Les 134
  tests de `tests/rules/firestore.test.ts` couvraient déjà les quatre
  collections avant cette correction — rien n'a changé côté règles ou tests,
  seule la documentation était fausse.
- **`users/{uid}.photoURL` n'a aucune validation de format dans
  `firestore.rules`.** La règle `allow update` ne vérifie que l'ensemble des
  clés changées (`changed().hasOnly([...])`), jamais la valeur d'aucun champ —
  un attendee peut écrire n'importe quelle chaîne dans son propre `photoURL`.
  `mirrorDirectory` (functions/SPEC.md #6) valide déjà que le hostname est
  `firebasestorage.googleapis.com` avant de copier vers `directory/{uid}`,
  mais ça ne protège que la projection : `users/{uid}` lui-même reste
  écrivable sans contrainte. Un audit du 2026-08-26 (voir l'historique de ce
  fichier) a confirmé qu'aucun écran actuel n'affiche le `photoURL` d'un
  *autre* attendee autrement qu'en passant par `directory/{uid}` — donc rien
  n'est exposé aujourd'hui — mais c'est un fait de l'app actuelle, pas une
  garantie de la règle : le premier écran qui lira `users/{uid}.photoURL`
  d'un tiers (organisateur, futur outil console, etc.) hérite du trou sans
  qu'on s'en aperçoive. Ajouter la même contrainte de hostname directement
  dans `allow create`/`allow update` de `users/{uid}`, pour que la
  protection existe à la source et ne dépende pas de la discipline de chaque
  futur lecteur.

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
2. Passer `kgc-database` sur Blaze.
3. Déployer les règles et les index (`npm run deploy:rules`) — écrits depuis
   le début, jamais appliqués en prod à ce jour.
4. Déployer les Cloud Functions.
5. Tester avec un compte réel, non seedé, de bout en bout.

---

## Phase 6 — Tenir la documentation à jour

Mettre à jour ce fichier, `AGENTS.md` et le `README.md` à chaque phase
franchie — pas à la fin. C'est exactement l'écart qu'on vient de corriger sur
le README ; ne pas le recreuser ici.
