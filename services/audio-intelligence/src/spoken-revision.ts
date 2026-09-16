import type { AudioEvidence, SpokenRevisionEvent, TranscriptSegment } from './types.js';

function textAfter(text: string, marker: RegExp): string | null {
  const match = text.match(marker);
  return match?.[1]?.replace(/[。.!！?？]+$/, '').trim() || null;
}

export function detectSpokenRevisions(
  segments: TranscriptSegment[],
  evidence: AudioEvidence[],
): SpokenRevisionEvent[] {
  const evidenceBySegment = new Map(
    evidence.map((item) => [item.evidence_id.replace(/^.*:evidence:/, ''), item.evidence_id]),
  );
  const revisions: SpokenRevisionEvent[] = [];
  for (const [index, segment] of segments.entries()) {
    const text = segment.text.trim();
    let changeType: SpokenRevisionEvent['change_type'] | null = null;
    let newFact: string | null = null;
    if (/取消|作废|不用再/.test(text)) {
      changeType = 'revoked';
    } else if (/延期到|推迟到/.test(text)) {
      changeType = 'postponed';
      newFact = textAfter(text, /(?:延期到|推迟到)(.+)$/);
    } else if (/(?:刚才|刚刚).*?(?:说错|错了)|改成|以最新通知为准/.test(text)) {
      changeType = /以最新通知为准/.test(text) ? 'replaced' : 'corrected';
      newFact =
        textAfter(text, /改成(.+)$/) ??
        textAfter(text, /(?:统一在|改为|变更为)(.+)$/) ??
        (/以最新通知为准/.test(text) ? '最新通知' : text);
    }
    if (!changeType) continue;
    const previousSegment = segments[index - 1];
    const previous = previousSegment?.text.trim() ?? null;
    const evidenceId = evidenceBySegment.get(segment.segment_id);
    const previousEvidenceId = previousSegment
      ? evidenceBySegment.get(previousSegment.segment_id)
      : undefined;
    revisions.push({
      revision_id: `${segment.source_audio_id}:revision:${String(revisions.length + 1).padStart(4, '0')}`,
      change_type: changeType,
      source_audio_id: segment.source_audio_id,
      trigger_segment_id: segment.segment_id,
      evidence_ids: [previousEvidenceId, evidenceId].filter((value): value is string => Boolean(value)),
      trigger_text: text,
      old_fact: previous,
      new_fact: newFact,
      requires_user_confirmation: true,
    });
  }
  return revisions;
}
