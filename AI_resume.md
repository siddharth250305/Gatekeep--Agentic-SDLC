# Rathod Adesh Siddhartha
Karlskrona, Sweden | adrt25@student.bth.se | +46 0793256688 | [LinkedIn](https://linkedin.com)

---

## Profile
Master’s student in Software Engineering at Blekinge Institute of Technology with expertise in Python, PostgreSQL, React, FastAPI, and multi-agent AI systems (LangGraph). Passionate about software architecture, system design, and building reliable human-in-the-loop automation pipelines. Proven ability to translate complex engineering workflows and regulatory frameworks into high-precision, governed software solutions.

---

## Education

**Blekinge Institute of Technology** | Karlskrona, Sweden  
*Master of Science in Software Engineering* | Expected June 2027

**Jawaharlal Nehru Technological University** | Hyderabad, India  
*Bachelor of Technology in Computer Science and Engineering* | Graduated 2025

---

## Technical Skills

* **Programming Languages & Technologies:** Python, PostgreSQL, React, TypeScript, FastAPI, JavaScript, HTML/CSS
* **AI & Machine Learning Frameworks:** LangGraph, LangChain, Gemini API, OpenAI API, LLM Structured Outputs (Pydantic), Google OKF, LlamaParse, Unstructured OCR
* **Core Competencies:** Multi-Agent Orchestration, Human-in-the-Loop (HITL) Systems, Software Architecture, System Design, Tamper-Evident Audit Logging, Deterministic Sandboxing, REST API Development
* **DevOps & Tools:** Git, Docker, Docker Compose, Linux Container Isolation, CI/CD Workflows

---

## Projects

### **GateKeep — Governed Multi-Agent Software Pipeline** | [GitHub Link]
*Governed multi-agent orchestration pipeline turning feature briefs into verified code with human approval gates, isolated sandboxes, and tamper-evident audit logs.*
- Built an **event-driven multi-agent orchestration pipeline** (LangGraph, FastAPI) across Requirements, Design, and Coding agents, utilizing `interrupt()` and PostgreSQL checkpointing (`AsyncPostgresSaver`) to pause and resume workflows across server restarts.
- Engineered a **self-healing code execution engine** that runs tests inside isolated Docker containers (zero network, resource limits), automatically feeding pytest failure traces back to the code agent for iterative self-correction.
- Architected a **tamper-evident SHA-256 hash-chained audit trail** with cryptographic verification endpoints, enforcing role-based gate sign-offs (Requester, Planner, Engineer) and database-level artifact locking.
- Developed a **reviewer dashboard (React + TypeScript)** featuring real-time run progression, token/cost analytics per phase, test output diffs, and rejection-with-feedback loops.
* **Tech:** Python · LangGraph · FastAPI · PostgreSQL · Docker · React · TypeScript · Pydantic · pytest

### **CarbonLenz AI — Carbon Compliance Scanner for EU Importers** | [GitHub Link]
*AI-powered tool that scans supplier PDFs, validates carbon emission data against EU CBAM regulations, and forecasts financial exposure across 2026–2034.*
- Built an **LLM extraction pipeline** (Gemini/OpenAI Structured Outputs + OCR) to parse unstructured supplier certificates into structured JSON — extracting 12+ compliance fields automatically.
- Developed a **deterministic rules engine** with zero hallucination risk — separating AI document parsing from exact regulatory calculations (default markups, phase-in factors, certificate pricing).
- Implemented **Supplier Risk Scoring (0–100)** by validating extracted evidence against EU Annex VI verification requirements, flagging missing verifier credentials, methodology gaps, and emission data splits.
- Built an **interactive dashboard (React)** with dark-mode UI, year-by-year cost comparison charts, and one-click PDF report generation — demonstrating **€46K+/year potential savings** per supplier.
* **Tech:** Python · FastAPI · React · Gemini/OpenAI API · Google OKF · LlamaParse · Vanilla CSS

### **Automatic Exam Seating Arrangement System**
- Developed a software solution to automate exam seating allocation in a structured and efficient way.
- Reduced manual effort by organizing seating based on defined logic and constraint satisfaction algorithms.
- Strengthened practical skills in system design, algorithmic problem solving, and backend logic.

### **Real-Time Emotion Detection in Online Classes**
- Built an AI-based system to detect student emotional engagement during live online classes.
- Processed real-time video/image inputs and applied computer vision and AI classification models to generate actionable analytics.
- Gained hands-on experience in real-time stream processing, intelligent system architecture, and UI analytics.

---

## Additional Information
Currently based in Sweden and actively seeking internship or working student opportunities in Software Engineering, AI/LLM Development, Full-Stack Web Development, or Data Analytics.
