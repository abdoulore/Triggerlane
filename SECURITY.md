# Security Policy

## Supported Version

Security fixes are applied to the latest code on the default branch. This project is currently a pre-release sandbox and does not maintain parallel supported release lines.

## Reporting a Vulnerability

Please do not disclose a suspected vulnerability in a public issue, discussion, or social post.

Use GitHub's private vulnerability reporting or Security Advisories for this repository. Include:

- the affected route, component, or commit;
- clear reproduction steps;
- the observed and expected behavior;
- the likely impact;
- any proof-of-concept material that can be shared safely.

Reports will be reviewed on a best-effort basis. There is currently no paid bug-bounty program.

## Security Boundary

Triggerlane is a simulated trading sandbox. It is not approved for custody, real trading, or production financial activity. Do not provide it with:

- private keys or seed phrases;
- exchange or brokerage credentials;
- real wallet signing permissions;
- production customer data;
- secrets copied from another environment.

Live market data is monitoring-only, sandbox balances have no monetary value, and the Rialo adapter is not configured for network execution.

## Deployment Guidance

Anyone deploying the project is responsible for, at minimum:

- replacing `SESSION_SECRET` with a unique high-entropy secret;
- serving the application over HTTPS;
- restricting `WEB_ORIGIN` to the deployed web application;
- keeping environment files and `.data/` out of version control;
- applying dependency updates and reviewing their security advisories;
- protecting PGlite data and backups with appropriate filesystem access;
- disabling any feature whose external provider contract has not been verified.

Never enable the Rialo execution feature flags unless the network, toolchain, permissions, feeds, lifecycle semantics, and execution venue have all been independently verified.
