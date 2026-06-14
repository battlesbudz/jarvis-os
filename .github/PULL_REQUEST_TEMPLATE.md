## Summary

Describe what changed and why.

## User-Visible Behavior

What will a Jarvis OS user, self-hoster, or maintainer notice?

## Safety / Permissions Impact

Check all that apply:

- [ ] No safety-sensitive behavior changed
- [ ] Provider routing or ChatGPT subscription path changed
- [ ] Desktop connector, daemon, or Android permissions changed
- [ ] Approval gates, memory writes, deploys, email/calendar writes, or code-change behavior changed
- [ ] Secrets, OAuth, webhook, or database handling changed

If any box except "No safety-sensitive behavior changed" is checked, explain the new boundary and how it is tested.

## Verification

List commands run:

- [ ] `npm run server:build`
- [ ] `npm run jarvis:doctor`
- [ ] `npm test`
- [ ] Dashboard build, Android build, connector check, or other targeted test:

## Documentation

- [ ] Docs updated
- [ ] Docs not needed because:

## Remaining Risk

What still needs human review or follow-up?
