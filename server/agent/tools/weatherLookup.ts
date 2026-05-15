import type { AgentTool } from "../types";

type GeocodeResult = {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
  timezone?: string;
};

type ForecastResponse = {
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
    wind_speed_10m_max?: number[];
  };
};

const WEATHER_CODE_LABELS: Record<number, string> = {
  0: "clear",
  1: "mostly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "foggy",
  48: "foggy",
  51: "light drizzle",
  53: "drizzle",
  55: "heavy drizzle",
  61: "light rain",
  63: "rain",
  65: "heavy rain",
  71: "light snow",
  73: "snow",
  75: "heavy snow",
  80: "light showers",
  81: "showers",
  82: "heavy showers",
  95: "thunderstorms",
  96: "thunderstorms with hail",
  99: "severe thunderstorms with hail",
};

function labelWeather(code: number | undefined): string {
  if (code == null) return "conditions unavailable";
  return WEATHER_CODE_LABELS[code] ?? `weather code ${code}`;
}

function chooseForecastIndex(times: string[] | undefined, requestedDate: string | undefined): number {
  if (!times?.length) return 0;
  if (requestedDate) {
    const exact = times.indexOf(requestedDate);
    if (exact >= 0) return exact;
  }
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const tomorrowIndex = times.indexOf(tomorrow);
  return tomorrowIndex >= 0 ? tomorrowIndex : Math.min(1, times.length - 1);
}

function normalizeLocationCandidates(location: string): string[] {
  const normalized = location.trim().toLowerCase().replace(/\s+/g, " ");
  const withoutCountry = normalized.replace(/,\s*(usa|us|united states|united states of america)$/i, "").trim();
  const aliases: Record<string, string[]> = {
    "nyc": ["New York"],
    "new york city": ["New York"],
    "new york, ny": ["New York"],
    "new york ny": ["New York"],
    "manhattan": ["Manhattan", "New York"],
    "manhattan, ny": ["Manhattan", "New York"],
    "brooklyn, ny": ["Brooklyn", "New York"],
    "queens, ny": ["Queens", "New York"],
    "bronx, ny": ["Bronx", "New York"],
    "staten island, ny": ["Staten Island", "New York"],
  };

  const candidates = [location.trim(), ...(aliases[withoutCountry] ?? [])].filter(Boolean);
  return [...new Set(candidates)];
}

function scoreGeocodeResult(place: GeocodeResult, requestedLocation: string): number {
  const text = requestedLocation.toLowerCase();
  let score = 0;
  if (place.country === "United States") score += 2;
  if (/\bny\b|new york|nyc|manhattan|brooklyn|queens|bronx|staten island/.test(text)) {
    if (place.admin1 === "New York") score += 6;
    if (place.name === "New York") score += 4;
  }
  if (place.name.toLowerCase() === requestedLocation.trim().toLowerCase()) score += 3;
  return score;
}

async function geocodeLocation(location: string, signal?: AbortSignal): Promise<GeocodeResult | undefined> {
  for (const candidate of normalizeLocationCandidates(location)) {
    const geocodeUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
    geocodeUrl.searchParams.set("name", candidate);
    geocodeUrl.searchParams.set("count", "10");
    geocodeUrl.searchParams.set("language", "en");
    geocodeUrl.searchParams.set("format", "json");

    const geocodeRes = await fetch(geocodeUrl, { signal });
    if (!geocodeRes.ok) throw new Error(`geocoding failed (${geocodeRes.status})`);
    const geocodeJson = await geocodeRes.json() as { results?: GeocodeResult[] };
    const places = geocodeJson.results ?? [];
    if (places.length === 0) continue;
    return [...places].sort((a, b) => scoreGeocodeResult(b, location) - scoreGeocodeResult(a, location))[0];
  }
  return undefined;
}

export const weatherLookupTool: AgentTool = {
  name: "weather_lookup",
  description:
    "Get a current no-key weather forecast for a city or place using Open-Meteo. Use this for weather, temperature, rain, snow, or forecast questions. If the user did not provide a location and no location is obvious from context, ask for the city/state before calling.",
  parameters: {
    type: "object",
    properties: {
      location: {
        type: "string",
        description: "City/place to forecast, ideally with state/country, e.g. 'Pittsburgh, PA' or 'Orlando, Florida'.",
      },
      date: {
        type: "string",
        description: "Optional ISO date YYYY-MM-DD. If omitted, returns tomorrow's forecast.",
      },
    },
    required: ["location"],
  },
  async execute(args, ctx) {
    const location = String(args.location ?? "").trim();
    const date = typeof args.date === "string" ? args.date.trim() : undefined;
    if (!location) {
      return {
        ok: false,
        label: "Weather needs a location",
        content: "I need a city or place before I can check the forecast.",
      };
    }

    try {
      const place = await geocodeLocation(location, ctx.signal);
      if (!place) {
        return {
          ok: false,
          label: "Location not found",
          content: `I couldn't find a weather location matching "${location}". Ask the user for a nearby city/state.`,
        };
      }

      const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
      forecastUrl.searchParams.set("latitude", String(place.latitude));
      forecastUrl.searchParams.set("longitude", String(place.longitude));
      forecastUrl.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max");
      forecastUrl.searchParams.set("temperature_unit", "fahrenheit");
      forecastUrl.searchParams.set("wind_speed_unit", "mph");
      forecastUrl.searchParams.set("timezone", "auto");
      forecastUrl.searchParams.set("forecast_days", "7");

      const forecastRes = await fetch(forecastUrl, { signal: ctx.signal });
      if (!forecastRes.ok) throw new Error(`forecast failed (${forecastRes.status})`);
      const forecast = await forecastRes.json() as ForecastResponse;
      const daily = forecast.daily;
      const index = chooseForecastIndex(daily?.time, date);
      const forecastDate = daily?.time?.[index] ?? date ?? "tomorrow";
      const placeLabel = [place.name, place.admin1, place.country].filter(Boolean).join(", ");

      const high = daily?.temperature_2m_max?.[index];
      const low = daily?.temperature_2m_min?.[index];
      const rain = daily?.precipitation_probability_max?.[index];
      const wind = daily?.wind_speed_10m_max?.[index];
      const condition = labelWeather(daily?.weather_code?.[index]);

      const parts = [
        `Forecast for ${placeLabel} on ${forecastDate}: ${condition}.`,
        high != null && low != null ? `High ${Math.round(high)}°F, low ${Math.round(low)}°F.` : "",
        rain != null ? `Precipitation chance up to ${Math.round(rain)}%.` : "",
        wind != null ? `Wind up to ${Math.round(wind)} mph.` : "",
        "Source: Open-Meteo.",
      ].filter(Boolean);

      return {
        ok: true,
        label: `Weather: ${placeLabel}`,
        content: parts.join(" "),
        detail: JSON.stringify({ source: "open-meteo", location: placeLabel, date: forecastDate }),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        label: "Weather lookup failed",
        content: `Weather lookup failed: ${message}`,
      };
    }
  },
};
