## Stage 1: Design and compatibility

**Goal**: Add local admin accounts without LDAP or new dependencies.
**Success Criteria**: Preserve the original login and existing sessions; store added passwords as bcrypt hashes in the existing persistent data directory.
**Tests**: Review login, session, password-change, and updater paths.
**Status**: Complete

## Stage 2: Backend accounts and sessions

**Goal**: Support account creation, listing, password resets, and disabling; validate account identity on every admin-authenticated route.
**Success Criteria**: Separate identities work throughout the panel; password changes and disabling revoke sessions; the original account and self-disable protection prevent lockout.
**Tests**: Service and HTTP tests for legacy compatibility, account isolation, input validation, session revocation, and unauthorized access.
**Status**: Complete

## Stage 3: Settings UI and fork updates

**Goal**: Add admin management to Settings and use the fork for frontend updates.
**Success Criteria**: Existing UI patterns work on desktop/mobile; updater does not fetch upstream UI for a fork.
**Tests**: Frontend build/lint, updater syntax and focused shell behavior checks.
**Status**: Complete

## Stage 4: Validation and handoff

**Goal**: Merge the deployed v1.1.315 baseline, validate, and publish to the user's fork.
**Success Criteria**: Relevant tests pass; the fork includes the VM's current revision and its own Bedrock change; no VM restart or live account changes occur.
**Tests**: Jest, relevant lint/format checks, frontend production build, browser checks, diff review, and ancestry check before push.
**Status**: In Progress
