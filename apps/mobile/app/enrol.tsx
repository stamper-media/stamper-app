import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { COPY } from "../lib/copy";
import { enrolDevice } from "../lib/enrol";
import { getRuntime } from "../lib/runtime";

export default function EnrolScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [stub, setStub] = useState(false);

  const start = async () => {
    setBusy(true);
    setResult(null);
    try {
      const rt = await getRuntime();
      setStub(rt.cfg.attestMode === "stub");
      const e = await enrolDevice(rt.api, rt.att);
      setResult(e.level >= 1 ? COPY.enrol.doneL1 : COPY.enrol.doneL0);
      setTimeout(() => router.back(), 1200);
    } catch (e) {
      setResult(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{COPY.enrol.title}</Text>
      <Text style={styles.body}>{COPY.enrol.body}</Text>
      {stub ? <Text style={styles.body}>{COPY.enrol.stubNotice}</Text> : null}
      <Pressable
        accessibilityRole="button"
        testID="enrol-start"
        style={styles.button}
        onPress={start}
        disabled={busy}
      >
        {busy ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={styles.buttonText}>{COPY.enrol.start}</Text>
        )}
      </Pressable>
      {result ? <Text style={styles.body}>{result}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 24, gap: 12, justifyContent: "center" },
  title: { fontSize: 22, fontWeight: "700" },
  body: { fontSize: 16 },
  button: { backgroundColor: "#1f6feb", padding: 14, borderRadius: 8, alignItems: "center" },
  buttonText: { color: "white", fontWeight: "600", fontSize: 17 },
});
