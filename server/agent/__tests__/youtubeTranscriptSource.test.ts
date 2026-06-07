import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { humanReadableSource } from "../../lib/transcriptSourceLabel";

describe("humanReadableSource", () => {
  it("returns null for undefined, empty string, 'unknown', and 'cache'", () => {
    assert.equal(humanReadableSource(undefined), null);
    assert.equal(humanReadableSource(""), null);
    assert.equal(humanReadableSource("unknown"), null);
    assert.equal(humanReadableSource("cache"), null);
  });

  it("returns null for 'gemini' (attribution already present in transcript body)", () => {
    assert.equal(humanReadableSource("gemini"), null);
  });

  it("returns 'Supadata (verbatim captions)' for the supadata source", () => {
    assert.equal(humanReadableSource("supadata"), "Supadata (verbatim captions)");
  });

  it("returns 'YouTube captions (verbatim)' for all caption-based sources", () => {
    assert.equal(humanReadableSource("innertube/ANDROID"), "YouTube captions (verbatim)");
    assert.equal(humanReadableSource("innertube/WEB"), "YouTube captions (verbatim)");
    assert.equal(humanReadableSource("yt-dlp"), "YouTube captions (verbatim)");
    assert.equal(humanReadableSource("timedtext"), "YouTube captions (verbatim)");
    assert.equal(humanReadableSource("youtube-transcript"), "YouTube captions (verbatim)");
  });

  it("returns 'Whisper (AI audio transcription)' for audio-transcription sources", () => {
    assert.equal(humanReadableSource("audio-transcription"), "Whisper (AI audio transcription)");
    assert.equal(humanReadableSource("audio-transcription (auto-retry)"), "Whisper (AI audio transcription)");
  });

  it("returns 'browser' and 'local worker' for browser/worker sources", () => {
    assert.equal(humanReadableSource("browser"), "browser");
    assert.equal(humanReadableSource("local-worker"), "local worker");
  });

  it("passes through unrecognised source strings verbatim", () => {
    assert.equal(humanReadableSource("some-future-source"), "some-future-source");
  });
});
