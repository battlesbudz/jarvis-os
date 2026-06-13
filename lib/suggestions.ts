export interface Suggestion {
  id: string;
  title: string;
  description: string;
  category: "activity" | "date_night" | "finance" | "career" | "wellness";
  icon: string;
  actionLabel: string;
}

export function getSuggestions(): Suggestion[] {
  const day = new Date().getDay();
  const suggestions: Suggestion[] = [
    {
      id: "1",
      title: "Try a new restaurant",
      description: "Explore that new Italian place downtown for a relaxed dinner.",
      category: "date_night",
      icon: "restaurant",
      actionLabel: "Plan it",
    },
    {
      id: "2",
      title: "Automate your savings",
      description: "Set up a recurring transfer of $50/week to your savings account.",
      category: "finance",
      icon: "trending-up",
      actionLabel: "Learn more",
    },
    {
      id: "3",
      title: "Morning yoga flow",
      description: "Start tomorrow with a 15-minute yoga session for flexibility.",
      category: "wellness",
      icon: "leaf",
      actionLabel: "Schedule",
    },
    {
      id: "4",
      title: "Update your LinkedIn",
      description: "Add recent achievements to boost profile visibility.",
      category: "career",
      icon: "briefcase",
      actionLabel: "Open",
    },
    {
      id: "5",
      title: "Weekend hike",
      description: "Check out trails nearby for a Saturday morning adventure.",
      category: "activity",
      icon: "compass",
      actionLabel: "Explore",
    },
  ];

  if (day === 5 || day === 6) {
    suggestions.unshift({
      id: "6",
      title: "Movie night in",
      description: "Pick a new release and set up a cozy movie night at home.",
      category: "date_night",
      icon: "film",
      actionLabel: "Browse",
    });
  }

  return suggestions;
}
