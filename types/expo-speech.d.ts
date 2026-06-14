declare module "expo-speech" {
  export interface SpeechOptions {
    language?: string;
    pitch?: number;
    rate?: number;
    onStart?: () => void;
    onDone?: () => void;
    onStopped?: () => void;
    onError?: (error: unknown) => void;
  }

  export function speak(text: string, options?: SpeechOptions): void;
  export function stop(): Promise<void>;
}
