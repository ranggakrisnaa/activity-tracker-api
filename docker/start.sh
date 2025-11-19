#!/bin/bash
set -e

echo "Starting services with Docker Compose..."
echo "This will start:"
echo "  - PostgreSQL Primary (Port 5432)"
echo "  - PostgreSQL Replica 1 (Port 5433)"
echo "  - PostgreSQL Replica 2 (Port 5434)"
echo "  - Redis Primary (Port 6379)"
echo "  - Redis Replica (Port 6380)"
echo "  - Redis Sentinel (Port 26379)"
echo "  - Application (Port 3000)"
echo "  - PgAdmin (Port 5050)"
echo "  - Redis Commander (Port 8081)"

# Make init scripts executable
chmod +x docker/postgres/init-primary.sh
chmod +x docker/postgres/init-replica.sh

# Start services
docker-compose up -d

echo ""
echo "Waiting for services to be healthy..."
sleep 30

echo ""
echo "Services started successfully!"
echo ""
echo "Access URLs:"
echo "  - Application: http://localhost:3000"
echo "  - API Docs: http://localhost:3000/api/docs"
echo "  - PgAdmin: http://localhost:5050 (admin@admin.com / admin123)"
echo "  - Redis Commander: http://localhost:8081"
echo ""
echo "Database Connections:"
echo "  - Primary (Write): postgresql://postgres:postgres123@localhost:5432/activity_tracker"
echo "  - Replica 1 (Read): postgresql://postgres:postgres123@localhost:5433/activity_tracker"
echo "  - Replica 2 (Read): postgresql://postgres:postgres123@localhost:5434/activity_tracker"
echo ""
echo "Redis Connections:"
echo "  - Primary: redis://:redis123@localhost:6379"
echo "  - Replica: redis://:redis123@localhost:6380"
echo "  - Sentinel: localhost:26379"
echo ""
echo "Run 'docker-compose logs -f' to view logs"
echo "Run 'docker-compose down -v' to stop and remove all containers and volumes"
