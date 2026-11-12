# Deploy runbook

How arena-ranking runs on the Oracle A1 box and how the operator ships, checks, backs up and restores it. Everything the box gets lives in `deploy/stack/`.

## The Oracle constraint

The deployment adds no Oracle resource: same instance, same boot volume, no block volume, no load balancer, no reserved IP. The box already uses the whole Always Free A1 allowance, so anything new is billed. Backups go to Cloudflare R2, never to Oracle storage. Outbound traffic stays far under the free 10 TB a month.

## What runs

One Compose project, `arena-ranking`, in `~/apps/arena-ranking/` on the box (`deploy/stack/compose.yaml`).

| Service | Image | Memory | CPUs | Networks |
| --- | --- | --- | --- | --- |
| web | `arena-ranking-web:<tag>` | 384m | 0.5 | edge, `web` (Caddy, alias `arena-ranking-web`) |
| api | `arena-ranking-api:<tag>` | 512m | 0.5 | edge, internal; `127.0.0.1:3301` on the box for the tunnel |
| worker | `arena-ranking-worker:<tag>` | 512m | 0.5 | internal |
| postgres | `postgres:17.11-alpine` | 2g | 0.75 | internal |
| redis | `redis:7.4.11-alpine` | 256m | 0.25 | internal |
| migrate (one-shot, `ops` profile) | `arena-ranking-api:<tag>` | 256m | 0.5 | internal |
| backup (one-shot, `ops` profile) | `rclone/rclone:1.75.1` | 256m | 0.5 | internal |

Every service has a pids limit of 256, `cpu_shares: 512` and json-file logs capped at 10 MB times 3. The long-running services have a healthcheck; the two one-shots exit before one could run, so theirs is disabled. The steady-state memory sum is 3,712 MiB.

The browser only talks to web. Web forwards `/api/*` to api over the `edge` network. Postgres and redis sit on `internal` only.

Beside `compose.yaml` on the box, and nowhere else:

- `.env`, mode 600, from `.env.example`. Compose interpolates it into each container's environment; no `env_file` loads it whole.
- `riot.key`, mode 600, holding the Riot API key. It is mounted read-only at `/run/secrets/riot.key` into api and worker, which run as the file's owner (`APP_UID`, `APP_GID`), so the operator owns and edits it. The backend re-reads it on every request batch, so replacing the key needs no restart.
- `state/`: `backup/` (dump staging), `backup.last`, `backup.cron.log`.

## Prerequisites on the box

1. **Room.** `df -h /` shows at least 10 GB free. `sudo docker network ls` lists `web`, Caddy's network.
2. **The directory and the key.** Ship once (see "Release" below) to create `~/apps/arena-ranking/`, then:

   ```bash
   cd ~/apps/arena-ranking
   umask 077 && cat > riot.key        # paste the key, Enter, Ctrl-D
   chmod 600 riot.key && ls -l riot.key
   ```

