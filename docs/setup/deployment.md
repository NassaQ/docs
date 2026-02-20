# Deployment Guide

Docker Compose orchestration, container configuration, and deployment procedures for the NassaQ platform.

## Overview

NassaQ uses **Docker Compose** to orchestrate its services for local development. The top-level `docker-compose.yml` manages three containers:

```mermaid
flowchart LR
    subgraph Docker["Docker Compose Network"]
        RMQ["rabbitmq<br/>RabbitMQ 3<br/>:5672 / :15672"]
        SRV["server<br/>FastAPI Backend<br/>:8000"]
        OCR["ocr<br/>OCR Worker<br/>:8001 → :8000"]
    end

    SRV -->|depends_on<br/>service_healthy| RMQ
    OCR -->|depends_on<br/>service_healthy| RMQ
    SRV -->|publish to<br/>ocr_queue| RMQ
    RMQ -->|consume from<br/>ocr_queue| OCR

    subgraph External["External Services"]
        AZ_SQL["Azure SQL Server"]
        AZ_BLOB["Azure Blob Storage"]
    end

    SRV --> AZ_SQL
    SRV --> AZ_BLOB
    OCR --> AZ_SQL
    OCR --> AZ_BLOB

    FE["Frontend<br/>(runs separately)<br/>:8080"] -->|HTTP| SRV
```

!!! note "Frontend Not in Compose"
    The React frontend is **not** included in the Docker Compose configuration. It runs separately via `npm run dev` on port 8080.

---

## Quick Start

### 1. Prerequisites

- Docker Engine 20.10+
- Docker Compose v2+
- Azure SQL Server credentials
- Azure Blob Storage connection string

### 2. Configure Environment Files

```bash
# Copy example env files (if they exist)
cp server/.env.example server/.env
cp ocr/.env.example ocr/.env
```

Edit each `.env` file with your Azure credentials. See [Backend Server Setup](backend.md) and [OCR API Setup](ocr-worker.md) for all required variables.

### 3. Launch Services

```bash
docker compose up --build
```

This will:

1. Start RabbitMQ and wait for its health check to pass (~30 seconds)
2. Build and start the backend server
3. Build and start the OCR worker
4. All services restart automatically unless explicitly stopped

### 4. Verify

| Service | URL | Description |
|---------|-----|-------------|
| Backend API | `http://localhost:8000` | FastAPI with auto-generated docs at `/docs` |
| OCR API | `http://localhost:8001` | OCR worker health endpoint |
| RabbitMQ UI | `http://localhost:15672` | Management console (guest/guest) |

---

## Service Definitions

### RabbitMQ

The message broker that connects the backend server to the OCR worker.

```yaml
rabbitmq:
  image: rabbitmq:3-management-alpine
  container_name: nassaq-rabbitmq
  ports:
    - "5672:5672"     # AMQP protocol
    - "15672:15672"   # Management UI
  environment:
    RABBITMQ_DEFAULT_USER: guest
    RABBITMQ_DEFAULT_PASS: guest
  volumes:
    - rabbitmq_data:/var/lib/rabbitmq
  healthcheck:
    test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
    interval: 15s
    timeout: 10s
    retries: 5
    start_period: 30s
  restart: unless-stopped
```

| Property | Value | Notes |
|----------|-------|-------|
| **Image** | `rabbitmq:3-management-alpine` | Lightweight Alpine image with management UI |
| **AMQP Port** | 5672 | Message broker protocol |
| **Management Port** | 15672 | Web-based management UI |
| **Credentials** | guest/guest | Default dev credentials |
| **Volume** | `rabbitmq_data` | Persists queue data across restarts |
| **Health Check** | `rabbitmq-diagnostics ping` | Ensures broker is ready before dependents start |
| **Start Period** | 30s | Grace period for initial startup |

### Backend Server

The FastAPI REST API server.

```yaml
server:
  build:
    context: ./server
    dockerfile: Dockerfile
  container_name: nassaq-server
  ports:
    - "8000:8000"
  env_file:
    - ./server/.env
  environment:
    MESSAGE_BROKER_URL: "amqp://guest:guest@rabbitmq:5672/"
  depends_on:
    rabbitmq:
      condition: service_healthy
  restart: unless-stopped
```

| Property | Value | Notes |
|----------|-------|-------|
| **Build Context** | `./server` | Uses `server/Dockerfile` |
| **Port** | 8000:8000 | Host:Container mapping |
| **Env File** | `./server/.env` | All application config |
| **Broker Override** | `amqp://...@rabbitmq:5672/` | Uses Docker hostname instead of localhost |
| **Dependency** | `rabbitmq` (healthy) | Waits for RabbitMQ health check |

!!! info "Broker URL Override"
    The `MESSAGE_BROKER_URL` is overridden in the compose file to use the Docker service hostname `rabbitmq` instead of `localhost`. This allows the server to connect to RabbitMQ via Docker's internal DNS.

### OCR Worker

The document processing service with PaddleOCR and EasyOCR.

