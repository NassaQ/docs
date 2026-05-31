# Backend Server - Setup

This guide covers environment setup, dependencies, Docker configuration, and running the FastAPI backend server. Once running, see the [API Reference](../reference/api-endpoints.md) for all available endpoints and the [Security & Auth](../concepts/security.md) page for the auth system details.

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Python | >= 3.11 | Runtime |
| [uv](https://docs.astral.sh/uv/) | Latest | Package manager |
| Docker | 20+ | Containerized deployment |
| ODBC Driver 18 | Latest | SQL Server connectivity |

## Dependencies

The server's full dependency list lives in `pyproject.toml`. Key libraries:

| Library | Role |
|---------|------|
| **FastAPI** | Async web framework with automatic OpenAPI docs |
| **SQLAlchemy 2.0** | Async ORM with `aioodbc` driver for SQL Server |
| **python-jose** | JWT encoding/decoding with HS256 |
| **bcrypt** (via passlib) | Password hashing with automatic salt generation |
| **aio-pika** | Async RabbitMQ client for publishing OCR jobs |
| **azure-storage-blob** | File upload/download/delete from Azure Blob Storage |
| **Pydantic** | Request/response validation with email support |

## Environment Variables

Configuration is managed via Pydantic Settings in `app/core/config.py`, loading from a `.env` file. Copy the example and fill in your credentials:

```bash
cp .env.example .env
```

The `.env.example` file documents every variable. Two connection strings are **computed automatically** — you never set them directly:

**SQL Server:**
```
mssql+aioodbc://{SQL_USER}:{SQL_PASS}@{SQL_SERVER}/{SQL_DB_NAME}?driver={SQL_DRIVER}&TrustServerCertificate=yes
```

**MongoDB (Cosmos DB):**
```
mongodb://{MONGO_USER}:{MONGO_PASS}@{MONGO_HOST}:{MONGO_PORT}/?ssl=true&tlsInsecure=...&authMechanism=SCRAM-SHA-256&...
```

### Example `.env` File

```env title=".env"
ENVIRONMENT="dev"

# SQL Server
SQL_SERVER="your-server.database.windows.net"
SQL_DB_NAME="your-database"
SQL_USER="your-username"
SQL_PASS="your-password"

# MongoDB (Azure Cosmos DB)
MONGO_USER="your-mongo-user"
MONGO_PASS="your-mongo-password"
MONGO_HOST="your-cluster.mongocluster.cosmos.azure.com"
MONGO_DB_NAME="sdmsdb"

# Azure Blob Storage
BLOB_STORAGE_TYPE="azure"
BLOB_CONNECTION_STR="DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...;EndpointSuffix=..."
BLOB_STORAGE_CONTAINER_NAME="your-container"

# Message Broker & Ingest Backend
PROCESSING_BACKEND="ocr_api" # Options: "ocr_api" (local) or "ai_foundry" (cloud)
MESSAGE_BROKER_URL="amqp://guest:guest@localhost:5672/" # Use AMQP for RabbitMQ in dev, or ASB connection string in production

# JWT Configuration
ACCESS_TOKEN_EXPIRE_MINUTES=1
REFRESH_TOKEN_EXPIRE_DAYS=7
JWT_ALGORITHM="HS256"
JWT_SECRET_KEY="your-secret-key-here"
```

!!! warning "Short Access Token TTL"
    The default access token expiry is **1 minute**. This is intentionally aggressive for the graduation project. The frontend implements proactive token refresh 5 seconds before expiry.

## Running Locally

### 1. Install Dependencies

```bash
cd server
uv sync
```

### 2. Ensure RabbitMQ is Running

```bash
docker compose up rabbitmq -d
```

### 3. Start the Server

```bash
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 4. Verify

```bash
# Health check (returns 204)
curl -f http://localhost:8000/

# Swagger UI (only in dev mode)
open http://localhost:8000/docs
```

!!! info "Swagger UI Availability"
    Swagger UI (`/docs`), ReDoc (`/redoc`), and the OpenAPI schema (`/openapi.json`) are **only available** when `ENVIRONMENT="dev"`. In production mode, these endpoints are disabled.

## Running Tests

```bash
cd server
uv sync --extra test
uv run pytest
```

The test suite includes:

- **`test_security.py`** -- Password hashing (bcrypt), JWT creation/decoding, token type validation, tamper detection
- **`test_schemas.py`** -- Pydantic validation for user creation, login, update schemas, password strength rules

## Docker

### Dockerfile Overview

The server uses a **multi-stage build**:

```mermaid
graph LR
    A[Stage 1: Builder] -->|Copy venv| B[Stage 2: Runtime]
    A -->|"python:3.11.14-slim + build tools"| A
    B -->|"python:3.11.14-slim + ODBC 18"| B
```

**Stage 1 (Builder):**

- Base: `python:3.11.14-slim`
- Installs `build-essential` and `unixodbc-dev`
- Uses `uv` (from `ghcr.io/astral-sh/uv:0.4.0`) to install dependencies into `/opt/venv`

**Stage 2 (Runtime):**

- Base: `python:3.11.14-slim`
- Installs Microsoft ODBC Driver 18
- Creates a non-root user (`user14`)
- Copies the venv and application code

### Key Docker Configuration

| Setting | Value |
|---------|-------|
| Exposed port | `8000` |
| Healthcheck | `curl -f http://localhost:8000/` every 30s |
| Start period | `5s` |
| User | `user14` (non-root) |
| Entrypoint | `uvicorn app.main:app --host 0.0.0.0 --port 8000` |

### Build and Run

```bash
# Build
docker build -t nassaq-server:latest ./server

# Run
docker run -d \
  --name nassaq-server \
  --env-file server/.env \
  -p 8000:8000 \
  nassaq-server:latest
```

## Application Lifecycle

```mermaid
sequenceDiagram
    participant App as FastAPI App
    participant B as RabbitMQ Broker
    participant DB as SQL Server Engine

    Note over App: Startup
    App->>B: Connect to RabbitMQ
    App->>App: Store broker in app.state
    Note over App: Ready to serve requests

    Note over App: Shutdown
    App->>B: Close RabbitMQ connection
    App->>DB: Dispose SQL engine
```

### Startup

1. **Connect RabbitMQ** -- Establishes a connection to the message broker for publishing OCR jobs
2. **Store in app state** -- The broker instance is stored in `app.state.broker` for dependency injection

### Shutdown

1. Close the RabbitMQ connection
2. Dispose the SQLAlchemy async engine (releases all connection pool resources)

## Database Connection

The server uses SQLAlchemy 2.0 with async support via `aioodbc`. The engine is configured with `pool_pre_ping=True` to verify connections before use and `pool_recycle=1800` to recycle connections every 30 minutes. For the full database schema, see the [Database Schema](../concepts/database.md) page.

### Azure SQL Cold Start Handling

The `get_db` dependency implements **exponential backoff retry** for Azure SQL Database cold starts (when the database is waking from a paused state):

```python
async def get_db():
    for attempt in range(1, settings.SQL_MAX_RETRIES + 1):
        try:
            async with AsyncSessionLocal() as session:
                yield session
                return
        except OperationalError:
            delay = settings.SQL_RETRY_DELAY_BASE ** attempt  # 2s, 4s, 8s
            await asyncio.sleep(delay)
    raise last_exception
```

## Storage Abstraction

The server uses an abstract `StorageBase` class with Azure Blob Storage as the current implementation:

```mermaid
classDiagram
    class StorageBase {
        <<abstract>>
        +upload(data, path) str
        +download(path) bytes
        +delete(path) None
        +exists(path) bool
    }
    
    class AzureBlobStorage {
        +upload(file, path) str
        +download(path) bytes
        +download_stream(path) AsyncIterator
        +delete(path) None
        +delete_dir(path) None
        +find(query, prefix) list
        +exists(path) bool
        +properties(path) dict
        +list(path) list
    }
    
    StorageBase <|-- AzureBlobStorage
```

The `get_storage` dependency in `deps.py` selects the backend based on the `BLOB_STORAGE_TYPE` setting. Currently only `"azure"` is implemented.

## Message Broker Abstraction

Similarly, the broker uses an abstract base:

```mermaid
classDiagram
    class BaseBroker {
        <<abstract>>
        +connect()
        +publish(queue_name, message)
        +close()
    }
    
    class RabbitMQBroker {
        +connect()
        +publish(queue_name, message)
        +consume(queue_name, callback)
        +close()
    }
    
    class AzureServiceBusBroker {
        +connect()
        +publish(queue_name, message)
        +consume(queue_name, callback)
        +close()
    }
    
    BaseBroker <|-- RabbitMQBroker
    BaseBroker <|-- AzureServiceBusBroker
```

!!! note "Azure Service Bus"
    The `AzureServiceBusBroker` class is fully implemented and operational. In the production environment (configured by setting `ENVIRONMENT="production"` in your environment variables), the backend server automatically initiates `AzureServiceBusBroker` using the configured `MESSAGE_BROKER_URL` (which should contain your Azure Service Bus connection string) instead of RabbitMQ. This ensures enterprise-grade queues with built-in retries, DLQs, and zero operational infrastructure management. For details on production container topologies, see the [Deployment Guide](deployment.md).
