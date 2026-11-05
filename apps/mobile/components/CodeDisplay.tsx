import { codeToNato } from "@stamper/core";
import { StyleSheet, Text, View } from "react-native";
import { COPY } from "../lib/copy";
import { codeView, type StampStatus } from "../lib/status";

/** The predicted code stays greyed and unselectable until the registration receipt (§8.4a). */
export function CodeDisplay({ status }: { status: StampStatus }) {
  const view = codeView(status);
  if (!view.text) return null;
  return (
    <View
      style={styles.box}
      accessibilityLabel={view.definitive ? `Code ${view.text}` : COPY.code.predictedHint}
    >
      <Text selectable={view.definitive} style={[styles.code, !view.definitive && styles.greyed]}>
        {view.text}
      </Text>
      {view.definitive ? (
        <Text style={styles.hint}>
          {COPY.code.spoken}: {codeToNato(view.text)}
        </Text>
      ) : (
        <Text style={styles.hint}>{COPY.code.predictedHint}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: "center", paddingVertical: 12 },
  code: { fontSize: 32, fontWeight: "700", letterSpacing: 2, fontVariant: ["tabular-nums"] },
  greyed: { opacity: 0.35 },
  hint: { marginTop: 4, fontSize: 13, opacity: 0.7, textAlign: "center" },
});
