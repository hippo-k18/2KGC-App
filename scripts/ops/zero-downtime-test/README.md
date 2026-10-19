# Zero-downtime deploy test (T272)

A stand-in for the droplet in Docker: Ubuntu 20.04, systemd, Apache 2.4.41
(event MPM), Node 22, limited to 1 CPU and 2 GB like the droplet. It never
touches the real droplet.

- `fixture.sh` builds the layout the droplet has before T272: a git origin,
  `/opt/kgc/app`, vhosts proxying to `127.0.0.1:3200` / `:3100` in the same
  shapes as the live ones, the old `kgc-staging` / `kgc-dashboard` units, the
  CFP cron, and a first release put live by the **old** script
  (`old-deploy.sh`, a copy of the live `/opt/kgc/deploy.sh` taken 2026-10-18).
  The two apps are minimal Next.js 15.5.27 apps whose routes answer with their
  release, plus a 2-second `/slow` route to catch requests cut off mid-flight.
- `scenario.sh` runs every step under `poll.mjs` (100 ms polling of both sites
  through Apache, one new connection per request and one kept alive, plus
  `/slow`): A old script deploy (baseline), B `setup`, C deploy both (first
  swap), D rollback, E restart, F CFP cron, G a release that cannot start,
  H deploy both again, I start from the enabled units only.

Run from `scripts/ops`:

```bash
docker build -t kgc-zdt zero-downtime-test
docker run -d --name kgc-zdt --cpus=1 --memory=2g --memory-swap=6g --privileged --cgroupns=host \
  -v /sys/fs/cgroup:/sys/fs/cgroup:rw --tmpfs /run --tmpfs /run/lock \
  -v "$PWD/zero-downtime-test:/test" -v "$PWD/droplet-deploy.sh:/test/new-deploy.sh:ro" kgc-zdt
docker exec kgc-zdt bash /test/fixture.sh
docker exec kgc-zdt bash /test/scenario.sh
docker rm -f kgc-zdt
```

The script reads three test-only variables, `KGC_PUBLIC_WEB`,
`KGC_PUBLIC_DASH` and `KGC_PUBLIC_ARCHIVE`, so its public checks hit the
container's Apache. On the droplet they are unset and the real URLs are used.
