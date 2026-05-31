# System Design

This page provides a comprehensive overview of NassaQ's microservices architecture, how the services communicate, the dual-pipeline processing routes, and the design decisions behind the system.

---

## Architecture Overview

NassaQ is built as a **distributed system** supporting two different processing models depending on deployment needs:
1. **Self-Hosted / Local Mode**: Employs an offline-first stack using a local RabbitMQ broker and local OCR worker running PaddleOCR and EasyOCR. This ensures zero cloud costs and 100% data residency.
2. **Premium Cloud Mode**: Leverages Azure managed AI services (Azure Service Bus, Azure Document Intelligence, Azure OpenAI, Azure Cosmos DB, and Pinecone) to achieve high-speed, highly accurate extraction, automated categorization, and semantic RAG search capabilities.

```mermaid
graph TB
    subgraph CLIENT["Client Layer"]
        UI["User Interface<br/><i>React + TypeScript</i><br/>Port 8080"]
    end

    subgraph API_LAYER["API Layer"]
        SERVER["Backend Server<br/><i>FastAPI + RAG Ingest</i><br/>Port 8000"]
    end

    subgraph WORKERS["Asynchronous Workers"]
        OCR["Local OCR Worker<br/><i>PaddleOCR + EasyOCR</i><br/>Port 8001 (Local Mode)"]
        AIF["AI Foundry Worker<br/><i>Azure AI Services</i><br/>Port 8001 (Cloud Mode)"]
    end

    subgraph MESSAGING["Message Broker (Async)"]
        MQ["RabbitMQ (Dev / Local)<br/>Port 5672"]
        ASB["Azure Service Bus (Prod / Cloud)"]
    end

    subgraph STORAGE["Persistent Storage Stack"]
        SQL[("Azure SQL Server<br/><i>Relational Data & Metrics</i>")]
        BLOB[("Azure Blob Storage<br/><i>File Storage</i>")]
        MONGO[("Azure Cosmos DB<br/><i>MongoDB API</i>")]
        PINECONE[("Pinecone DB<br/><i>Vector Embeddings Store</i>")]
    end

    UI -->|"HTTP/REST"| SERVER
    SERVER -->|"Publish Jobs"| MQ
    SERVER -->|"Publish Jobs"| ASB
    MQ -->|"Consume"| OCR
    ASB -->|"Consume"| AIF
    MQ -->|"Consume"| AIF
    
    SERVER -->|"Read / Write"| SQL
    SERVER -->|"Upload / Download"| BLOB
    SERVER -->|"Read Layout / JSON"| MONGO
    SERVER -->|"Query / Ingest Chunks"| PINECONE
    
    OCR -->|"Download"| BLOB
    OCR -->|"Update Status"| SQL
    
    AIF -->|"Download / Upload"| BLOB
    AIF -->|"Update Status & Metrics"| SQL
    AIF -->|"Store Layout & Text"| MONGO

    style CLIENT fill:#1a1a2e,stroke:#7c3aed,stroke-width:2px,color:#e0e0e0
    style API_LAYER fill:#1a1a2e,stroke:#7c3aed,stroke-width:2px,color:#e0e0e0
    style WORKERS fill:#1a1a2e,stroke:#7c3aed,stroke-width:2px,color:#e0e0e0
    style MESSAGING fill:#1a1a2e,stroke:#f59e0b,stroke-width:2px,color:#e0e0e0
    style STORAGE fill:#1a1a2e,stroke:#10b981,stroke-width:2px,color:#e0e0e0
```

### Design Principles

| Principle | Implementation |
|:---|:---|
| **Separation of Concerns** | Decouples front-end state, ingestion API, asynchronous file parsing, and vector ingestion into independent layers. |
| **Architectural Dualism** | The exact same database and API contract support both local, offline workers and premium, cloud-hosted AI workers. |
| **Asynchronous Deferral** | All heavy OCR, text extraction, and categorization processes run outside the user's request-response lifecycle. |
| **Shared Data Residency** | Services coordinate state using Azure SQL Server records and Azure Blob Storage files -- maintaining stateless application nodes. |
| **RAG Readiness** | Document parsing outputs are structured with page counts, word logs, and markdown layouts ready to be seamlessly chunked, embedded, and queried. |

---

## Service Descriptions

### User Interface

The frontend is a fully responsive **single-page application (SPA)** built with React, TypeScript, and Tailwind CSS. It communicates exclusively with the Backend Server via REST API calls.

