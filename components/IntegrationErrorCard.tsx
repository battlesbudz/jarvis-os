import { View, Text, Pressable, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';

export const INTEGRATION_LABELS: Record<string, string> = {
  google: 'Google',
  outlook: 'Outlook',
  telegram: 'Telegram',
  discord: 'Discord',
  slack: 'Slack',
  whatsapp: 'WhatsApp',
};

interface Props {
  integrationKey: string;
  onDismiss: () => void;
  onGoToSettings: () => void;
  cardStyle?: ViewStyle;
}

export function IntegrationErrorCard({ integrationKey, onDismiss, onGoToSettings, cardStyle }: Props) {
  const label = INTEGRATION_LABELS[integrationKey] ?? integrationKey;
  return (
    <View style={[styles.card, cardStyle]}>
      <View style={styles.iconRow}>
        <Ionicons name="warning-outline" size={18} color="#F59E0B" />
        <Text style={styles.title}>{label} needs to be reconnected</Text>
        <Pressable onPress={onDismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close" size={16} color={Colors.textTertiary} />
        </Pressable>
      </View>
      <Text style={styles.body}>
        Jarvis lost access to {label}. Reconnect it in Settings to restore full functionality.
      </Text>
      <Pressable style={styles.button} onPress={onGoToSettings}>
        <Text style={styles.buttonText}>Go to Settings → Connections</Text>
        <Ionicons name="arrow-forward" size={14} color={Colors.primary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FCD34D',
    gap: 8,
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: '#92400E',
  },
  body: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#78350F',
    lineHeight: 18,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  buttonText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.primary,
  },
});
