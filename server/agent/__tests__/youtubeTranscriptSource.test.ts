import { humanReadableSource } from "../tools/youtubeTranscript";

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

  it("returns 'Supadata' for the supadata source", () => {
    expect(humanReadableSource("supadata")).toBe("Supadata");
  });

  it("returns 'YouTube captions' for all caption-based sources", () => {
    expect(humanReadableSource("innertube/ANDROID")).toBe("YouTube captions");
    expect(humanReadableSource("innertube/WEB")).toBe("YouTube captions");
    expect(humanReadableSource("yt-dlp")).toBe("YouTube captions");
    expect(humanReadableSource("timedtext")).toBe("YouTube captions");
    expect(humanReadableSource("youtube-transcript")).toBe("YouTube captions");
  });

  it("returns 'Whisper (audio)' for audio-transcription sources", () => {
    expect(humanReadableSource("audio-transcription")).toBe("Whisper (audio)");
    expect(humanReadableSource("audio-transcription (auto-retry)")).toBe("Whisper (audio)");
  });

  it("returns 'browser' and 'local worker' for browser/worker sources", () => {
    expect(humanReadableSource("browser")).toBe("browser");
    expect(humanReadableSource("local-worker")).toBe("local worker");
  });

  it("passes through unrecognised source strings verbatim", () => {
    expect(humanReadableSource("some-future-source")).toBe("some-future-source");
  });
});
