import { ChromaClient, Collection } from 'chromadb';
// Remove Transformers.js imports
// import { pipeline, Pipeline, env } from '@xenova/transformers';
// Removed unused GoogleGenerativeAI import
// import path from 'path';

// Configuration
const COLLECTION_NAME = "jobsdb_hk_listings_v1";
// Use an environment variable for the Chroma URL for flexibility
const CHROMA_URL = process.env.CHROMA_DB_URL || "http://localhost:8000";
// Embedding Model Name - Use the one you requested, but keep standard as fallback comment
// const EMBEDDING_MODEL_NAME = process.env.EMBEDDING_MODEL_NAME || "models/gemini-embedding-exp-03-07"; // Or "models/text-embedding-004"
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Remove Transformers.js env settings
// env.allowLocalModels = true;
// env.useBrowserCache = false;

// Singleton instances (cached within the module scope for the lifetime of the serverless function instance)
let chromaClientInstance: ChromaClient | null = null;
let collectionInstance: Collection | null = null;
// Remove extractor instance
// let extractorInstance: Pipeline | null = null;

// Check API Key at startup (important for embedding API)
if (!GEMINI_API_KEY) {
    console.error("FATAL STARTUP ERROR: Missing GEMINI_API_KEY environment variable. Required for embedding generation.");
}

// --- Gemini Embedding API Setup ---
// Fallback model if needed - ensure your key works with this
// const EMBEDDING_MODEL_NAME = "text-embedding-004"; // Example model name, ensure compatibility
const GEMINI_EMBEDDING_MODEL = "text-embedding-004";
const GEMINI_EMBEDDING_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:embedContent?key=${GEMINI_API_KEY}`;
const GEMINI_BATCH_EMBEDDING_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:batchEmbedContents?key=${GEMINI_API_KEY}`;

async function initializeVectorDbClient(): Promise<ChromaClient> {
    if (!chromaClientInstance) {
        console.log(`(vectorDb utils) Initializing ChromaDB client at: ${CHROMA_URL}`);
        try {
            // Add a timeout configuration if available/needed for the client
            chromaClientInstance = new ChromaClient({ path: CHROMA_URL });
            // Maybe add a quick health check ping here if the client supports it
             console.log("(vectorDb utils) ChromaDB client initialized.");
        } catch(err) {
            console.error(`(vectorDb utils) Failed to initialize ChromaDB client at ${CHROMA_URL}`, err);
            chromaClientInstance = null; // Ensure it's null if init fails
            throw new Error(`Failed to initialize vector database client.`);
        }
    }
    // Check connection? Chroma client doesn't have an easy ping. Assume ok if constructor doesn't throw.
    if (!chromaClientInstance) {
         throw new Error(`Failed to initialize vector database client.`);
    }
    return chromaClientInstance;
}

/**
 * Gets the ChromaDB collection, initializing the client if necessary.
 * Throws an error if initialization fails.
 * No longer returns an extractor pipeline.
 */
export async function getVectorDbCollection():
  Promise<{ collection: Collection; client: ChromaClient }> {
  try {
    const client = await initializeVectorDbClient();

    if (!collectionInstance) {
      console.log(
        `(vectorDb utils) Getting or creating Chroma collection: ${COLLECTION_NAME}`
      );
      collectionInstance = await client.getOrCreateCollection({
        name: COLLECTION_NAME,
        metadata: { "hnsw:space": "cosine" },
      });
      console.log(
        `(vectorDb utils) Accessed Chroma collection: ${COLLECTION_NAME}`
      );
    }

    return { collection: collectionInstance, client };
  } catch (error: unknown) {
    console.error("(vectorDb utils) Error in getVectorDbCollection:", error);

    // Narrow the type before using:
    if (error instanceof Error) {
      collectionInstance = null;
      throw new Error(
        `Failed to access vector database collection: ${error.message}`
      );
    }

    // Fallback for non-Error throwables:
    throw new Error("Failed to access vector database collection: Unknown error");
  }
}


// --- Helper Function to Generate Single Embedding ---
async function generateEmbedding(text: string): Promise<number[]> {
  if (!GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY env var");
  try {
    // console.log(`Requesting embedding for text length: ${text.length}`); // Debug
    const response = await fetch(GEMINI_EMBEDDING_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { parts: [{ text }] } })
    });
    if (!response.ok) {
        const errorBody = await response.text();
        console.error("Gemini Embedding API Error:", response.status, response.statusText, errorBody);
        throw new Error(`Gemini API error (${response.status}): ${response.statusText}. Body: ${errorBody.substring(0, 200)}`);
    }
    // Use interface for data
    interface GeminiEmbeddingResponse {
            embedding?: { values: number[] };
        }
        const data = await response.json() as GeminiEmbeddingResponse;
        return data.embedding?.values || [];
      } catch (error: unknown) { // CORRECT: Explicitly type error as unknown
        console.error("Error generating single embedding:", error);
         // CORRECT: Add type check before accessing properties
        const message = error instanceof Error ? error.message : 'Unknown embedding generation error';
        throw new Error(`Failed to generate embedding: ${message}`);
      }
    }

// --- Helper Function to Generate Batch Embeddings ---
async function generateEmbeddingsBatch(texts: string[], batchSize: number = 100): Promise<number[][]> {
    if (!GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY env var");
    if (!texts || texts.length === 0) return [];

    const allEmbeddings: number[][] = [];
    console.log(`Starting batch embedding for ${texts.length} texts with batch size ${batchSize}...`);

    for (let i = 0; i < texts.length; i += batchSize) {
        const batchTexts = texts.slice(i, i + batchSize);
        console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(texts.length / batchSize)} (texts ${i + 1} to ${i + batchTexts.length})`);

        const requests = batchTexts.map(text => ({ content: { parts: [{ text }] } }));

        try {
            const response = await fetch(GEMINI_BATCH_EMBEDDING_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ requests })
            });

            if (!response.ok) {
                const errorBody = await response.text();
                console.error("Gemini Batch Embedding API Error:", response.status, response.statusText, errorBody);
                throw new Error(`Gemini Batch API error (${response.status}): ${response.statusText}. Body: ${errorBody.substring(0, 200)}`);
            }

            // Define an interface for the expected structure within the 'embeddings' array
            interface EmbeddingItem {
                values?: number[];
            }
            const data = await response.json();
            // Use the interface in the map callback
            const batchEmbeddings = data.embeddings?.map((emb: EmbeddingItem) => emb?.values || []) || [];
            console.log(`  Received ${batchEmbeddings.length} embeddings for batch.`);
            allEmbeddings.push(...batchEmbeddings);

            // Optional: Add a small delay between batches if hitting rate limits
            // await new Promise(resolve => setTimeout(resolve, 200));

        } catch (error: unknown) { // Use 'unknown' for error type
            console.error(`Error processing batch starting at index ${i}:`, error);
             // Type check before accessing properties
            const message = error instanceof Error ? error.message : 'Unknown batch embedding generation error';
            // Decide whether to throw or continue with partial results
            // For simplicity here, we'll throw. You might want to log and continue.
            throw new Error(`Failed to generate batch embeddings: ${message}`);
        }
    }
    console.log(`Finished batch embedding. Total embeddings generated: ${allEmbeddings.length}`);
    return allEmbeddings;
}

export { getVectorDbCollection, generateEmbedding, generateEmbeddingsBatch }; // Export helpers 