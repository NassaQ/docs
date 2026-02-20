# System Design

This page provides a comprehensive overview of NassaQ's microservices architecture, how the services communicate, and the design decisions behind the system.

---

## Architecture Overview

NassaQ is built as a **distributed system** composed of three independent services, a message broker, and cloud-based data stores. Each service is developed, versioned, and deployed independently.

```mermaid
graph TB
    subgraph CLIENT["Client Layer"]
        UI["User Interface<br/><i>React + TypeScript</i><br/>Port 8080"]
    end

    subgraph API_LAYER["API Layer"]
        SERVER["Backend Server<br/><i>FastAPI</i><br/>Port 8000"]
    end

    subgraph WORKER_LAYER["Worker Layer"]
        OCR["OCR Worker<br/><i>FastAPI + PaddleOCR + EasyOCR</i><br/>Port 8001"]
    end

    subgraph MESSAGING["Message Broker"]
        MQ[("RabbitMQ<br/>Port 5672")]
    end

    subgraph STORAGE["Azure Cloud Storage"]
        SQL[("Azure SQL Server<br/><i>Relational Data</i>")]
        BLOB[("Azure Blob Storage<br/><i>File Storage</i>")]
        MONGO[("Azure Cosmos DB<br/><i>MongoDB API</i><br/><small>Planned</small>")]
    end

    UI -->|"HTTP/REST"| SERVER
    SERVER -->|"Publish Messages"| MQ
    MQ -->|"Consume Messages"| OCR
    SERVER -->|"Read / Write"| SQL
    SERVER -->|"Upload / Download"| BLOB
    SERVER -.->|"Planned"| MONGO
    OCR -->|"Read / Write"| SQL
    OCR -->|"Download"| BLOB

    style CLIENT fill:#1a1a2e,stroke:#7c3aed,stroke-width:2px,color:#e0e0e0
    style API_LAYER fill:#1a1a2e,stroke:#7c3aed,stroke-width:2px,color:#e0e0e0
    style WORKER_LAYER fill:#1a1a2e,stroke:#7c3aed,stroke-width:2px,color:#e0e0e0
    style MESSAGING fill:#1a1a2e,stroke:#f59e0b,stroke-width:2px,color:#e0e0e0
    style STORAGE fill:#1a1a2e,stroke:#10b981,stroke-width:2px,color:#e0e0e0
```

### Design Principles

| Principle | Implementation |
|:---|:---|
| **Separation of Concerns** | Each service has a single, well-defined responsibility |
| **Asynchronous Processing** | Long-running OCR tasks are decoupled from the API via message queues |
| **Shared Nothing** | Services share only the database and blob storage -- no in-memory state is shared |
| **Cloud-Native** | All persistent storage is on Azure managed services |
| **Independent Deployability** | Each service has its own Dockerfile, dependencies, and Git repository |

---

## Service Descriptions

### User Interface

The frontend is a **single-page application (SPA)** built with React and TypeScript. It communicates exclusively with the Backend Server via REST API calls.

**Responsibilities:**

- Render the public marketing site (landing, about, pricing, contact)
- Handle user authentication (login, registration)
- Provide the dashboard interface for document management
- Display document processing status
- Manage user profiles and settings

---

### Backend Server

The server is the **central API gateway** and the only service the frontend communicates with directly. It handles authentication, data validation, file uploads, and job dispatch.

**Responsibilities:**

- Authenticate users and manage JWT token lifecycle
- Validate and process file uploads
- Store files in Azure Blob Storage
- Create database records for documents and processing status
- Publish processing jobs to RabbitMQ
- Serve document status and metadata to the frontend
- Manage users, roles, and virtual file paths

---

### OCR Worker

The OCR worker is an **event-driven processor** that consumes jobs from RabbitMQ. It is designed to run independently and can be scaled horizontally by deploying multiple instances.

**Responsibilities:**

- Consume document processing messages from `ocr_queue`
- Download source files from Azure Blob Storage
- Route documents through the smart OCR pipeline (PaddleOCR vs. EasyOCR)
- Process PDFs (embedded text extraction, image OCR, full-page OCR fallback)
- Process images directly via the OCR pipeline
- Read plain text files without OCR
- Update processing status in the database (Queued -> Processing -> Finished/Failed)
- Save extracted text and metadata locally (with planned MongoDB migration)

---

## Communication Patterns

### REST API (Frontend <-> Server)

The frontend communicates with the server using standard HTTP REST calls. All API endpoints are versioned under `/api/v1/`.

