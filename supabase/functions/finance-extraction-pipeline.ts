/**
 * Finance extraction processing pipeline scaffolding.
 * Modular multi-stage async pipeline for OCR + LLM extraction.
 *
 * Workflow:
 * 1. Ingest raw document or email.
 * 2. Extract text with OCR.
 * 3. Extract structured data via LLM.
 * 4. Validate and correct.
 * 5. Store structured data.
 *
 * Queue/stage abstraction is stubbed for demonstration.
 */

export interface IngestionJob {
  id: string;
  rawDocument: string | Buffer;
  metadata?: Record<string, any>;
}

export interface OcrResult {
  text: string;
  rawOcrJson?: any;
}

export interface LlmExtractionInput {
  ocrText: string;
  metadata?: Record<string, any>;
}

export interface LlmExtractionOutput {
  structuredData: any;
  confidence?: number;
  errors?: string[];
}

// Enhanced queue with concurrency control
export class AsyncQueue<T> {
  private queue: T[] = [];
  private listeners: ((item: T) => void)[] = [];

  enqueue(item: T) {
    if (this.listeners.length > 0) {
      const listener = this.listeners.shift();
      listener && listener(item);
      return;
    }
    this.queue.push(item);
  }

  async dequeue(): Promise<T | undefined> {
    if (this.queue.length > 0) {
      return this.queue.shift();
    }
    return new Promise<T>((resolve) => {
      this.listeners.push(resolve);
    });
  }

  async isEmpty(): Promise<boolean> {
    return this.queue.length === 0;
  }
}

// Pipeline stub illustrating async steps
export async function processIngestionJob(job: IngestionJob) {
  console.log(`Starting ingestion job ${job.id}`);
  // 1. Document preprocessing - stub
  const preprocessedDoc = job.rawDocument;

  // 2. OCR extraction - stub example call
  const ocrResult: OcrResult = await runOcr(preprocessedDoc);

  // 3. LLM extraction
  const llmOutput: LlmExtractionOutput = await runLlmExtraction({ ocrText: ocrResult.text, metadata: job.metadata });

  // 4. Validation & correction - stub
  const validatedData = validateExtraction(llmOutput);

  // 5. Persist data - stub
  await storeStructuredData(validatedData);

  console.log(`Completed ingestion job ${job.id}`);
}

import {ImageAnnotatorClient} from '@google-cloud/vision';
import {fetch} from 'undici';
import * as z from 'zod';
import { createClient } from '@supabase/supabase-js';

const visionClient = new ImageAnnotatorClient();
const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// OCR function using Google Cloud Vision
async function runOcr(document: string | Buffer): Promise<OcrResult> {
  let request;
if (typeof document === 'string') {
  request = document;
} else {
  request = {image: {content: document}};
}
  const [result] = await visionClient.textDetection(request);
  const detections = result.textAnnotations;
  const text = detections?.[0]?.description ?? '';
  return {text, rawOcrJson: result};
}

// Zod schema for LLM extracted structured data
const extractionSchema = z.object({
  invoiceNumber: z.string().optional(),
  date: z.string().optional(),
  totalAmount: z.number().optional(),
  supplierName: z.string().optional(),
  lineItems: z.array(z.object({
    description: z.string(),
    quantity: z.number(),
    unitPrice: z.number(),
    total: z.number(),
  })).optional(),
});

// LLM extraction function using Google Gemini API
async function runLlmExtraction(input: LlmExtractionInput): Promise<LlmExtractionOutput> {
  // Build structured prompt
  const prompt = `Extract structured invoice data with fields: invoiceNumber, date, totalAmount, supplierName, lineItems (description, quantity, unitPrice, total) from the text: "${input.ocrText.replace(/"/g, '\\"').slice(0, 1000)}"`;

  const apiKey = process.env.FINANCE_GEMINI_API_KEY || '';
  const model = 'gemini-3.8-flash';

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini extraction failed with status ${response.status}: ${errText}`);
  }

  interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

const data = (await response.json()) as GeminiResponse;
  const rawText = data?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text ?? '').join('')
    ?? data?.candidates?.[0]?.content?.parts?.[0]?.text
    ?? '';

  // Parse and validate extraction
  const parsed = JSON.parse(rawText);
  const validated = extractionSchema.safeParse(parsed);

  if (!validated.success) {
    return { structuredData: parsed, confidence: 0, errors: ['Validation failed: ' + JSON.stringify(validated.error)] };
  }

  return { structuredData: validated.data, confidence: 1, errors: [] };
}

// Validation function wraps schema validation result for extensibility
function validateExtraction(output: LlmExtractionOutput) {
  if (output.errors && output.errors.length > 0) {
    console.error('Extraction validation errors:', output.errors);
  }
  // Additional business logic validation could be added here
  return output.structuredData;
}

// Store extraction result in Supabase
async function storeStructuredData(data: any) {
  const { error } = await supabase.from('invoices').insert([data]);
  if (error) {
    console.error('Failed to store extraction:', error);
    throw error;
  }
  console.log('Extraction stored with ID:', data.id ?? '(no ID)');
}
