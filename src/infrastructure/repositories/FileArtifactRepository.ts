import fs from 'node:fs/promises';
import path from 'node:path';
import { IArtifactRepository } from '../../domain/repositories/IArtifactRepository.js';

export class FileArtifactRepository implements IArtifactRepository {
  constructor(private readonly artifactsDir: string) {}

  async write<T>(fileName: string, data: T): Promise<void> {
    await fs.mkdir(this.artifactsDir, { recursive: true });
    const fullPath = path.join(this.artifactsDir, fileName);
    await fs.writeFile(fullPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async read<T>(fileName: string): Promise<T> {
    const fullPath = path.join(this.artifactsDir, fileName);
    const content = await fs.readFile(fullPath, 'utf-8');
    return JSON.parse(content) as T;
  }

  async exists(fileName: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.artifactsDir, fileName));
      return true;
    } catch {
      return false;
    }
  }

  async appendLine(fileName: string, line: string): Promise<void> {
    await fs.mkdir(this.artifactsDir, { recursive: true });
    const fullPath = path.join(this.artifactsDir, fileName);
    await fs.appendFile(fullPath, line + '\n', 'utf-8');
  }
}
