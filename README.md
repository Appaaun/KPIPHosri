# Hospital KPI Management System

ระบบติดตามตัวชี้วัดโรงพยาบาล — Thai-first KPI management for a hospital intranet. Organization name and timezone are configurable. All supplied KPI records are **synthetic demonstrations**, not official hospital indicators. No patient-level data is modeled.

## Requirements and quick start

Node.js 24 (22.12+ supported), npm 11, PostgreSQL 16, and Docker Compose v2 for the container workflow. npm workspaces and the committed lockfile keep all applications together.

```sh
npm ci
node scripts/local-env.mjs
# Review .env. Random local database credentials and AUTH_SECRET are created only when absent.
docker compose up -d postgres
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
# Separate terminal:
npm run worker:dev
```

The environment wrapper loads the root .env without overwriting exported variables, disables Next telemetry, and activates Prisma's supported JS engine. Database and worker processes must be restarted in new tasks. The web app listens on port 3000. Production cookies require HTTPS; use development mode for local HTTP.

## First administrator

Seed initializes departments/settings but **does not create a default user or password**. Set `ADMIN_EMAIL`, `ADMIN_USERNAME`, and a unique `ADMIN_PASSWORD` of at least 12 characters in your secure shell environment, then run:

```sh
npm run admin:create
```

Do not place secret values on a shared command line. `admin:create` creates a new administrator; it does not silently reset an existing account. Manage subsequent users at `/admin/users`; password resets invalidate existing sessions.

For an explicitly synthetic development demo only, set `SEED_DEMO_DATA=true`, `SEED_DEMO_USERS=true`, `DEMO_ADMIN_PASSWORD`, and `DEMO_USER_PASSWORD` in ignored `.env`, then `npm run db:seed`. Both passwords require 12+ characters. Missing passwords skip user creation. Existing accounts/passwords are preserved on repeat seed. Accounts:

| Account                      | Role             | Scope                       |
| ---------------------------- | ---------------- | --------------------------- |
| admin@example.local          | SUPER_ADMIN      | All                         |
| executive@example.local      | EXECUTIVE        | Approved aggregates, all    |
| quality@example.local        | QUALITY_ADMIN    | Catalog, aggregates, sync   |
| pharmacy.admin@example.local | DEPARTMENT_ADMIN | Pharmacy                    |
| pharmacy.entry@example.local | DATA_ENTRY       | Pharmacy                    |
| nursing.admin@example.local  | DEPARTMENT_ADMIN | Nursing                     |
| nursing.viewer@example.local | VIEWER           | Nursing approved aggregates |

Admin uses `DEMO_ADMIN_PASSWORD`; the others use `DEMO_USER_PASSWORD`. Username is the account prefix before `@`. The onboarding machine has locally generated random demo passwords in ignored `.env`; inspect that local file securely if using this demo. They are never embedded in source or saved cloud scripts.

## Docker

Review `.env`, set real production secrets and HTTPS `APP_URL`/`NEXTAUTH_URL`, and disable demo flags. Then:

```sh
docker compose up --build -d
# Explicit initial settings/departments seed:
docker compose run --rm web npm run db:seed
# With ADMIN_* securely exported into the container:
docker compose run --rm -e ADMIN_EMAIL -e ADMIN_USERNAME -e ADMIN_PASSWORD web npm run admin:create
```

Compose starts PostgreSQL, applies migrations in a one-shot service, then starts web and worker. Postgres is persistent, with a readiness check; no arbitrary startup sleep. Web is bound to loopback behind your HTTPS reverse proxy. See [deployment](docs/DEPLOYMENT.md).

## Verification

```sh
npm run db:generate
npm run db:migrate
npm run db:seed
npm run lint
npm run typecheck
npm test
npm run build
npm start
# Against the running server, with explicit demo users enabled:
npm run test:e2e
# Optional browser smoke (install browser first):
npm run test:browser
```

`test:e2e` performs real authentication, authorization attacks, entry/approval, CSV import, exports, and audit checks over HTTP. It creates synthetic workflow records and changes no passwords. It refuses to run without explicit demo setup. `test:browser` uses Playwright Chromium and a demo account; `npx playwright install chromium` installs the browser when network policy permits.

## Architecture and layout

- `apps/web`: Next.js App Router, Thai responsive UI, NextAuth local credentials, server API and service layer.
- `apps/worker`: independently scheduled Node/TypeScript worker, heartbeat, source sync, calculation, alerts.
- `packages/db`: PostgreSQL Prisma client, SQL migrations, deterministic synthetic seed.
- `packages/kpi-engine`: pure calculation, configurable target/warning evaluation and trends.
- `packages/shared`: roles, validation, department guards, CSV safety, adapter contracts.
- `docker`, `scripts`, `tests`, `docs`: deployment, operations, quality gates and design documentation.

Data flows from manual/CSV submission → approval transaction → official result → dashboard polling (45 seconds by default). Worker adapters write aggregate results into PostgreSQL; dashboards never query HIS. Manual approvals cannot be overwritten by the worker. Existing official periods are immutable through the web API; duplicate approval returns 409. Historical target snapshots preserve original evaluation.

## Security and limitations

Server-enforced department boundaries apply even when IDs are guessed. Disabled users/departments and changed roles/passwords are checked on every request. Use HTTPS, unique secrets, separate migration/runtime DB roles, backups, and a deployment security review before real use. Audit mutations are blocked by a DB trigger; privileged DB owners can still administer the database. This is a production-oriented V1, not a clinical safety certification.

HIMPRO is disabled and has **no invented table names or SQL**. A reviewed aggregate SELECT-only mapping, real schema, credentials, TLS and timeouts are required before implementing that adapter. CUSTOM calculation deliberately fails closed rather than evaluating arbitrary expressions. See [HIMPRO integration](docs/HIMPRO_INTEGRATION.md).

List APIs are bounded (25 KPIs/page, 100 recent submissions/users/alerts; 24 KPI history rows). Dashboard aggregation is capped at 1,000 active definitions and 12 recent results per KPI. Large installations need database aggregate queries/materialized summaries and additional list pagination. No patient drilldown, external notifications, PDF generator, arbitrary custom formulas, or historical official-result correction UI is included. Official result correction requires a future reviewed revision workflow; existing official results cannot silently change.
