## Current

- Done: service, real auth middleware/routes, CLI recovery preservation, and Settings UI implemented. New account passwords are bcrypt hashes in init.json; account revisions invalidate tokens on password/status changes. Sanitized frontend request-error logging to exclude credential payloads.
- Validation: 25 service/HTTP tests and 11 updater tests pass. Full Jest run using the example config via moduleNameMapper: 126 passed, 8 existing skipped. Backend lint and focused frontend lint pass. Frontend build passes with existing console/asset-size/Browserslist warnings. Browser checks pass for create, password confirmation/reset, disable/re-enable, and desktop/mobile layout.
- Review: fixed awaited refresh persistence/configured TTL regression identified by review; no auth bypass found. Admin backups require init.json; concurrent writers across multiple processes are outside the existing single-process deployment model.
- Done: merged the deployed v1.1.315 revision without conflicts and preserved the fork's Bedrock change. On the merged baseline, 415 tests pass and 8 existing tests are skipped; backend lint and frontend build pass.
- Next: publish main, run a detached VM update, and create/verify `melson` as requested. Supplied credentials will not be stored in Git or printed in logs.
- Blocked: none. VM remains unchanged.

## Discovery

- Local checkout started clean on fork main. VM runs Node directly and has not been changed.
- Existing updater fetches fork backend but prefers upstream UI. Separate worktrees isolate frontend/updater edits; auth review shares the root checkout read-only.