**Responsibilities:**
- Localized bilingual layout (English / Arabic) with custom Right-to-Left (RTL) context support.
- File upload client integrating directly with the server’s REST endpoints.
- Interactive status polling to track OCR, Classification, and Vectorization phases.
- Unified RAG Search panel for entering natural language queries and presenting sourced, cited AI answers.

---

### Backend Server

The FastAPI server acts as the **central gateway** of the system. It governs authorization, data validation, database orchestration, and vector indexing.

**Responsibilities:**
- Verifies JWT authentication lifecycles (OAuth2 password flow with active token-refresh monitoring).
- Stores original uploads into Azure Blob Storage and initializes processing stages.
- Publishes processing payloads to RabbitMQ or Azure Service Bus based on `PROCESSING_BACKEND`.
- Pulls extracted texts from Cosmos DB, handles text chunking, generates embeddings, and uploads to Pinecone.
- Performs multi-stage semantic searches (Pinecone search → Cohere Rerank → GPT-based answer generation).

---

### Local OCR Worker

An **event-driven offline worker** designed for self-hosting. It runs on lightweight, CPU-based container infrastructure.

**Responsibilities:**
- Listens for messages on `ocr_queue`.
- Downloads the original file from Azure Blob Storage.
- Routes images and scanned pages to **PaddleOCR** or **EasyOCR** based on automatic language detection.
- Extracts native text from digital PDFs and falls back to rendering page-by-page images for scanned PDFs.
- Saves text outputs and JSON logs locally (under volume-mapped directories).
- Updates SQL Server database states (`Processing_Status` and `Documents`).

---

### AI Foundry Worker

A **high-performance, cloud-native worker** designed for the premium tier. It connects to managed Azure AI cognitive services.

**Responsibilities:**
- Listens for messages on `ai_foundry_queue` (supporting both RabbitMQ and Azure Service Bus).
- Runs **Azure Document Intelligence** layout models to extract premium text and table Markdown.
- Executes **Azure OpenAI LLM** classification models to categorize documents and write structural explanations.
- Moves files automatically inside Azure Blob Storage into structured category-based folders (e.g. `/invoice/bill.pdf`).
- Commits full layout schemas and text content to **Azure Cosmos DB** (MongoDB API).
- Commits structured document statistics (cost in USD, primary language, word counts) to the SQL Server `Ocr_Results` table.

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
        F["/rag/*"]
    end

    A -->|"POST"| B
    A -->|"GET, PATCH, DELETE"| C
    A -->|"POST, GET, DELETE"| D
    A -->|"GET, POST, PATCH, DELETE"| E
    A -->|"POST, GET, DELETE"| F
```

---

### Message Queue (Server -> Workers)

The server and workers communicate asynchronously. This ensures uploads return instantly without blocking users during long-running OCR or LLM processes.

```mermaid
sequenceDiagram
    participant Server as Backend Server
    participant Broker as Message Broker<br/>(RabbitMQ / ASB)
    participant Worker as Worker (Local / Cloud)

    Note over Server: User uploads a document
    Server->>Broker: Publish persistent message
    Note right of Server: Message payload:<br/>{ doc_id, file_path,<br/>  filename, user_id }
    Server-->>Server: Return 200 to client (non-blocking)

    Broker->>Worker: Deliver message (prefetch_count=1)
    Worker->>Worker: Process document
    alt Success
        Worker->>Broker: ACK message
    else Failure
        Worker->>Broker: NACK message (requeue)
    end
```

---

## Document Ingestion Flow

The complete end-to-end lifecycle of an uploaded document in **Premium Cloud Mode**:

```mermaid
flowchart TD
    A[User uploads file in UI] --> B[POST /api/v1/docs/upload]
    B --> C{Valid File & Path?}
    C -->|No| D[Return 400 Error]
    C -->|Yes| E[Upload Original File to Azure Blob]
    E --> F[Create SQL Documents Record]
    F --> G["Create SQL Processing_Status Stages<br/>(OCR: Queued, Vectorization: Queued)"]
    G --> H{PROCESSING_BACKEND?}
    
    H -->|ocr_api| I[Publish to ocr_queue]
    H -->|ai_foundry| J[Publish to ai_foundry_queue]
    
    I & J --> K[Return 200 OK with doc_id]
    
    %% Async Ingestion
    J --> L[AI Foundry Worker Consumes Job]
    L --> M[Update SQL Stage OCR -> Processing]
    M --> N[Download File from Blob Storage]
    N --> O[Analyze Document via Azure Document Intelligence]
    O --> P[Classify via Azure OpenAI LLM]
    P --> Q[Move Blob to organized category folder]
    Q --> R[Write full layout and text to Cosmos DB]
    R --> S[Write metrics and costs to SQL Ocr_Results]
    S --> T[Update SQL Stage OCR & Classification -> Finished]
    T --> U[ACK Message]
    
    %% RAG Ingestion
    UserIn["User clicks Ingest to RAG in UI"] --> V[POST /api/v1/rag/ingest]
    V --> W[Read text from Cosmos DB]
    W --> X[Chunk text & generate embeddings via Azure OpenAI]
    X --> Y[Store chunks in Pinecone Vector DB]
    Y --> Z[Update SQL Stage Vectorization -> Finished]
    Z --> AA[Return Ingest Complete]

    style A fill:#7c3aed,stroke:#7c3aed,color:#fff
    style K fill:#10b981,stroke:#10b981,color:#fff
    style D fill:#ef4444,stroke:#ef4444,color:#fff
    style T fill:#10b981,stroke:#10b981,color:#fff
    style AA fill:#10b981,stroke:#10b981,color:#fff
