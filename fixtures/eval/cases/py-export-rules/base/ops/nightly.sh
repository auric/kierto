#!/bin/sh
# Runs on the batch host each night. The finance import reads the file at 02:00.
set -eu
cd /srv/accounts-service
python -m app.cli export --out /var/exports/accounts.csv
