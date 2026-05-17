import { IClock } from '../../domain/services/IClock.js';

export class SystemClock implements IClock {
  now(): string {
    return new Date().toISOString();
  }
}
