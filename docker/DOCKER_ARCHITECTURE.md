# Docker Compose Architecture

## 📊 Services Overview

### PostgreSQL Cluster (Write/Read Separation)

- **Primary (Master)**: Port 5432 - Handles all WRITE operations
- **Replica 1**: Port 5433 - READ operations (load balanced)
- **Replica 2**: Port 5434 - READ operations (load balanced)

### Redis Cluster (Cache & Pub/Sub)

- **Primary**: Port 6379 - WRITE operations & Pub/Sub
- **Replica**: Port 6380 - READ operations
- **Sentinel**: Port 26379 - Automatic failover monitoring

### Application

- **API Server**: Port 3000 - Main application

### Management Tools

- **PgAdmin**: Port 5050 - PostgreSQL GUI
- **Redis Commander**: Port 8081 - Redis GUI

---

## 🚀 Quick Start

### 1. Start All Services

```bash
chmod +x docker/start.sh
./docker/start.sh
```

### 2. Check Replication Status

```bash
chmod +x docker/check-replication.sh
./docker/check-replication.sh
```

### 3. Stop All Services

```bash
chmod +x docker/stop.sh
./docker/stop.sh
```

---

## 🏗️ Architecture Features

### Database Sharding/Replication

- ✅ **Physical Replication**: Streaming replication from primary to replicas
- ✅ **Replication Slots**: Prevent WAL deletion before replicas consume them
- ✅ **Hot Standby**: Replicas accept read-only queries
- ✅ **Automatic Failover**: Can be configured with Patroni (future enhancement)

### Redis High Availability

- ✅ **Master-Slave Replication**: Async replication to replica
- ✅ **Sentinel Monitoring**: Automatic failover detection
- ✅ **Persistence**: AOF (Append-Only File) enabled
- ✅ **LRU Eviction**: Memory management with allkeys-lru policy

---

## 📝 Environment Variables

All environment variables are configured in `docker-compose.yml`:

### Database

- `DATABASE_URL`: Primary database (write operations)
- `DATABASE_READ_REPLICAS`: Comma-separated read replicas

### Redis

- `REDIS_URL`: Primary Redis (write operations)
- `REDIS_READ_URL`: Redis replica (read operations)
- `REDIS_SENTINEL_HOSTS`: Sentinel host for failover

### Application

- `JWT_SECRET`: Secret for JWT token generation
- `API_RATE_LIMIT`: Requests per client per hour
- `CACHE_TTL_*`: Cache expiration times

---

## 🔍 Monitoring

### Check PostgreSQL Replication Lag

```bash
docker exec -it postgres-primary psql -U postgres -d activity_tracker -c \
  "SELECT client_addr, state, sync_state, replay_lag FROM pg_stat_replication;"
```

### Check Redis Replication Status

```bash
docker exec -it redis-primary redis-cli -a redis123 INFO replication
```

### View Application Logs

```bash
docker-compose logs -f app
```

---

## 🛡️ Security Features

- ✅ All passwords configurable via environment variables
- ✅ Network isolation with Docker bridge network
- ✅ Replication user with limited permissions
- ✅ Redis password authentication
- ✅ PostgreSQL md5 authentication

---

## 📈 Scaling Strategy

### Horizontal Scaling

1. **Add More Read Replicas**: Copy `postgres-replica-2` configuration
2. **Shard by Client ID**: Implement application-level sharding
3. **Add Redis Cluster**: Replace single Redis with cluster mode

### Vertical Scaling

- Increase `shared_buffers` in PostgreSQL configs
- Increase `maxmemory` in Redis configs
- Allocate more CPU/RAM to Docker containers

---

## 🧪 Testing Replication

### Test PostgreSQL Replication

```bash
# Write to primary
docker exec -it postgres-primary psql -U postgres -d activity_tracker -c \
  "CREATE TABLE test_replication (id SERIAL PRIMARY KEY, data TEXT);"

# Read from replica
docker exec -it postgres-replica-1 psql -U postgres -d activity_tracker -c \
  "SELECT * FROM test_replication;"
```

### Test Redis Replication

```bash
# Write to primary
docker exec -it redis-primary redis-cli -a redis123 SET test_key "test_value"

# Read from replica
docker exec -it redis-replica redis-cli -a redis123 GET test_key
```

---

## 🔧 Troubleshooting

### Replication Not Working

```bash
# Check primary logs
docker logs postgres-primary

# Check replica logs
docker logs postgres-replica-1

# Verify replication slots
docker exec -it postgres-primary psql -U postgres -c "SELECT * FROM pg_replication_slots;"
```

### Redis Failover Issues

```bash
# Check Sentinel status
docker exec -it redis-sentinel redis-cli -p 26379 SENTINEL get-master-addr-by-name mymaster

# Force failover (testing)
docker exec -it redis-sentinel redis-cli -p 26379 SENTINEL failover mymaster
```

---

## 📦 Production Considerations

1. **Use External Volumes**: Mount to host filesystem for persistence
2. **Backup Strategy**: Regular pg_basebackup and Redis RDB snapshots
3. **Monitoring**: Add Prometheus + Grafana for metrics
4. **Load Balancer**: Use HAProxy/PgBouncer for connection pooling
5. **SSL/TLS**: Enable encrypted connections in production
6. **Resource Limits**: Set memory/CPU limits in docker-compose

---

## 🔄 Backup & Restore

### PostgreSQL Backup

```bash
docker exec -it postgres-primary pg_dump -U postgres activity_tracker > backup.sql
```

### PostgreSQL Restore

```bash
cat backup.sql | docker exec -i postgres-primary psql -U postgres activity_tracker
```

### Redis Backup

```bash
docker exec -it redis-primary redis-cli -a redis123 BGSAVE
docker cp redis-primary:/data/dump.rdb ./redis-backup.rdb
```

---

## 📚 Additional Resources

- [PostgreSQL Replication](https://www.postgresql.org/docs/current/high-availability.html)
- [Redis Sentinel](https://redis.io/docs/management/sentinel/)
- [Docker Compose Best Practices](https://docs.docker.com/compose/production/)
