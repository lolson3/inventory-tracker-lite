# Follow-up hardening audit

Date: 2026-09-15

## Result

Update: access-token authentication and its frontend form were removed at the user’s request. Network access now determines who can use the tracker.

No unresolved high-severity issue was identified in the reviewed implementation for the documented single-server deployment. This is a code review and regression assessment, not an independent penetration test or a guarantee against vulnerabilities.

The original whole-document replacement API is removed. SQLite transactions, unique barcode constraints, atomic increments, revision checks, and persistent request IDs address concurrent saves and lost responses. Runtime input validation rejects malformed operations before mutation. Tests also inject a database failure after mutation but before receipt creation and verify that the entire transaction rolls back.

The frontend is TypeScript, uses an external script compatible with the restrictive CSP, blocks editing until loading succeeds, and retains failed requests for safe retry. DOM tests cover hostile text, the former `all` type-name collision, failure states, and successful retry cleanup. The tracker now opens without authentication, as requested by the user.

The server defaults to loopback, validates host/origin, restricts served files, and applies body, header, connection, timeout, and request-rate limits. The deployment examples put HTTPS at the reverse proxy and restrict the runtime account's filesystem access.

## Verification

- `npm test`: **46 passed, 0 failed** on Windows with Node 24.18.1.
- `npm run typecheck`: passed.
- `npm run format:check`: passed.
- `npm audit --json`: zero known vulnerabilities across the installed dependency graph.
- Windows launcher smoke test: launched from the parent directory, served the page and all frontend modules, and preserved a temporary copy of the existing inventory.
- Live migration: compared every barcode, alias, description, quantity, and assigned type; **19 items and five types preserved**. A SQLite backup was opened and compared before the legacy JSON was deleted at the user's request.
- Runtime database and backups are ignored by Git. The old JSON is removed from the index and working directory; it remains in previous commits.
- Linux and Windows CI jobs are defined. The Linux job, Debian service units, reverse proxy, and shell launcher have not been executed in this Windows environment. Shell and deployment file line endings are enforced with Git attributes.

## Issues found and resolved during follow-up

1. A backup command could initialize an empty database file. Backup now requires an already initialized database, with a regression test.
2. A successful retry left the scan input populated. Retry now clears the submitted scan/type/link input after acknowledgement, with a DOM regression test.
3. Migration validation trimmed descriptions. Descriptions now retain their exact text; tests include surrounding whitespace and the live migration compared original descriptions exactly.

## Remaining limitations and deployment work

- **Published history:** previously committed JSON is still available in Git history. Removing historical copies requires a separate coordinated history rewrite and cannot retract copies already downloaded.
- **Deployment validation:** verify Node's installed path, TLS trust, LAN DNS, firewall rules, service permissions, and timer execution on the actual Debian server before use. The supplied defaults do not expose Node directly to the LAN.
- **Shared access:** anyone who can reach the tracker can view, edit, or clear inventory. Individual accounts, roles, and actor-attributed history are not implemented.
- **Pending changes:** failed requests and unsaved scan batches are retained within the open page, with an unload warning. They do not survive a forced tab/browser close. Batch scanning uses a 150 ms pause to delimit suffix-free scans and commits the batch atomically on Enter or Done. Physical scanner timing still needs verification on the target device.
- **Capacity:** reads and responses contain the full inventory and the frontend renders it in full. Pagination or incremental refresh is the next scaling step. The global limiter is intentionally coarse; one client can consume its allowance. Use proxy-level client limits if needed.
- **Retention:** request receipts and timestamped backups accumulate. Monitor disk space, set an external backup retention policy, and keep off-server backups. Do not casually delete request receipts: doing so changes retry guarantees.
- **Recovery:** automatic migration happens only during database initialization. Keep the verified SQLite backup. Do not delete a database to troubleshoot startup, and rehearse restore on the deployed server.
- **Browser scope:** frontend tests use jsdom, not a real browser or physical barcode scanner. Exercise the complete scanning workflow on target devices before operational rollout.

## References checked

- [Node SQLite and backup API](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)
- [systemd filesystem restrictions and state directories](https://manpages.debian.org/trixie/systemd/systemd.exec.5.en.html)

Deployment and recovery commands are in [README.md](README.md).
