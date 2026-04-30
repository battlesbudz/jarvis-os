import { humanReadableSource } from "../../lib/transcriptSourceLabel";

describe("humanReadableSource", () => {
  it("returns null for undefined, empty string, 'unknown', and 'cache'", () => {
    expect(humanReadableSource(undefined)).toBeNull();
    expect(humanReadableSource("")).toBeNull();
    expect(humanReadableSource("unknown")).toBeNull();
    expect(humanReadableSource("cache")).toBeNull();
  });

  it("returns null for 'gemini' (attribution already present in transcript body)", () => {
    expect(humanReadableSource("gemini")).toBeNull();
  });

  it("returns 'Supadata (verbatim captions)' for the supadata source", () => {
    expect(humanReadableSource("supadata")).toBe("Supadata (verbatim captions)");
  });

  it("returns 'YouTube captions (verbatim)' for all caption-based sources", () => {
    expect(humanReadableSource("innertube/ANDROID")).toBe("YouTube captions (verbatim)");
    expect(humanReadableSource("innertube/WEB")).toBe("YouTube captions (verbatim)");
    expect(humanReadableSource("yt-dlp")).toBe("YouTube captions (verbatim)");
    expect(humanReadableSource("timedtext")).toBe("YouTube captions (verbatim)");
    expect(humanReadableSource("youtube-transcript")).toBe("YouTube captions (verbatim)");
  });

  it("returns 'Whisper (AI audio transcription)' for audio-transcription sources", () => {
    expect(humanReadableSource("audio-transcription")).toBe("Whisper (AI audio transcription)");
    expect(humanReadableSource("audio-transcription (auto-retry)")).toBe("Whisper (AI audio transcription)");
  });

  it("returns 'browser' and 'local worker' for browser/worker sources", () => {
    expect(humanReadableSource("browser")).toBe("browser");
    expect(humanReadableSource("local-worker")).toBe("local worker");
  });

  it("passes through unrecognised source strings verbatim", () => {
    expect(humanReadableSource("some-future-source")).toBe("some-future-source");
  });
});
