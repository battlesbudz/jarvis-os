import React from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { SectionHeader } from './SettingsSectionChrome';

type WakeWordSectionProps = {
  wakeWordEnabled: boolean;
  talkModeEnabled: boolean;
  wakeWords: string[];
  newWakeWord: string;
  saving: boolean;
  assistantActive?: boolean;
  assistantStatus?: string;
  hotwordPhrase?: string;
  hotwordAvailability?: string;
  hotwordDetail?: string;
  hotwordRecognitionActive?: boolean;
  onToggleWakeWord: (enabled: boolean) => void;
  onToggleTalkMode: (enabled: boolean) => void;
  onChangeNewWakeWord: (phrase: string) => void;
  onAddWakeWord: () => void;
  onRemoveWakeWord: (phrase: string) => void;
  onOpenAssistantSettings?: () => void;
  onRefreshAssistantStatus?: () => void;
};

export function WakeWordSection({
  wakeWordEnabled,
  talkModeEnabled,
  wakeWords,
  newWakeWord,
  saving,
  assistantActive = false,
  assistantStatus = 'Not selected',
  hotwordPhrase = 'Hey Jarvis',
  hotwordAvailability = 'not_checked',
  hotwordDetail = 'Choose Jarvis as the Android assistant, then reopen this screen.',
  hotwordRecognitionActive = false,
  onToggleWakeWord,
  onToggleTalkMode,
  onChangeNewWakeWord,
  onAddWakeWord,
  onRemoveWakeWord,
  onOpenAssistantSettings,
  onRefreshAssistantStatus,
}: WakeWordSectionProps) {
  const hotwordReady = hotwordRecognitionActive || hotwordAvailability === 'ready';

  return (
    <>
      <SectionHeader label="ASSISTANT WAKE" accent={Colors.primary} />
      <View style={s.card}>
        <View style={s.row}>
          <View style={[s.iconWrap, { backgroundColor: '#1E3A5F' }]}>
            <Ionicons name="sparkles-outline" size={18} color={Colors.primary} />
          </View>
          <View style={s.info}>
            <Text style={s.name}>Android Assistant</Text>
            <Text style={s.sub}>{assistantActive ? assistantStatus : 'Not selected'}</Text>
          </View>
          <Pressable
            onPress={onOpenAssistantSettings}
            disabled={saving || !onOpenAssistantSettings}
            style={[s.actionButton, (saving || !onOpenAssistantSettings) && s.disabled]}
          >
            <Ionicons name="settings-outline" size={14} color={Colors.primary} />
            <Text style={s.actionText}>{assistantActive ? 'Open' : 'Set'}</Text>
          </Pressable>
        </View>

        <View style={[s.row, s.rowBorder]}>
          <View style={[s.iconWrap, { backgroundColor: hotwordReady ? '#0f2f1a' : '#2f2510' }]}>
            <Ionicons
              name={hotwordReady ? 'checkmark-circle-outline' : 'hardware-chip-outline'}
              size={18}
              color={hotwordReady ? Colors.success : Colors.warning}
            />
          </View>
          <View style={s.info}>
            <Text style={s.name}>System Hotword</Text>
            <Text style={s.sub}>{hotwordDetail}</Text>
          </View>
          <Pressable
            onPress={onRefreshAssistantStatus}
            disabled={saving || !onRefreshAssistantStatus}
            style={[s.iconButton, (saving || !onRefreshAssistantStatus) && s.disabled]}
            hitSlop={8}
          >
            <Ionicons name="refresh" size={16} color={Colors.textSecondary} />
          </Pressable>
        </View>

        <View style={[s.row, s.rowBorder]}>
          <View style={[s.iconWrap, { backgroundColor: '#172554' }]}>
            <Ionicons name="radio-outline" size={18} color={Colors.primary} />
          </View>
          <View style={s.info}>
            <Text style={s.name}>Wake Word</Text>
            <Text style={s.sub}>{hotwordPhrase}</Text>
          </View>
          <Switch
            value={wakeWordEnabled}
            onValueChange={onToggleWakeWord}
            disabled={saving}
            trackColor={{ false: Colors.border, true: Colors.primary }}
          />
        </View>

        <View style={[s.row, s.rowBorder]}>
          <View style={[s.iconWrap, { backgroundColor: '#0f2f1a' }]}>
            <Ionicons name="chatbubble-ellipses-outline" size={18} color={Colors.success} />
          </View>
          <View style={s.info}>
            <Text style={s.name}>Talk Mode</Text>
            <Text style={s.sub}>Keep the conversation open after Jarvis launches</Text>
          </View>
          <Switch
            value={talkModeEnabled}
            onValueChange={onToggleTalkMode}
            disabled={saving}
            trackColor={{ false: Colors.border, true: Colors.success }}
          />
        </View>

        <View style={[s.row, s.rowBorder]}>
          <View style={[s.iconWrap, { backgroundColor: '#2A1D34' }]}>
            <Ionicons name="mic-off-outline" size={18} color={Colors.violet} />
          </View>
          <View style={s.info}>
            <Text style={s.name}>Mic Fallback</Text>
            <Text style={s.sub}>Off</Text>
          </View>
          <View style={s.lockPill}>
            <Ionicons name="lock-closed-outline" size={12} color={Colors.textTertiary} />
          </View>
        </View>

        {wakeWordEnabled && (
          <View style={s.phraseSection}>
            <Text style={s.phraseHeader}>TRIGGER PHRASES</Text>
            {wakeWords.map(phrase => (
              <View key={phrase} style={s.phraseRow}>
                <Ionicons name="radio-outline" size={14} color={Colors.textSecondary} style={s.phraseIcon} />
                <Text style={s.phrase}>{phrase}</Text>
                <Pressable onPress={() => onRemoveWakeWord(phrase)} hitSlop={10}>
                  <Ionicons name="close-circle" size={16} color={Colors.textTertiary} />
                </Pressable>
              </View>
            ))}
            <View style={s.addRow}>
              <TextInput
                style={s.input}
                placeholder="Add phrase..."
                placeholderTextColor={Colors.textTertiary}
                value={newWakeWord}
                onChangeText={onChangeNewWakeWord}
                onSubmitEditing={onAddWakeWord}
                returnKeyType="done"
                autoCapitalize="none"
              />
              <Pressable onPress={onAddWakeWord} style={s.addButton}>
                <Ionicons name="add" size={16} color="#fff" />
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </>
  );
}

const s = StyleSheet.create({
  actionButton: { minHeight: 32, borderRadius: 8, borderWidth: 1, borderColor: Colors.primary, paddingHorizontal: 10, flexDirection: 'row', gap: 5, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontSize: 12, color: Colors.primary, fontFamily: 'Inter_600SemiBold' },
  addButton: { backgroundColor: Colors.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  card: { backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1, borderColor: Colors.border },
  disabled: { opacity: 0.5 },
  iconButton: { width: 32, height: 32, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  iconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, minWidth: 0 },
  input: { flex: 1, marginTop: 0, backgroundColor: Colors.surfaceAlt, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, color: Colors.text, fontFamily: 'Inter_400Regular', fontSize: 13 },
  lockPill: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceAlt, borderWidth: 1, borderColor: Colors.border },
  name: { color: Colors.text, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  phrase: { flex: 1, fontSize: 13, color: Colors.text, fontFamily: 'Inter_400Regular' },
  phraseHeader: { fontSize: 11, color: Colors.textTertiary, fontFamily: 'Inter_500Medium', marginTop: 6, marginBottom: 8, letterSpacing: 0.5 },
  phraseIcon: { marginRight: 8 },
  phraseRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, backgroundColor: Colors.surface, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  phraseSection: { paddingHorizontal: 14, paddingBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, paddingVertical: 12 },
  rowBorder: { borderTopWidth: 1, borderTopColor: Colors.border },
  sub: { color: Colors.textTertiary, fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
});
