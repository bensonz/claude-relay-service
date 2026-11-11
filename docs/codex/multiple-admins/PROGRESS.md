## Current

- Done: service, real auth middleware/routes, CLI recovery preservation, and Settings UI implemented. New account passwords are bcrypt hashes in init.json; account revisions invalidate tokens on password/status changes. Sanitized frontend request-error logging to exclude credential payloads.
- Validation: 25 service/HTTP tests and 11 updater tests pass. Full Jest run using the example config via moduleNameMapper: 126 passed, 8 existing skipped. Backend lint and focused frontend lint pass. Frontend build passes with existing console/asset-size/Browserslist warnings. Browser checks pass for create, password confirmation/reset, disable/re-enable, and desktop/mobile layout.
- Review: fixed awaited refresh persistence/configured TTL regression identified by review; no auth bypass found. Admin backups require init.json; concurrent writers across multiple processes are outside the existing single-process deployment model.
- Next: user authorized syncing the fork to deployed v1.1.315 and publishing main. Revalidate the merged baseline before push.
- Blocked: none. VM remains unchanged.

## Discovery

- Local checkout started clean on fork main. VM runs Node directly and has not been changed.
- Existing updater fetches fork backend but prefers upstream UI. Separate worktrees isolate frontend/updater edits; auth review shares the root checkout read-only.
