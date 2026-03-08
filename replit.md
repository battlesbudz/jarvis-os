# GamePlan - Daily Game Plan App

## Overview
A mobile app that generates personalized daily task checklists with AI-powered adaptive task sizing. Users can break tasks into smaller steps or combine them using a "detail level" slider (1-5), helping with executive dysfunction. The AI learns from 7-day completion history to suggest appropriately-sized tasks.

## Tech Stack
- **Frontend**: Expo Router (React Native) with file-based routing
- **Backend**: Express.js (serves landing page and API)
- **AI**: OpenAI via Replit AI Integrations (gpt-5-mini) for task resizing and smart plan generation
- **State**: AsyncStorage for local persistence
- **Styling**: React Native StyleSheet with Inter font family
- **Icons**: @expo/vector-icons (Ionicons)

## Project Structure
- `app/(tabs)/` - Tab screens: index (Today), goals, insights, profile
- `app/(tabs)/_layout.tsx` - Tab navigation with NativeTabs (liquid glass) + classic fallback
- `components/` - Reusable components: TaskCard, GoalCard, SuggestionCard, ProgressRing, AddGoalSheet, TaskResizerSheet
- `lib/storage.ts` - AsyncStorage data layer for tasks, goals, platforms, stats, completion history
- `lib/helpers.ts` - Category colors, icons, labels, date formatting utilities
- `lib/query-client.ts` - React Query client with apiRequest helper
- `constants/colors.ts` - Theme colors (indigo primary, purple secondary)
- `server/ai.ts` - AI logic for resizeTask() and generateSmartPlan()
- `server/routes.ts` - API endpoints: POST /api/ai/resize-task, POST /api/ai/generate-plan

## Color Palette
- Primary: #6366F1 (indigo)
- Secondary: #8B5CF6 (purple)
- Accent: #EC4899 (pink)
- Success: #10B981 (green)
- Warning: #F59E0B (amber)
- Background: #FFFFFF, Surface: #F9FAFB

## Features
1. **Today Tab** - Daily checklist with progress ring, task categories, completion tracking
2. **AI Task Resizer** - Break tasks into smaller steps or simplify them with a detail level slider (1-5)
3. **Smart Plan Generation** - AI generates daily plans based on goals + 7-day completion history
4. **Subtasks** - Tasks can have nested subtasks with progress bars; parent auto-completes when all subtasks done
5. **Completion History** - Rolling 7-day history feeds into AI for personalized sizing
6. **Goals Tab** - Create, edit, delete goals with progress tracking across categories
7. **Insights Tab** - Smart recommendations, activity suggestions, stats dashboard
8. **Profile Tab** - Connected platforms management, streak tracking, preferences

## API Endpoints
- `POST /api/ai/resize-task` - Takes taskTitle, detailLevel (1-5), direction (smaller/bigger), history
- `POST /api/ai/generate-plan` - Takes goals, history, dayOfWeek; returns tasks + insight

## Workflows
- `Start Backend` (port 5000) - Express server
- `Start Frontend` (port 8081) - Expo dev server
