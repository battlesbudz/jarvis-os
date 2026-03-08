import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInRight, FadeOutLeft } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { saveLifeContext, type LifeContext } from '@/lib/storage';

const QUESTIONS = [
  {
    question: "What's your #1 priority right now?",
    subLabel: "A goal, project, or life situation you're actively pushing on",
    field: 'priorityGoal' as keyof LifeContext,
    placeholder: "e.g. Launch my side business by June, Get back in shape, Get promoted...",
  },
  {
    question: "Any deadlines or commitments on your mind?",
    subLabel: "Something you've promised yourself or others",
    field: 'upcomingDeadline' as keyof LifeContext,
    placeholder: "e.g. Marathon in 8 weeks, Quarterly review next Friday, Friend's wedding...",
  },
  {
    question: "Which area of life do you most want to level up?",
    subLabel: "Career, health, relationships, finances, creativity…",
    field: 'improvementArea' as keyof LifeContext,
    placeholder: "e.g. My fitness has slipped and I want to build a real routine...",
  },
  {
    question: "What's been getting in your way lately?",
    subLabel: "Be honest — this helps your coach give realistic, grounded advice",
    field: 'currentBlocker' as keyof LifeContext,
    placeholder: "e.g. Always running out of time, procrastinating on hard tasks, low motivation...",
  },
  {
    question: "Anything else you want your coach to know?",
    subLabel: "Context, backstory, current life situation — anything goes",
    field: 'freeText' as keyof LifeContext,
    placeholder: "e.g. I work full-time and have two kids, I'm going through a career change, I travel often...",
  },
];

interface Props {
  visible: boolean;
  existing: LifeContext | null;
  onComplete: () => void;
  onClose: () => void;
}

export default function LifeContextSheet({ visible, existing, onComplete, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [key, setKey] = useState(0);

  useEffect(() => {
    if (visible) {
      setStep(0);
      setKey(k => k + 1);
      if (existing) {
        setAnswers({
          priorityGoal: existing.priorityGoal || '',
          upcomingDeadline: existing.upcomingDeadline || '',
          improvementArea: existing.improvementArea || '',
          currentBlocker: existing.currentBlocker || '',
          freeText: existing.freeText || '',
        });
      } else {
        setAnswers({});
      }
    }
  }, [visible]);

  const currentQ = QUESTIONS[step];
  const currentAnswer = answers[currentQ.field] || '';
  const isLast = step === QUESTIONS.length - 1;
  const progress = (step + 1) / QUESTIONS.length;
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const handleNext = async () => {
    if (isLast) {
      const ctx: LifeContext = {
        priorityGoal: answers.priorityGoal || '',
        upcomingDeadline: answers.upcomingDeadline || '',
        improvementArea: answers.improvementArea || '',
        currentBlocker: answers.currentBlocker || '',
        freeText: answers.freeText || '',
        lastUpdated: new Date().toISOString(),
      };
      await saveLifeContext(ctx);
      onComplete();
    } else {
      setStep(s => s + 1);
      setKey(k => k + 1);
    }
  };

  const handleSkip = () => {
    setAnswers(prev => ({ ...prev, [currentQ.field]: '' }));
    if (isLast) {
      handleNext();
    } else {
      setStep(s => s + 1);
      setKey(k => k + 1);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={[styles.inner, { paddingTop: topPad + 12 }]}>
          <View style={styles.topBar}>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={Colors.textSecondary} />
            </Pressable>
            <Text style={styles.stepIndicator}>{step + 1} of {QUESTIONS.length}</Text>
          </View>

          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` as any }]} />
          </View>

          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Animated.View key={key} entering={FadeInRight.duration(280)}>
              <Text style={styles.question}>{currentQ.question}</Text>
              <Text style={styles.subLabel}>{currentQ.subLabel}</Text>

              <TextInput
                style={styles.input}
                value={currentAnswer}
                onChangeText={text => setAnswers(prev => ({ ...prev, [currentQ.field]: text }))}
                placeholder={currentQ.placeholder}
                placeholderTextColor={Colors.textTertiary}
                multiline
                numberOfLines={5}
                autoFocus
                textAlignVertical="top"
              />
            </Animated.View>
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
            <Pressable style={styles.skipBtn} onPress={handleSkip}>
              <Text style={styles.skipText}>Skip</Text>
            </Pressable>
            <Pressable
              style={[styles.nextBtn, !currentAnswer.trim() && styles.nextBtnDim]}
              onPress={handleNext}
            >
              <Text style={styles.nextText}>{isLast ? 'Done' : 'Next'}</Text>
              <Ionicons name={isLast ? 'checkmark' : 'arrow-forward'} size={16} color="#fff" />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
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
  closeBtn: {
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
  question: {
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
    lineHeight: 32,
    marginBottom: 8,
  },
  subLabel: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: 28,
  },
  input: {
    backgroundColor: Colors.card,
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
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    gap: 12,
  },
  skipBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  skipText: {
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
  },
  nextBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    gap: 8,
  },
  nextBtnDim: {
    opacity: 0.7,
  },
  nextText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
});
