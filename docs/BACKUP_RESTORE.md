# Backup and restore

Use PostgreSQL 16 client tools and a securely supplied DATABASE_URL. `sh scripts/backup.sh` produces a permission-restricted custom-format dump under ignored backups/. Schedule daily and before every migration. Encrypt copies, keep an off-host copy with hospital retention controls, and monitor job failures. Do not store passwords in cron commands/logs.

Restore into a newly provisioned empty test database first: securely set RESTORE_DATABASE_URL, then `sh scripts/restore.sh backups/<file>.dump`. The script fails on any restore error and does not clean an existing database. Confirm migrations, table counts, login, department boundaries, dashboard results and audit history before scheduling a production restore. Record RPO/RTO and restoration evidence. Persist the PostgreSQL volume but do not treat a volume as a backup.
