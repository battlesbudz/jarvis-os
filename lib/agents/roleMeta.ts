import { Ionicons } from "@expo/vector-icons";

export const ROLE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  coach: "fitness-outline",
  researcher: "search-outline",
  coder: "code-slash-outline",
  writer: "pencil-outline",
  analyst: "bar-chart-outline",
  scheduler: "calendar-outline",
  support: "headset-outline",
  security: "shield-outline",
  devops: "server-outline",
  custom: "person-outline",
};

export const ROLE_COLORS: Record<string, string> = {
  coach: "#4A90E2",
  researcher: "#7B68EE",
  coder: "#50C878",
  writer: "#FFD700",
  analyst: "#FF8C00",
  scheduler: "#20B2AA",
  support: "#FF69B4",
  security: "#DC143C",
  devops: "#4682B4",
  custom: "#9370DB",
};

export const ROLES = ["coach", "researcher", "coder", "writer", "analyst", "scheduler", "support", "security", "devops", "custom"];
