import { Router } from 'express';
import type { Confidence, ProductDraft, Sourced } from '@room/shared';
import {
  ALL_SUBCATEGORY_IDS,
  defaultClearances,
  defaultFootprint,
  findSubcategory,
  taxonomyPromptList,
  MM_PER_INCH,
  newId,
} from '@room/shared';
import { AiError, getProvider, type Citation } from '../ai/index.js';
import { fetchPageMeta } from '../net.js';
import { storeImageFromUrl } from './assets.js';

export const ingestRouter = Router();

// --------------------------------------------------------------- schemas ---

/**
 * The shape the extraction call must return.
 *
 * Dimensions come back with the unit the source actually stated plus a
 * normalized millimetre value. Keeping both means a wrong answer is diagnosable
 * — "37 inches" misread as 37mm is obvious side by side, where a bare 940 is
 * not — and the review card can show the user what the source said.
 */
const PRODUCT_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    brand: { type: 'string' },
    modelNumber: { type: 'string' },
    subcategoryId: { type: 'string', enum: ALL_SUBCATEGORY_IDS },
    widthMm: { type: 'number' },
    depthMm: { type: 'number' },
    heightMm: { type: 'number' },
    seatHeightMm: { type: 'number' },
    statedDimensions: {
      type: 'string',
      description: 'The dimensions exactly as the source wrote them, e.g. "90 1/2 x 37 3/8 x 32 5/8 inches"',
    },
    price: { type: 'number' },
    currency: { type: 'string' },
    colorHex: { type: 'string', description: 'Approximate main colour as #rrggbb' },
    colorLabel: {
      type: 'string',
      description: 'Colour/finish name. Infer from the product name or URL when stated there, e.g. "Tibbleby beige-gray".',
    },
    imageUrl: {
      type: 'string',
      description: 'Direct URL to a product photo, only if one appeared in the research notes. Omit rather than guess.',
    },
    shape: { type: 'string', enum: ['rect', 'L'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    warnings: {
      type: 'array',
      items: { type: 'string' },
      description: 'Conflicts between sources, guesses, or missing data',
    },
  },
  required: ['name', 'subcategoryId', 'widthMm', 'depthMm', 'heightMm', 'confidence'],
} as const;

interface ExtractedProduct {
  name: string;
  brand?: string;
  modelNumber?: string;
  subcategoryId: string;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  seatHeightMm?: number;
  statedDimensions?: string;
  price?: number;
  currency?: string;
  colorHex?: string;
  colorLabel?: string;
  imageUrl?: string;
  shape?: 'rect' | 'L';
  confidence: Confidence;
  warnings?: string[];
}

// --------------------------------------------------------------- prompts ---

const RESEARCH_RULES = `
You are gathering furniture specifications for a room planning tool. Accuracy of
dimensions matters more than completeness.

Rules:
- Prefer the manufacturer's own specification page over a retailer or aggregator.
- Report dimensions exactly as the source states them, including the unit.
- Width is across the front, depth is front-to-back, height is floor to top.
- If sources disagree, say so explicitly and say which you trust and why.
- If you cannot find a real dimension, say so plainly. Do not estimate silently.
- Note the product's main colour and price if you find them.
- If a direct product image URL appears in your sources, quote it. Never invent one.
`.trim();

function researchPrompt(method: string, detail: string): string {
  switch (method) {
    case 'url':
      return `${RESEARCH_RULES}\n\nResearch the product at this URL: ${detail}\nIdentify exactly which product it is, then find its official dimensions. Cross-check against the manufacturer's spec page if the URL is a retailer listing.`;
    case 'model':
      return `${RESEARCH_RULES}\n\nFind the furniture product with this model number or name: ${detail}\nIdentify the manufacturer and the product's official dimensions.`;
    case 'photo':
      return `${RESEARCH_RULES}\n\nThe image shows a piece of furniture. Identify it as specifically as you can — brand and model if recognisable, otherwise the type and style. Then search for the real dimensions of that product. If you cannot identify a specific product, say so and give typical dimensions for that type of furniture, clearly labelled as typical rather than actual.${detail ? `\n\nThe user adds: ${detail}` : ''}`;
    default:
      return `${RESEARCH_RULES}\n\nFind this furniture product: ${detail}`;
  }
}

