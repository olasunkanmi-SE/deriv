import { VocabularyError } from '../errors.js';

export const ACTION_PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const;

export type ActionPriority = (typeof ACTION_PRIORITIES)[number];

export function parseActionPriority(s: string): ActionPriority {
  if ((ACTION_PRIORITIES as readonly string[]).includes(s)) {
    return s as ActionPriority;
  }
  throw new VocabularyError('ActionPriority', s, ACTION_PRIORITIES);
}
