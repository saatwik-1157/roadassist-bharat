# Running RoadAssist on AWS (free plan)

An alternative to Render, for when the free Render service's sleep or limits
get in the way. The app is the **same Docker image** Render runs
(`ghcr.io/saatwik-1157/roadassist-bharat:latest`, public), on one EC2
instance, behind the same Cloudflare proxy, against the **same Neon
database**. Nothing about the application changes; only where it runs.

Keep Render configured while you try this: switching back is one DNS edit
(step 7).

## What it costs

New AWS accounts (since 15 July 2025) can choose the **Free plan**: up to
US$200 in credits (US$100 at sign-up, up to US$100 more for trying services),
valid for **6 months or until the credits run out**. At the end you must
upgrade to a paid plan or AWS closes the account — put a reminder in your
calendar for month 5.

| Item | Approx. per month (Singapore) |
|---|---|
| EC2 `t3.micro` running all month | ~US$10 |
| Public IPv4 address | ~US$3.60 |
| 8 GB gp3 disk | ~US$0.80 |
| **Total** | **~US$14 → about 7 months of US$100 credits** |

Neon and Cloudflare stay on their free plans.

## Steps (in the AWS console)

1. **Create the account** at aws.amazon.com and choose the **Free plan** when
   asked. AWS asks for a card for verification; on the Free plan you are not
   charged. Turn on MFA for the root user, then create a budget alert
   (Billing → Budgets → "Zero spend budget").
2. **Pick the region** `Asia Pacific (Singapore) ap-southeast-1` (top right).
   Neon and Render are both in Singapore, so the database stays close.
3. **Launch the instance** (EC2 → Launch instance):
   - Name `roadassist`, image **Amazon Linux 2023**, type **t3.micro**.
   - Key pair: *Proceed without a key pair* (you will use EC2 Instance Connect).
   - Network: allow **HTTPS** and **HTTP** from the internet. Leave SSH open
     only if you want Instance Connect (it needs port 22).
   - Storage: 8 GiB gp3.
   - Advanced details → **User data**: paste the whole of
     [`user-data.sh`](user-data.sh).
   - Launch. Note the instance's **Public IPv4 address**.
4. **Give it a fixed address**: EC2 → Elastic IPs → Allocate → Associate
   with the `roadassist` instance. Use this IP from now on.
5. **Add the environment and start it**: select the instance → Connect →
   **EC2 Instance Connect** → Connect. In the browser terminal:
   ```bash
   sudo nano /opt/roadassist/.env
   ```
   Paste [`env.example`](env.example), fill the six secret values by copying
   them from Render (roadassist → Environment → the eye icon on each), save
   (Ctrl+O, Enter, Ctrl+X), then:
   ```bash
   cd /opt/roadassist && sudo docker compose up -d && sudo docker compose logs -f app
   ```
   Wait for the server to report it is listening (Ctrl+C stops following the
   log, not the app).
6. **Test before switching**: from your PC,
   ```bash
   curl -k --resolve app.roadassistbharat.online:443:<ELASTIC_IP> https://app.roadassistbharat.online/health
   ```
   It must print `"database":"ok"`.
7. **Switch the domain** (Cloudflare → roadassistbharat.online → DNS):
   change the `app` record from the Render CNAME to an **A record → your
   Elastic IP**, keep it **Proxied** (orange cloud), and make sure SSL/TLS
   mode is **Full** (not Flexible, not Strict — the origin uses Caddy's own
   certificate). To go back to Render, put the old CNAME back.
8. **Check**: `node app/scripts/verify-deployment.mjs https://app.roadassistbharat.online`
   from `app/` must pass, as it does for Render.

## Updating

Render redeploys on every push. On EC2, pull the new image when you want it:

```bash
cd /opt/roadassist && sudo docker compose pull && sudo docker compose up -d
```

## Notes

- `docker-start.sh` runs the migrations with `MIGRATION_DATABASE_URL` and
  then drops it, exactly as on Render.
- Uploaded hazard photos are kept in the database (`PHOTO_STORE` defaults to
  `db` outside development), so the `uploads` volume only matters if you set
  `PHOTO_STORE=disk`.
- The instance never sleeps, so the UptimeRobot monitor becomes an uptime
  alarm rather than a keep-awake.
