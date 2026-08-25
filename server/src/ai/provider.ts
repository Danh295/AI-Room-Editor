/**
 * The AI surface the ingestion routes depend on.
 *
 * Two operations, deliberately separated:
 *
 *   research()  web-grounded, free-form prose, returns citations
 *   extract()   constrained to a JSON schema, no tools
 *
 * They are separate because Gemini rejects the combination outright --
 * `Tool use with a response mime type: 'application/json' is unsupported` --
 * and because it's the more robust shape regardless: search results are messy
 * and contradictory, and a model reconciling them writes better prose than it
 * writes into a rigid schema on the first pass.
 */

export interface ImageInput {
  base64: string;
  mimeType: string;
}

export interface ResearchInput {
  prompt: string;
  /** Optional image for identify-from-photo flows. */
  image?: ImageInput;
  /** Hint for the model; the provider decides whether it can honour it. */
  maxSearches?: number;
}

export interface Citation {
  /** Display label — usually the source domain. */
  title: string;
  /** Best available URL. Redirects are resolved where possible. */
  url: string;
}

export interface ResearchResult {
  text: string;
  citations: Citation[];
  /** What the model actually searched for; useful for debugging a bad lookup. */
  queries: string[];
  model: string;
}

export interface ExtractInput<T> {
  prompt: string;
  schema: Record<string, unknown>;
  image?: ImageInput;
  /** Override the default extraction model — spatial work needs a stronger one. */
  model?: string;
  /** Cheap sanity check before the value is handed on. */
  validate?: (value: unknown) => value is T;
}

export interface AiProvider {
  readonly name: 'gemini' | 'anthropic';
  readonly researchModel: string;
  readonly extractModel: string;
  /** Model used for geometry-from-image work, where coordinate accuracy matters. */
  readonly visionModel: string;
  research(input: ResearchInput): Promise<ResearchResult>;
  extract<T>(input: ExtractInput<T>): Promise<T>;
}

/**
 * Errors the routes can turn into an honest message instead of a 500.
 * Rate limiting matters here specifically: the free tier is easy to exhaust,
 * and "you've hit today's quota" is a very different instruction to the user
 * than "something went wrong".
 */
export class AiError extends Error {
  constructor(
    message: string,
    readonly kind: 'quota' | 'unavailable' | 'refused' | 'bad_response' | 'unknown',
    readonly status = 502,
  ) {
    super(message);
    this.name = 'AiError';
  }
}
