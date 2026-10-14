# RoadAssist Bharat on a free India-region server (Oracle Cloud)

> **Status: prepared, not live.** The live site is still Render + Neon in
> Singapore. Nothing here changes it until you switch the DNS record in step f,
> and step h switches it back.

This kit moves the whole platform (the app **and** its database) onto one
**Oracle Cloud Infrastructure (OCI) Always Free** virtual machine in **Mumbai
or Hyderabad**, for free. Caddy on the same machine serves HTTPS with a free
Let's Encrypt certificate.

| | Today | With this kit |
|---|---|---|
| App | Render free plan, Singapore (sleeps when idle) | OCI Ampere A1 VM, India (does not sleep) |
| Database | Neon free plan, Singapore | PostgreSQL 16 + PostGIS 3.4 **on the same VM**, India |
| HTTPS | Render's edge | Caddy + Let's Encrypt on the VM |
| Backups | Neon's | A verified `pg_dump` every night on the VM, last 7 kept; **you** copy them off the VM |

**Why the database is on the VM:** Neon's free plan has no India region (its
list is US East 1/2, US West 2, Singapore, Sydney, Frankfurt, London, São
Paulo). Supabase does offer Mumbai for free, but it pauses idle free projects
and caps them at 500 MB; a database beside the app has neither limit.

## What this setup is, and is not

Read this before you rely on it.

- **One machine.** No replica, no failover, no load balancer. If the VM stops,
  the site is down until it starts again.
