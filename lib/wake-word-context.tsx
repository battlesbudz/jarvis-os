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
  /** Call this from insights.tsx whenever Talk Mode is toggled so the provider
   *  can route wake events to the correct UX path. */
  setTalkModeActive: (active: boolean) => void;
}

const WakeWordContext = createContext<WakeWordContextValue>({
  pendingWakeEvent: null,
  clearWakeEvent: () => {},
  setTalkModeActive: () => {},
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
 * Context-aware routing when a wake event fires:
 *  - daemonHandling: true  → daemon owns the voice turn; app stays quiet.
 *  - daemonHandling: false + Talk Mode active → route to /(tabs)/insights so
 *    the pending wake event triggers the in-app mic recording loop.
 *  - daemonHandling: false + Talk Mode inactive → route to /voice-realtime for
 *    a full OpenAI Realtime voice conversation.
 */
export function WakeWordProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [pendingWakeEvent, setPendingWakeEvent] = useState<WakeEvent | null>(null);
  const abortedRef = useRef(false);
  const connectingRef = useRef(false);
  /** Tracks whether insights.tsx Talk Mode is currently active. */
  const talkModeActiveRef = useRef(false);

  const clearWakeEvent = useCallback(() => setPendingWakeEvent(null), []);

  const setTalkModeActive = useCallback((active: boolean) => {
    talkModeActiveRef.current = active;
  }, []);

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
                      if (!ev.phrase) continue;
                      if (ev.daemonHandling) {
                        // Daemon owns the voice turn end-to-end — app stays quiet.
                        // Optionally store the event so insights.tsx can show
                        // a visual indicator, but do NOT start any mic session.
                        setPendingWakeEvent({
                          phrase: ev.phrase,
                          transcript: ev.transcript ?? '',
                          daemonHandling: true,
                        });
                      } else if (talkModeActiveRef.current) {
                        // Talk Mode is active on insights — route there so the
                        // useWakeWord effect in insights.tsx triggers recording.
                        router.push('/(tabs)/insights');
                        setPendingWakeEvent({
                          phrase: ev.phrase,
                          transcript: ev.transcript ?? '',
                          daemonHandling: false,
                        });
                      } else {
                        // Talk Mode not active — open the full realtime voice screen.
                        router.push('/voice-realtime');
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
    <WakeWordContext.Provider value={{ pendingWakeEvent, clearWakeEvent, setTalkModeActive }}>
      {children}
    </WakeWordContext.Provider>
  );
}
