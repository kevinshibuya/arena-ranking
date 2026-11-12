# arena-ranking

Arena stats tracker and ladder for League of Legends, Brazil first. One context: the product, its crawl, and the operation of the one box it runs on.

## Language

### Operations

**Open**:
The state in which the site answers anyone: ladder, search and profiles with no gate of any kind. Requires a Riot production key.
_Avoid_: Public, live, launched

**Gated**:
The state before Open: the whole site behind one shared credential, because Riot forbids public use of a development or personal key.
_Avoid_: Private beta, staging, password-protected

**Release**:
One built set of the three app images, named by the commit it was built from. The box runs exactly one release at a time.
_Avoid_: Build, version, deploy (the act of making a release the running one)

**Deploy**:
The act of making a release the running one on the box: migrate the database forward, then start the release's images.
_Avoid_: Ship (moving a release to the box), push, update

**Rollback**:
Returning the running release to a previous one, by images alone. The database is never rolled back by a rollback.
_Avoid_: Revert, downgrade

**Premigrate dump**:
A database dump taken right before a deploy migrates the schema. One per deploy attempt, never overwritten, kept so a rollback can also restore the schema the release left.

**Prerestore dump**:
A database dump taken right before a restore replaces the live database, so a restore of the wrong dump can itself be undone.

**Nightly dump**:
The scheduled daily database dump, kept for thirty days.

**Seed dump**:
A dump of the development database restored into a fresh production database on the first deploy, so production starts with the players and matches already crawled.

**Guard**:
The scheduled check on the box that reports, every run, whether the last nightly succeeded, whether every service is healthy, and whether the Riot key is accepted. Silence from the guard is itself a failure.
_Avoid_: Monitor, watchdog, healthcheck (the per-container probe)
