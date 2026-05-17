import fs from 'node:fs/promises';
import path from 'node:path';
import { KnowledgeFile, IKnowledgeRepository } from '../../domain/repositories/IKnowledgeRepository.js';

export class FileKnowledgeRepository implements IKnowledgeRepository {
  constructor(private readonly knowledgeDir: string) {}

  async loadFiles(): Promise<KnowledgeFile[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.knowledgeDir);
    } catch (err) {
      console.warn(`[FileKnowledgeRepository] Cannot read directory "${this.knowledgeDir}": ${String(err)}`);
      return [];
    }

    const mdFiles = entries.filter((e) => e.endsWith('.md')).sort();
    const results: KnowledgeFile[] = [];

    for (const fileName of mdFiles) {
      const fullPath = path.join(this.knowledgeDir, fileName);
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        results.push({ fileName: path.join(this.knowledgeDir, fileName), content });
      } catch (err) {
        console.warn(`[FileKnowledgeRepository] Cannot read file "${fullPath}": ${String(err)}`);
      }
    }

    return results;
  }
}