```

---

## Network Topology

The network layout when running in local development with Docker Compose:

```mermaid
graph TB
    subgraph HOST["Host Machine"]
        subgraph DOCKER["Docker Network (nassaq)"]
            RMQ["nassaq-rabbitmq<br/>Ports: 5672, 15672"]
            SRV["nassaq-server<br/>Internal: 8000"]
            OCRW["nassaq-ocr<br/>Internal: 8000"]
            AIFW["nassaq-ai-foundry<br/>Internal: 8001"]
        end
        
        FE["Frontend Dev Server<br/>Port: 8080<br/><i>(runs outside Docker)</i>"]
    end

    subgraph AZURE["Azure Cloud & SaaS"]
        ASQL["Azure SQL Server"]
        ABLOB["Azure Blob Storage"]
        ACOSMOS["Azure Cosmos DB"]
        APINECONE["Pinecone Vector DB"]
    end

    FE -->|":8000"| SRV
    SRV -->|":5672"| RMQ
    OCRW -->|":5672"| RMQ
    AIFW -->|":5672"| RMQ
    
    SRV -->|"TCP/1433"| ASQL
    SRV -->|"HTTPS/443"| ABLOB
    SRV -->|"HTTPS/443"| APINECONE
    
    OCRW -->|"TCP/1433"| ASQL
    OCRW -->|"HTTPS/443"| ABLOB
    
    AIFW -->|"TCP/1433"| ASQL
    AIFW -->|"HTTPS/443"| ABLOB
    AIFW -->|"TCP/10260"| ACOSMOS

    style HOST fill:#0d1117,stroke:#30363d,stroke-width:2px,color:#e0e0e0
    style DOCKER fill:#161b22,stroke:#7c3aed,stroke-width:2px,color:#e0e0e0
    style AZURE fill:#161b22,stroke:#0078d4,stroke-width:2px,color:#e0e0e0
```

---

## Storage Architecture

### Azure Blob Storage (Originals & Folders)
Blob Storage acts as the shared storage backing all documents. 
- During **upload**, the server commits original files under a randomized root guid.
- During **cloud processing**, the AI Foundry worker downloads the file, processes it, and then re-uploads it organized under a clean category folder prefix (e.g. `invoice/bill_1.pdf`) while deleting the orphaned temporary upload.

### Azure Cosmos DB (MongoDB API)
Stores full layout JSON trees, metadata, and extracted text. This keeps SQL Server lean, as heavy page-by-page parsed strings are offloaded to Cosmos DB. Cosmos DB MongoDB documents are indexed by `_id`, which matches `Documents.mongo_doc_id` in SQL Server.

### Pinecone DB (Vector Search)
Stores embedded text chunks. Chunks are generated dynamically during the RAG Ingest phase and are tagged with metadata (`document_id`, `classification`, `language`, `source_file`) to support narrow target queries.

---

## Scalability Considerations

- **Horizontal Worker Scaling**: Since workers consume jobs asynchronously from queues, multiple container instances of both the `Local OCR Worker` or `AI Foundry Worker` can be spawned. RabbitMQ and Azure Service Bus will automatically round-robin tasks among them.
- **RAG & LLM Scaling**: The RAG pipeline offloads heavy embedding queries to Pinecone and Cohere APIs. Relieving local CPU bottlenecks allows the core server to handle thousands of requests per second.
- **Database Partitioning**: Storing relational schemas in SQL Server while maintaining large layouts in Cosmos DB prevents database lockups and enables independent scaling of NoSQL collections.
