#!/bin/bash
set -e

echo "Stopping all services..."

docker-compose down

echo ""
echo "All services stopped!"
echo ""
echo "To remove volumes as well, run: docker-compose down -v"
