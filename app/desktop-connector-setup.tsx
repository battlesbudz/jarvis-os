import React, { useCallback } from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WindowsConnectorSetupWizard } from "@/components/desktopConnector/WindowsConnectorSetupWizard";
import Colors from "@/constants/colors";

export default function DesktopConnectorSetupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const goHome = useCallback(() => {
    router.replace("/(tabs)/insights" as any);
  }, [router]);

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 24,
          paddingBottom: (Platform.OS === "web" ? 34 : insets.bottom) + 24,
        },
      ]}
    >
      <View style={styles.center}>
        <WindowsConnectorSetupWizard onSkip={goHome} onConnected={goHome} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
    justifyContent: "center",
  },
  center: {
    width: "100%",
    alignItems: "center",
  },
});
