# AI Foundry Worker - Setup

This guide covers environment setup, dependencies, Docker configuration, and running the **AI Foundry Worker** service. This worker is the premium, cloud-native processing engine for NassaQ, utilizing Azure managed services for high-speed OCR, advanced classification, automated storage organization, and metadata persistence.

For details on how the AI Foundry pipeline processes documents, see the [Processing Pipelines](../guides/ocr-pipelines.md) page.

---

## Overview

The AI Foundry Worker is a Python-based microservice that processes uploaded documents asynchronously. In contrast to the CPU-based local OCR worker, the AI Foundry Worker delegates heavy computations to Microsoft Azure's state-of-the-art managed AI capabilities.

### Key Capabilities

- **Azure Document Intelligence OCR** -- Uses the `prebuilt-layout` model with high resolution and Arabic locale to extract text and structure (including tables) in clean Markdown.
- **Azure OpenAI Classification** -- Employs GPT models (`gpt-4.1-mini` or similar) to automatically categorize documents and write detailed reasoning.
- **Auto-Organization** -- Dynamically moves classified files inside Azure Blob Storage into neat category-based folders (e.g., `/invoices/filename.pdf`).
- **Cosmos DB Integration** -- Stores full text, JSON metadata, and OCR metrics in Azure Cosmos DB (MongoDB API).
- **SQL Server Sync** -- Updates SQL Server database metrics table (`Ocr_Results`) with document properties, page/word counts, confidence levels, and transaction costs in USD.

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Python | >= 3.11 | Runtime |
| [uv](https://docs.astral.sh/uv/) | Latest | Package manager |
| Docker | 20+ | Containerized deployment |
| ODBC Driver 18 | Latest | SQL Server connectivity |
| Azure Services | -- | Active account with Document Intelligence, Azure OpenAI, Blob Storage, Cosmos DB, and (optionally) Service Bus |

---

## Dependencies

The worker's dependencies are defined in `pyproject.toml`. Key libraries:

| Library | Role |
|---------|------|
| **FastAPI** | Lightweight web framework exposing ASGI lifecycle and health checks |
| **azure-ai-documentintelligence** | Official Azure SDK for layout extraction and advanced OCR |
| **openai** (via Azure) | LLM interface for document classification and categorization |
| **motor / pymongo** | Async MongoDB driver for writing results to Azure Cosmos DB |
| **SQLAlchemy 2.0** | Async ORM with `aioodbc` driver for SQL Server metric sync |
| **aio-pika** | Async RabbitMQ client for dev queue consumption |
| **azure-servicebus** | Client for production Azure Service Bus message queue consumption |
| **Pydantic Settings** | Environment-based configuration |

---

## Environment Variables

Configuration is managed via Pydantic Settings in `app/core/config.py`, loading from a `.env` file. Copy the example and fill in your credentials:

```bash
cp .env.example .env
```

### Required Variables

#### 1. Basic Configurations
- `ENVIRONMENT`: Set to `"dev"` for local testing or `"production"` to activate Azure Service Bus.
- `MESSAGE_BROKER_URL`: For RabbitMQ (`amqp://...`) in dev, or Azure Service Bus connection string in production.
- `AI_FOUNDRY_QUEUE_NAME`: Queue name to listen to (default: `ai_foundry_queue`).

#### 2. SQL Server (Metric Sync)
- `SQL_SERVER`: Hostname of your Azure SQL Server.
- `SQL_DB_NAME`: Database name.
- `SQL_USER`: Username.
- `SQL_PASS`: Password.
- `SQL_DRIVER`: Defaults to `"ODBC Driver 18 for SQL Server"`.

#### 3. Azure Blob Storage
- `BLOB_CONNECTION_STR`: Full Azure Blob Storage connection string.
- `BLOB_STORAGE_CONTAINER_NAME`: Target container name.

#### 4. Azure Document Intelligence (OCR)
- `AZURE_DOC_INTELLIGENCE_ENDPOINT`: Azure Document Intelligence resource endpoint URL.
- `AZURE_DOC_INTELLIGENCE_KEY`: API access key.

#### 5. Azure OpenAI (LLM Classifier)
- `AZURE_OPENAI_API_KEY`: Azure OpenAI resource access key.
- `AZURE_OPENAI_ENDPOINT`: Endpoint URL.
- `AZURE_OPENAI_DEPLOYMENT_NAME`: GPT deployment name (e.g. `gpt-4.1-mini`).
- `AZURE_OPENAI_API_VERSION`: API version (e.g. `2024-12-01-preview`).

#### 6. Azure Cosmos DB (MongoDB API)
- `MONGO_USER`: Cosmos DB account name.
- `MONGO_PASS`: Access password/key.
- `MONGO_HOST`: Cosmos MongoDB cluster hostname.
- `MONGO_PORT`: Defaults to `10260`.
- `MONGO_DB_NAME`: Database name.
- `COSMOS_OCR_COLLECTION`: Collection to store full JSON results (default: `ocr_results`).

---

## Example `.env` File

```env title="ai-foundry/.env"
ENVIRONMENT="dev"

# Message Broker
MESSAGE_BROKER_URL="amqp://guest:guest@localhost:5672/"
AI_FOUNDRY_QUEUE_NAME="ai_foundry_queue"

# SQL Server
SQL_SERVER="your-server.database.windows.net"
SQL_DB_NAME="your-database"
SQL_USER="your-username"
SQL_PASS="your-password"

# Azure Blob Storage
BLOB_CONNECTION_STR="DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...;EndpointSuffix=..."
BLOB_STORAGE_CONTAINER_NAME="your-container"

# Azure Document Intelligence (OCR)
AZURE_DOC_INTELLIGENCE_ENDPOINT="https://your-resource.cognitiveservices.azure.com/"
AZURE_DOC_INTELLIGENCE_KEY="your-key-here"

# Azure OpenAI (Classification)
AZURE_OPENAI_API_KEY="your-key-here"
AZURE_OPENAI_ENDPOINT="https://your-openai-resource.openai.azure.com/"
AZURE_OPENAI_DEPLOYMENT_NAME="gpt-4.1-mini"
AZURE_OPENAI_API_VERSION="2024-12-01-preview"

# Azure Cosmos DB (MongoDB API)
MONGO_USER="your-cosmos-mongo-username"
MONGO_PASS="your-cosmos-mongo-password"
MONGO_HOST="your-cosmos-mongo-host.mongocluster.cosmos.azure.com"
MONGO_PORT=10260
MONGO_DB_NAME="nassaq"
COSMOS_OCR_COLLECTION="ocr_results"
```

---

## Running Locally

### 1. Install Dependencies

```bash
cd ai-foundry
uv sync
```

### 2. Start Dev RabbitMQ (if in dev mode)

```bash
docker compose -f docker-compose.local.yml up rabbitmq -d
```

### 3. Start the Worker

```bash
uv run uvicorn app.main:app --host 0.0.0.0 --port 8001
```

Unlike the local OCR worker, there are **no local AI models to download**, so startup is instantaneous!

### 4. Verify Health

The health endpoint returns `200 OK` with status info if the queue consumer is running:

```bash
curl -f http://localhost:8001/
```

Response:
```json
{
  "status": "healthy",
  "consumer": "running"
}
```

---

## Docker Configuration

### Dockerfile Overview

The AI Foundry Worker uses a **multi-stage build** to produce a lightweight container running as a secure, non-root user:

**Stage 1 (Builder):**
- Base: `python:3.11-slim`
- Installs `build-essential` and `unixodbc-dev` (required to compile database drivers).
- Uses `uv` to install production dependencies into a virtual environment at `/opt/venv`.

**Stage 2 (Runtime):**
- Base: `python:3.11-slim`
- Installs Microsoft ODBC Driver 18.
- Creates a dedicated non-root user (`user14`) for security.
- Copies the virtual environment and application code.
- Runs the worker via `uvicorn` on port `8001`.

### Key Docker Settings

| Setting | Value |
|---------|-------|
| Exposed port | `8001` |
| Healthcheck | `curl -f http://localhost:8001/` every 30s |
| Start period | `10s` (Fast start since cloud-native) |
| User | `user14` (non-root) |
| Entrypoint | `uvicorn app.main:app --host 0.0.0.0 --port 8001` |

### Build and Run

```bash
# Build
docker build -t nassaq-ai-foundry:latest ./ai-foundry

# Run
docker run -d \
  --name nassaq-ai-foundry \
  --env-file ai-foundry/.env \
  -p 8001:8001 \
  nassaq-ai-foundry:latest
```

---

## Application Lifecycle

The FastAPI application implements an asynchronous `lifespan` manager that connects clients cleanly at startup and disposes of them at shutdown:

```mermaid
sequenceDiagram
    participant App as FastAPI App
    participant ASB as Message Broker<br/>(RabbitMQ / ASB)
    participant DocIntel as Document Intelligence
    participant OpenAI as Azure OpenAI
    participant Cosmos as Cosmos DB
    participant Blob as Blob Storage

    Note over App: Startup
    App->>DocIntel: Connect OCR Pipeline
    App->>OpenAI: Connect LLM Classifier
    App->>Blob: Connect Blob Storage Client
    App->>Cosmos: Open Connection Pool
    App->>ASB: Connect & Start Async Consumer Task
    Note over App: Listening for upload jobs...

    Note over App: Shutdown
    App->>ASB: Cancel Consumer Task & Close Connection
    App->>Blob: Close Client
    App->>Cosmos: Close Connection Pool
    Note over App: Worker shut down cleanly
```

### Broker Selection (`get_broker`)

At startup, the worker determines its broker strategy dynamically based on the environment:

- **If `ENVIRONMENT == "production"`**: Connects via `AzureServiceBusBroker` using the Azure Service Bus protocol to pull messages from `ai_foundry_queue`.
- **Otherwise**: Connects via `RabbitMQBroker` using the AMQP protocol to pull messages from the local RabbitMQ instance.
