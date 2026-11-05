import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { COPY } from "../../lib/copy";
import { type Enrolment, getEnrolment } from "../../lib/enrol";
import { getOrCreateDeviceKey, resetDeviceKey } from "../../lib/keys";
import { getRuntime } from "../../lib/runtime";
import { useQueueItems } from "../../lib/useQueue";

export default function Settings() {
  const [address, setAddress] = useState("");
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const pending = useQueueItems().filter((i) => i.state !== "claimSent" && i.state !== "failed");

  useFocusEffect(
    useCallback(() => {
      getOrCreateDeviceKey().then(
        (k) => setAddress(k.address),
        () => undefined,
      );
      getEnrolment().then(setEnrolment, () => undefined);
    }, []),
  );

  const reset = () =>
    Alert.alert(COPY.settings.reset, "", [
      { text: "Cancel", style: "cancel" },
      { text: COPY.settings.reset, style: "destructive", onPress: () => void resetDeviceKey() },
    ]);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{COPY.settings.device}</Text>
      <Text selectable style={styles.mono}>
        {address}
      </Text>
      <Text style={styles.label}>{COPY.settings.level}</Text>
      <Text>{enrolment ? `L${enrolment.level}` : "-"}</Text>
      <Text style={styles.label}>{COPY.settings.queue}</Text>
      <Text>{pending.length}</Text>
      <Pressable
        accessibilityRole="button"
        style={styles.button}
        onPress={() => void getRuntime().then((r) => r.drain())}
      >
        <Text style={styles.buttonText}>{COPY.settings.retry}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" style={[styles.button, styles.danger]} onPress={reset}>
        <Text style={styles.buttonText}>{COPY.settings.reset}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 16, gap: 6 },
  label: { marginTop: 12, fontWeight: "600" },
  mono: { fontFamily: "monospace", fontSize: 12 },
  button: {
    marginTop: 16,
    backgroundColor: "#1f6feb",
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  danger: { backgroundColor: "#b00020" },
  buttonText: { color: "white", fontWeight: "600" },
});
