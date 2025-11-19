# Activity Tracker API

A production-ready API service for tracking and analyzing client API usage with real-time monitoring, intelligent caching, and comprehensive rate limiting.

## Overview

Activity Tracker API is designed to handle high-frequency API traffic while maintaining data consistency and system reliability. Built with TypeScript, Express, PostgreSQL, and Redis, it provides robust features for API activity monitoring, analytics, and access control.

## Why Use This

**For API Gateway & Monitoring:**

- Track millions of API calls with minimal performance overhead through batch processing
- Real-time analytics and usage patterns via WebSocket streaming
- Per-client rate limiting with configurable thresholds
- Detailed audit trails with request/response logging

**For Production Reliability:**

- Handles concurrent requests without race conditions using Redis Lua scripts
- Automatic retry logic with exponential backoff for transient failures
- Graceful degradation when dependencies are unavailable
- In-memory fallback mechanisms for critical operations

**For Performance:**

- Intelligent cache pre-warming based on access patterns (INCRBY tracking)
- Read/write splitting for database and Redis to distribute load
- Batch processing reduces database writes by 100x
- Scheduled cache refresh via cron jobs to maintain hot data

**For Scalability:**

- Redis Sentinel support for high availability
- PostgreSQL read replicas for horizontal scaling
- Stateless design enables easy horizontal scaling
- WebSocket pub/sub for distributed real-time updates

## Key Features

### Core Functionality

- **Client Management**: Register clients with API keys and JWT authentication
- **Activity Logging**: Batch processing (100 logs / 5 seconds) with retry logic
- **Usage Analytics**: Daily usage reports and top clients by time range
- **Real-time Streaming**: SSE/WebSocket for live activity updates
- **Rate Limiting**: Sliding window algorithm with per-client thresholds

### High Availability Features

- **Atomic Operations**: Redis Lua scripts prevent race conditions
- **Cache Intelligence**: Automatic pre-warming based on hit/miss tracking
- **Fault Tolerance**: Retry logic with exponential backoff (200ms → 5s)
- **Graceful Degradation**: In-memory storage when Redis/DB unavailable
- **Read Replicas**: Automatic failover for database reads

### Developer Experience

- **OpenAPI Documentation**: Interactive Swagger UI at `/api-docs`
- **Type Safety**: Full TypeScript coverage with Zod validation
- **Testing**: Vitest + Supertest for unit and integration tests
- **Docker Support**: Production-ready containerization
- **Real-time Logs**: Structured logging with pino

## Quick Start

### Prerequisites

- Node.js 20.x or higher
- PostgreSQL 15+
- Redis 7+
- pnpm (recommended) or npm

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd activity-tracker

# Install dependencies
pnpm install

# Setup database
docker-compose up -d postgres redis

# Run migrations
pnpm migration:run
```

### Configuration

Create `.env` file in the root directory:

```env
# Server
NODE_ENV=development
PORT=8080
HOST=localhost

# Database
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=postgres
DATABASE_PASSWORD=postgres123
DATABASE_NAME=activity_tracker
DATABASE_READ_REPLICAS=localhost:5433  # Optional

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=                         # Optional
REDIS_READ_HOST=localhost               # Optional
REDIS_READ_PORT=6380                    # Optional
REDIS_SENTINEL_HOSTS=                   # Optional: host1:26379,host2:26379
REDIS_SENTINEL_MASTER_NAME=mymaster     # Required if using Sentinel

# Security
JWT_SECRET=your-secret-key-min-32-chars
ENCRYPTION_KEY=64-character-hex-string

# Rate Limiting (defaults)
API_RATE_LIMIT=1000                     # Global default

# Cache Configuration
CACHE_TTL_USAGE_DAILY=3600              # 1 hour
CACHE_TTL_USAGE_TOP=3600                # 1 hour
CACHE_VERSION=v1                        # Increment to invalidate all cache

# Cache Pre-warming
CACHE_PREWARM_ENABLED=true              # Enable startup pre-warming
CACHE_PREWARM_CRON_ENABLED=true         # Enable scheduled pre-warming
CACHE_HIT_TRACKING_ENABLED=true         # Track cache patterns with INCRBY

# Logging
LOG_BATCH_SIZE=100                      # Batch logs before DB insert
LOG_BATCH_INTERVAL_MS=5000              # Flush interval
```

### Running the Application

```bash
# Development mode with hot reload
pnpm start:dev

# Build for production
pnpm build

# Production mode
pnpm start:prod

# Run tests
pnpm test

# Run tests with coverage
pnpm test:cov
```

### Docker Deployment

```bash
# Build and run all services
docker-compose up -d

# View logs
docker-compose logs -f app

# Stop services
docker-compose down
```

The API will be available at `http://localhost:8080` with Swagger docs at `http://localhost:8080/api-docs`.

## 📁 Folder Structure

```code
├── biome.json
├── Dockerfile
├── LICENSE
├── package.json
├── pnpm-lock.yaml
├── README.md
├── src
│   ├── api
│   │   ├── healthCheck
│   │   │   ├── __tests__
│   │   │   │   └── healthCheckRouter.test.ts
│   │   │   └── healthCheckRouter.ts
│   │   └── user
│   │       ├── __tests__
│   │       │   ├── userRouter.test.ts
│   │       │   └── userService.test.ts
│   │       ├── userController.ts
│   │       ├── userModel.ts
│   │       ├── userRepository.ts
│   │       ├── userRouter.ts
│   │       └── userService.ts
│   ├── api-docs
│   │   ├── __tests__
│   │   │   └── openAPIRouter.test.ts
│   │   ├── openAPIDocumentGenerator.ts
│   │   ├── openAPIResponseBuilders.ts
│   │   └── openAPIRouter.ts
│   ├── common
│   │   ├── __tests__
│   │   │   ├── errorHandler.test.ts
│   │   │   └── requestLogger.test.ts
│   │   ├── middleware
│   │   │   ├── errorHandler.ts
│   │   │   ├── rateLimiter.ts
│   │   │   └── requestLogger.ts
│   │   ├── models
│   │   │   └── serviceResponse.ts
│   │   └── utils
│   │       ├── commonValidation.ts
│   │       ├── envConfig.ts
│   │       └── httpHandlers.ts
│   ├── index.ts
│   └── server.ts
├── tsconfig.json
└── vite.config.mts
```
