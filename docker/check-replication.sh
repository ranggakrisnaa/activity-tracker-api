#!/bin/bash
set -e

echo "Checking replication status..."
echo ""

echo "=== PostgreSQL Primary Status ==="
docker exec -it postgres-primary psql -U postgres -d activity_tracker -c "SELECT * FROM pg_stat_replication;"
echo ""

echo "=== PostgreSQL Replica 1 Status ==="
docker exec -it postgres-replica-1 psql -U postgres -d activity_tracker -c "SELECT pg_is_in_recovery();"
echo ""

echo "=== PostgreSQL Replica 2 Status ==="
docker exec -it postgres-replica-2 psql -U postgres -d activity_tracker -c "SELECT pg_is_in_recovery();"
echo ""

echo "=== Redis Replication Status ==="
docker exec -it redis-primary redis-cli -a redis123 INFO replication
echo ""

echo "=== Redis Sentinel Status ==="
docker exec -it redis-sentinel redis-cli -p 26379 SENTINEL masters
echo ""

echo "If pg_is_in_recovery() returns 't', the replica is working correctly!"
