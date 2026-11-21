import { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { LocalTile, Marker } from 'react-native-maps';
import { PUBLIC_CHANNEL, PeerId } from '../transport/Transport';
import { useTransport } from '../transport/TransportContext';
import { usePositionContext } from '../locate/PositionContext';
import { useCameraPermission } from '../camera/useCameraPermission';
import { LatLon, findLocLine, formatLocLine } from '../locate/locLine';
import { LONDON_REGION, TILE_PATH_TEMPLATE, bundledTilesCover } from '../locate/tiles';
import { colors, fontSize, fontWeight, layout, spacing } from '../theme/tokens';

interface SharedPin {
  id: string;
  from: string;
  lat: number;
  lon: number;
}

type ShareTarget = PeerId | typeof PUBLIC_CHANNEL;

export function LocateScreen() {
  const transport = useTransport();
  const position = usePositionContext();
  const cameraPermission = useCameraPermission();
  const [pins, setPins] = useState<SharedPin[]>([]);
  const [justShared, setJustShared] = useState(false);
  // BLUEPRINT_1.md: Share location sends to one person or to the public channel.
  const [shareTo, setShareTo] = useState<ShareTarget>(PUBLIC_CHANNEL);

  useEffect(() => {
    const unsubscribe = transport.subscribe((message) => {
      const loc = findLocLine(message.text);
      if (!loc) return;
      setPins((prev) =>
        prev.some((pin) => pin.id === message.id)
          ? prev
          : [...prev, { id: message.id, from: message.from, lat: loc.lat, lon: loc.lon }],
      );
    });
    return unsubscribe;
  }, [transport]);

  const coords: LatLon | null = position.coords;
  // Before the first fix we show the downloaded London area; after a fix we
  // check whether the tiles cover where the user actually is.
  const tilesAvailable = coords ? bundledTilesCover(coords) : true;

  const recipients: { id: ShareTarget; label: string }[] = [
    { id: PUBLIC_CHANNEL, label: 'Public' },
    ...transport
      .peers()
      .filter((peer) => peer.kind === 'phone')
      .map((peer) => ({ id: peer.id as ShareTarget, label: peer.name })),
  ];
  const shareTargetLabel =
    shareTo === PUBLIC_CHANNEL
      ? 'the public channel'
      : recipients.find((recipient) => recipient.id === shareTo)?.label ?? 'one person';

  function shareLocation() {
    if (!coords) return;
    transport.send(shareTo, formatLocLine(coords));
    setJustShared(true);
  }

  if (position.status === 'denied') {
    return (
      <View style={styles.container}>
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Location permission denied</Text>
          <Text style={styles.noticeHint}>
            Enable location permission in Settings to see your position on the offline map.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView style={styles.map} initialRegion={LONDON_REGION}>
        <LocalTile pathTemplate={TILE_PATH_TEMPLATE} tileSize={256} />
        {coords && (
          <Marker
            coordinate={{ latitude: coords.lat, longitude: coords.lon }}
            title="You"
            pinColor={colors.accent}
          />
        )}
        {pins.map((pin) => (
          <Marker
            key={pin.id}
            coordinate={{ latitude: pin.lat, longitude: pin.lon }}
            title={`Shared by ${pin.from}`}
            pinColor={colors.warning}
          />
        ))}
      </MapView>
      {position.status === 'pending' && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Getting your position…</Text>
        </View>
      )}
      {(cameraPermission === 'denied' || !tilesAvailable) && (
        <View style={styles.bannerStack}>
          {cameraPermission === 'denied' && (
            <Text style={styles.bannerText}>
              Camera permission denied — enable camera access in Settings to orient yourself on
              the map.
            </Text>
          )}
          {!tilesAvailable && (
            <Text style={styles.bannerText}>Map not downloaded for this area</Text>
          )}
        </View>
      )}
      <View style={styles.bottomPanel}>
        <View style={styles.recipientRow}>
          {recipients.map((recipient) => (
            <TouchableOpacity
              key={recipient.id}
              style={[
                styles.recipientChip,
                shareTo === recipient.id && styles.recipientChipActive,
              ]}
              onPress={() => setShareTo(recipient.id)}
              accessibilityRole="button"
            >
              <Text
                style={[
                  styles.recipientChipText,
                  shareTo === recipient.id && styles.recipientChipTextActive,
                ]}
              >
                {recipient.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity
          style={[styles.shareButton, !coords && styles.shareButtonDisabled]}
          onPress={shareLocation}
          disabled={!coords}
          accessibilityRole="button"
        >
          <Text style={styles.shareButtonText}>Share location</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>
          {coords
            ? justShared
              ? `Shared ${formatLocLine(coords)} with ${shareTargetLabel}`
              : `Sends a loc: line to ${shareTargetLabel}`
            : 'Waiting for a position fix…'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  map: { flex: 1 },
  notice: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  noticeTitle: { color: colors.text, fontSize: fontSize.title, fontWeight: fontWeight.bold },
  noticeHint: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  banner: {
    position: 'absolute',
    top: spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
    borderRadius: layout.radiusMd,
    backgroundColor: colors.surfaceRaised,
    padding: spacing.md,
  },
  bannerStack: {
    position: 'absolute',
    top: spacing.lg + 44,
    left: spacing.lg,
    right: spacing.lg,
    borderRadius: layout.radiusMd,
    backgroundColor: colors.surfaceRaised,
    padding: spacing.md,
    gap: spacing.xs,
  },
  bannerText: { color: colors.text, fontSize: fontSize.body, textAlign: 'center' },
  bottomPanel: {
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderTopWidth: layout.borderWidth,
    borderTopColor: colors.border,
  },
  recipientRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  recipientChip: {
    minHeight: layout.minTapTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: layout.radiusLg,
    borderWidth: layout.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  recipientChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  recipientChipText: { color: colors.text, fontSize: fontSize.body, fontWeight: fontWeight.medium },
  recipientChipTextActive: { color: colors.accentText },
  shareButton: {
    minHeight: layout.minTapTarget,
    borderRadius: layout.radiusMd,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareButtonDisabled: { backgroundColor: colors.border },
  shareButtonText: {
    color: colors.accentText,
    fontSize: fontSize.body,
    fontWeight: fontWeight.bold,
  },
  hint: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
