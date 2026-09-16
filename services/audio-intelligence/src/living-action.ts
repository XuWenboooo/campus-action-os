import type { SpokenRevisionEvent } from './types.js';

/**
 * Adapter into the existing Living Action / Notification Diff vocabulary.
 * It creates a pending proposal only; the existing confirmation and persistence
 * path remains the authority for changing a Task or VerifiedActionObject.
 */
export type LivingActionRevisionProposal = {
  change_event_id: string;
  action_id: string;
  status: 'pending_review';
  change_type: SpokenRevisionEvent['change_type'];
  old_value: string | null;
  new_value: string | null;
  evidence_ids: string[];
  source_audio_id: string;
  trigger_segment_id: string;
  requires_confirmation: true;
};

export function toLivingActionRevisionProposal(
  actionId: string,
  revision: SpokenRevisionEvent,
): LivingActionRevisionProposal {
  return {
    change_event_id: revision.revision_id,
    action_id: actionId,
    status: 'pending_review',
    change_type: revision.change_type,
    old_value: revision.old_fact,
    new_value: revision.new_fact,
    evidence_ids: revision.evidence_ids,
    source_audio_id: revision.source_audio_id,
    trigger_segment_id: revision.trigger_segment_id,
    requires_confirmation: true,
  };
}
