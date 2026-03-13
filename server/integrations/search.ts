export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

export interface TavilyResponse {
  answer?: string;
  results: SearchResult[];
}

export async function tavilySearch(query: string, maxResults: number = 5): Promise<TavilyResponse> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error('TAVILY_API_KEY not set');

  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'basic',
      max_results: maxResults,
      include_answer: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Tavily error ${res.status}: ${text}`);
  }

  return res.json() as Promise<TavilyResponse>;
}

export function formatSearchResults(result: TavilyResponse): string {
  const parts: string[] = [];
  if (result.answer) parts.push(`Summary: ${result.answer}`);
  for (const r of result.results) {
    parts.push(`- ${r.title} (${r.url})\n  ${r.content.slice(0, 300)}`);
  }
  return parts.join('\n\n');
}
