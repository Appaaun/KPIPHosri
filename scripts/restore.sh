#!/bin/sh
set -eu
: "${RESTORE_DATABASE_URL:?Set RESTORE_DATABASE_URL to an empty TEST database}"
: "${1:?Provide the backup file path}"
pg_restore --dbname="$RESTORE_DATABASE_URL" --no-owner --exit-on-error "$1"
