# Render deployment

The root `render.yaml` provisions a Node web service, a background worker, and a
persistent PostgreSQL database in Singapore. These are paid resources. Review
Render's current total before creating the Blueprint. No Render API key is needed
in this repository. PostgreSQL external access is disabled; services connect over
Render's private network.

## Create the deployment

1. In Render, choose **New → Blueprint** and connect the GitHub account that can
   read `Appaaun/KPIPHosri`.
2. Select the repository and the branch containing `render.yaml` (initially
   `codex/render-online`). Keep the Blueprint path as `render.yaml`.
3. Review the three resources and their prices, then create the Blueprint.
4. Wait for `kpi-phosri-web` to become **Live**. Open its displayed HTTPS URL and
   append `/login`. Use Render's returned URL, rather than assuming a hostname.

The web pre-deploy command applies migrations and creates the organization and
department records. Demo users and results are disabled. The worker separately
applies pending migrations before starting. The database is new; local demo data
and passwords are not copied.

The web start command sets `APP_URL` and `NEXTAUTH_URL` from Render's
`RENDER_EXTERNAL_URL`, so authentication redirects and same-origin write checks
use the assigned HTTPS URL. Next reads Render's `PORT` automatically. If using a
custom domain later, change the start command to use that HTTPS origin for both
variables before redeploying.

## Create the first administrator

In the web service's **Environment** page, add these secret values:

- `ADMIN_EMAIL`: your administrator email.
- `ADMIN_USERNAME`: a username using 3–60 lowercase letters, digits, `.`, `_`, or `-`.
- `ADMIN_PASSWORD`: a unique password of 12–128 characters.

Save the environment changes and let Render deploy them. Open the web service's
**Shell** and run:

```sh
npm run admin:create
```

The command creates an administrator without printing its password. It does not
reset existing users and should be run once. Remove the three `ADMIN_*` variables
after successful creation and deploy the environment update. Sign in at `/login`
with the username and password you chose, then add departments, users, and KPIs.

Do not run demo seeding or smoke/browser tests against this deployment. The health
check at `/api/health` checks database connectivity. For a failed deployment, use
the failing service's build/deploy logs and redact credentials before sharing.

Review database backups, access policies, and the production role separation
described in [DEPLOYMENT.md](DEPLOYMENT.md) before using real organizational data.
