# GamePlan - Daily Game Plan App

## Overview
A mobile app that aggregates data from multiple platforms and generates a personalized daily game plan. Each morning, users receive a curated checklist of tasks that builds on previous days' progress.

## Tech Stack
- **Frontend**: Expo Router (React Native) with file-based routing
- **Backend**: Express.js (serves landing page and API)
- **State**: AsyncStorage for local persistence
- **Styling**: React Native StyleSheet with Inter font family
- **Icons**: @expo/vector-icons (Ionicons)

## Project Structure
- `app/(tabs)/` - Tab screens: index (Today), goals, insights, profile
- `app/(tabs)/_layout.tsx` - Tab navigation with NativeTabs (liquid glass) + classic fallback
- `components/` - Reusable components: TaskCard, GoalCard, SuggestionCard, ProgressRing, AddGoalSheet
- `lib/storage.ts` - AsyncStorage data layer for tasks, goals, platforms, stats
- `lib/helpers.ts` - Category colors, icons, labels, date formatting utilities
- `constants/colors.ts` - Theme colors (indigo primary, purple secondary)
- `server/` - Express backend

## Color Palette
- Primary: #6366F1 (indigo)
- Secondary: #8B5CF6 (purple)
- Accent: #EC4899 (pink)
- Success: #10B981 (green)
- Warning: #F59E0B (amber)
- Background: #FFFFFF, Surface: #F9FAFB

## Features
1. **Today Tab** - AI-generated daily checklist with progress ring, task categories, completion tracking
2. **Goals Tab** - Create, edit, delete goals with progress tracking across categories
3. **Insights Tab** - Smart recommendations, activity suggestions, stats dashboard
4. **Profile Tab** - Connected platforms management, streak tracking, preferences

## Workflows
- `Start Backend` (port 5000) - Express server
- `Start Frontend` (port 8081) - Expo dev server
