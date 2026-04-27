export const createAudioPlayer = (_source: unknown) => ({
  play: () => {},
  remove: () => {},
});

export const requestRecordingPermissionsAsync = async () => ({
  granted: false as const,
  status: 'denied' as const,
});
