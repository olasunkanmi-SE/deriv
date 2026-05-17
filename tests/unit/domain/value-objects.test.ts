import { describe, it, expect } from 'vitest';
import { VocabularyError } from '../../../src/domain/errors.js';
import {
  TICKET_CATEGORIES,
  parseTicketCategory,
} from '../../../src/domain/value-objects/TicketCategory.js';
import {
  URGENCY_LEVELS,
  parseUrgencyLevel,
} from '../../../src/domain/value-objects/UrgencyLevel.js';
import {
  SENTIMENTS,
  parseSentiment,
} from '../../../src/domain/value-objects/Sentiment.js';
import {
  RESOLUTION_MODES,
  parseResolutionMode,
} from '../../../src/domain/value-objects/ResolutionMode.js';
import {
  QUEUES,
  parseQueue,
} from '../../../src/domain/value-objects/Queue.js';
import {
  ACTION_PRIORITIES,
  parseActionPriority,
} from '../../../src/domain/value-objects/ActionPriority.js';

describe('TicketCategory', () => {
  it('accepts all valid values', () => {
    for (const v of TICKET_CATEGORIES) {
      expect(parseTicketCategory(v)).toBe(v);
    }
  });

  it('rejects an unknown value', () => {
    expect(() => parseTicketCategory('unknown_category')).toThrow(VocabularyError);
  });

  it('rejects an empty string', () => {
    expect(() => parseTicketCategory('')).toThrow(VocabularyError);
  });
});

describe('UrgencyLevel', () => {
  it('accepts all valid values', () => {
    for (const v of URGENCY_LEVELS) {
      expect(parseUrgencyLevel(v)).toBe(v);
    }
  });

  it('rejects an unknown value', () => {
    expect(() => parseUrgencyLevel('urgent')).toThrow(VocabularyError);
  });
});

describe('Sentiment', () => {
  it('accepts all valid values', () => {
    for (const v of SENTIMENTS) {
      expect(parseSentiment(v)).toBe(v);
    }
  });

  it('rejects an unknown value', () => {
    expect(() => parseSentiment('angry')).toThrow(VocabularyError);
  });
});

describe('ResolutionMode', () => {
  it('accepts all valid values', () => {
    for (const v of RESOLUTION_MODES) {
      expect(parseResolutionMode(v)).toBe(v);
    }
  });

  it('rejects an unknown value', () => {
    expect(() => parseResolutionMode('auto_resolve')).toThrow(VocabularyError);
  });
});

describe('Queue', () => {
  it('accepts all valid values', () => {
    for (const v of QUEUES) {
      expect(parseQueue(v)).toBe(v);
    }
  });

  it('rejects an unknown value', () => {
    expect(() => parseQueue('billing')).toThrow(VocabularyError);
  });
});

describe('ActionPriority', () => {
  it('accepts all valid values', () => {
    for (const v of ACTION_PRIORITIES) {
      expect(parseActionPriority(v)).toBe(v);
    }
  });

  it('rejects an unknown value', () => {
    expect(() => parseActionPriority('P4')).toThrow(VocabularyError);
  });

  it('rejects lowercase priority', () => {
    expect(() => parseActionPriority('p0')).toThrow(VocabularyError);
  });
});

describe('VocabularyError', () => {
  it('includes the vocab name, received value, and allowed values in the message', () => {
    const err = new VocabularyError('TestVocab', 'bad_value', ['a', 'b']);
    expect(err.message).toContain('TestVocab');
    expect(err.message).toContain('bad_value');
    expect(err.message).toContain('a');
    expect(err.name).toBe('VocabularyError');
  });
});
