import { useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import {
  REPORT_NOTE_MAX,
  REPORT_REASONS,
  type ReportReason,
  type ReportTarget,
} from '@kgc/shared';

import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { HIT_TARGET, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth/auth-provider';
import { useEventSettings } from '@/lib/data/event-settings';
import { blockUser, fileReport, unblockUser, useBlocked } from '@/lib/data/safety';
import { contactAddress } from '@/lib/legal';

/**
 * The "…" on a post, a reply, a conversation or a profile, and the sheet it
 * opens: Report, and Block or Unblock the person who wrote it.
 *
 * One component for every surface, so the reasons, the wording and what a
 * block does are the same wherever someone meets them. A `Modal` rather than
 * `Alert`: `Alert` does nothing on web and Android shows at most three buttons.
 *
 * The backdrop is a sibling behind the sheet, not its parent. Wrapped in an
 * accessible "Close" button, the whole sheet was one element on iOS, so
 * VoiceOver could not reach Report, Block, the reasons or Send (T230).
 */
export function SafetyMenu({
  target,
  authorId,
  authorName,
  subject,
  canBlock = true,
}: {
  target: ReportTarget;
  /** Who wrote it. Absent or me: no Block option, and no report of my own words. */
  authorId?: string;
  authorName?: string;
  /** "this post", "this reply", "this conversation", "this profile". */
  subject: string;
  /** False for a deleted account: it can still be reported, but there is nobody to block. */
  canBlock?: boolean;
}) {
  const colors = useTheme();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  if (!user || (authorId && authorId === user.uid)) return null;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`More options for ${subject}`}
        hitSlop={10}
        style={{ minWidth: HIT_TARGET, minHeight: HIT_TARGET, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="ellipsis" size={20} color={colors.textSecondary} />
      </Pressable>
      {open ? (
        <SafetySheet
          me={user.uid}
          target={target}
          authorId={authorId}
          authorName={authorName}
          subject={subject}
          canBlock={canBlock && Boolean(authorId)}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

type Step = 'menu' | 'report' | 'block' | 'done';

function SafetySheet({
  me,
  target,
  authorId,
  authorName,
  subject,
  canBlock,
  onClose,
}: {
  me: string;
  target: ReportTarget;
  authorId?: string;
  authorName?: string;
  subject: string;
  canBlock: boolean;
  onClose: () => void;
}) {
  const colors = useTheme();
  const { branding } = useEventSettings();
  const { blocked } = useBlocked();
  const [step, setStep] = useState<Step>('menu');
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ title: string; body: string } | null>(null);

  const who = authorName || 'this person';
  const isBlocked = Boolean(authorId && blocked.has(authorId));

  async function sendReport() {
    if (!reason) return;
    setBusy(true);
    const res = await fileReport({ reporterId: me, target, reason, note, targetAuthorId: authorId });
    setBusy(false);
    setOutcome(
      res.ok
        ? {
            title: 'Thanks for telling us',
            body: canBlock
              ? 'The organizers will look at it. You can also block this person from the same menu.'
              : 'The organizers will look at it.',
          }
        : {
            title: 'Not sent',
            body: `If you reported ${subject} before, the organizers already have it. Otherwise write to ${contactAddress(branding.supportEmail)}.`,
          },
    );
    setStep('done');
  }

  async function toggleBlock() {
    if (!authorId || !canBlock) return;
    setBusy(true);
    const res = isBlocked ? await unblockUser(me, authorId) : await blockUser(me, authorId);
    setBusy(false);
    setOutcome(
      res.ok
        ? isBlocked
          ? { title: `${who} is unblocked`, body: 'You will see their posts and messages again.' }
          : {
              title: `${who} is blocked`,
              body: "You won't see their posts, replies or messages, and neither of you can message the other. They aren't told. You can unblock them from their profile.",
            }
        : { title: 'That did not work', body: 'Check your connection and try again.' },
    );
    setStep('done');
  }

  const row = (label: string, onPress: () => void, tone: 'primary' | 'danger' = 'primary') => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        minHeight: HIT_TARGET,
        justifyContent: 'center',
        paddingHorizontal: Spacing.md,
        backgroundColor: pressed ? colors.surfacePressed : 'transparent',
      })}>
      <Text tone={tone}>{label}</Text>
    </Pressable>
  );

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        {/* Tap outside to close. Not an accessibility element: every step has
            its own Cancel or Done, and VoiceOver's escape gesture closes too. */}
        <Pressable
          onPress={onClose}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
        />
        <View
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: Radius.lg,
            borderTopRightRadius: Radius.lg,
            paddingTop: Spacing.md,
            paddingBottom: Spacing.xl,
            gap: Spacing.sm,
          }}>
          {step === 'menu' ? (
            <>
              {row(`Report ${subject}`, () => setStep('report'), 'danger')}
              {canBlock ? row(isBlocked ? `Unblock ${who}` : `Block ${who}`, () => setStep('block'), 'danger') : null}
              {row('Cancel', onClose)}
            </>
          ) : null}

          {step === 'report' ? (
            <View style={{ paddingHorizontal: Spacing.md, gap: Spacing.sm }}>
              <Text variant="heading" accessibilityRole="header">
                Report {subject}
              </Text>
              <Text variant="subhead" tone="secondary">
                {authorName
                  ? `Only the organizers see reports. ${authorName} isn't told who sent it.`
                  : 'Only the organizers see reports.'}
              </Text>
              <View accessibilityRole="radiogroup" style={{ gap: 2 }}>
                {REPORT_REASONS.map((r) => {
                  const on = reason === r.id;
                  return (
                    <Pressable
                      key={r.id}
                      onPress={() => setReason(r.id)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                      style={{ minHeight: HIT_TARGET, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
                      <View
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: 10,
                          borderWidth: 2,
                          borderColor: on ? colors.tint : colors.border,
                          backgroundColor: on ? colors.tint : 'transparent',
                        }}
                      />
                      <Text>{r.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Anything the organizers should know (optional)"
                placeholderTextColor={colors.textTertiary}
                maxLength={REPORT_NOTE_MAX}
                multiline
                accessibilityLabel="Note for the organizers"
                style={{
                  backgroundColor: colors.background,
                  borderRadius: Radius.md,
                  padding: Spacing.sm,
                  minHeight: 72,
                  fontSize: 17,
                  color: colors.text,
                  textAlignVertical: 'top',
                }}
              />
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.lg }}>
                <Pressable onPress={onClose} accessibilityRole="button" style={{ minHeight: HIT_TARGET, justifyContent: 'center' }}>
                  <Text tone="secondary">Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={sendReport}
                  disabled={!reason || busy}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !reason || busy }}
                  style={{ minHeight: HIT_TARGET, justifyContent: 'center', opacity: reason && !busy ? 1 : 0.4 }}>
                  <Text variant="heading" tone="danger">
                    {busy ? 'Sending…' : 'Send report'}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {step === 'block' ? (
            <View style={{ paddingHorizontal: Spacing.md, gap: Spacing.sm }}>
              <Text variant="heading" accessibilityRole="header">
                {isBlocked ? `Unblock ${who}?` : `Block ${who}?`}
              </Text>
              <Text variant="subhead" tone="secondary">
                {isBlocked
                  ? 'Their posts, replies and messages will show again, and you can message each other.'
                  : "Their posts, replies and messages will be hidden from you, and neither of you can message the other. They aren't told."}
              </Text>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.lg }}>
                <Pressable onPress={onClose} accessibilityRole="button" style={{ minHeight: HIT_TARGET, justifyContent: 'center' }}>
                  <Text tone="secondary">Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={toggleBlock}
                  disabled={busy}
                  accessibilityRole="button"
                  style={{ minHeight: HIT_TARGET, justifyContent: 'center', opacity: busy ? 0.4 : 1 }}>
                  <Text variant="heading" tone="danger">
                    {isBlocked ? 'Unblock' : 'Block'}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {step === 'done' && outcome ? (
            <View style={{ paddingHorizontal: Spacing.md, gap: Spacing.sm }}>
              <Text variant="heading" accessibilityRole="header">
                {outcome.title}
              </Text>
              <Text variant="subhead" tone="secondary">
                {outcome.body}
              </Text>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                style={{ minHeight: HIT_TARGET, justifyContent: 'center', alignSelf: 'flex-end' }}>
                <Text variant="heading" tone="tint">
                  Done
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
