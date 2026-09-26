# Nacre on AWS with Docker Compose

- `https://nacre.lol`: landing page and `/dashboard`
- `https://api.nacre.lol`: Bun API (`/health`, `/api/...`)
- Caddy manages HTTPS automatically; only ports 80 and 443 are published.
- The frontend proxy uses `http://api:3001` on Docker's private network.
- SQLite lives in the persistent `nacre_api_data` volume. Certificate data also
  lives in persistent volumes. Do not use `docker compose down --volumes`.
- No signing key is needed on the production host. Wallets sign in the browser.

## Host and DNS

Use an EC2 instance with at least 4 GB RAM (8 GB preferred for building Next.js),
Docker Engine and the Compose plugin. Associate an Elastic IP for stable DNS.
Allow TCP 80 and 443 publicly; restrict SSH to the deployment operator's IP.
Optional UDP 443 enables HTTP/3. Do not expose 3000 or 3001.

Set DNS A records `@` and `api` to the instance public IPv4; use a `www` CNAME to
`nacre.lol`. Remove parking records or stale AAAA records for these hostnames.
DNS must resolve to this instance for public HTTPS certificate issuance.

For the current instance (`3.108.133.250`), enter these records in Porkbun.
Porkbun represents the root domain with an empty Host field:

| Type | Host | Answer |
| --- | --- | --- |
| A | *(blank)* | `3.108.133.250` |
| A | `api` | `3.108.133.250` |
| CNAME | `www` | `nacre.lol` |

Use the default TTL. The SSH user is `ubuntu`; the application is in
`/opt/nacre`. Keep `nacre.pem` on your workstation, never in the repository or
Docker images. Run Compose commands on this host with `sudo`.

## Build and start

From the repository root:

```sh
cp deploy/production.env.example deploy/production.env
chmod 600 deploy/production.env
# Optionally configure BASE_SEPOLIA_RPC_URL in this file.
docker compose --env-file deploy/production.env build
docker compose --env-file deploy/production.env up -d
```

The containers restart after a reboot. The API seeds historical observations
when starting a new database. Import the existing database before starting if
you want to retain the current pools, position registrations, and archive state.

## Consistent database copy

On the local workstation, create a SQLite backup with its backup API (or
`VACUUM INTO`) while the app runs. Copy that snapshot to the host with SCP.
Never copy only the raw database file while WAL writes may be outstanding.

On the host, with the API stopped and the image already built:

```sh
docker compose stop frontend api
# Refuses to overwrite an existing production database.
docker compose run --rm --no-deps --user root \
  -v "$PWD/deploy/nacre-backup.sqlite:/import/nacre.sqlite:ro" \
  api sh -c 'test ! -e /data/nacre.sqlite && cp /import/nacre.sqlite /data/nacre.sqlite && chown bun:bun /data/nacre.sqlite'
docker compose --env-file deploy/production.env up -d
```

Do not overwrite live production data on later deployments. Back up the volume
before migrations. The public API rejects local sandbox mutation endpoints;
verified on-chain pool and LP position registration remain enabled.

## Verify and update

```sh
docker compose ps
curl --fail https://api.nacre.lol/health
curl --fail https://nacre.lol/api/workspace/bid-markets
docker compose logs --tail=100 api frontend caddy
```

Pull the reviewed commit and run the build/up commands again. Keep the prior
image tags and database backup available for rollback. A restart uses the same
persistent SQLite and certificate volumes.
