import { Link } from "expo-router";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { CodeDisplay } from "../../components/CodeDisplay";
import { COPY } from "../../lib/copy";
import { statusFromItem } from "../../lib/status";
import { useQueueItems } from "../../lib/useQueue";

const PHASE_TEXT: Record<string, string> = {
  captured: COPY.status.captured,
  hashing: COPY.status.hashing,
  signed: COPY.gallery.pending,
  uploading: COPY.status.uploading,
  claimSent: COPY.status.registering,
  failed: COPY.status.failed,
};

export default function Gallery() {
  const items = [...useQueueItems()].reverse();
  if (items.length === 0) {
    return (
      <View style={styles.center}>
        <Text>{COPY.gallery.empty}</Text>
      </View>
    );
  }
  return (
    <FlatList
      data={items}
      keyExtractor={(i) => i.id}
      renderItem={({ item }) => {
        const s = statusFromItem(item);
        return (
          <Link href={`/stamp/${item.id}`} style={styles.row}>
            <Text style={styles.title}>{new Date(item.createdAt).toLocaleString()}</Text>
            {"\n"}
            <Text>{PHASE_TEXT[s.phase] ?? s.phase}</Text>
            {s.predictedCode ? <CodeDisplay status={s} /> : null}
          </Link>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  row: { padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "#999" },
  title: { fontWeight: "600" },
});
