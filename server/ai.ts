import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export interface CompletionHistoryItem {
  title: string;
  category: string;
  completed: boolean;
  hadSubtasks: boolean;
  date: string;
}

export interface ResizeTaskRequest {
  taskTitle: string;
  taskDescription?: string;
  detailLevel: number;
  direction: "smaller" | "bigger";
  history: CompletionHistoryItem[];
}

export interface ResizeTaskResponse {
  steps: string[];
}

export interface GeneratePlanRequest {
  goals: { id: string; title: string; category: string; current: number; target: number; unit: string }[];
  history: CompletionHistoryItem[];
  dayOfWeek: string;
}

export interface GeneratePlanTask {
  title: string;
  category: string;
  priority: "high" | "medium" | "low";
  time: string;
  description: string;
  goalId?: string;
}

export interface GeneratePlanResponse {
  tasks: GeneratePlanTask[];
  insight: string;
}

export async function resizeTask(req: ResizeTaskRequest): Promise<ResizeTaskResponse> {
  const { taskTitle, taskDescription, detailLevel, direction, history } = req;

  const completedTasks = history.filter(h => h.completed).map(h => h.title);
  const skippedTasks = history.filter(h => !h.completed).map(h => h.title);

  const historyContext = completedTasks.length > 0 || skippedTasks.length > 0
    ? `\nRecent history for context:
- Tasks they completed recently: ${completedTasks.slice(0, 5).join(', ') || 'none'}
- Tasks they left undone recently: ${skippedTasks.slice(0, 5).join(', ') || 'none'}
Use this to calibrate step size. If they tend to skip tasks, make steps more approachable and concrete. If they complete everything easily, steps can be slightly more ambitious.`
    : '';

  let directionPrompt: string;
  if (direction === 'smaller') {
    const stepCounts: Record<number, string> = {
      1: '2-3 broad steps',
      2: '3-4 clear steps',
      3: '4-6 specific steps',
      4: '6-8 detailed steps',
      5: '8-12 very small, immediately actionable micro-steps',
    };
    directionPrompt = `Break this task into ${stepCounts[detailLevel] || '4-6 steps'}. Each step should be concrete and actionable — something you can do right now without thinking about what it means. For higher detail levels, break steps into the smallest possible actions (e.g., "open laptop" rather than "start working").`;
  } else {
    directionPrompt = `Combine or simplify this task into ${detailLevel <= 2 ? '1 single clear action' : '1-2 higher-level actions'}. Make it feel less overwhelming by framing it as one focused activity instead of multiple separate things.`;
  }

  const prompt = `You help people who struggle with getting started on tasks. Your job is to resize tasks to make them more manageable.

Task: "${taskTitle}"${taskDescription ? `\nContext: ${taskDescription}` : ''}
${historyContext}

${directionPrompt}

Rules:
- Start each step with a verb (action word)
- Keep language simple and encouraging
- No numbering, just the step text
- Each step should take no more than 5-15 minutes
- Make steps feel easy to start — low friction, low intimidation

Return ONLY a JSON object with a "steps" array of strings. No other text.`;

  const response = await openai.chat.completions.create({
    model: "gpt-5-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    max_completion_tokens: 8192,
  });

  const content = response.choices[0]?.message?.content || '{"steps":[]}';
  try {
    const parsed = JSON.parse(content);
    return { steps: Array.isArray(parsed.steps) ? parsed.steps : [] };
  } catch {
    return { steps: [] };
  }
}

export async function generateSmartPlan(req: GeneratePlanRequest): Promise<GeneratePlanResponse> {
  const { goals, history, dayOfWeek } = req;

  const completedTasks = history.filter(h => h.completed);
  const skippedTasks = history.filter(h => !h.completed);

  const goalsText = goals.length > 0
    ? goals.map(g => `- [id:${g.id}] ${g.title} (${g.category}): ${g.current}/${g.target} ${g.unit}`).join('\n')
    : 'No specific goals set yet.';

  const historyText = history.length > 0
    ? `Completed ${completedTasks.length} of ${history.length} tasks in the last 7 days.
Tasks completed: ${completedTasks.map(h => h.title).slice(0, 8).join(', ') || 'none'}
Tasks left undone: ${skippedTasks.map(h => h.title).slice(0, 8).join(', ') || 'none'}
${skippedTasks.length > completedTasks.length ? 'This person tends to skip more tasks than they complete — keep today\'s plan lighter and more approachable.' : ''}
${completedTasks.length > skippedTasks.length ? 'This person is on a good streak — maintain momentum with a balanced plan.' : ''}`
    : 'No history yet — create a balanced starter plan.';

  const prompt = `You create personalized daily task plans for people. Today is ${dayOfWeek}.

User's goals:
${goalsText}

Recent activity:
${historyText}

Create a daily plan with 5-8 tasks. For each task provide:
- title: short, action-oriented task name
- category: one of "calendar", "fitness", "finance", "career", "personal", "social"
- priority: "high", "medium", or "low"
- time: suggested time like "7:00 AM", "9:30 AM", etc.
- description: one-line helpful context
- goalId: (optional) the id from the goals list above (e.g. "id:abc123") if this task directly works toward that specific goal — omit for general tasks

Rules:
- Align tasks with the user's goals
- When a task directly advances a specific goal (e.g. a fitness task for a running goal), set goalId to that goal's id (the value in [id:...])
- If they've been skipping fitness tasks, make fitness tasks easier/shorter
- If they've been completing everything, add one slightly challenging stretch task
- Include at least one personal/wellness task
- On weekends (Saturday/Sunday), lean more toward personal and social tasks
- Keep task names concise and starting with a verb
- Also include an "insight" — a brief motivational or strategic observation about their patterns

Return ONLY a JSON object with "tasks" array and "insight" string. No other text.`;

  const response = await openai.chat.completions.create({
    model: "gpt-5-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    max_completion_tokens: 8192,
  });

  const content = response.choices[0]?.message?.content || '{"tasks":[],"insight":""}';
  try {
    const parsed = JSON.parse(content);
    return {
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      insight: parsed.insight || 'Start small, stay consistent.',
    };
  } catch {
    return { tasks: [], insight: 'Start small, stay consistent.' };
  }
}
