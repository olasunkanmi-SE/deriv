import crypto from 'node:crypto';
import { KnowledgeChunk } from '../../domain/entities/KnowledgeChunk.js';
import { IChunker } from '../../domain/services/IChunker.js';

const MAX_CHUNK_CHARS = 1200;
const HEADING_RE = /^#{1,3} .+/;

export class MarkdownChunker implements IChunker {
  chunk(content: string, documentId: string, sourceFile: string): KnowledgeChunk[] {
    if (!content.trim()) {
      return [];
    }

    const sections = splitIntoSections(content, documentId);
    const chunks: KnowledgeChunk[] = [];
    let counter = 1;

    for (const section of sections) {
      const subTexts = splitLargeSection(section.text);
      for (const text of subTexts) {
        const trimmed = text.trim();
        if (!trimmed) continue;
        chunks.push({
          document_id: documentId,
          source_file: sourceFile,
          chunk_id: `${documentId}-${String(counter).padStart(3, '0')}`,
          section_title: section.title,
          text: trimmed,
          character_count: trimmed.length,
          content_hash: sha256(trimmed),
        });
        counter++;
      }
    }

    return chunks;
  }
}

interface Section {
  title: string;
  text: string;
}

function splitIntoSections(content: string, documentId: string): Section[] {
  const lines = content.split('\n');
  const breakIndices: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (HEADING_RE.test(lines[i] ?? '')) {
      breakIndices.push(i);
    }
  }

  if (breakIndices.length === 0) {
    return [{ title: documentId, text: content }];
  }

  const sections: Section[] = [];

  // Preamble content before the first heading
  const firstBreak = breakIndices[0] ?? 0;
  if (firstBreak > 0) {
    const preamble = lines.slice(0, firstBreak).join('\n').trim();
    if (preamble) {
      sections.push({ title: '(preamble)', text: preamble });
    }
  }

  // One section per heading
  for (let i = 0; i < breakIndices.length; i++) {
    const start = breakIndices[i] ?? 0;
    const end = breakIndices[i + 1] ?? lines.length;
    const sectionLines = lines.slice(start, end);
    const headingLine = sectionLines[0] ?? '';
    const title = headingLine.replace(/^#+\s+/, '').trim();
    const text = sectionLines.join('\n').trim();
    if (text) {
      sections.push({ title, text });
    }
  }

  return sections;
}

function splitLargeSection(text: string): string[] {
  if (text.length <= MAX_CHUNK_CHARS) {
    return [text];
  }

  const paragraphs = text.split(/\n\n+/);
  const result: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    const separator = current ? '\n\n' : '';
    if (current.length + separator.length + para.length > MAX_CHUNK_CHARS && current.length > 0) {
      result.push(current.trim());
      current = para;
    } else {
      current = current + separator + para;
    }
  }

  if (current.trim()) {
    result.push(current.trim());
  }

  return result.length > 0 ? result : [text];
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}
