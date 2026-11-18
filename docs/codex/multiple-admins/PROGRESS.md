## Current

- Complete: deployed `8e964fb` on 2026-11-18 and switched VM origin to `bensonz/claude-relay-service`. Created the requested `melson` full admin with the supplied password. Original login, new login, profile identity, and protected dashboard access passed; health is healthy and the public Settings bundle checksum matches the tested local build.
- Runtime: CRS is at `http://35.200.116.88:3000/admin-next/login`. The existing Caddy HTTPS site serves a separate static page, so it is not the CRS login URL. No proxy/TLS settings were changed. Future fork updates use `sudo crs update` on this root-owned installation.
- Deployment evidence: `/root/crs-admin-deploy.4hj33vf0/status` is SUCCESS; `result.json` records login/API checks. `complete.log` records the successful restart. The credential input was overwritten after use; added passwords are bcrypt hashes in the existing `data/init.json` (mode 0600).
- Build adjustment: the VM's frontend compilation remained CPU-bound for several minutes. Stopped only the deployment build processes, then uploaded the already tested frontend bundle from the same commit (SHA-256 `34975bfdc6fa0d5b0e9976f536f87ff85387e721914e07ddd697185a7b0ea22b`). The detached completion script installed it, restarted CRS, and provisioned/verified the account. The prior server source and UI remain in the protected job directory as fallback; fallback was not needed.
- Done: service, real auth middleware/routes, CLI recovery preservation, and Settings UI implemented. New account passwords are bcrypt hashes in init.json; account revisions invalidate tokens on password/status changes. Sanitized frontend request-error logging to exclude credential payloads.
- Validation: 25 service/HTTP tests and 11 updater tests pass. Full Jest run using the example config via moduleNameMapper: 126 passed, 8 existing skipped. Backend lint and focused frontend lint pass. Frontend build passes with existing console/asset-size/Browserslist warnings. Browser checks pass for create, password confirmation/reset, disable/re-enable, and desktop/mobile layout.
- Review: fixed awaited refresh persistence/configured TTL regression identified by review; no auth bypass found. Admin backups require init.json; concurrent writers across multiple processes are outside the existing single-process deployment model.
- Done: merged the deployed v1.1.315 revision without conflicts and preserved the fork's Bedrock change. On the merged baseline, 415 tests pass and 8 existing tests are skipped; backend lint and frontend build pass.
- Next: none for the requested feature and account. Back up `data/init.json` with normal application data.
- Blocked: none. GCloud's active account lacks compute lookup permission; the VM work used existing authenticated SSH access.

## Discovery

- Local checkout started clean on fork main. VM runs Node directly and has not been changed.
- Existing updater fetches fork backend but prefers upstream UI. Separate worktrees isolate frontend/updater edits; auth review shares the root checkout read-only.
