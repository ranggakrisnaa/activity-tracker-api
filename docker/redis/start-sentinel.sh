#!/bin/sh

echo "Waiting for redis-primary to be resolvable..."
until getent hosts redis-primary > /dev/null 2>&1; do
  echo "redis-primary not resolvable yet, waiting..."
  sleep 2
done

# Get the IP address of redis-primary
REDIS_PRIMARY_IP=$(getent hosts redis-primary | awk '{ print $1 }')
echo "redis-primary resolved to: $REDIS_PRIMARY_IP"

# Create sentinel config with resolved IP
cat > /tmp/sentinel-runtime.conf << EOF
port 26379
dir /tmp
sentinel monitor mymaster $REDIS_PRIMARY_IP 6379 2
sentinel auth-pass mymaster redis123
sentinel down-after-milliseconds mymaster 5000
sentinel parallel-syncs mymaster 1
sentinel failover-timeout mymaster 10000
sentinel announce-ip redis-sentinel
sentinel announce-port 26379
sentinel deny-scripts-reconfig yes
EOF

echo "Starting Sentinel with resolved IP..."
exec redis-sentinel /tmp/sentinel-runtime.conf
