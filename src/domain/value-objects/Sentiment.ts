import { VocabularyError } from '../errors.js';

export const SENTIMENTS = ['negative', 'neutral', 'positive', 'mixed'] as const;

export type Sentiment = (typeof SENTIMENTS)[number];

export function parseSentiment(s: string): Sentiment {
  if ((SENTIMENTS as readonly string[]).includes(s)) {
    return s as Sentiment;
  }
  throw new VocabularyError('Sentiment', s, SENTIMENTS);
}
