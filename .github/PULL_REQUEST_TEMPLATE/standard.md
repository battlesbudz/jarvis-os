## Summary

- 

## User-Visible Behavior

What will a Jarvis OS user, self-hoster, or maintainer notice?

## Safety / Permissions Impact

- [ ] No safety-sensitive behavior changed
- [ ] Provider routing or ChatGPT subscription path changed
- [ ] Desktop connector, daemon, or Android permissions changed
- [ ] Approval gates, memory writes, deploys, email/calendar writes, or code-change behavior changed
- [ ] Secrets, OAuth, webhook, database, release, or APK handling changed

## Focused Assertions

List targeted tests for every sensitive area touched:

- Provider routing:
- Android daemon:
- Desktop connector:
- Settings UI:
- Storage/memory:
- Deployment/release:

## Verification

- [ ] `npm run docs:audit`
- [ ] `npm run server:build`
- [ ] `npm run jarvis:doctor`
- [ ] `npm test`
- [ ] Dashboard, Android, connector, or deployment-specific check:

## Remaining Risk

What still needs human review or follow-up?
