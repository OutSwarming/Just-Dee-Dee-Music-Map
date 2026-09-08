# Project boundaries

This repository owns Just Dee Dee Music. Its only production Firebase project is `just-dee-dee-music-map`. Read `docs/FIREBASE_PROJECT_OWNERSHIP.md` before any infrastructure or deployment change.

Never deploy this repository's functions, hosting or rules to `barkrangermap-auth`. That is Bark Ranger's separate project. Preserve project-check predeploy hooks, dedicated JDDM runtime identities and target-project secret references. Historical reports mentioning Bark are not current deployment instructions.

Use explicit project IDs and scoped deployments. Do not restore old shared endpoints or unpause retired schedules as a shortcut. Migration backups in `work/project-separation/` are private and must not be committed. Calendar frequency changes are separate from project separation; verify every trigger owner before changing schedules.

Before changing database readers or writers, read `docs/FIRESTORE_EFFICIENCY.md`. Registered collection writers must use `operationDb(db)` so canonical records and their snapshots commit together. Preserve the recovery handler, operation counters, and authoritative fallback when changing this layer.
