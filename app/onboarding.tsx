import React, { useState, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInRight, FadeOutLeft, FadeIn } from 'react-native-reanimated';
import { router } from 'expo-router';
import Colors from '@/constants/colors';
import {
  saveUserName,
  saveLifeContext,
  saveGoal,
  setOnboardingComplete,
  type LifeContext,
  type Goal,
} from '@/lib/storage';

const { width } = Dimensions.get('window');

const LIFE_QUESTIONS = [
  {
    field: 'priorityGoal' as keyof LifeContext,
    question: "What's your #1 priority right now?",
    subLabel: "A goal, project, or life situation you're actively pushing on",
    placeholder: "e.g. Launch my side business by June, get back in shape, get promoted...",
  },
  {
    field: 'upcomingDeadline' as keyof LifeContext,
    question: "Any deadlines or commitments on your mind?",
    subLabel: "Something you've promised yourself or others",
    placeholder: "e.g. Marathon in 8 weeks, quarterly review next Friday...",
  },
  {
    field: 'improvementArea' as keyof LifeContext,
    question: "Which area of life do you most want to level up?",
    subLabel: "Career, health, relationships, finances, creativity…",
    placeholder: "e.g. My fitness has slipped and I want to build a real routine...",
  },
  {
    field: 'currentBlocker' as keyof LifeContext,
    question: "What's been getting in your way lately?",
    subLabel: "Be honest — this helps your coach give realistic advice",
    placeholder: "e.g. Always running out of time, procrastinating on hard tasks...",
  },
];

const GOAL_CATEGORIES: Array<{ id: Goal['category']; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { id: 'fitness', label: 'Fitness', icon: 'barbell-outline' },
  { id: 'career', label: 'Career', icon: 'briefcase-outline' },
  { id: 'finance', label: 'Finance', icon: 'trending-up-outline' },
  { id: 'personal', label: 'Personal', icon: 'person-outline' },
  { id: 'social', label: 'Social', icon: 'people-outline' },
];

type StepId = 'name' | 'context_0' | 'context_1' | 'context_2' | 'context_3' | 'goal' | 'connect';

const STEP_ORDER: StepId[] = ['name', 'context_0', 'context_1', 'context_2', 'context_3', 'goal', 'connect'];