```mermaid
graph LR
    subgraph Frontend
        A[apiFetch Wrapper]
    end

    subgraph "Backend Server /api/v1"
        B["/auth/*"]
        C["/users/*"]
        D["/docs/*"]
        E["/paths/*"]
    end

    A -->|"POST"| B
    A -->|"GET, PATCH, DELETE"| C
    A -->|"POST, GET, DELETE"| D
    A -->|"GET, POST, PATCH, DELETE"| E
```

**Authentication flow:**

1. Frontend sends credentials to `POST /api/v1/auth/login` (OAuth2 password flow)
2. Server returns an access token (short-lived) and refresh token (long-lived)
3. Frontend includes `Authorization: Bearer <token>` in all subsequent requests
4. When the access token is about to expire, the frontend proactively calls `POST /api/v1/auth/refresh`

---

### Message Queue (Server -> OCR Worker)

The server and OCR worker communicate asynchronously through RabbitMQ. This decouples the upload response time from the potentially slow OCR processing.

```mermaid
sequenceDiagram
    participant Server as Backend Server
    participant RMQ as RabbitMQ<br/>(ocr_queue)
    participant OCR as OCR Worker

    Note over Server: User uploads a document

    Server->>RMQ: Publish (persistent message)
    Note right of Server: Message payload:<br/>{ doc_id, file_path,<br/>  filename, user_id }

    Server-->>Server: Return 200 to client<br/>(non-blocking)

    RMQ->>OCR: Deliver message<br/>(prefetch_count=1)
    
    OCR->>OCR: Download file from Blob
    OCR->>OCR: Process document (OCR)
    OCR->>OCR: Save results

    alt Success
        OCR->>RMQ: ACK message
    else Failure
        OCR->>RMQ: NACK message (requeue)
    end
```

**Key characteristics:**

- Messages are **persistent** (survive broker restarts)
- Worker uses `prefetch_count=1` (processes one document at a time per instance)
- Failed messages are automatically **requeued** for retry
- Database operations use **exponential backoff** on connection failures (up to 3 retries)

---

### Shared Data Stores

Both the Backend Server and the OCR Worker access the same Azure SQL Server database and Azure Blob Storage container. They do **not** communicate directly with each other over HTTP.

```mermaid
graph TB
    subgraph Services
        S["Backend Server"]
        O["OCR Worker"]
    end

    subgraph "Azure SQL Server"
        U["Users Table"]
        D["Documents Table"]
        PS["Processing_Status Table"]
        R["Roles Table"]
        VP["Virtual_Paths Table"]
    end

    subgraph "Azure Blob Storage"
        BC["Document Container"]
    end

    S -->|"Full access to all tables"| U
    S -->|"Full access"| D
    S -->|"Create records"| PS
    S -->|"Full access"| R
    S -->|"Full access"| VP
    S -->|"Upload files"| BC

    O -->|"Update mongo_doc_id"| D
    O -->|"Update status"| PS
    O -->|"Download files"| BC

    style Services fill:#1a1a2e,stroke:#7c3aed,stroke-width:2px,color:#e0e0e0
```

!!! note "Access Patterns"
    The OCR Worker uses a **subset** of the database models. It only reads/writes to the `Documents` and `Processing_Status` tables. It never accesses user, role, or path data.

---

## Document Processing Flow

This is the complete end-to-end flow from a user uploading a document to the final processed result:

```mermaid
flowchart TD
    A[User selects file in UI] --> B[POST /api/v1/docs/upload]
    B --> C{File valid?}
    C -->|No| D[Return 400 error]
    C -->|Yes| E[Validate virtual path exists]
    E --> F[Upload to Azure Blob Storage]
    F --> G[Create Documents record in SQL Server]
    G --> H["Create Processing_Status record<br/>(status: Queued)"]
    H --> I["Publish message to ocr_queue<br/>{doc_id, file_path, filename, user_id}"]
    I --> J[Return 200 with doc_id]
    
    I --> K[OCR Worker receives message]
    K --> L["Update status: Processing"]
    L --> M[Download file from Blob Storage]
    M --> N{File type?}
    
    N -->|PDF| O[Extract embedded text]
    O --> P[Extract embedded images]
    P --> Q{Has content?}
    Q -->|No| R[Full-page OCR fallback]
    Q -->|Yes| S[Combine text from all pages]
    R --> S
    
    N -->|Image| T[Decode with OpenCV]
    T --> U[Smart OCR Pipeline]
    U --> V{Arabic detected?}
    V -->|Yes| W[EasyOCR with paragraph mode]
    V -->|No| X[PaddleOCR result]
    W --> S
    X --> S
    
    N -->|Text| Y[Read UTF-8 content]
    Y --> S
    
    S --> Z[Save extracted text + metadata]
    Z --> AA["Update status: Finished"]
    AA --> AB[ACK message]

    style A fill:#7c3aed,stroke:#7c3aed,color:#fff
    style J fill:#10b981,stroke:#10b981,color:#fff
    style D fill:#ef4444,stroke:#ef4444,color:#fff
    style AA fill:#10b981,stroke:#10b981,color:#fff
```

