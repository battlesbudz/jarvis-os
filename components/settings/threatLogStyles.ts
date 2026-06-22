import { StyleSheet } from 'react-native';
import Colors from '@/constants/colors';

export const tlStyles = StyleSheet.create({
  header: {
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  headerText: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: '#F59E0B',
    letterSpacing: 1.5,
  },
  headerSub: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    width: '100%',
    marginTop: 2,
  },
  loadingRow: {
    padding: 16,
    alignItems: 'center',
  },
  emptyText: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
  },
  signalRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 10,
  },
  signalBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  signalIconWrap: {
    paddingTop: 2,
  },
  signalBody: {
    flex: 1,
    gap: 3,
  },
  signalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  signalType: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    flex: 1,
  },
  confidenceBadge: {
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  confidenceText: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
  },
  signalExplanation: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    lineHeight: 17,
  },
  signalDate: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
  },
});