function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const [stepIndex, setStepIndex] = useState(0);
  const [animKey, setAnimKey] = useState(0);

  const [name, setName] = useState('');
  const [lifeAnswers, setLifeAnswers] = useState<Record<string, string>>({});
  const [goalTitle, setGoalTitle] = useState('');
  const [goalCategory, setGoalCategory] = useState<Goal['category']>('personal');

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const currentStep = STEP_ORDER[stepIndex];
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === STEP_ORDER.length - 1;
  const progress = (stepIndex + 1) / STEP_ORDER.length;

  function goNext() {
    if (isLastStep) {
      handleFinish();
    } else {
      setStepIndex(i => i + 1);
      setAnimKey(k => k + 1);
    }
  }

  function goBack() {
    if (isFirstStep) return;
    setStepIndex(i => i - 1);
    setAnimKey(k => k + 1);
  }

  async function handleFinish() {
    if (name.trim()) await saveUserName(name.trim());

    const ctx: LifeContext = {
      priorityGoal: lifeAnswers.priorityGoal || '',
      upcomingDeadline: lifeAnswers.upcomingDeadline || '',
      improvementArea: lifeAnswers.improvementArea || '',
      currentBlocker: lifeAnswers.currentBlocker || '',
      freeText: '',
      lastUpdated: new Date().toISOString(),
    };
    await saveLifeContext(ctx);

    if (goalTitle.trim()) {
      const goal: Goal = {
        id: generateId(),
        title: goalTitle.trim(),
        category: goalCategory,
        target: 100,
        current: 0,
        unit: 'units',
        createdAt: new Date().toISOString(),
      };
      await saveGoal(goal);
    }

    await setOnboardingComplete();
    router.replace('/(tabs)');
  }

  function renderStep() {
    if (currentStep === 'name') {
      return (
        <Animated.View key={animKey} entering={FadeInRight.duration(300)} style={styles.stepContent}>
          <Text style={styles.stepEmoji}>👋</Text>
          <Text style={styles.question}>What should we call you?</Text>
          <Text style={styles.subLabel}>Your coach will use this to personalize your experience</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Your first name"
            placeholderTextColor={Colors.textTertiary}
            autoFocus
            autoCorrect={false}
            returnKeyType="next"
            onSubmitEditing={goNext}
          />
        </Animated.View>
      );
    }

    if (currentStep.startsWith('context_')) {
      const idx = parseInt(currentStep.split('_')[1], 10);
      const q = LIFE_QUESTIONS[idx];
      const answer = lifeAnswers[q.field] || '';
      return (
        <Animated.View key={animKey} entering={FadeInRight.duration(300)} style={styles.stepContent}>
          <Text style={styles.question}>{q.question}</Text>
          <Text style={styles.subLabel}>{q.subLabel}</Text>
          <TextInput
            style={styles.textarea}
            value={answer}
            onChangeText={text => setLifeAnswers(prev => ({ ...prev, [q.field]: text }))}
            placeholder={q.placeholder}
            placeholderTextColor={Colors.textTertiary}
            multiline
            numberOfLines={5}
            autoFocus
            textAlignVertical="top"
          />
        </Animated.View>
      );
    }

    if (currentStep === 'goal') {
      return (
        <Animated.View key={animKey} entering={FadeInRight.duration(300)} style={styles.stepContent}>
          <Text style={styles.question}>Set your first goal</Text>
          <Text style={styles.subLabel}>What's one thing you want to make meaningful progress on?</Text>
          <TextInput
            style={styles.input}
            value={goalTitle}
            onChangeText={setGoalTitle}
            placeholder="e.g. Run a 5K, Save $5,000, Read 12 books..."
            placeholderTextColor={Colors.textTertiary}
            autoFocus
            returnKeyType="done"
          />
          <Text style={styles.categoryLabel}>Category</Text>
          <View style={styles.categoryRow}>
            {GOAL_CATEGORIES.map(cat => (
              <Pressable
                key={cat.id}
                onPress={() => setGoalCategory(cat.id)}
                style={[styles.categoryChip, goalCategory === cat.id && styles.categoryChipActive]}
              >
                <Ionicons
                  name={cat.icon}
                  size={16}
                  color={goalCategory === cat.id ? '#fff' : Colors.textSecondary}
                />
                <Text style={[styles.categoryChipText, goalCategory === cat.id && styles.categoryChipTextActive]}>
                  {cat.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </Animated.View>
      );
    }

    if (currentStep === 'connect') {
      return (
        <Animated.View key={animKey} entering={FadeInRight.duration(300)} style={styles.stepContent}>
          <Text style={styles.stepEmoji}>🔗</Text>
          <Text style={styles.question}>Connect your calendar</Text>
          <Text style={styles.subLabel}>
            Your coach can see your schedule and help you plan around it. Connect your apps from the Profile tab anytime.
          </Text>
          <View style={styles.connectNote}>
            <Ionicons name="information-circle-outline" size={18} color={Colors.primary} />
            <Text style={styles.connectNoteText}>
              You can connect Google Calendar, Outlook, and Gmail from your Profile tab after setup.
            </Text>
          </View>
          <Text style={styles.readyText}>You're all set to start your GamePlan.</Text>
        </Animated.View>
      );
    }

    return null;
  }

  function canProceed() {
    if (currentStep === 'name') return name.trim().length > 0;
    if (currentStep === 'goal') return true;
    if (currentStep === 'connect') return true;
    return true;
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={[styles.inner, { paddingTop: topPad + 16 }]}>
        <View style={styles.topBar}>
          {!isFirstStep ? (
            <Pressable onPress={goBack} style={styles.navBtn}>
              <Ionicons name="arrow-back" size={22} color={Colors.textSecondary} />
            </Pressable>
          ) : (
            <View style={styles.navBtn} />
          )}
          <Text style={styles.stepIndicator}>{stepIndex + 1} of {STEP_ORDER.length}</Text>
        </View>

        <View style={styles.progressTrack}>
          <Animated.View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` as any }]} />
        </View>

        <ScrollView
          style={styles.scrollArea}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {renderStep()}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
          {currentStep.startsWith('context_') && (
            <Pressable
              style={styles.skipBtn}
              onPress={goNext}
            >
              <Text style={styles.skipText}>Skip</Text>
            </Pressable>
          )}
          {currentStep === 'goal' && (
            <Pressable style={styles.skipBtn} onPress={goNext}>
              <Text style={styles.skipText}>Skip</Text>
            </Pressable>
          )}
          <Pressable
            style={[
              styles.nextBtn,
              !canProceed() && styles.nextBtnDim,
              (currentStep.startsWith('context_') || currentStep === 'goal') && styles.nextBtnFlex,
            ]}
            onPress={canProceed() ? goNext : undefined}
          >
            <Text style={styles.nextText}>
              {isLastStep ? "Let's go" : 'Next'}
            </Text>
            <Ionicons
              name={isLastStep ? 'checkmark' : 'arrow-forward'}
              size={16}
              color="#fff"
            />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  inner: {
    flex: 1,
    paddingHorizontal: 24,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  navBtn: {
    width: 32,
    padding: 4,
  },
  stepIndicator: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
  },
  progressTrack: {
    height: 4,
    backgroundColor: Colors.borderLight,
    borderRadius: 99,
    overflow: 'hidden',
    marginBottom: 32,
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 99,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  stepContent: {
    flex: 1,
  },
  stepEmoji: {
    fontSize: 40,
    marginBottom: 16,
  },
  question: {
    fontSize: 26,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
    lineHeight: 34,
    marginBottom: 8,
  },
  subLabel: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    lineHeight: 22,
    marginBottom: 28,
  },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    fontSize: 17,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
  },
  textarea: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
    minHeight: 130,
    lineHeight: 22,
  },
  categoryLabel: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textSecondary,
    marginTop: 20,
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  categoryChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  categoryChipText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
  },
  categoryChipTextActive: {
    color: '#fff',
  },
  connectNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 24,
  },
  connectNoteText: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  readyText: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    textAlign: 'center',
    marginTop: 16,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    gap: 12,
  },
  skipBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  skipText: {
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
  },
  nextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 28,
    gap: 8,
  },
  nextBtnFlex: {
    flex: 1,
  },
  nextBtnDim: {
    opacity: 0.5,
  },
  nextText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
});
