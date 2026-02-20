# About & Contributing

## About NassaQ

**NassaQ** (Arabic: **نسّـق**, meaning "to organize" or "to format") is an AI-powered document management and digitization platform. It is developed as a **graduation project** by a team of 9 students, combining backend engineering, AI/ML, data engineering, and frontend development. For an overview of the system architecture, see the [System Design](../overview/architecture.md) page. For deployment details, see the [Deployment](../setup/deployment.md) page. For the current project status and planned features, see the [Roadmap](../project/roadmap.md).

!!! warning "External Contributions"
    NassaQ is a **graduation project**. External contributions (pull requests, issues, feature requests) are **not accepted**. This documentation is provided for academic reference and team coordination.

---

## The Team

<div class="team-grid">

<div class="team-card">
  <div class="team-avatar">NE</div>
  <div class="team-name">Nada Essam</div>
  <div class="team-role">Front-End Developer</div>
  <div class="team-links">
    <a href="#" title="GitHub">:material-github:</a>
    <a href="#" title="LinkedIn">:material-linkedin:</a>
  </div>
</div>

<div class="team-card">
  <div class="team-avatar">GH</div>
  <div class="team-name">Ganna Hassan</div>
  <div class="team-role">Data Engineer</div>
  <div class="team-links">
    <a href="#" title="GitHub">:material-github:</a>
    <a href="#" title="LinkedIn">:material-linkedin:</a>
  </div>
</div>

<div class="team-card">
  <div class="team-avatar">AA</div>
  <div class="team-name">Alaa Awad</div>
  <div class="team-role">Data Engineer</div>
  <div class="team-links">
    <a href="#" title="GitHub">:material-github:</a>
    <a href="#" title="LinkedIn">:material-linkedin:</a>
  </div>
</div>

<div class="team-card">
  <div class="team-avatar">YE</div>
  <div class="team-name">Yousef Elsherbiny</div>
  <div class="team-role">AI Engineer</div>
  <div class="team-links">
    <a href="#" title="GitHub">:material-github:</a>
    <a href="#" title="LinkedIn">:material-linkedin:</a>
  </div>
</div>

<div class="team-card">
  <div class="team-avatar">YM</div>
  <div class="team-name">Youssef Mohammed</div>
  <div class="team-role">AI Engineer</div>
  <div class="team-links">
    <a href="#" title="GitHub">:material-github:</a>
    <a href="#" title="LinkedIn">:material-linkedin:</a>
  </div>
</div>

<div class="team-card">
  <div class="team-avatar">OY</div>
  <div class="team-name">Osama Yousef</div>
  <div class="team-role">Back-End Developer</div>
  <div class="team-links">
    <a href="#" title="GitHub">:material-github:</a>
    <a href="#" title="LinkedIn">:material-linkedin:</a>
  </div>
</div>

<div class="team-card">
  <div class="team-avatar">AG</div>
  <div class="team-name">Ahmed Gamil</div>
  <div class="team-role">Data Engineer</div>
  <div class="team-links">
    <a href="#" title="GitHub">:material-github:</a>
    <a href="#" title="LinkedIn">:material-linkedin:</a>
  </div>
</div>

<div class="team-card">
  <div class="team-avatar">EE</div>
  <div class="team-name">Elsayed Essam</div>
  <div class="team-role">Data Engineer</div>
  <div class="team-links">
    <a href="#" title="GitHub">:material-github:</a>
    <a href="#" title="LinkedIn">:material-linkedin:</a>
  </div>
</div>

<div class="team-card">
  <div class="team-avatar">AH</div>
  <div class="team-name">Abdulrahman Hamada</div>
  <div class="team-role">Back-End Developer</div>
  <div class="team-links">
    <a href="#" title="GitHub">:material-github:</a>
    <a href="#" title="LinkedIn">:material-linkedin:</a>
  </div>
</div>

</div>

### Role Distribution

| Role | Members | Responsibilities |
|------|---------|-----------------|
| **Front-End Developer** | 1 | React UI, component design, i18n, animations |
| **Back-End Developer** | 2 | FastAPI server, REST API, auth system, database |
| **AI Engineer** | 2 | OCR pipeline, PaddleOCR/EasyOCR integration, Arabic text detection |
| **Data Engineer** | 4 | Database design, data pipelines, Azure infrastructure, deployment |

---

## Repository Structure

The project is organized as **3 independent Git repositories** under a shared parent directory:

| Repository | Remote | Description |
|-----------|--------|-------------|
| `server/` | `NassaQ/server` | FastAPI backend server |
| `ocr/` | `NassaQ/ocr-api` | OCR processing worker |
| `frontend/` | `NassaQ/User_Interface` | React frontend application |

The top-level `docker-compose.yml` and this documentation site (`docs-site/`) live outside the individual repos.

```
nassaq/
├── server/              # Backend server (own Git repo)
├── ocr/                 # OCR worker (own Git repo)
├── frontend/            # Frontend app (own Git repo)
├── docker-compose.yml   # Multi-service orchestration
└── docs-site/           # Documentation (this site)
```

---

## Internal Workflow

### Git Strategy

- Each repository has its own branching strategy
- Feature branches are created for new work
- Pull requests are reviewed by team members before merging
- Main branch is kept in a deployable state

### Code Standards

#### Python (Backend + OCR)

| Tool | Purpose |
|------|---------|
| **Ruff** | Linting and formatting |
| **Type hints** | Used throughout for documentation and IDE support |
| **Pydantic** | Schema validation for all API inputs/outputs |
| **Async/await** | Fully asynchronous codebase |

#### TypeScript (Frontend)

| Tool | Purpose |
|------|---------|
| **ESLint** | Linting with TypeScript and React Hooks plugins |
| **TypeScript** | Type safety (strict mode off, but types used) |
| **Tailwind CSS** | Utility-first styling |
| **shadcn/ui** | Consistent component library |

### Package Management

| Service | Manager | Lock File |
|---------|---------|-----------|
| Backend Server | `uv` | `uv.lock` |
| OCR Worker | `uv` | `uv.lock` |
| Frontend | `npm` | `package-lock.json` |
| Documentation | `uv` | `uv.lock` |

---

## Communication

### How the Team Coordinates

- Internal communication channels for day-to-day discussions
- Regular team meetings for sprint planning and progress reviews
- Shared documentation (this site) for technical reference

### Reporting Issues

Since this is a graduation project, issues are tracked internally. There is no public issue tracker.

---

## License

This project is developed for academic purposes as part of a graduation requirement. It is not released under an open-source license.