function extractPrompt(research: string): string {
  return `Convert these research notes into structured data.

Categories available (pick the single closest subcategory id):
${taxonomyPromptList()}

Rules:
- Convert every dimension to millimetres. 1 inch = 25.4mm, 1 cm = 10mm.
- statedDimensions must quote the source's own wording and unit, unconverted.
- confidence: "high" only if a manufacturer or major retailer gave exact
  dimensions; "medium" if a secondary source did or sources disagreed slightly;
  "low" if the numbers are typical-for-the-type rather than measured.
- Put any conflict, guess, or missing figure into warnings.

Research notes:
${research}`;
}

// ------------------------------------------------------------- utilities ---

/** Wrap a value with its confidence and source for the review card. */
function sourced<T>(value: T, confidence: Confidence, citedText?: string, sourceUrl?: string): Sourced<T> {
  return { value, confidence, citedText, sourceUrl };
}

/** Reject dimensions that are obviously not furniture-sized. */
function plausibleMm(value: number): boolean {
  return Number.isFinite(value) && value > 5 && value < 20_000;
}

function sanityWarnings(p: ExtractedProduct): string[] {
  const out: string[] = [];
  for (const [label, value] of [
    ['width', p.widthMm],
    ['depth', p.depthMm],
    ['height', p.heightMm],
  ] as const) {
    if (!plausibleMm(value)) {
      out.push(`The ${label} (${value}mm) is outside a believable range — check it before saving.`);
    }
  }
  // A classic unit-conversion failure: inches left unconverted look like a
  // doll's-house sofa.
  if (plausibleMm(p.widthMm) && p.widthMm < 200 && /sofa|bed|table|dresser/.test(p.subcategoryId)) {
    out.push('These numbers look like inches that were never converted to millimetres.');
  }
  return out;
}

// ---------------------------------------------------------------- routes ---