3. **The env.** `cp .env.example .env && chmod 600 .env`, then fill it with `nano .env`:
   - `APP_UID` and `APP_GID`: `id -u` and `id -g` (the owner of `riot.key`).
   - `POSTGRES_PASSWORD`, `REDIS_PASSWORD`: `openssl rand -hex 32` each.
   - `DASHBOARD_USER`, `DASHBOARD_PASS`: for the queue dashboard.
   - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`: an R2 token scoped to Object Read & Write on the bucket.
   - Leave `IMAGE_TAG` and `PREVIOUS_IMAGE_TAG` empty: the deploy writes them.

## Release: build, ship, deploy

```bash
# Mac, from the repo root, on a clean tree
pnpm images:build                                  # arena-ranking-{api,worker,web}:<short sha>, linux/arm64
pnpm stack:smoke                                   # optional: the same images, run locally as the box would
export BOX=ubuntu@<box-ip> SSH_KEY=<key path>      # never committed
bash deploy/stack/bin/ship.sh <tag>                # files to ~/apps/arena-ranking, images into the box's Docker
# box
cd ~/apps/arena-ranking && bash bin/deploy.sh <tag>   # --first on the very first deploy
```

- `build-images.sh [<tag>]` builds the three images for `linux/arm64` and checks each is arm64 and runs as a non-root user. The tag is the short commit SHA, with `-dirty` on a dirty tree.
- `ship.sh <tag> [--dry-run]` refuses a `-dirty` tag. It tars `deploy/stack/` without `.env`, `riot.key`, `state/` and `test/` into `~/apps/arena-ranking/` over SSH, then copies the images with `docker save`, `scp` and `docker load`. `BOX` and `SSH_KEY` come from your shell. `--dry-run` lists the files and prints the commands without touching the box.
- `deploy.sh <tag> [--first]`, on the box, in order:
  1. Checks `.env` exists and `riot.key` is there with mode 600.
  2. A premigrate dump to R2, `premigrate/<tag>.dump.gz` (skipped with `--first`: there is no database yet). If it fails, the deploy stops and nothing has changed.
  3. Writes `.env.next` with `IMAGE_TAG=<tag>`. `PREVIOUS_IMAGE_TAG` takes the old `IMAGE_TAG` only when the tag changes.
  4. Runs `migrate` against `.env.next`. If it fails, `.env.next` is deleted and `.env` is unchanged.
  5. `.env.next` becomes `.env`, then `up -d --remove-orphans`.
  6. Waits up to 90 s for web, api and worker to be healthy, then prints `docker compose ps`.
  7. Removes every `arena-ranking-*` image tag that is neither current nor previous.

Never run `docker system prune`, `image prune` or `builder prune` on the box: other projects' images and build cache live there.

## Caddy

Append `deploy/stack/caddy/arena-ranking.caddy` to `~/apps/caddy/Caddyfile`. Fill in the stand-in hostname, a user, and the hash from `sudo docker exec caddy caddy hash-password --plaintext '<password>'`. Edit the file in place (`nano`), never by rename: the file is bind-mounted alone, and a rename leaves Caddy reading the old inode. Then `sudo docker exec caddy caddy reload --config /etc/caddy/Caddyfile`.

The block puts the whole site behind basic auth. Riot forbids public consumption on a development or personal key, so the `basic_auth` block stays until Riot grants a production key; removing it is a separate step after that. The block also answers 404 for `/api/ops/*`, so the queue dashboard is reached only through the tunnel.

## Health checks after a deploy

1. On the box: `sudo docker compose ps` shows web, api, worker, postgres and redis `healthy`.
2. From the Mac, open the tunnel to the API's loopback port:

   ```bash
   ssh -i "$SSH_KEY" -N -L 3301:127.0.0.1:3301 "$BOX"
   ```

3. `curl -s localhost:3301/api/health` shows `process.status` `ok`, `ops.riotKey` `ok`, and the queue depths ([ops.md](ops.md)).
4. `http://localhost:3301/api/ops/queues` in a browser opens the queue dashboard, with `DASHBOARD_USER` and `DASHBOARD_PASS`.
5. `https://<hostname>/` asks for the Caddy basic auth, then shows the home page with the Riot disclaimer in the footer.
6. Search a known Riot ID; the profile fills in within seconds.

## Riot key rotation

A development key expires daily. Replace the file's contents in place, from the Mac:

```bash
pbpaste | ssh -i "$SSH_KEY" "$BOX" 'cat > ~/apps/arena-ranking/riot.key'
```

`cat >` keeps the file's inode, mode and owner, so the containers' read-only mount sees the new key. No restart: while the old key was rejected, the worker's probe resumes the queue within a minute ([ops.md](ops.md)).

## Rollback

```bash
cd ~/apps/arena-ranking && bash bin/rollback.sh
```

It swaps `IMAGE_TAG` and `PREVIOUS_IMAGE_TAG` in `.env`, brings web, api and worker up on the previous images and waits for them to be healthy. It never touches the database. Migrations are forward-only, so when the release being left changed the schema, restore `premigrate/<that tag>.dump.gz` (below), then roll back.

## Backups

Nightly at 03:00 UTC, `bin/backup.sh`:

1. Runs `pg_dump -Fc` in the postgres container and gzips it into `state/backup/`.
2. Checks the file is not empty and that `gzip -t` passes.
3. Has the one-shot `backup` container (rclone) copy it to `r2:$R2_BUCKET/nightly/<YYYY-MM-DD>T<HHMM>Z.dump.gz`.
4. Checks the remote size matches the local one.
5. Deletes nightly dumps older than 31 days, which keeps 30.
6. Writes `state/backup.last` (`<iso> ok <object> <bytes>`) and removes the local file.

A failure at any step writes `<iso> fail <step>` to `state/backup.last` and exits 1. The R2 credentials reach rclone only as the backup service's environment, never on a command line.

Install the cron line once, with `crontab -e`, beside the lines already there (`deploy/stack/backup.cron`):

```
0 3 * * * cd "$HOME/apps/arena-ranking" && bash bin/backup.sh >> state/backup.cron.log 2>&1
```

Check it the next morning: `cat ~/apps/arena-ranking/state/backup.last`. List the dumps:

```bash
cd ~/apps/arena-ranking
sudo docker compose --profile ops run --rm -T backup lsl r2:arena-ranking-backups/nightly
```

## Restore

Restoring replaces the live database. On the box:

```bash
cd ~/apps/arena-ranking
sudo docker compose up -d --wait postgres                  # on a fresh box, or if it is down
bash bin/restore.sh nightly/<name>.dump.gz                 # stops web, api, worker; drop, create, pg_restore
sudo docker compose --profile ops run --rm -T migrate      # "migrate: up to date", or applies what the dump predates
sudo docker compose up -d
```

`bin/restore.sh` downloads the object through the backup container, checks it with `gzip -t`, drops and recreates the `arena` database and restores into it. It leaves web, api and worker stopped. Redis needs no restore: the queues refill from the sweep and the schedules.

On the Mac, `pnpm stack:restore-test` tests the whole path. A local directory stands in for R2. It migrates a source database and adds a sentinel row, then runs `bin/backup.sh`. It starts a fresh Postgres container, restores the dump into it with `bin/restore.sh`, and requires the migrator to print `migrate: up to date` and the sentinel row to be there.

## Local checks

| Command | What it proves |
| --- | --- |
| `pnpm images:build` | The three images build for `linux/arm64` and run as non-root |
| `pnpm stack:smoke` | The compose file passes `deploy/stack/test/check-compose.mjs` (budget, limits, healthchecks, log caps, networks, the key mount). The stack comes up with a throwaway `.env` and `riot.key`, with the fake upstream as a service (`test/compose.smoke.yml`), on a local `web` network created if missing. api and worker read the key, no container runs as root, `/api/health` answers ok through web's rewrite, the home page renders, and everything comes down, volumes included |
| `pnpm stack:restore-test` | A backup restores into a fresh container and the migrator finds nothing pending |
| `shellcheck deploy/stack/bin/*.sh` | The scripts lint clean |
