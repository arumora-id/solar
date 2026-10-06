# NFR catalogue (ISO/IEC 25010 aligned) - pick what applies, always give a metric

| Category | Typical requirement | Example metric |
|---|---|---|
| Performance efficiency | Response time of synchronous APIs | p95 < 300 ms, p99 < 800 ms at 200 RPS |
| Performance efficiency | Batch / throughput | 1 M records processed < 30 min |
| Capacity / Scalability | Peak load and growth | 5x peak (1,000 RPS) via horizontal scaling, no code change |
| Availability | Service availability | 99.9 % monthly (≤ 43.8 min downtime) |
| Reliability / Recoverability | Backup and restore | RPO ≤ 15 min, RTO ≤ 1 h |
| Reliability | Fault tolerance | No single point of failure in production; retries with exponential backoff (max 3) |
| Security - Authentication | Who can access | OAuth 2.0 / OIDC, MFA for administrators |
| Security - Authorization | Least privilege | RBAC, every API checks scope; deny by default |
| Security - Confidentiality | Data protection | TLS 1.2+ in transit, AES-256 at rest, secrets in a vault |
| Security - Auditability | Traceability | Audit log of every write with user, timestamp, before/after, retained 1 year |
| Compliance | Regulation / data residency | Personal data stored in-region (e.g. Indonesia - UU PDP No. 27/2022) |
| Maintainability | Code quality & deployability | Automated CI/CD, unit test coverage ≥ 70 %, zero-downtime deployment |
| Observability | Monitoring | Structured logs, RED metrics, distributed tracing (OpenTelemetry), alert < 5 min |
| Interoperability | Standards | REST/JSON with OpenAPI 3.1 contract; events with schema registry |
| Usability / Accessibility | UI | WCAG 2.1 AA; supported browsers listed |
| Portability | Hosting | Containerised (OCI), runs on Kubernetes 1.29+ |
| Cost | Run cost | Monthly infrastructure cost ≤ agreed budget, tagged per environment |
