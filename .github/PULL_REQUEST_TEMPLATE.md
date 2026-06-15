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
- [ ] `npm run docs:audit`
- [ ] Dashboard build, Android build, connector check, or other targeted test:

## Documentation

- [ ] Docs updated
- [ ] Docs not needed because:

## Focused Assertions

Check any area touched and list the targeted test or assertion that covers it:

- [ ] Provider routing / ChatGPT subscription path:
- [ ] Android daemon permissions or pairing:
- [ ] Desktop connector permissions or local shell/file access:
- [ ] Settings UI or account/provider controls:
- [ ] Storage, memory, SOUL, or G-Brain behavior:
- [ ] Deployment, release, APK, or update manifest:
- [ ] Public docs or contributor flow:

Use the focused test map in `CONTRIBUTING.md` when choosing checks.

## Remaining Risk

What still needs human review or follow-up?
