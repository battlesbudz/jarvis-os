# eyeVue glasses: local-first companion integration

Status: proposed in the first eyeVue PR.

## Decision

Jarvis owns the primary eyeVue companion connection. The glasses keep their native
physical-button and internal-storage behavior; only the AI wake route is redirected.
The firmware phrase **“Hey, Star”** starts Jarvis Talk Mode, which continues until
the user says **“Goodbye.”** A future PR may investigate changing the firmware wake
phrase to “Hey, Jarvis.”

Still images are analyzed on the Fold 6 by the already-imported Gemma 4 E4B LiteRT-LM
model. No continuous video is sent to a model. The model stays warm for visual
follow-ups until Talk Mode ends; follow-ups reuse the last temporary image unless the
user says “look again.” Jarvis announces a delay after 15 seconds and stops local
vision after 30 seconds. Cloud vision requires per-image approval.

## Privacy and storage

- A camera-button capture may remain in the glasses' native 3 GB storage.
- Jarvis's phone-side copy is temporary unless the user explicitly asks to save it.
- “Take a picture” and completed audio/video recordings require a destination prompt.
- An explicit save writes the image plus description and conversation context to both
  Gallery and MemoryOS; that persistence flow remains behind the existing approval and
  memory-storage boundaries.
- People may be described but are not identified.

## Hardware boundary

Reverse-engineered eyeVue firmware exposes AA12 command, AA14 event, and AA15 photo
characteristics. Some firmware may not emit AA15 data for a physical camera-button
press. The service logs command IDs and keeps AA15 subscribed continuously; physical
glasses acceptance testing must verify whether a media-index fallback is needed for
the user's exact CYO3 firmware.

## First-connect acceptance test

1. Grant Nearby Devices, microphone, and notification permissions.
2. Pair the eyeVue glasses in Android, enable eyeVue in Jarvis, and verify automatic
   reconnection after an app restart.
3. Say “Hey, Star” with the Fold 6 locked; Jarvis, never the vendor AI, must respond.
4. Press the camera button and verify one moderate local description with no duplicate
   native sounds and no Gallery/MemoryOS copy.
5. Ask a follow-up, then say “look again,” and verify image reuse then recapture.
6. Exercise battery/storage, photo, video start/stop, and audio start/stop commands.
7. Drop Bluetooth during Talk Mode and verify the service reconnects; start a phone
   call and verify the existing Talk Mode audio policy pauses/resumes Jarvis.
8. Disconnect Jarvis manually before opening the official eyeVue app.
