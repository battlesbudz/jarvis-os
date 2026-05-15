import assert from "node:assert";
import { weatherLookupTool } from "../tools/weatherLookup";

const originalFetch = globalThis.fetch;

async function run() {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url.toString());
    if (url.hostname === "geocoding-api.open-meteo.com") {
      if (url.searchParams.get("name") !== "New York") {
        return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        results: [
          { name: "New York", latitude: 40.7128, longitude: -74.006, country: "United States", admin1: "New York" },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.hostname === "api.open-meteo.com") {
      return new Response(JSON.stringify({
        daily: {
          time: ["2026-05-15", "2026-05-16"],
          weather_code: [0, 61],
          temperature_2m_max: [70, 72],
          temperature_2m_min: [55, 58],
          precipitation_probability_max: [10, 40],
          wind_speed_10m_max: [8, 12],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected fetch: ${url.toString()}`);
  }) as typeof fetch;

  try {
    const result = await weatherLookupTool.execute(
      { location: "New York, NY", date: "2026-05-16" },
      { userId: "test-user", channel: "test", state: {}, signal: undefined } as any,
    );
    assert.equal(result.ok, true);
    assert.match(result.content, /Forecast for New York, New York, United States/);
    assert.match(result.content, /rain/i);
    assert.ok(calls.some((url) => url.includes("name=New+York")), "NYC alias should geocode as New York");
    console.log("weather lookup NYC alias assertions passed");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
