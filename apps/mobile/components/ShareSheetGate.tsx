import * as Sharing from "expo-sharing";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { COPY } from "../lib/copy";
import { canShare, type StampStatus } from "../lib/status";

/** The share sheet opens only with a receipt AND the marked file on the device (§8.4b). */
export function ShareSheetGate({ status, mimeType }: { status: StampStatus; mimeType: string }) {
  const [busy, setBusy] = useState(false);
  const open = canShare(status);
  const onPress = async () => {
    if (!open || !status.markedLocalUri) return;
    setBusy(true);
    try {
      await Sharing.shareAsync(status.markedLocalUri, { mimeType, dialogTitle: status.code ?? "" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !open || busy }}
        disabled={!open || busy}
        onPress={onPress}
        style={[styles.button, (!open || busy) && styles.disabled]}
      >
        <Text style={styles.label}>{COPY.share.button}</Text>
      </Pressable>
      {!open ? <Text style={styles.hint}>{COPY.share.locked}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", padding: 16 },
  button: {
    backgroundColor: "#1f6feb",
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 8,
  },
  disabled: { backgroundColor: "#8a8f98" },
  label: { color: "white", fontSize: 17, fontWeight: "600" },
  hint: { marginTop: 8, fontSize: 13, opacity: 0.7, textAlign: "center" },
});
