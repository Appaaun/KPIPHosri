# Database

PostgreSQL 16, Prisma 6.19.3 with the PostgreSQL driver adapter. UUID public IDs; immutable department code and IDs. Timestamps are UTC. KPI periods use explicit SQL DATE columns and UTC parsing independent of browser timezone. Organization display timezone defaults to Asia/Bangkok.

Models: OrganizationSettings, Department, User, KpiDefinition, KpiTarget, KpiSubmission, KpiResult, DataSource, SyncRun, Alert, AuditLog, WorkerHeartbeat, LoginAttempt. Foreign keys prevent removal of referenced departments/users/definitions; the UI uses soft deactivation. KpiTarget records timestamped target history. Official results retain the full target definition snapshot. Audit records contain safe action metadata; KPI changes preserve before/after definition JSON. Passwords/hashes are never captured in audits.

Official `(kpiId, periodStart, periodEnd)` and submission linkage are unique. Version/state claims avoid competing approval/submit transitions; transactions roll back the workflow state if a duplicate result conflicts. Migrations include SQL date constraints and append-only audit triggers. `npm run db:migrate` deploys checked-in Prisma migrations; never use production db push. `npm run db:seed` is idempotent and preserves existing users/results/configuration. Demo values are deterministic by KPI index/month and are labeled synthetic. Dates advance relative to seeding month.

Run `npm run db:generate` after schema changes; create/review a new migration with Prisma tooling and test against a disposable database. Keep the PostgreSQL driver and Prisma versions pinned together.
