import Anthropic from '@anthropic-ai/sdk';
import crypto from 'node:crypto';
import { ILLMCallLogger } from '../../domain/services/ILLMCallLogger.js';
import { ILLMService, LLMRequest } from '../../domain/services/ILLMService.js';
import { IClock } from '../../domain/services/IClock.js';
import { LLMConfig } from '../config/EnvConfig.js';

const SYSTEM_PROMPT =
  'You are a support triage assistant. Respond ONLY with valid JSON that matches the requested schema. ' +
  'No markdown code blocks, no explanation, no extra text. Output raw JSON only.';

export class AnthropicLLMService implements ILLMService {
  private readonly client: Anthropic;

  constructor(
    private readonly config: LLMConfig,
    private readonly logger: ILLMCallLogger,
    private readonly clock: IClock,
  ) {
    this.client = new Anthropic({ apiKey: config.anthropicApiKey });
  }

  async complete(request: LLMRequest): Promise<string> {
    const model = this.selectModel(request.stage);
    const promptHash = sha256(request.prompt);

    let result: string;
    try {
      result = await this.callAPI(model, request.prompt);
      JSON.parse(result); // validate; throws if invalid
    } catch {
      // Single retry with explicit correction appended
      const retryPrompt =
        `${request.prompt}\n\n` +
        'IMPORTANT: Your previous response was not valid JSON. ' +
        'Output ONLY a raw JSON object with no markdown, no code fences, no explanation.';
      result = await this.callAPI(model, retryPrompt);
    }

    await this.logger.log({
      stage: request.stage,
      timestamp: this.clock.now(),
      provider: 'anthropic',
      model,
      prompt_hash: promptHash,
      input_artifacts: request.inputArtifacts,
      output_artifact: request.outputArtifact,
      ticket_ids: request.ticketIds,
      chunk_ids_included: request.chunkIds,
    });

    return result;
  }

  private async callAPI(model: string, prompt: string): Promise<string> {
    const response = await this.client.messages.create({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });

    const block = response.content[0];
    if (!block || block.type !== 'text') {
      throw new Error(`[AnthropicLLMService] Unexpected response content type: ${block?.type}`);
    }

    return extractJSON(block.text);
  }

  private selectModel(stage: string): string {
    return stage === 'triage' ? this.config.triageModel : this.config.mainModel;
  }
}

function extractJSON(text: string): string {
  // Strip markdown code fences if the model wraps the output
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/s);
  if (fenced?.[1]) return fenced[1].trim();
  return text.trim();
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}
