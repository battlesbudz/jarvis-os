import React, { useRef, useState, useMemo, useCallback } from 'react';
import { View, PanResponder, Animated, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';

interface SortableListProps<T> {
  data: T[];
  keyExtractor: (item: T) => string;
  renderItem: (params: { item: T; isActive: boolean }) => React.ReactNode;
  onReorder: (newData: T[]) => void;
}

interface ItemRowProps<T> {
  item: T;
  index: number;
  isActive: boolean;
  dragDy: Animated.Value;
  renderItem: (params: { item: T; isActive: boolean }) => React.ReactNode;
  onDragStart: (index: number) => void;
  onDragMove: (dy: number) => void;
  onDragRelease: (dy: number) => void;
  onLayout: (index: number, height: number) => void;
}

function ItemRow<T>({
  item,
  index,
  isActive,
  dragDy,
  renderItem,
  onDragStart,
  onDragMove,
  onDragRelease,
  onLayout,
}: ItemRowProps<T>) {
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          onDragStart(index);
        },
        onPanResponderMove: (_, gs) => {
          onDragMove(gs.dy);
        },
        onPanResponderRelease: (_, gs) => {
          onDragRelease(gs.dy);
        },
        onPanResponderTerminate: (_, gs) => {
          onDragRelease(gs.dy);
        },
      }),
    [index, onDragStart, onDragMove, onDragRelease]
  );

  const activeStyle = isActive
    ? {
        transform: [{ translateY: dragDy }, { scale: 1.02 }] as any,
        zIndex: 100,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.15,
        shadowRadius: 10,
        elevation: 8,
        opacity: 0.95,
      }
    : {};

  return (
    <Animated.View
      style={[styles.row, activeStyle]}
      onLayout={(e) => onLayout(index, e.nativeEvent.layout.height)}
    >
      <View
        {...panResponder.panHandlers}
        style={styles.dragHandle}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Ionicons name="reorder-three-outline" size={22} color={Colors.textTertiary} />
      </View>
      <View style={styles.itemContent}>
        {renderItem({ item, isActive })}
      </View>
    </Animated.View>
  );
}

export default function SortableList<T>({
  data,
  keyExtractor,
  renderItem,
  onReorder,
}: SortableListProps<T>) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const dragDy = useRef(new Animated.Value(0)).current;
  const itemHeights = useRef<number[]>([]);
  const activeIndexRef = useRef<number | null>(null);

  const getTargetIndex = useCallback(
    (fromIndex: number, dy: number): number => {
      let fromCenter = 0;
      for (let i = 0; i < fromIndex; i++) fromCenter += itemHeights.current[i] ?? 80;
      fromCenter += (itemHeights.current[fromIndex] ?? 80) / 2;
      const newCenter = fromCenter + dy;

      let accumulated = 0;
      for (let i = 0; i < data.length; i++) {
        const h = itemHeights.current[i] ?? 80;
        const mid = accumulated + h / 2;
        if (newCenter < mid) return i;
        accumulated += h;
      }
      return data.length - 1;
    },
    [data]
  );

  const handleDragStart = useCallback((index: number) => {
    activeIndexRef.current = index;
    setActiveIndex(index);
    dragDy.setValue(0);
  }, [dragDy]);

  const handleDragMove = useCallback(
    (dy: number) => {
      dragDy.setValue(dy);
    },
    [dragDy]
  );

  const handleDragRelease = useCallback(
    (dy: number) => {
      const fromIndex = activeIndexRef.current;
      if (fromIndex !== null) {
        const toIndex = getTargetIndex(fromIndex, dy);
        if (fromIndex !== toIndex) {
          const newData = [...data];
          const [moved] = newData.splice(fromIndex, 1);
          newData.splice(toIndex, 0, moved);
          onReorder(newData);
        }
      }
      Animated.spring(dragDy, { toValue: 0, useNativeDriver: true }).start();
      setActiveIndex(null);
      activeIndexRef.current = null;
    },
    [data, dragDy, getTargetIndex, onReorder]
  );

  const handleLayout = useCallback((index: number, height: number) => {
    itemHeights.current[index] = height;
  }, []);

  return (
    <View>
      {data.map((item, index) => (
        <ItemRow
          key={keyExtractor(item)}
          item={item}
          index={index}
          isActive={activeIndex === index}
          dragDy={dragDy}
          renderItem={renderItem}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragRelease={handleDragRelease}
          onLayout={handleLayout}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dragHandle: {
    paddingHorizontal: 4,
    paddingVertical: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemContent: {
    flex: 1,
  },
});
