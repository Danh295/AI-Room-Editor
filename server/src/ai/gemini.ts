import { GoogleGenAI } from '@google/genai';
import { resolveAll } from '../net.js';
import {
  AiError,
  type AiProvider,
  type Citation,
  type ExtractInput,
  type ImageInput,
  type ResearchInput,
  type ResearchResult,
} from './provider.js';

/**
 * Model choice, verified against a live free-tier key rather than the docs.
 *
 * gemini-2.5-flash is the workhorse: it answers, it supports googleSearch, and
 * its free-tier quota is generous enough to actually use. The 3.x models are
 * listed for this key but returned 429 immediately on the free tier, and
 * gemini-2.5-pro now 404s for new keys ("no longer available to new users").
 * Both are overridable so a paid key can trade up without a code change.
 */
const DEFAULT_RESEARCH_MODEL = process.env.GEMINI_RESEARCH_MODEL ?? 'gemini-2.5-flash';
const DEFAULT_EXTRACT_MODEL = process.env.GEMINI_EXTRACT_MODEL ?? 'gemini-2.5-flash';

/**
 * Tracing a floor plan is a different job to reading a spec sheet, and the
 * models are not interchangeable at it. Measured against a known 800x600 plan,
 * mean error per corner was:
 *
 *   gemini-2.5-flash   ~85px   unusable — the traced shape had the wrong aspect ratio
 *   gemini-3.6-flash    ~30px  poor
 *   gemini-3.5-flash     ~9px  about 1%, good enough to correct by dragging
 *
 * So geometry goes to 3.5-flash even though its free-tier quota is tighter.
 * Floor plans are traced once per project; product lookups happen far more
 * often and stay on the cheaper model.
 */
const DEFAULT_VISION_MODEL = process.env.GEMINI_VISION_MODEL ?? 'gemini-3.5-flash';

interface GroundingChunk {
  web?: { uri?: string; title?: string };
}

/** Map an SDK error onto something the UI can say out loud. */
function toAiError(err: unknown): AiError {
  const message = err instanceof Error ? err.message : String(err);

  if (/\b429\b|quota|rate.?limit/i.test(message)) {
    return new AiError(
      'Gemini free-tier quota reached. It resets on a rolling window — wait a minute and retry, or add billing to the key.',
      'quota',
      429,
    );
  }
  if (/\b503\b|high demand|overloaded|unavailable/i.test(message)) {
    return new AiError('Gemini is busy right now. Retrying in a moment usually works.', 'unavailable', 503);
  }
  if (/\b404\b|not found|no longer available/i.test(message)) {
    return new AiError(
      `That Gemini model isn't available to this key. Set GEMINI_RESEARCH_MODEL to one that is.`,
      'unavailable',
      502,
    );
  }
  if (/safety|blocked|PROHIBITED/i.test(message)) {
    return new AiError('Gemini declined that request.', 'refused', 502);
  }
  return new AiError(message.slice(0, 300), 'unknown', 502);
}

function imagePart(image: ImageInput) {
  return { inlineData: { mimeType: image.mimeType, data: image.base64 } };
}

export class GeminiProvider implements AiProvider {
  readonly name = 'gemini' as const;
  readonly researchModel = DEFAULT_RESEARCH_MODEL;
  readonly extractModel = DEFAULT_EXTRACT_MODEL;
  readonly visionModel = DEFAULT_VISION_MODEL;

  private client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async research(input: ResearchInput): Promise<ResearchResult> {
    const parts: Record<string, unknown>[] = [];
    if (input.image) parts.push(imagePart(input.image));
    parts.push({ text: input.prompt });

    let response;
    try {
      response = await this.client.models.generateContent({
        model: this.researchModel,
        contents: [{ role: 'user', parts }],
        config: { tools: [{ googleSearch: {} }] },
      });
    } catch (err) {
      throw toAiError(err);
    }

    const text = (response.text ?? '').trim();
    if (text === '') {
      throw new AiError('Gemini returned an empty response.', 'bad_response');
    }

    const grounding = response.candidates?.[0]?.groundingMetadata;
    const chunks = (grounding?.groundingChunks ?? []) as GroundingChunk[];

    // Citations arrive as opaque vertexaisearch redirect tokens. The title is
    // the real domain, so it's usable immediately; the URL is resolved so what
    // gets stored on the item outlives the redirect token.
    const rawUrls = chunks.map((c) => c.web?.uri).filter((u): u is string => Boolean(u));
    const resolved = await resolveAll(rawUrls);

    const citations: Citation[] = chunks
      .map((chunk, i): Citation | null => {
        const raw = chunk.web?.uri;
        if (!raw) return null;
        const index = [...new Set(rawUrls)].indexOf(raw);
        return {
          title: chunk.web?.title ?? new URL(resolved[index] ?? raw).hostname,
          url: resolved[index] ?? raw,
        };
      })
      .filter((c): c is Citation => c !== null)
      // The same source often grounds several sentences.
      .filter((c, i, all) => all.findIndex((o) => o.url === c.url) === i);

    return {
      text,
      citations,
      queries: grounding?.webSearchQueries ?? [],
      model: this.researchModel,
    };
  }

  async extract<T>(input: ExtractInput<T>): Promise<T> {
    const parts: Record<string, unknown>[] = [];
    if (input.image) parts.push(imagePart(input.image));
    parts.push({ text: input.prompt });

    let response;
    try {
      response = await this.client.models.generateContent({
        model: input.model ?? this.extractModel,
        contents: [{ role: 'user', parts }],
        config: {
          // No tools here on purpose — see provider.ts. Gemini rejects the
          // combination of tool use and a JSON response mime type.
          responseMimeType: 'application/json',
          responseSchema: input.schema,
        },
      });
    } catch (err) {
      throw toAiError(err);
    }

    const raw = (response.text ?? '').trim();
    if (raw === '') throw new AiError('Gemini returned no JSON.', 'bad_response');

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new AiError(`Gemini returned malformed JSON: ${raw.slice(0, 200)}`, 'bad_response');
    }

    if (input.validate && !input.validate(parsed)) {
      throw new AiError('Extracted data did not match the expected shape.', 'bad_response');
    }

    return parsed as T;
  }
}