- **No managed backups.** The VM dumps the database every night (02:30 IST),
  restores each dump into a scratch database to check it, and keeps the last
  7. Those dumps live **on the same VM**: if the VM's disk is lost, they are
  lost with it. Copying one off the VM regularly ([Backups](#backups)) is your
  job, and the only protection against losing the machine.
- **Oracle may stop an idle Always Free VM.** Oracle's docs: an Always Free
  instance may be reclaimed when, over 7 days, its 95th-percentile CPU is
  under 20%, network under 20% and (A1 only) memory under 20%. A small demo
  is under all three. **Keep the UptimeRobot monitor**: it does not change
  those numbers, but it tells you within minutes when the site goes down, and
  you start the VM again (Compute → Instances → roadassist → **Start**; the
  disk, database and public IP survive a stop). Upgrading the account to Pay
  As You Go is widely reported to avoid reclamation while Always Free
  resources stay free, but Oracle's current page does not say so, and a paid
  account bills anything beyond the free limits.
- **Ampere capacity in Mumbai/Hyderabad is sometimes exhausted** ("Out of
  capacity" / "Out of host capacity" when creating the VM). Retry later (other
  times of day), try a smaller shape (1 OCPU / 6 GB is plenty for this app), or
  pick another fault domain. You can only create Always Free VMs in your
  **home region**, which you choose once at sign-up and cannot change: pick
  Mumbai or Hyderabad then.
- **Free limits today** (Oracle's Always Free page, checked 13 Oct 2026):
  Ampere A1 **1,500 OCPU-hours and 9,000 GB-hours a month = 2 OCPUs and 12 GB
  RAM** in total (older guides say 4 OCPUs / 24 GB; that was halved), 200 GB of
  block storage including boot disks, 5 volume backups, 10 TB/month outbound.
- **Sign-up needs a card** for identity verification. Always Free resources are
  not charged. Do not click "Upgrade" unless you mean to.
- What still leaves India: the email alerts (Resend, USA), the map and weather
  look-ups, and Telegram if you turn it on, exactly as today
  (`app/scripts/check-data-residency.mjs` declares each).

## The files

| File | What it is |
|---|---|
| `cloud-init.yaml` | Paste into OCI when creating the VM. **Generated** from the four files below by `build-cloud-init.mjs`; never edit it by hand. |
| `compose.yml` | The stack: `db`, `app`, `caddy`, `backup`, `db-grants` |
| `Caddyfile` | HTTPS for the site name; strips client-supplied address headers |
| `db-init/10-roadassist-roles.sh` | First start of the database only: the owner and app roles |
| `bootstrap.sh` | First boot of the VM: host firewall, Docker, the repository clone |
| `env.example` | Every setting, placeholders only. Becomes `/opt/roadassist/.env` |
| `migrate-db.sh`, `migrate-db.md` | Copy Neon into the VM's database and prove it |

How the pieces fit: Caddy (ports 80/443, the only thing reachable from the
internet) → app on `edge` network → database on `data`, an **internal** Docker
network with no host port and no route out. The app connects as
`roadassist_app` (rows only); migrations run as `roadassist_owner` through
`MIGRATION_DATABASE_URL`, which `docker-start.sh` unsets before the API starts,
exactly as on Render. The superuser is used only for first-start setup and
backups.

The client address: there is no Cloudflare in front of this VM, so
`CLIENT_IP_HEADER` is **empty** (Render's `cf-connecting-ip` would let any
caller pick their own address here) and Caddy strips that header anyway.
Caddy replaces any `X-Forwarded-For` a caller sends with the address that
really connected, and the app trusts that header only from Caddy's fixed
address (`TRUST_PROXY=172.30.53.10`). Tested: a request carrying forged
`X-Forwarded-For`, `CF-Connecting-IP`, `X-Real-IP` and `True-Client-IP`
reached the backend with only Caddy's own values.

---

## Before you start

1. **Commit and push this kit to `main`.** Two things depend on it: the VM
   clones the repository at first boot (it needs `least-privilege-role.sql`,
   `backup.sh` and `migrate-db.sh` from it), and the push runs the image
   workflow, which now builds for **arm64** as well as amd64.
2. **Wait for the image workflow** (GitHub → Actions → *publish image*) to go
   green, then check the image has an arm64 build. On any PC with Docker:
   ```bash
   docker manifest inspect ghcr.io/saatwik-1157/roadassist-bharat:latest | grep architecture
   ```
   It must list `arm64`. Today it lists only `amd64`, and an amd64-only image
   will not start on the Ampere VM.
3. Have these ready: the **Neon owner's direct connection string** (Neon →
   project → Connect → role `neondb_owner`, *Connection pooling* **off**), and
   from Render (roadassist → Environment, eye icon on each): `JWT_SECRET`,
   `EMAIL_API_KEY`, `ALERT_EMAIL_TO`, `EMAIL_SIGNIN`, and the three
   `TELEGRAM_*` values if Render has them.

## a · The database: nothing to create

There is no database service to sign up for. It is the `db` container on the
VM, created on first start by `db-init/10-roadassist-roles.sh` with three
roles (`postgres` superuser, `roadassist_owner`, `roadassist_app`) and the
PostGIS and pgcrypto extensions. You give it three passwords in step c.

## b · The Oracle Cloud account and the VM

**Account** (about 15 minutes):

1. Go to **oracle.com/cloud/free** → **Start for free**.
2. Country **India**, your name and email → verify the email.
3. Password, a **Cloud Account Name** (any short name, e.g. `roadassist`).
4. **Home Region: `India West (Mumbai)` or `India South (Hyderabad)`.**
   This is permanent, and Always Free VMs can only be created here.
5. Address and phone, then **card verification**. Oracle places a small
   temporary hold and releases it. Debit/RuPay/prepaid cards are often
   refused; a credit card usually works.
6. Wait for the "account is ready" email, then sign in.

**The VM** (Console, top-left ☰ menu):

1. ☰ → **Compute** → **Instances** → **Create instance**.
2. **Name**: `roadassist`. **Placement**: leave the availability domain as it
   is (Mumbai and Hyderabad each have one).
3. **Image and shape** → **Edit**:
   - **Change shape** → **Ampere** → tick **VM.Standard.A1.Flex** → OCPUs
     **2**, Memory **12 GB** (or 1 and 6; both show *Always Free-eligible*) →
     **Select shape**.
   - **Change image** → **Canonical Ubuntu** → **24.04** (the build shown for
     Ampere is aarch64) → **Select image**.
4. **Networking**: *Create new virtual cloud network* and *Create new public
   subnet* (the defaults), and **Automatically assign public IPv4 address:
   on**.
5. **Add SSH keys**: **Generate a key pair for me** → **Save private key**.
   Keep this file safe; it is the only way in.
6. **Boot volume**: leave the default size (about 47 GB; the free allowance is
   200 GB).
7. Scroll down → **Show advanced options** → **Management** →
   **Initialization script** → **Paste cloud-init script** → paste the
   **whole** of [`cloud-init.yaml`](cloud-init.yaml).
8. **Create**. When the state is **Running**, copy the **Public IP address**
   from the instance page. Below it is called `<VM-IP>`.

If it says **Out of capacity**: see the capacity note at the top. Nothing was
created, so just try again later or with 1 OCPU / 6 GB.

**Open ports 80 and 443 in the cloud firewall.** OCI has two firewalls: the
VM's own (cloud-init opens it) and the network's **security list** (you open
it here):

1. On the instance page → **Primary VNIC** → click the **Subnet** name.
2. **Security** (or **Security Lists**) → **Default Security List for …**.
3. **Add Ingress Rules**: Source CIDR `0.0.0.0/0`, IP Protocol **TCP**,
   Destination Port Range `80` → **Add Ingress Rules**.
4. Again for TCP `443`. (Optional: UDP `443` for HTTP/3.)

Leave the existing rule for port 22 (SSH). To be stricter, change its source
from `0.0.0.0/0` to your own IP address.

## c · SSH in and write `.env`

From Windows PowerShell (in the folder with the key you saved):

```powershell
icacls .\ssh-key-*.key /inheritance:r /grant:r "$($env:USERNAME):(R)"
ssh -i .\ssh-key-*.key ubuntu@<VM-IP>
```

(`icacls` fixes the key file's permissions, which Windows' ssh otherwise
refuses. On Oracle Linux the user is `opc`, not `ubuntu`.)

On the VM, wait for the first-boot setup and check it finished:

```bash
cloud-init status --wait          # prints "status: done"
sudo tail -n 5 /var/log/roadassist-bootstrap.log   # ends "=== done ..."
sudo docker version               # Server ... Arch: arm64
```

Create `.env` from the example and fill in the three database passwords with
long random values (this must happen **before** the database first starts;
they are read once):

```bash
sudo cp /opt/roadassist/repo/deploy/oci-india/env.example /opt/roadassist/.env
sudo chmod 600 /opt/roadassist/.env
for v in POSTGRES_PASSWORD DB_OWNER_PASSWORD DB_APP_PASSWORD; do
  sudo sed -i "s|^$v=.*|$v=$(openssl rand -hex 32)|" /opt/roadassist/.env
done
sudo nano /opt/roadassist/.env
```

In nano, replace each `<copy ... from Render>` with the value from Render
(or delete the placeholder to leave it empty). Save with **Ctrl+O**, **Enter**,
**Ctrl+X**. Then check nothing is left:

```bash
sudo grep -nE '<copy|<openssl' /opt/roadassist/.env   # must print nothing
```

## d · Copy the database (rehearsal)

Render stays live during this. Follow [`migrate-db.md`](migrate-db.md), "Run
it": start only the database, run `migrate-db.sh`, and look for **MATCH**.

## e · Test before switching DNS

A Let's Encrypt certificate for `app.roadassistbharat.online` can only be
issued once that name points at the VM, so it cannot be tested over HTTPS
before the switch. Test the same server under a temporary name instead:

1. **Hostinger** → **Domains** → `roadassistbharat.online` → **DNS /
   Nameservers** → **DNS records** → add: Type **A**, Name `precheck`, Points
   to `<VM-IP>`, TTL `300`. Do not touch any other record.
2. On the VM (`.env` already has `SITE_ADDRESSES=precheck.roadassistbharat.online`):
   ```bash
   cd /opt/roadassist
   sudo docker compose up -d
   sudo docker compose ps -a
   ```
   Expect `db`, `app` and `caddy` **healthy**, `backup` running, `db-grants`
   **exited (0)**. The app log should read `→ migrating (as the migration role
   in MIGRATION_DATABASE_URL)` and `→ starting api`:
   `sudo docker compose logs app | grep '→'`.
3. From your PC. `--resolve` sends the request straight to the VM, so a stale
   DNS cache on your PC cannot fool the test:
   ```bash
   curl --resolve precheck.roadassistbharat.online:443:<VM-IP> https://precheck.roadassistbharat.online/health
   ```
   It must print `"database":"ok"`. (If it fails with a certificate error,
   give Caddy a minute: `sudo docker compose logs caddy | grep -i certificate`.)
4. The full deployment check, from `app/` in your clone:
   ```bash
   node scripts/verify-deployment.mjs https://precheck.roadassistbharat.online
   ```
5. Open `https://precheck.roadassistbharat.online/app.html` in a browser and
   try a sign-in with a demo number. Anything written here is discarded by the
   cut-over copy in step f.

## f · Switch (the cut-over)

At a quiet time (for example 02:00 to 04:00 IST). Expect 10 to 20 minutes of
downtime.

1. **Render** → roadassist → **Settings** → **Suspend Web Service**. Nothing
   writes to Neon from now on.
2. On the VM, the final copy (it must say **MATCH**):
   ```bash
   cd /opt/roadassist
   sudo docker compose stop app
   read -rs SOURCE_DATABASE_URL && export SOURCE_DATABASE_URL
   sudo -E REPLACE_TARGET=1 /opt/roadassist/repo/deploy/oci-india/migrate-db.sh
   unset SOURCE_DATABASE_URL
   ```
3. Serve the real name, and start everything:
   ```bash
   sudo sed -i 's/^SITE_ADDRESSES=.*/SITE_ADDRESSES=app.roadassistbharat.online/' /opt/roadassist/.env
   sudo docker compose up -d
   ```
4. **Hostinger** → DNS records: write down the `app` CNAME's target
   (`roadassist-u6ba.onrender.com`; you need it to roll back), **delete** that
   CNAME, then **add**: Type **A**, Name `app`, Points to `<VM-IP>`, TTL
   `300`. Leave every other record alone: the four `A` records and the `www`
   CNAME keep the showcase on GitHub Pages, and the `send` records keep email
   working.
5. Watch Caddy get the certificate (usually within a minute or two of the
   record changing):
   ```bash
   sudo docker compose logs -f caddy | grep -i -E 'certificate|error'
   ```
   Ctrl+C stops watching. If it keeps failing after 10 minutes,
   `sudo docker compose restart caddy` makes it try again at once.
6. From your PC, even before your own DNS has caught up:
   ```bash
   curl --resolve app.roadassistbharat.online:443:<VM-IP> https://app.roadassistbharat.online/health
   ```
7. Delete the `precheck` A record at Hostinger.

## g · Check it

From `app/` in your clone:

```bash
node scripts/verify-deployment.mjs https://app.roadassistbharat.online
```

It must pass as it did for Render (the HSTS warning should now be gone: the
app sees `https` from Caddy). Then:

- `nslookup app.roadassistbharat.online 8.8.8.8` shows `<VM-IP>`.
- **UptimeRobot**: keep the monitor on `https://app.roadassistbharat.online/health`.
  It now watches the VM.
- The showcase (`pages/live.json`) and the GitHub `keep-awake` workflow use the
  same name and need no change. The VM never sleeps, so keep-awake is no
  longer needed, but it is harmless.
- `sudo docker compose logs backup` shows a `verified:` line.

## h · Roll back

1. **Hostinger** → DNS records: delete the `app` **A** record, add back
   Type **CNAME**, Name `app`, Target `roadassist-u6ba.onrender.com`, TTL `300`.
2. **Render** → roadassist → **Resume Web Service**. Render still has the
   custom domain and reissues its certificate by itself.
3. Optionally stop the VM's stack: `cd /opt/roadassist && sudo docker compose stop`.

Neon is exactly as it was at the cut-over. Anything written on the VM after the
cut-over is **not** in Neon (it stays on the VM and in its backups).

---

## Backups

- **What runs:** the `backup` service (`app/scripts/backup.sh`, the same
  script `app/docker-compose.prod.yml` uses): a dump at start and every night
  at 21:00 UTC (02:30 IST), each restored into a scratch database and checked
  (audit-log rows, the append-only rules) before older dumps are pruned. The
  last 7 daily dumps are kept, in `/opt/roadassist/backups` (root only: they
  hold personal data).
- **See them:** `sudo ls -lt /opt/roadassist/backups` and
  `sudo docker compose logs backup | tail`.
- **Copy one off the VM (free)**, say weekly, and after any change you care
  about. On the VM:
  ```bash
  f=$(sudo ls -1t /opt/roadassist/backups/*.dump | head -1)
  sudo install -m 600 -o ubuntu "$f" ~/latest.dump
  ```
  then on your PC:
  ```powershell
  scp -i .\ssh-key-*.key ubuntu@<VM-IP>:latest.dump .\roadassist-backup.dump
  ```
  and back on the VM: `rm ~/latest.dump`. Keep the file somewhere private.
  It holds phone numbers and positions; a personal cloud drive may store it
  outside India.
- **A whole-disk copy inside OCI (also free):** ☰ → **Storage** → **Block
  Storage** → **Boot Volumes** → the `roadassist` boot volume → **Boot volume
  backups** → **Create boot volume backup**. Always Free includes 5 volume
  backups. This protects against a broken VM, not against losing the account.
- **Restore a dump** (on the VM). `migrate-db.sh` restores one of these as
  well: as `roadassist_owner`, in one transaction, then it re-applies the app
  role's grants and prints the row counts.
  ```bash
  cd /opt/roadassist
  sudo docker compose stop app
  sudo SOURCE_DUMP=/opt/roadassist/backups/<file>.dump REPLACE_TARGET=1 /opt/roadassist/repo/deploy/oci-india/migrate-db.sh
  sudo docker compose up -d
  ```
  A dump you copied back from your PC: put it under `/opt/roadassist/backups/`
  first (`scp` it to the VM, then `sudo mv`).

## Updating the app

Render redeployed on every push; the VM updates when you tell it to:

```bash
cd /opt/roadassist
sudo git -C repo pull --ff-only
sudo docker compose pull
sudo docker compose up -d
```

If `compose.yml` or `Caddyfile` changed in the repository, copy them in first:
`sudo cp repo/deploy/oci-india/compose.yml repo/deploy/oci-india/Caddyfile .`
To pin a build, set `IMAGE_TAG=sha-<short-sha>` in `.env`.

## Changing a database password

The three passwords in `.env` are read only when the database is first
created. To change one later, change it in the database **and** in `.env`:

```bash
cd /opt/roadassist
sudo docker compose exec db psql -U postgres -d roadassist -c "ALTER ROLE roadassist_app WITH PASSWORD '<new hex value>'"
sudo nano .env            # set DB_APP_PASSWORD to the same value
sudo docker compose up -d
```

(Same for `roadassist_owner` / `DB_OWNER_PASSWORD`, and `postgres` /
`POSTGRES_PASSWORD`.)

## Changing this kit

Edit `compose.yml`, `Caddyfile`, `db-init/10-roadassist-roles.sh` or
`bootstrap.sh`, then regenerate `cloud-init.yaml`:

```bash
node deploy/oci-india/build-cloud-init.mjs          # rewrite
node deploy/oci-india/build-cloud-init.mjs --check  # verify it is current
```

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `curl` to the VM times out | The security-list rule (step b) is missing, or cloud-init has not finished (`cloud-init status`) |
| `app` keeps restarting, log says `exec format error` or `no matching manifest` | The image has no arm64 build yet ("Before you start", 2) |
| `app` unhealthy, log mentions `password authentication failed` | `.env` passwords changed after the database was created (see "Changing a database password") |
| Caddy logs `NXDOMAIN` or `unauthorized` for the certificate | The DNS record does not point at the VM yet; wait for the TTL, then `sudo docker compose restart caddy` |
| `migrate-db.sh` says the app is running | `sudo docker compose stop app` first; it refuses on purpose |
| The site was fine, now nothing answers | Oracle may have stopped the VM as idle: Console → Instances → **Start** |
