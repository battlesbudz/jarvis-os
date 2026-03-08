import React from 'react';
import { View, Text, StyleSheet, TextStyle } from 'react-native';

interface Props {
  text: string;
  isUser?: boolean;
  baseStyle?: TextStyle;
}

interface Token {
  type: 'h1' | 'h2' | 'bullet' | 'numbered' | 'paragraph' | 'blank';
  content: string;
  number?: number;
}

function tokenize(text: string): Token[] {
  const lines = text.split('\n');
  const tokens: Token[] = [];
  let numberedIdx = 0;

  for (const raw of lines) {
    const line = raw;
    if (line.trim() === '') {
      tokens.push({ type: 'blank', content: '' });
      continue;
    }
    if (/^# (.+)/.test(line)) {
      tokens.push({ type: 'h1', content: line.replace(/^# /, '') });
      continue;
    }
    if (/^## (.+)/.test(line)) {
      tokens.push({ type: 'h2', content: line.replace(/^## /, '') });
      continue;
    }
    const bulletMatch = line.match(/^[-•*] (.+)/);
    if (bulletMatch) {
      tokens.push({ type: 'bullet', content: bulletMatch[1] });
      continue;
    }
    const numberedMatch = line.match(/^(\d+)\. (.+)/);
    if (numberedMatch) {
      numberedIdx = parseInt(numberedMatch[1], 10);
      tokens.push({ type: 'numbered', content: numberedMatch[2], number: numberedIdx });
      continue;
    }
    tokens.push({ type: 'paragraph', content: line });
  }
  return tokens;
}

function renderInline(text: string, baseColor: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(
        <Text key={`t${last}`} style={{ color: baseColor }}>
          {text.slice(last, match.index)}
        </Text>
      );
    }
    parts.push(
      <Text key={`b${match.index}`} style={{ color: baseColor, fontFamily: 'Inter_700Bold' }}>
        {match[1]}
      </Text>
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    parts.push(
      <Text key={`t${last}`} style={{ color: baseColor }}>
        {text.slice(last)}
      </Text>
    );
  }
  return parts;
}

export default function MarkdownText({ text, isUser = false, baseStyle }: Props) {
  const baseColor = isUser ? '#FFFFFF' : '#1E293B';
  const tokens = tokenize(text);

  const rendered: React.ReactNode[] = [];
  let blankCount = 0;

  tokens.forEach((token, i) => {
    if (token.type === 'blank') {
      blankCount++;
      return;
    }

    const prevToken = tokens[i - 1];
    const needsTopGap = blankCount > 0 || (prevToken && prevToken.type !== 'blank' && i > 0);
    blankCount = 0;

    if (token.type === 'h1') {
      rendered.push(
        <Text key={i} style={[styles.h1, { color: baseColor }, needsTopGap && styles.topGap, baseStyle]}>
          {renderInline(token.content, baseColor)}
        </Text>
      );
    } else if (token.type === 'h2') {
      rendered.push(
        <Text key={i} style={[styles.h2, { color: baseColor }, needsTopGap && styles.topGap, baseStyle]}>
          {renderInline(token.content, baseColor)}
        </Text>
      );
    } else if (token.type === 'bullet') {
      rendered.push(
        <View key={i} style={[styles.listRow, needsTopGap && styles.listTopGap]}>
          <Text style={[styles.bullet, { color: baseColor }]}>{'•'}</Text>
          <Text style={[styles.listText, { color: baseColor }, baseStyle]}>
            {renderInline(token.content, baseColor)}
          </Text>
        </View>
      );
    } else if (token.type === 'numbered') {
      rendered.push(
        <View key={i} style={[styles.listRow, needsTopGap && styles.listTopGap]}>
          <Text style={[styles.bullet, { color: baseColor }]}>{token.number}.</Text>
          <Text style={[styles.listText, { color: baseColor }, baseStyle]}>
            {renderInline(token.content, baseColor)}
          </Text>
        </View>
      );
    } else {
      rendered.push(
        <Text key={i} style={[styles.paragraph, { color: baseColor }, needsTopGap && styles.topGap, baseStyle]}>
          {renderInline(token.content, baseColor)}
        </Text>
      );
    }
  });

  return <View style={styles.container}>{rendered}</View>;
}

const styles = StyleSheet.create({
  container: {
    flexShrink: 1,
  },
  paragraph: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    lineHeight: 22,
  },
  h1: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    lineHeight: 24,
    marginTop: 6,
  },
  h2: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    lineHeight: 22,
    marginTop: 4,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 3,
  },
  listTopGap: {
    marginTop: 8,
  },
  bullet: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    lineHeight: 22,
    marginRight: 6,
    minWidth: 14,
  },
  listText: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    lineHeight: 22,
    flex: 1,
  },
  topGap: {
    marginTop: 8,
  },
});
