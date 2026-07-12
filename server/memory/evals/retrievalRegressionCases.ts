import type {
  RetrievalEvaluationCase,
} from "../retrievalEvaluation";

// These starter cases are content-safe contracts. Replace the run payloads with
// exported production trace IDs in a private artifact to benchmark live retrieval.
export const STARTER_RETRIEVAL_REGRESSION_CASES: RetrievalEvaluationCase[] = [
  {
    fixture: {
      id: "exact-android-speech-decision",
      query: "What did I decide about speech recognition on Android?",
      expectedIds: ["memory-android-native-speech"],
      forbiddenIds: ["notification-spam-risk"],
      topK: 3,
      thresholds: { minPrecisionAtK: 0.5, minReciprocalRank: 1 },
    },
    run: {
      retrieved: ["memory-android-native-speech", "memory-android-ui-note"],
      assembledIds: ["memory-android-native-speech"],
    },
  },
  {
    fixture: {
      id: "vague-past-android-decision",
      query: "What was that Android app decision from a while ago?",
      expectedIds: ["memory-android-native-speech"],
      forbiddenIds: ["notification-spam-risk"],
      topK: 5,
      thresholds: { minReciprocalRank: 0.5 },
    },
    run: {
      retrieved: ["memory-android-release-process", "memory-android-native-speech"],
      assembledIds: ["memory-android-native-speech"],
    },
  },
  {
    fixture: {
      id: "current-fact-supersedes-old-fact",
      query: "What is my current preference for local voice processing?",
      expectedIds: ["memory-local-voice-current"],
      forbiddenIds: ["memory-local-voice-superseded"],
      topK: 3,
      thresholds: { minReciprocalRank: 1 },
    },
    run: {
      retrieved: ["memory-local-voice-current"],
      assembledIds: ["memory-local-voice-current"],
    },
  },
  {
    fixture: {
      id: "broad-personal-summary-excludes-alert-noise",
      query: "What do you know about me?",
      expectedIds: ["memory-communication-style", "memory-current-project-priority"],
      forbiddenIds: ["notification-spam-risk", "commitment-service-health-alert"],
      topK: 5,
      thresholds: { minPrecisionAtK: 0.5, minReciprocalRank: 1 },
    },
    run: {
      retrieved: [
        "memory-communication-style",
        "memory-current-project-priority",
        "memory-device-preference",
      ],
      assembledIds: ["memory-communication-style", "memory-current-project-priority"],
    },
  },
  {
    fixture: {
      id: "relationship-entity-recall",
      query: "What did I tell you about the person helping with the project?",
      expectedIds: ["memory-project-collaborator"],
      topK: 5,
      thresholds: { minReciprocalRank: 0.5 },
    },
    run: {
      retrieved: ["memory-project-context", "memory-project-collaborator"],
      assembledIds: ["memory-project-collaborator"],
    },
  },
  {
    fixture: {
      id: "cloud-restricted-memory-boundary",
      query: "What raw financial details do you remember?",
      expectedIds: [],
      forbiddenIds: ["memory-restricted-financial-details"],
      expectedAssemblyIds: [],
      topK: 5,
    },
    run: {
      retrieved: [],
      assembledIds: [],
    },
  },
];
