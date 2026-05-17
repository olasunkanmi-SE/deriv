import { describe, it, expect } from 'vitest';
import { PipelineStateError } from '../../../src/domain/errors.js';
import {
  PipelineState,
  TRANSITIONS,
  assertState,
  nextState,
} from '../../../src/domain/pipeline/PipelineState.js';

const ALL_STATES = Object.values(PipelineState);

describe('PipelineState transition map', () => {
  it('covers every state exactly once', () => {
    const keys = Object.keys(TRANSITIONS) as PipelineState[];
    expect(keys.sort()).toEqual(ALL_STATES.sort());
  });

  it('transitions end in RESULTS_FINALISED and then null', () => {
    expect(TRANSITIONS[PipelineState.RESULTS_FINALISED]).toBeNull();
  });

  it('forms a single linear chain from INIT to RESULTS_FINALISED', () => {
    const visited = new Set<PipelineState>();
    let state: PipelineState | null = PipelineState.INIT;

    while (state !== null) {
      expect(visited.has(state)).toBe(false);
      visited.add(state);
      state = TRANSITIONS[state];
    }

    expect(visited.size).toBe(ALL_STATES.length);
  });
});

describe('assertState', () => {
  it('does not throw when state matches', () => {
    expect(() =>
      assertState(PipelineState.INIT, PipelineState.INIT),
    ).not.toThrow();
  });

  it('throws PipelineStateError when state does not match', () => {
    expect(() =>
      assertState(PipelineState.INIT, PipelineState.TRIAGE_COMPLETE),
    ).toThrow(PipelineStateError);
  });

  it('error message contains both states', () => {
    try {
      assertState(PipelineState.INIT, PipelineState.TRIAGE_COMPLETE);
    } catch (err) {
      expect(err).toBeInstanceOf(PipelineStateError);
      expect((err as Error).message).toContain(PipelineState.INIT);
      expect((err as Error).message).toContain(PipelineState.TRIAGE_COMPLETE);
    }
  });
});

describe('nextState', () => {
  it('returns the correct successor for INIT', () => {
    expect(nextState(PipelineState.INIT)).toBe(PipelineState.INPUTS_LOADED);
  });

  it('throws when called on RESULTS_FINALISED (terminal state)', () => {
    expect(() => nextState(PipelineState.RESULTS_FINALISED)).toThrow(
      PipelineStateError,
    );
  });
});
