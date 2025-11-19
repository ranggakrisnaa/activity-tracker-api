#!/bin/bash
set -e

echo "Initializing PostgreSQL Replica (Slave)..."

# Wait for primary to be ready
until pg_isready -h "$POSTGRES_MASTER_SERVICE_HOST" -p "$POSTGRES_MASTER_SERVICE_PORT" -U "$POSTGRES_USER"
do
  echo "Waiting for primary database to be ready..."
  sleep 2
done

echo "Primary is ready. Setting up replication..."

# Stop PostgreSQL temporarily
pg_ctl -D "$PGDATA" -m fast -w stop || true

# Clear data directory
rm -rf "$PGDATA"/*

# Create base backup from primary
PGPASSWORD="$POSTGRES_REPLICATION_PASSWORD" pg_basebackup \
    -h "$POSTGRES_MASTER_SERVICE_HOST" \
    -p "$POSTGRES_MASTER_SERVICE_PORT" \
    -U "$POSTGRES_REPLICATION_USER" \
    -D "$PGDATA" \
    -Fp -Xs -P -R

# Create standby signal file (for PostgreSQL 12+)
touch "$PGDATA/standby.signal"

# Determine replica slot name from environment variable
SLOT_NAME="replica_${REPLICA_ID}_slot"

echo "Using replication slot: $SLOT_NAME"

# Configure recovery settings
cat >> "$PGDATA/postgresql.auto.conf" <<EOF
primary_conninfo = 'host=$POSTGRES_MASTER_SERVICE_HOST port=$POSTGRES_MASTER_SERVICE_PORT user=$POSTGRES_REPLICATION_USER password=$POSTGRES_REPLICATION_PASSWORD'
primary_slot_name = '$SLOT_NAME'
restore_command = 'cp /var/lib/postgresql/data/pg_wal/%f %p'
max_connections = 200
EOF

# Copy custom replica configuration if exists
if [ -f "/etc/postgresql/postgresql.conf" ]; then
  cp /etc/postgresql/postgresql.conf "$PGDATA/postgresql.conf"
fi

echo "PostgreSQL Replica initialization completed!"

# Start PostgreSQL
pg_ctl -D "$PGDATA" -w start
