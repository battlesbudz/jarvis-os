## Summary

- 

## Sensitive Area

- [ ] Provider routing / ChatGPT subscription path
- [ ] Approval gates or external actions
- [ ] Memory, SOUL, G-Brain, or stored user context
- [ ] Desktop connector local shell/file access
- [ ] Android daemon permissions or pairing
- [ ] OAuth, secrets, webhooks, or database credentials
- [ ] Deployment, release, APK, or update manifests

## Boundary Explanation

Explain the exact boundary before and after this change.

## Required Focused Tests

List targeted tests or assertions that prove the sensitive path still behaves correctly:

- 

Use the focused test map in `CONTRIBUTING.md` when choosing checks.

## Verification

- [ ] `npm run docs:audit`
- [ ] `npm run server:build`
- [ ] `npm run jarvis:doctor`
- [ ] `npm test`
- [ ] Relevant focused test:

## Remaining Risk

What should reviewers inspect carefully?
