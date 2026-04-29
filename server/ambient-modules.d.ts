declare module "pg" {
  export interface Pool {
    connect(): Promise<PoolClient>;
    query(text: string, values?: unknown[]): Promise<QueryResult>;
    end(): Promise<void>;
  }

  export interface PoolClient {
    query(text: string, values?: unknown[]): Promise<QueryResult>;
    release(err?: Error | boolean): void;
  }

  export interface QueryResult {
    rows: unknown[];
    rowCount: number | null;
    command: string;
    fields: FieldDef[];
  }

  export interface FieldDef {
    name: string;
    dataTypeID: number;
  }

  export interface PoolConfig {
    connectionString?: string;
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
    ssl?: boolean | Record<string, unknown>;
    max?: number;
    idleTimeoutMillis?: number;
    connectionTimeoutMillis?: number;
  }

  export class Pool {
    constructor(config?: PoolConfig);
    connect(): Promise<PoolClient>;
    query(text: string, values?: unknown[]): Promise<QueryResult>;
    end(): Promise<void>;
    on(event: string, callback: (...args: unknown[]) => void): this;
  }

  const pg: { Pool: typeof Pool };
  export default pg;
}

declare module "yt-search" {
  export interface VideoResult {
    videoId: string;
    url: string;
    title: string;
    description: string;
    image: string;
    thumbnail: string;
    seconds: number;
    timestamp: string;
    duration: { seconds: number; timestamp: string; toString(): string };
    ago: string;
    views: number;
    author: { name: string; url: string };
  }

  export interface SearchResult {
    videos: VideoResult[];
    playlists: unknown[];
    accounts: unknown[];
  }

  function ytSearch(options: string | { query: string; pageStart?: number; pageEnd?: number }): Promise<SearchResult>;
  export default ytSearch;
}

declare module "youtube-transcript/dist/youtube-transcript.esm.js" {
  export interface TranscriptSegment {
    text: string;
    start: number;
    duration: number;
    offset: number;
  }

  export class YoutubeTranscript {
    static fetchTranscript(url: string, config?: { lang?: string }): Promise<TranscriptSegment[]>;
  }
}
