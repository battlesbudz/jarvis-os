export const createAudioPlayer = (_source: unknown) => ({
  play: () => {},
  remove: () => {},
  addListener: (_event: string, _callback: (status: unknown) => void) => ({
    remove: () => {},
  }),
});

export const requestRecordingPermissionsAsync = async () => ({
  granted: false as const,
  status: 'denied' as const,
});