```yaml
ocr:
  build:
    context: ./ocr
    dockerfile: Dockerfile
  container_name: nassaq-ocr
  ports:
    - "8001:8000"
  env_file:
    - ./ocr/.env
  environment:
    MESSAGE_BROKER_URL: "amqp://guest:guest@rabbitmq:5672/"
  volumes:
    - ocr_output:/ocr/documents
  depends_on:
    rabbitmq:
      condition: service_healthy
  restart: unless-stopped
```

| Property | Value | Notes |
|----------|-------|-------|
| **Build Context** | `./ocr` | Uses `ocr/Dockerfile` |
| **Port** | 8001:8000 | Maps host 8001 → container 8000 |
| **Env File** | `./ocr/.env` | All application config |
| **Broker Override** | `amqp://...@rabbitmq:5672/` | Docker internal hostname |
| **Volume** | `ocr_output:/ocr/documents` | Persists processed OCR output |
| **Dependency** | `rabbitmq` (healthy) | Waits for RabbitMQ health check |

---

## Volumes

| Volume | Service | Container Path | Purpose |
|--------|---------|---------------|---------|
| `rabbitmq_data` | rabbitmq | `/var/lib/rabbitmq` | Queue data, message persistence |
| `ocr_output` | ocr | `/ocr/documents` | Processed OCR output files |

Both volumes use the `local` driver — data is stored on the Docker host filesystem.

---

## Network Architecture

Docker Compose creates a default bridge network that all services join. Services communicate using their service names as hostnames:

| From | To | Hostname | Port |
|------|----|----------|------|
| server | rabbitmq | `rabbitmq` | 5672 |
| ocr | rabbitmq | `rabbitmq` | 5672 |
| server | Azure SQL | External | 1433 |
| server | Azure Blob | External | 443 |
| ocr | Azure SQL | External | 1433 |
| ocr | Azure Blob | External | 443 |
| frontend (host) | server | `localhost` | 8000 |

---

## Startup Order

The `depends_on` with `condition: service_healthy` ensures proper startup ordering:

```mermaid
sequenceDiagram
    participant DC as Docker Compose
    participant RMQ as RabbitMQ
    participant SRV as Server
    participant OCR as OCR Worker

    DC->>RMQ: Start container
    Note over RMQ: Initializing...
    RMQ->>RMQ: Health check: ping
    Note over RMQ: start_period: 30s<br/>interval: 15s, retries: 5

    RMQ-->>DC: Healthy

    par Start dependents
        DC->>SRV: Start container
        DC->>OCR: Start container
    end

    SRV->>RMQ: Connect to AMQP
    OCR->>RMQ: Connect to AMQP
    OCR->>OCR: Load PaddleOCR model
    OCR->>OCR: Load EasyOCR model
    OCR->>RMQ: Start consuming ocr_queue
```

---

## Common Operations

### Build and Start All Services

```bash
docker compose up --build
```

### Start in Background (Detached)

```bash
docker compose up -d
```

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f server
docker compose logs -f ocr
docker compose logs -f rabbitmq
```

### Stop All Services

```bash
docker compose down
```

### Stop and Remove Volumes

```bash
docker compose down -v
```

!!! warning "Data Loss"
    Using `-v` removes all named volumes, including RabbitMQ queue data and OCR output files.

### Rebuild a Single Service

```bash
docker compose build server
docker compose up -d server
```

### Check Service Status

```bash
docker compose ps
```

---

## Environment Variable Configuration

Each service reads its configuration from a `.env` file. Start from the provided examples:

```bash
cp server/.env.example server/.env
cp ocr/.env.example ocr/.env
```

The `.env.example` files in each repository document every variable with descriptions and defaults. See the service setup pages for the full reference:

- [Backend Server — Environment Variables](backend.md#environment-variables)
- [OCR API — Environment Variables](ocr-worker.md#environment-variables)

!!! danger "Never Commit Secrets"
    The `.env` files contain Azure credentials and JWT secrets. They must **never** be committed to version control. Both `server/.env` and `ocr/.env` should be in their respective `.gitignore` files.

---

## Docker Build Details

Both the server and OCR worker use **multi-stage Docker builds** for optimized image sizes. See the individual service setup pages for detailed Dockerfile breakdowns:

- [Backend Server - Docker Build](backend.md#docker-configuration)
- [OCR API - Docker Build](ocr-worker.md#docker-configuration)

---

## Azure Deployment Considerations

The current Docker Compose setup is designed for **local development**. For production deployment to Azure, consider:

| Concern | Local (Docker Compose) | Production (Azure) |
|---------|----------------------|-------------------|
| **Orchestration** | Docker Compose | Azure Container Apps / AKS |
| **Message Broker** | RabbitMQ container | Azure Service Bus |
| **Database** | Azure SQL (external) | Azure SQL (same) |
| **Blob Storage** | Azure Blob (external) | Azure Blob (same) |
| **Secrets** | `.env` files | Azure Key Vault |
| **Networking** | Docker bridge network | Azure Virtual Network |
| **SSL/TLS** | Not configured | Azure Application Gateway / Front Door |
| **Scaling** | Single instance each | Auto-scaling based on queue depth |
| **Monitoring** | Docker logs | Azure Monitor / Application Insights |

!!! info "Azure Service Bus"
    The backend server includes a stub `AzureServiceBusBroker` class (not yet implemented) intended to replace RabbitMQ in production. See the [Roadmap](../project/roadmap.md) for details.
