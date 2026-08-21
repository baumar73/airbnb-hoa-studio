# Airbnb HOA Studio Brief

## Scope
Work only inside this sanitized repository. The current assignment is limited to `portal/`.
Do not modify `operations/` in this assignment.

## Safety invariants
- Never deploy or call production services.
- Never send email, submit an HOA package, approve a case, or infer approval from inbound email.
- Guest save may only persist a draft. It must never trigger HOA submission.
- A guest must never be added automatically to HOA submission recipients.
- Live submission remains blocked until secure IDs and the applicable fee evidence or confirmed waiver are present.
- Do not add SSN collection or identity-document upload to the portal.
- Preserve same-origin mutation checks and closed access for canceled cases.
- Do not invent or reconstruct real people, identifiers, addresses, credentials, documents, or production namespace IDs.
- Missing PDF templates are intentional in this external-model workspace. Do not fabricate replacements.

## Required engineering workflow
1. Inspect the implementation and existing tests before editing.
2. Use test-driven development. Add a failing regression test before each behavior change.
3. Preserve every existing passing test.
4. Add safe route-level tests for state-changing guest POST paths. Mock storage and outbound integrations. Assert no outbound HOA submission or email occurs from guest save.
5. Inspect and fix these known product defects if still present:
   - draft adult slots must retain their original indexes when names are blank;
   - signature controls must remain attached to the correct adult slot;
   - progress labels/counts must match the actual workflow state;
   - the middle-name field/column must remain usable at supported viewport widths;
   - preview and production KV configuration must remain isolated;
   - secure photo-ID handoff must remain explicitly unresolved rather than being replaced by insecure upload or email.
6. Update vulnerable development dependencies conservatively if a compatible fixed version exists. Do not use force upgrades. Preserve lockfile reproducibility.
7. Run and report:
   - `npm test`
   - `npm run check`
   - `npm run build`
   - `npm audit --json`
8. Commit only verified changes to the current Git branch with a descriptive message.

## Acceptance criteria
- Existing tests and new regression tests pass.
- Build succeeds.
- No production call or deployment occurs.
- No weakening of the safety invariants.
- Final response lists changed files, tests added, exact command outcomes, remaining risks, and commit id.
