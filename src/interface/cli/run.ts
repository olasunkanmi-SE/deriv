import path from 'node:path';
import { PipelineOrchestrator } from '../../application/pipeline/PipelineOrchestrator.js';
import { loadLLMConfig, loadRetrievalConfig } from '../../infrastructure/config/EnvConfig.js';
import { JsonlLLMCallLogger } from '../../infrastructure/llm/JsonlLLMCallLogger.js';
import { AnthropicLLMService } from '../../infrastructure/llm/AnthropicLLMService.js';
import { FileArtifactRepository } from '../../infrastructure/repositories/FileArtifactRepository.js';
import { FileKnowledgeRepository } from '../../infrastructure/repositories/FileKnowledgeRepository.js';
import { FileTicketRepository } from '../../infrastructure/repositories/FileTicketRepository.js';
import { MarkdownChunker } from '../../infrastructure/retrieval/MarkdownChunker.js';
import { TfIdfBm25Retriever } from '../../infrastructure/retrieval/TfIdfBm25Retriever.js';
import { SystemClock } from '../../infrastructure/clock/SystemClock.js';

const ROOT = path.resolve(__dirname, '..', '..', '..');

async function main(): Promise<void> {
  let llmConfig;
  try {
    llmConfig = loadLLMConfig();
  } catch (err) {
    console.error(String(err));
    process.exit(1);
  }

  const retrievalConfig = loadRetrievalConfig();
  const clock = new SystemClock();
  const artifactsDir = path.join(ROOT, 'artifacts');
  const artifactRepo = new FileArtifactRepository(artifactsDir);
  const llmCallLogger = new JsonlLLMCallLogger(artifactRepo);

  const orchestrator = new PipelineOrchestrator({
    ticketRepo: new FileTicketRepository(path.join(ROOT, 'tickets.json')),
    knowledgeRepo: new FileKnowledgeRepository(path.join(ROOT, 'knowledge_base')),
    artifactRepo,
    llm: new AnthropicLLMService(llmConfig, llmCallLogger, clock),
    llmCallLogger,
    chunker: new MarkdownChunker(),
    retriever: new TfIdfBm25Retriever(),
    clock,
    retrievalConfig,
  });

  console.log('[Pipeline] Starting support triage pipeline...');
  await orchestrator.run();
  console.log(`[Pipeline] Complete. Final state: ${orchestrator.getState()}`);
  console.log(`[Pipeline] Artifacts written to: ${artifactsDir}`);
}

main().catch((err: unknown) => {
  console.error('[Pipeline] Fatal error:', err);
  process.exit(1);
});