---

## Network Topology

The following diagram shows the network layout when running all services via Docker Compose:

```mermaid
graph TB
    subgraph HOST["Host Machine"]
        subgraph DOCKER["Docker Network (nassaq)"]
            RMQ["nassaq-rabbitmq<br/>Ports: 5672, 15672"]
            SRV["nassaq-server<br/>Internal: 8000"]
            OCRW["nassaq-ocr<br/>Internal: 8000"]
        end
        
        FE["Frontend Dev Server<br/>Port: 8080<br/><i>(runs outside Docker)</i>"]
    end

    subgraph AZURE["Azure Cloud"]
        ASQL["Azure SQL Server"]
        ABLOB["Azure Blob Storage"]
        ACOSMOS["Azure Cosmos DB"]
    end

    FE -->|":8000"| SRV
    SRV -->|":5672"| RMQ
    RMQ -->|":5672"| OCRW
    SRV -->|"TCP/1433"| ASQL
    SRV -->|"HTTPS/443"| ABLOB
    SRV -.->|"TCP/10260"| ACOSMOS
    OCRW -->|"TCP/1433"| ASQL
    OCRW -->|"HTTPS/443"| ABLOB

    style HOST fill:#0d1117,stroke:#30363d,stroke-width:2px,color:#e0e0e0
    style DOCKER fill:#161b22,stroke:#7c3aed,stroke-width:2px,color:#e0e0e0
    style AZURE fill:#161b22,stroke:#0078d4,stroke-width:2px,color:#e0e0e0
```

| External Port | Service | Protocol | Purpose |
|:---|:---|:---|:---|
| `8080` | Frontend (Vite) | HTTP | Development web server |
| `8000` | Backend Server | HTTP | REST API |
| `8001` | OCR Worker | HTTP | Health check / direct upload (mapped to internal `8000`) |
| `5672` | RabbitMQ | AMQP | Message broker protocol |
| `15672` | RabbitMQ | HTTP | Management UI (username: `guest`, password: `guest`) |

---

## Storage Architecture

### Azure Blob Storage

Blob Storage is used as the **single source of truth** for all uploaded documents. Both the server (uploader) and the OCR worker (downloader) access the same container.

```mermaid
flowchart LR
    subgraph Upload
        S[Backend Server] -->|"upload_blob()"| BC[Blob Container]
    end

    subgraph Download
        BC -->|"download_blob()"| O[OCR Worker]
    end

    subgraph "After Processing"
        O -->|"Save locally"| LD["Local /documents/<br/><i>Extracted text (.txt)</i><br/><i>Metadata (.json)</i><br/><i>Source file copy</i>"]
    end
```

The storage layer is abstracted behind a `StorageBase` interface, allowing for future swapping between Azure Blob, local filesystem, or S3-compatible storage:

```python
class StorageBase(ABC):
    @abstractmethod
    async def upload(self, file, filename: str, path: str) -> str: ...

    @abstractmethod
    async def download(self, blob_url: str) -> bytes: ...

    @abstractmethod
    async def delete(self, blob_url: str) -> None: ...
```

### Azure SQL Server

SQL Server is the primary relational database, storing all structured data: users, roles, documents, processing status, virtual paths, permissions, and audit logs. See the [Database Schema](../concepts/database.md) page for detailed table documentation.

### Azure Cosmos DB (Planned)

Cosmos DB with the MongoDB API is planned as the storage layer for processed document content (extracted text, embeddings). The server configuration already includes MongoDB connection settings, but the integration is not yet complete.

---

## Scalability Considerations

| Aspect | Current Design | Scaling Path |
|:---|:---|:---|
| **OCR Processing** | Single worker instance, `prefetch_count=1` | Deploy multiple worker containers; RabbitMQ distributes jobs automatically |
| **Backend Server** | Single instance behind Docker | Add a load balancer (e.g., Nginx, Azure Application Gateway) with multiple server containers |
| **Database** | Azure SQL Server (managed) | Azure handles scaling; consider read replicas for heavy query loads |
| **File Storage** | Azure Blob (managed) | Effectively unlimited; Azure handles scaling transparently |
| **Message Broker** | Single RabbitMQ container | RabbitMQ clustering or migrate to Azure Service Bus (broker stub already exists) |

!!! info "Horizontal Scaling"
    The architecture is already designed for horizontal scaling at the worker level. Because the OCR worker consumes from a shared queue with `prefetch_count=1`, adding more worker containers immediately distributes the load without any code changes.
