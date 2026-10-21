# KPI engine

Pure TypeScript, no React dependencies. DIRECT_VALUE rounds a finite input; PERCENTAGE computes n/d×100; RATE uses a configurable multiplier (default 1,000); RATIO computes n/d. Zero/negative/nonfinite denominator or overflow produces null/NO_DATA. CUSTOM is unsupported and fails closed; no eval or arbitrary SQL formulas.

GTE uses result ≥ target, with explicit lower warning boundary. LTE uses result ≤ target, with explicit upper warning boundary. BETWEEN includes both target endpoints and has independently configurable warning min/max. There is no universal target×0.9 rule. Finite values outside all configured bounds are RED; missing values are NO_DATA. Backend recalculation is authoritative. Trend reports numeric direction/delta, not universally beneficial direction (lower-is-better indicators can improve while declining).

Approval stores the current evaluated target snapshot. Later target changes do not rewrite historical statuses. Existing official periods cannot be silently replaced. UI colors always include status text/symbol. The engine tests exercise boundary inclusion, every mode, warning ranges, invalid numbers, zero division, rounding and trends.

Period dashboards and historical rows display the target and unit from the official result's saved snapshot, not a later catalog edit. The detail header separately identifies the current catalog target. Value trends and comparison arrows only compare the same unit, calculation mode, frequency and rate scale; incompatible historical results remain available in the history table. A browser workflow verifies that raising the catalog target after approval does not change the official result's original target or status.
