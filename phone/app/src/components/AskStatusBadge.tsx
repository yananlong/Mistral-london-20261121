import { StyleSheet, Text, View } from 'react-native';
import { ASK_STATUS_LABEL, AskStatus } from '../ask/askStateMachine';
import { colors, fontSize, fontWeight, layout, spacing } from '../theme/tokens';

const STATUS_COLOR: Record<AskStatus, string> = {
  sent: colors.statusSent,
  receivedByHub: colors.statusReceived,
  answered: colors.statusAnswered,
  hubNotReachable: colors.statusUnreachable,
};

/**
 * The one shared Ask status component every question uses (PLAN.md section 6:
 * "Ask status component: one shared component that every question uses").
 */
export function AskStatusBadge({ status }: { status: AskStatus }) {
  return (
    <View style={[styles.badge, { borderColor: STATUS_COLOR[status] }]}>
      <Text style={[styles.label, { color: STATUS_COLOR[status] }]}>
        {ASK_STATUS_LABEL[status]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderWidth: layout.borderWidth,
    borderRadius: layout.radiusLg,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  label: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.medium,
  },
});
