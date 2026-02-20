# OCR API - Setup

This guide covers environment setup, dependencies, Docker configuration, and running the OCR processing service. For details on how the OCR pipeline processes documents, see the [Processing Pipelines](../guides/ocr-pipelines.md) page.

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Python | >= 3.11 | Runtime |
| [uv](https://docs.astral.sh/uv/) | Latest | Package manager |
| Docker | 20+ | Containerized deployment |
| ODBC Driver 18 | Latest | SQL Server connectivity |

## Dependencies

The OCR worker's full dependency list lives in `pyproject.toml`. Key libraries:

| Library | Role |
|---------|------|
| **PaddleOCR 3.3** | Primary OCR engine -- fast processing for English text, numbers, and tables |
| **EasyOCR 1.7** | Secondary OCR engine -- accurate Arabic text with correct RTL reading order |
| **PyMuPDF** | PDF parsing: text extraction, embedded image extraction, page-to-image rendering |
| **OpenCV** | Image decoding and color space conversion before OCR |
| **aio-pika** | Async RabbitMQ client for consuming messages from `ocr_queue` |
| **azure-storage-blob** | Downloading uploaded files from Azure Blob Storage |
| **aioodbc + pyodbc** | Async SQL Server access for updating processing status |

For the full database schema and table definitions, see the [Database Schema](../concepts/database.md) page.

## Environment Variables

Configuration is managed via Pydantic Settings in `app/core/config.py`, loading from a `.env` file. Copy the example and fill in your credentials:

```bash
cp .env.example .env
```

The `.env.example` file documents every variable. The `SQL_CONNECTION_STRING` is **computed automatically** from the SQL variables:

```
mssql+aioodbc://{SQL_USER}:{SQL_PASS}@{SQL_SERVER}/{SQL_DB_NAME}?driver={SQL_DRIVER}&TrustServerCertificate=yes
```

### Example `.env` File

```env title=".env"
# --- OCR Config ---
OUTPUT_DIR="documents"
GPU=false

# --- Message Broker ---
MESSAGE_BROKER_URL="amqp://guest:guest@localhost:5672/"
OCR_QUEUE_NAME="ocr_queue"

# --- SQL Server ---
SQL_SERVER="your-server.database.windows.net"
SQL_DB_NAME="your-database"
SQL_USER="your-username"
SQL_PASS="your-password"

# --- Azure Blob Storage ---
BLOB_CONNECTION_STR="DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...;EndpointSuffix=..."
BLOB_STORAGE_CONTAINER_NAME="your-container"
```

## Running Locally

### 1. Install Dependencies

```bash
cd ocr
uv sync
```

### 2. Ensure RabbitMQ is Running

If using Docker Compose from the project root:

```bash
docker compose up rabbitmq -d
```

Or install RabbitMQ locally and start it on the default port (5672).

### 3. Start the Service

```bash
uv run uvicorn app.main:app --host 0.0.0.0 --port 8001
```

!!! warning "First Startup is Slow"
    On first launch, PaddleOCR and EasyOCR will download their model weights (several hundred MB). Subsequent starts are much faster as models are cached locally.

### 5. Verify

The health endpoint returns `204 No Content` when the service is ready:

```bash
curl -f http://localhost:8001/
```

## Docker

### Dockerfile Overview

The OCR service uses a **multi-stage build** to minimize the final image size:

```mermaid
graph LR
    A[Stage 1: Builder] -->|Copy venv| B[Stage 2: Runtime]
    A -->|"python:3.11-slim + build tools"| A
    B -->|"python:3.11-slim + ODBC + libgl"| B
```

**Stage 1 (Builder):**

- Base: `python:3.11-slim-bookworm`
- Installs `build-essential` and `unixodbc-dev` for compiling native extensions
- Copies `uv` from the official image (`ghcr.io/astral-sh/uv:0.4.0`)
- Creates a virtual environment at `/opt/venv` and installs all dependencies

**Stage 2 (Runtime):**

- Base: `python:3.11-slim-bookworm`
- Installs Microsoft ODBC Driver 18, `libgl1`, and `libglib2.0-0` (required by OpenCV)
- Creates a non-root user (`user14`) for security
- Copies the venv from the builder stage and the application code
- Mounts `/ocr/documents` as a volume for OCR output

### Key Docker Configuration

| Setting | Value |
|---------|-------|
| Exposed port | `8000` |
| Healthcheck | `curl -f http://localhost:8000/` every 30s |
| Start period | `300s` (5 minutes -- allows model download on first run) |
| User | `user14` (non-root) |
| Volume | `/ocr/documents` |
| Entrypoint | `uvicorn app.main:app --host 0.0.0.0 --port 8000` |

### Environment Variables in Docker

```yaml
environment:
  GPU: "false"
  OUTPUT_DIR: "/ocr/documents"
```

All other variables (`SQL_*`, `BLOB_*`, `MESSAGE_BROKER_URL`) should be passed via environment variables or a `.env` file. For the full Docker Compose orchestration, see the [Deployment](deployment.md) page.

### Build and Run

```bash
# Build
docker build -t nassaq-ocr:latest ./ocr

# Run
docker run -d \
  --name nassaq-ocr \
  --env-file ocr/.env \
  -p 8001:8000 \
  -v ocr-documents:/ocr/documents \
  nassaq-ocr:latest
```

## GPU Configuration

EasyOCR supports GPU acceleration via CUDA. To enable it:

1. Set `GPU=true` in your `.env` file
2. Replace `paddlepaddle` with `paddlepaddle-gpu` in `pyproject.toml`
3. If using Docker, use an NVIDIA CUDA base image and install `nvidia-container-toolkit`

!!! note "CPU Mode is Default"
    The default configuration runs entirely on CPU. This is adequate for most document processing workloads. GPU acceleration primarily benefits batch processing of large image collections.

## Application Lifecycle

The FastAPI application uses a `lifespan` context manager that handles startup and shutdown:

```mermaid
sequenceDiagram
    participant App as FastAPI App
    participant P as PaddleOCR
    participant E as EasyOCR
    participant B as RabbitMQ
    participant S as Blob Storage

    Note over App: Startup
    App->>P: Load PaddleOCR engine (lang="ar")
    App->>E: Load EasyOCR reader (["ar", "en"])
    App->>B: Connect to RabbitMQ
    App->>S: Initialize BlobDownloader
    App->>B: Start consuming from ocr_queue
    Note over App: Ready to process messages

    Note over App: Shutdown
    App->>B: Close RabbitMQ connection
    App->>S: Close Blob client
```

### Startup Sequence

1. **Load PaddleOCR** -- Initializes the PaddleOCR engine with `use_angle_cls=False` and `lang="ar"`
2. **Load EasyOCR** -- Creates an EasyOCR Reader for Arabic and English with GPU setting from config
3. **Connect RabbitMQ** -- Establishes a robust connection to the message broker
4. **Initialize Blob Storage** -- Creates the Azure Blob downloader client
5. **Start Consumer** -- Begins consuming messages from the configured queue (`ocr_queue` by default)

### Shutdown Sequence

1. Close the RabbitMQ connection
2. Close the Blob Storage client

## API Endpoints

The OCR service exposes two endpoints:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Health check (returns `204 No Content`) |
| `POST` | `/api/v1/docs` | Direct file upload for OCR processing (batch mode) |

!!! info "Primary Processing Path"
    In production, documents are primarily processed via the **RabbitMQ consumer**, not the REST endpoint. The backend server uploads files to Azure Blob Storage and publishes a message to `ocr_queue`. The OCR worker consumes the message, downloads the file, and processes it asynchronously.

    The `POST /api/v1/docs` endpoint exists for direct testing and standalone use.
