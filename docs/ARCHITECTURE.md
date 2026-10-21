# Architecture

Next.js server components enforce authenticated page entry and provide safe organization configuration. Client presentation calls same-origin APIs. Authenticated service functions derive department scope from the current database user on every request. Prisma's JS query engine uses the PostgreSQL driver adapter, with no external accelerator or AI service. Node 24 is the standard runtime.

PostgreSQL is the system of record. NextAuth issues an HTTP-only, SameSite Lax, eight-hour signed/encrypted session cookie; production requires HTTPS secure cookies. Local credentials are hashed with Argon2id. Role/active/department/session-version state is reloaded on requests. Password/role changes invalidate old sessions.

Manual/CSV drafts become SUBMITTED, then APPROVED/REJECTED. The approval transaction claims a version and state, creates the unique official period result, and appends an audit event. Unique constraints reject duplicate periods. The worker has a separate runtime, source-level advisory transaction locks and a heartbeat. It never replaces a manually approved result. Polling reads aggregate KPI storage only.

UI dictionaries/status labels live in shared code; other Thai labels currently live beside UI presentation. A future English locale can replace presentation strings without changing stored enums/codes. Root organization settings are read centrally; environment values provide bootstrap defaults.

Current boundaries favor a coherent intranet V1. Dashboard aggregation has an explicit 1,000-definition cap; replace with materialized/SQL summaries before exceeding it. Outbound integrations and patient records are excluded.
