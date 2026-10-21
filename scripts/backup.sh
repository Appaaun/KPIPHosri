#!/bin/sh
set -eu
: "${DATABASE_URL:?Set DATABASE_URL securely}"
umask 077
mkdir -p backups
pg_dump --dbname="$DATABASE_URL" --format=custom --file="backups/kpi-$(date -u +%Y%m%dT%H%M%SZ).dump"
