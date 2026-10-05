---
applyTo: "security/**,infra/**,tests/security/**"
---

# Security work

- Least privilege. Every identity gets the narrowest role at the narrowest scope that works; say which and why in the pull request.
- No shared keys where Microsoft Entra authentication is available. If a key is unavoidable, it lives in Key Vault and the reason is written in `docs/verify-list.md`.
- A control counts as built when a test in `tests/security/` proves it blocks what it should and lets normal use through.
- The security fixtures in the scenario file exist to test defences in this demo. Do not add other attack content, and do not weaken a control to make a test pass.
- Portal-only settings (Purview, parts of Defender, Agent 365, Teams) are documented step by step in `docs/manual-steps.md`, each with the documentation link and a way to check the result.
