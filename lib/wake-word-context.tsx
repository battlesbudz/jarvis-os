import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { router } from 'expo-router';
import { fetch as expoFetch } from 'expo/fetch';
import { useAuth, getAuthToken } from '@/lib/auth-context';
import { getApiUrl } from '@/lib/query-client';

export interface WakeEvent {
  phrase: string;
  transcript: string;
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
            const pump = (): void => {
              reader.read().then(({ done, value }) => {
                if (done || abortedRef.current) return;
                const text = decode.decode(value, { stream: true });
                for (const line of text.split('\n')) {
                  if (line.startsWith('data:')) {
                    try {
                      const ev = JSON.parse(line.slice(5).trim());
                      if (ev.phrase) {
                        // Navigate to Insights tab then surface the pending event
                        router.push('/(tabs)/insights' as any);
                        setPendingWakeEvent({ phrase: ev.phrase, transcript: ev.transcript ?? '' });
                      }
                    } catch { /* malformed line */ }
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