/** POST /api/ingest/product */
ingestRouter.post('/product', async (req, res) => {
  const provider = getProvider();
  if (!provider) {
    return res.status(503).json({
      error: 'No AI key configured. Add GEMINI_API_KEY to .env and restart the server.',
    });
  }

  const body = req.body as {
    method?: string;
    url?: string;
    modelNumber?: string;
    query?: string;
    imageBase64?: string;
    mimeType?: string;
    hint?: string;
  };

  const method = body.method ?? 'query';
  const detail = body.url ?? body.modelNumber ?? body.query ?? body.hint ?? '';

  if (method !== 'photo' && detail.trim() === '') {
    return res.status(400).json({ error: 'Nothing to look up.' });
  }
  if (method === 'photo' && !body.imageBase64) {
    return res.status(400).json({ error: 'No image supplied.' });
  }

  try {
    // Deterministic first: the product photo and page title come from Open
    // Graph tags, not from the model. Asking a model for an image URL produces
    // plausible links that 404.
    let pageImageUrl: string | undefined;
    let pageTitle: string | undefined;
    if (method === 'url' && body.url) {
      try {
        const meta = await fetchPageMeta(body.url);
        pageImageUrl = meta.imageUrl;
        // Client-rendered storefronts serve a shell with a generic title
        // ("Products") and an empty og:image. Passing that to the model as a
        // hint is worse than passing nothing.
        pageTitle = meta.title && meta.title.length > 3 && !/^products?$/i.test(meta.title)
          ? meta.title
          : undefined;
      } catch {
        // A page that won't load is not fatal — the search can still find it.
      }
    }

    const image =
      method === 'photo' && body.imageBase64
        ? { base64: body.imageBase64.replace(/^data:[^,]+,/, ''), mimeType: body.mimeType ?? 'image/jpeg' }
        : undefined;

    // Call 1: web-grounded research, free-form.
    const research = await provider.research({
      prompt: researchPrompt(method, pageTitle ? `${detail}\n(page title: ${pageTitle})` : detail),
      image,
    });

    // Call 2: squeeze the notes into the schema. No tools — Gemini rejects
    // tool use combined with a JSON response type.
    const extracted = await provider.extract<ExtractedProduct>({
      prompt: extractPrompt(research.text),
      schema: PRODUCT_SCHEMA as unknown as Record<string, unknown>,
    });

    const confidence = extracted.confidence ?? 'low';
    const primary = research.citations[0];
    const warnings = [...(extracted.warnings ?? []), ...sanityWarnings(extracted)];
    if (research.citations.length === 0) {
      warnings.push('No sources were cited — treat these dimensions as unverified.');
    }

    const found = findSubcategory(extracted.subcategoryId);
    const subcategoryId = found?.subcategory.id ?? 'uncategorized';
    const categoryId = found?.category.id ?? 'other';

    // Cache the photo locally so the canvas never reaches out to a retailer.
    //
    // Open Graph first, since it's whatever the retailer actually published.
    // Many storefronts are client-rendered and expose nothing useful, so the
    // model's suggestion is the fallback -- made safe by the fact that storing
    // it requires successfully fetching and decoding it. A hallucinated URL
    // fails closed and the user simply gets no photo, which the review card
    // tells them, rather than a broken image.
    //
    let imageAssetId: string | undefined;
    for (const candidate of [pageImageUrl, extracted.imageUrl]) {
      if (!candidate || imageAssetId) continue;
      imageAssetId = (await storeImageFromUrl(candidate).catch(() => null))?.assetId;
    }
    if (!imageAssetId) {
      warnings.push('No product photo found — you can add one in the form below.');
    }


    const draft: ProductDraft = {
      name: sourced(extracted.name, confidence, undefined, primary?.url),
      brand: extracted.brand ? sourced(extracted.brand, confidence) : undefined,
      modelNumber: extracted.modelNumber ? sourced(extracted.modelNumber, confidence) : undefined,
      categoryId: sourced(categoryId, found ? 'high' : 'low'),
      subcategoryId: sourced(subcategoryId, found ? 'high' : 'low'),
      w: sourced(Math.round(extracted.widthMm), confidence, extracted.statedDimensions, primary?.url),
      d: sourced(Math.round(extracted.depthMm), confidence, extracted.statedDimensions, primary?.url),
      h: sourced(Math.round(extracted.heightMm), confidence, extracted.statedDimensions, primary?.url),
      seatHeight: extracted.seatHeightMm
        ? sourced(Math.round(extracted.seatHeightMm), confidence)
        : undefined,
      price: extracted.price ? sourced(extracted.price, confidence, undefined, primary?.url) : undefined,
      currency: extracted.currency,
      footprint:
        extracted.shape === 'L'
          ? { kind: 'L', notchW: 0.45, notchD: 0.45, corner: 'ne' }
          : defaultFootprint(subcategoryId),
      variants: extracted.colorHex
        ? [
            {
              id: newId('var'),
              label: extracted.colorLabel ?? 'As listed',
              hex: /^#[0-9a-f]{6}$/i.test(extracted.colorHex) ? extracted.colorHex : '#5a6270',
            },
          ]
        : [],
      clearances: defaultClearances(subcategoryId),
      imageAssetId,
      sourceUrl: method === 'url' ? body.url : primary?.url,
      provenance: {
        method: method as ProductDraft['provenance']['method'],
        citations: research.citations.map((c: Citation) => c.url),
        capturedAt: new Date().toISOString(),
        note: research.queries.length ? `Searched: ${research.queries.join('; ')}` : undefined,
      },
      warnings,
    };

    return res.json({
      draft,
      // Returned so the review card can show what the model actually read,
      // rather than asking the user to trust a number with no context.
      research: { text: research.text, citations: research.citations, model: research.model },
    });
  } catch (err) {
    if (err instanceof AiError) {
      return res.status(err.status).json({ error: err.message, kind: err.kind });
    }
    console.error('[ingest/product]', err);
    return res.status(500).json({ error: (err as Error).message });
  }
});

// ------------------------------------------------------------- floorplan ---

const FLOORPLAN_SCHEMA = {
  type: 'object',
  properties: {
    polygonPx: {
      type: 'array',
      description: 'Interior wall corners in image pixel coordinates, in order around the room',
      items: {
        type: 'object',
        properties: { x: { type: 'number' }, y: { type: 'number' } },
        required: ['x', 'y'],
      },
    },
    openings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['door', 'window', 'opening'] },
          atPx: {
            type: 'object',
            properties: { x: { type: 'number' }, y: { type: 'number' } },
            required: ['x', 'y'],
          },
          widthPx: { type: 'number' },
        },
        required: ['kind', 'atPx', 'widthPx'],
      },
    },
    readDimensions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Dimension labels printed on the drawing, exactly as written',
    },
    scaleMmPerPx: { type: 'number', description: 'Omit entirely if no printed dimension is legible' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['polygonPx', 'confidence'],
} as const;

