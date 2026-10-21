# HIMPRO integration — disabled

There is no real HIMPRO SQL or database mapping in this repository. The `HimproAdapter` fails closed on fetch/connection attempts even if HIMPRO_ENABLED is set. Enabling the environment variable alone cannot make an unknown schema safe. No credentials or patient identifiers are seeded.

Before implementing it, obtain from the hospital's authorized database administrator:

- database engine/version, host/port/database and network access route;
- dedicated SELECT-only account and TLS verification/certificate requirements;
- actual schema/table/field documentation or anonymized schema (no patient extracts);
- each approved KPI's aggregate formula, inclusion/exclusion rules, time boundaries and timezone;
- actual refresh cadence, expected source volumes, query plans and agreed statement timeout.

Implement `KpiDataAdapter` in packages/shared/src/adapters.ts using the approved driver. Use bound parameters, a read-only account/transaction, server-side statement timeout and client cancellation. Return only aggregate numerator/denominator/value; never patient rows. Keep credentials in secure environment settings. Log counts/timing/outcome, never sensitive payloads. Test against an authorized nonproduction source before enabling a DataSource and associating its KPIs.

Pseudo-mapping (NOT real HIMPRO SQL): approved metric code → reviewed aggregate query identifier → parameterized period boundaries → aggregate numerator/denominator. No table/column names are supplied or inferred.

MockHisAdapter returns deterministic synthetic aggregates. Only explicitly enabled MOCK sources are processed automatically; manual demo records remain distinct. Pages always read PostgreSQL, never HIS.
