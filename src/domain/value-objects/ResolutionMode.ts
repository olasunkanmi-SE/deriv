import { VocabularyError } from '../errors.js';

export const RESOLUTION_MODES = [
  'reply_only',
  'needs_human_review',
  'needs_specialist_escalation',
] as const;

export type ResolutionMode = (typeof RESOLUTION_MODES)[number];

export function parseResolutionMode(s: string): ResolutionMode {
  if ((RESOLUTION_MODES as readonly string[]).includes(s)) {
    return s as ResolutionMode;
  }
  throw new VocabularyError('ResolutionMode', s, RESOLUTION_MODES);
}
