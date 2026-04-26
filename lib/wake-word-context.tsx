import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { router } from 'expo-router';
import { fetch as expoFetch } from 'expo/fetch';
import { useAuth, getAuthToken } from '@/lib/auth-context';
import { getApiUrl } from '@/lib/query-client';

export interface WakeEvent {
  phrase: string;
  transcript: string;
  /** True when the Android daemon is handling the voice turn end-to-end (Talk Mode).
   *  When this is set, the app should NOT start its own mic session to avoid
   *  competing capture pipelines. */
  daemonHandling: boolean;
}

interface WakeWordContextValue {
  pendingWakeEvent: WakeEvent | null;
  clearWakeEvent: () => void;
}

const WakeWordContext = createContext<WakeWordContextValue>({
  pendingWakeEvent: null,
  clearWakeEvent: () => {},
});

export function useWakeWord(): WakeWordContextValue {
  return useContext(WakeWordContext);
}

/**
 * Parse complete SSE events from accumulated buffer text.
 * SSE events are delimited by double newlines (\n\n).
 * Returns [parsedEvents, remainingBuffer].
 */
function parseSseEvents(buffer: string): [Array<Record<string, string>>, string] {
  const events: Array<Record<string, string>> = [];
  // Split on double-newline boundaries to get complete event blocks
  const blocks = buffer.split(/\n\n/);
  // Last block is potentially incomplete — keep it in the buffer
  const remaining = blocks.pop() ?? '';
  for (const block of blocks) {
    const fields: Record<string, string> = {};
    for (const line of block.split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const field = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      if (field) fields[field] = value;
    }
    if (Object.keys(fields).length > 0) events.push(fields);
  }
  return [events, remaining];
}

/**
 * App-level provider that maintains a persistent SSE connection to
 * /api/voice/wake-events regardless of which screen is active.
 *
 * When a wake word fires:
 *  1. Navigates to the Insights tab so the mic UI is visible
 *  2. Stores the event in pendingWakeEvent so insights.tsx starts recording
 */
export function WakeWordProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [pendingWakeEvent, setPendingWakeEvent] = useState<WakeEvent | null>(null);
  const abortedRef = useRef(false);
  const connectingRef = useRef(false);

  const clearWakeEvent = useCallback(() => setPendingWakeEvent(null), []);

  useEffect(() => {
    if (!isAuthenticated) return;

    abortedRef.current = false;

    const connect = () => {
      if (abortedRef.current || connectingRef.current) return;
      connectingRef.current = true;

      getAuthToken().then(token => {
        if (abortedRef.current || !token) {
          connectingRef.current = false;
          return;
        }
        const url = new URL('/api/voice/wake-events', getApiUrl()).toString();
        expoFetch(url, { headers: { Authorization: `Bearer ${token}` } })
          .then(res => {
            connectingRef.current = false;
            if (abortedRef.current || !res.body) return;
            const reader = res.body.getReader();
            const decode = new TextDecoder();
            let buffer = '';

            const pump = (): void => {
              reader.read().then(({ done, value }) => {
                if (done || abortedRef.current) return;
                // Accumulate chunks and parse complete SSE events (delimited by \n\n)
                buffer += decode.decode(value, { stream: true });
                const [events, remaining] = parseSseEvents(buffer);
                buffer = remaining;
                for (const fields of events) {
                  if (fields['data']) {
                    try {
                      const ev = JSON.parse(fields['data']);
                      if (ev.phrase) {
                        // Navigate to Insights tab so the wake UI is visible
                        router.push('/(tabs)/insights');
                        setPendingWakeEvent({
                          phrase: ev.phrase,
                          transcript: ev.transcript ?? '',
                          // When true the daemon is handling the voice turn end-to-end;
                          // insights.tsx should NOT start its own mic capture session
                          daemonHandling: !!ev.daemonHandling,
                        });
                      }
                    } catch { /* malformed JSON in data field */ }
                  }
                }
                pump();
              }).catch(() => {
                if (!abortedRef.current) setTimeout(connect, 3000);
              });
            };
            pump();
          })
          .catch(() => {
            connectingRef.current = false;
            if (!abortedRef.current) setTimeout(connect, 5000);
          });
      }).catch(() => {
        connectingRef.current = false;
        if (!abortedRef.current) setTimeout(connect, 5000);
      });
    };

    connect();

    return () => {
      abortedRef.current = true;
      connectingRef.current = false;
    };
  }, [isAuthenticated]);

  return (
    <WakeWordContext.Provider value={{ pendingWakeEvent, clearWakeEvent }}>
      {children}
    </WakeWordContext.Provider>
  );
}
