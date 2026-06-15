# Android Unified Daemon Release Checklist

- [ ] Build unified Jarvis APK.
- [ ] Install on physical Android device.
- [ ] Log in to Jarvis.
- [ ] Open Profile -> Android Device.
- [ ] Generate pair code.
- [ ] Start integrated device control from the main app.
- [ ] Grant Accessibility Service.
- [ ] Grant Notification Access.
- [ ] Grant All Files Access.
- [ ] Verify `/api/channels/status` reports `android_daemon_connected: true`.
- [ ] Run `daemon_action` smoke ops: ping, read screen, screenshot, open app.
- [ ] Verify tap/type remains blocked until Android tap/type permission is enabled.
- [ ] Enable tap/type and run one operator action with explicit approval.
- [ ] Reboot the phone and verify boot reconnect.
- [ ] Confirm the old standalone Jarvis Daemon app can be uninstalled.
