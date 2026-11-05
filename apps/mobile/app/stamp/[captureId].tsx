import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, useWindowDimensions } from "react-native";
import { CodeDisplay } from "../../components/CodeDisplay";
import { PreviewBadge } from "../../components/PreviewBadge";
import { ShareSheetGate } from "../../components/ShareSheetGate";
import { COPY } from "../../lib/copy";
import { downloadToCache } from "../../lib/files";
import { getRuntime } from "../../lib/runtime";
import {
  needsMarkedDownload,
  reduceStatus,
  type StampStatus,
  statusFromItem,
} from "../../lib/status";
import { useQueueItems } from "../../lib/useQueue";

const LOCATION_NOTE = {
  recorded: COPY.location.recorded,
  denied: COPY.location.denied,
  unavailable: COPY.location.unavailable,
} as const;

const MESSAGE: Record<StampStatus["phase"], string> = {
  captured: COPY.status.captured,
  hashing: COPY.status.hashing,
  signed: COPY.status.signed,
  uploading: COPY.status.uploading,
  claimSent: COPY.status.registering,
  registered: COPY.status.registered,
  shareReady: COPY.status.shareReady,
  reissued: COPY.status.reissued,
  failed: COPY.status.failed,
};

export default function StampScreen() {
  const { captureId } = useLocalSearchParams<{ captureId: string }>();
  const item = useQueueItems().find((i) => i.id === captureId);
  const { width } = useWindowDimensions();
  const local = useMemo(() => (item ? statusFromItem(item) : null), [item]);
  const [server, setServer] = useState<StampStatus | null>(null);
  const downloading = useRef(false);
  const serverCaptureId = item?.state === "claimSent" ? item.capture?.captureId : undefined;
  const status = server ?? local;
  const polling =
    !!serverCaptureId &&
    status?.phase !== "shareReady" &&
    status?.phase !== "reissued" &&
    status?.phase !== "failed";

  const q = useQuery({
    queryKey: ["capture", serverCaptureId],
    enabled: polling,
    refetchInterval: polling ? 3_000 : false,
    queryFn: async () => (await getRuntime()).api.captureStatus(serverCaptureId as string),
  });

  useEffect(() => {
    if (!q.data || !local) return;
    setServer((prev) => reduceStatus(prev ?? local, { type: "server", dto: q.data }));
  }, [q.data, local]);

  useEffect(() => {
    if (!server || !needsMarkedDownload(server) || !server.markedUrl || downloading.current) return;
    downloading.current = true;
    const ext = item?.meta.mediaKind === 2 ? "mp4" : "jpg";
    downloadToCache(server.markedUrl, `marked-${captureId}.${ext}`)
      .then((uri) => setServer((s) => (s ? reduceStatus(s, { type: "markedDownloaded", uri }) : s)))
      .catch(() => undefined)
      .finally(() => {
        downloading.current = false;
      });
  }, [server, item, captureId]);

  if (!item || !status) return <Text style={styles.pad}>…</Text>;
  const isPhoto = item.meta.mediaKind === 1;
  const uploading = status.phase === "uploading" || status.phase === "signed";
  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      {status.phase === "shareReady" && status.markedLocalUri && isPhoto ? (
        <Image
          source={{ uri: status.markedLocalUri }}
          style={{ width, height: width * 0.75 }}
          contentFit="contain"
        />
      ) : isPhoto ? (
        <PreviewBadge
          uri={item.fileUri}
          aspect={
            item.meta.dims.w && item.meta.dims.h ? item.meta.dims.w / item.meta.dims.h : 4 / 3
          }
        />
      ) : null}
      <Text style={styles.message} testID="stamp-status">
        {MESSAGE[status.phase]}
      </Text>
      {item.offline && status.phase === "signed" ? (
        <Text style={styles.note}>{COPY.status.offline}</Text>
      ) : null}
      {item.locationStatus ? (
        <Text style={styles.note} testID="stamp-location">
          {LOCATION_NOTE[item.locationStatus]}
        </Text>
      ) : null}
      {uploading && Platform.OS === "android" ? (
        <Text style={styles.note}>{COPY.status.androidUploadNotice}</Text>
      ) : null}
      <CodeDisplay status={status} />
      <ShareSheetGate status={status} mimeType={isPhoto ? "image/jpeg" : "video/mp4"} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 24 },
  wrap: { alignItems: "center", paddingBottom: 32 },
  message: {
    marginTop: 16,
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
    paddingHorizontal: 16,
  },
  note: { marginTop: 8, fontSize: 14, opacity: 0.75, textAlign: "center", paddingHorizontal: 16 },
});