function floorplanPrompt(width: number, height: number): string {
  return `
This image is a floor plan, exactly ${width} pixels wide and ${height} pixels tall.
Trace the walls of the single main room.

Return the interior corners of that room as pixel coordinates, in order around
the perimeter (either direction is fine, but be consistent). The image origin is
the top-left corner.

Also report:
- doors, windows, and open passages, with their midpoint and width in pixels
- every dimension label printed on the drawing, transcribed exactly as written
- scaleMmPerPx, but only if a printed dimension lets you compute it: divide the
  real length in millimetres by the pixel length of that same wall. Omit the
  field entirely if nothing is legible — do not guess.

Be conservative. A missed corner the user can add is better than an invented one
they have to hunt down. Put anything you were unsure about into warnings.
`.trim();
}

/** POST /api/ingest/floorplan */
ingestRouter.post('/floorplan', async (req, res) => {
  const provider = getProvider();
  if (!provider) {
    return res.status(503).json({
      error: 'No AI key configured. Add GEMINI_API_KEY to .env and restart the server.',
    });
  }

  const { imageBase64, mimeType, width, height } = (req.body ?? {}) as {
    imageBase64?: string;
    mimeType?: string;
    width?: number;
    height?: number;
  };
  if (!imageBase64) return res.status(400).json({ error: 'No image supplied.' });
  if (!width || !height) {
    return res.status(400).json({ error: 'Image dimensions are required to scale the trace.' });
  }

  try {
    // One call: vision plus a schema, with no tools involved, which Gemini
    // accepts. There is nothing to search for here — the answer is in the pixels.
    const image = { base64: imageBase64.replace(/^data:[^,]+,/, ''), mimeType: mimeType ?? 'image/png' };
    const prompt = floorplanPrompt(width, height);

    type Trace = {
      polygonPx: { x: number; y: number }[];
      openings?: { kind: string; atPx: { x: number; y: number }; widthPx: number }[];
      readDimensions?: string[];
      scaleMmPerPx?: number;
      confidence: Confidence;
      warnings?: string[];
    };

    const schema = FLOORPLAN_SCHEMA as unknown as Record<string, unknown>;
    const degraded: string[] = [];

    let result: Trace;
    try {
      result = await provider.extract<Trace>({ prompt, schema, image, model: provider.visionModel });
    } catch (err) {
      // The accurate vision model has a tighter free-tier quota. Falling back
      // beats failing outright, but the user has to be told the trace just got
      // much rougher rather than discovering it by eye.
      if (err instanceof AiError && (err.kind === 'quota' || err.kind === 'unavailable')) {
        result = await provider.extract<Trace>({ prompt, schema, image });
        degraded.push(
          `The accurate tracing model was unavailable, so a weaker one was used — expect corners to be noticeably off. Drag them onto the underlay to fix.`,
        );
      } else {
        throw err;
      }
    }

    const polygon = (result.polygonPx ?? []).filter(
      (p) => Number.isFinite(p?.x) && Number.isFinite(p?.y),
    );

    const warnings = [...degraded, ...(result.warnings ?? [])];
    if (polygon.length < 3) {
      warnings.push('Could not make out a closed room outline. Draw the walls by hand instead.');
    }
    if (!result.scaleMmPerPx) {
      warnings.push('No usable scale found — set it by clicking two points a known distance apart.');
    }
    /*
      Be specific about how wrong this can be.

      Measured over repeated traces of the same known plan, the shape is
      reliable and the coordinates are not: corner count and opening count were
      correct every run, while mean corner error ranged from 5px to 52px on an
      800px-wide image and the enclosed area came out 3% to 24% under. The scale
      landed within about 7%.

      So the honest framing is that the trace finds the room's shape, and the
      user supplies the precision by dragging corners onto the underlay. Saying
      "approximate" would let someone assume it means a few millimetres.
    */
    warnings.push(
      'The shape and the number of corners are dependable; the exact positions are not — expect the outline to be off by a few percent, and the area by more. Drag each corner onto the underlay image before trusting any dimension.',
    );

    return res.json({
      polygonPx: polygon,
      openings: result.openings ?? [],
      readDimensions: result.readDimensions ?? [],
      scaleMmPerPx: result.scaleMmPerPx ?? null,
      confidence: result.confidence ?? 'low',
      warnings,
    });
  } catch (err) {
    if (err instanceof AiError) {
      return res.status(err.status).json({ error: err.message, kind: err.kind });
    }
    console.error('[ingest/floorplan]', err);
    return res.status(500).json({ error: (err as Error).message });
  }
});

export { MM_PER_INCH };
