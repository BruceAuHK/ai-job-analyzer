import { ChromaClient, Collection } from 'chromadb';
// Remove Transformers.js imports
// import { pipeline, Pipeline, env } from '@xenova/transformers';
import { GoogleGenerativeAI } from '@google/generative-ai'; // Use the official SDK for simplicity maybe? Or stick to fetch. Let's use fetch for consistency with other API calls.

// Configuration
const COLLECTION_NAME = "jobsdb_hk_listings_v1";
// Use an environment variable for the Chroma URL for flexibility
const CHROMA_URL = process.env.CHROMA_DB_URL || "http://localhost:8000";
// Embedding Model Name - Use the one you requested, but keep standard as fallback comment
const EMBEDDING_MODEL_NAME = process.env.EMBEDDING_MODEL_NAME || "models/gemini-embedding-exp-03-07"; // Or "models/text-embedding-004"
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
export async function getVectorDbCollection(): Promise<{ collection: Collection, client: ChromaClient }> {
    try {
        const client = await initializeVectorDbClient();

        if (!collectionInstance) {
            console.log(`(vectorDb utils) Getting or creating Chroma collection: ${COLLECTION_NAME}`);
            collectionInstance = await client.getOrCreateCollection({
                name: COLLECTION_NAME,
                // IMPORTANT: Specify embedding function details if needed, though chromadb client might not use it directly here
                // Or configure the distance metric if known for the model (often COSINE for Google models)
                 metadata: { "hnsw:space": "cosine" }
            });
            console.log(`(vectorDb utils) Accessed Chroma collection: ${COLLECTION_NAME}`);
        }
        return { collection: collectionInstance, client };
    } catch (error: any) {
         console.error("(vectorDb utils) Error in getVectorDbCollection:", error);
         collectionInstance = null; // Reset potentially failed instance
         throw new Error(`Failed to access vector database collection: ${error.message}`);
    }
}

/**
 * Generates an embedding for the given text using the Google Generative Language API.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
    if (!GEMINI_API_KEY) {
        throw new Error("Cannot generate embedding: Missing GEMINI_API_KEY.");
    }
    if (!text || typeof text !== 'string' || !text.trim()) {
         console.warn("(vectorDb utils) Attempted to embed empty or invalid text.");
         // Return a zero vector or handle appropriately? Throwing error is safer.
         throw new Error("Cannot generate embedding for empty text.");
    }

    // Construct the correct API endpoint URL
    // Note: The model name might need adjustment (e.g., removing 'models/' if the API adds it)
    // We'll assume the full name is needed. Using v1beta as per other calls.
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/${EMBEDDING_MODEL_NAME}:embedContent?key=${GEMINI_API_KEY}`;

    // Shorter console log for potentially long text
    const logText = text.length > 100 ? text.substring(0, 100) + "..." : text;
    console.log(`(vectorDb utils) Generating embedding via API for text: "${logText}" using ${EMBEDDING_MODEL_NAME}`);
    console.time("(vectorDb utils) generateEmbeddingApiCall");

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                // Structure might vary slightly depending on exact model/API (embedContent vs embedText)
                // Assuming embedContent structure similar to generateContent
                 content: { parts: [{ text: text }] },
                 // Some embedding models might have task_type parameter
                 // task_type: "RETRIEVAL_DOCUMENT" // or "RETRIEVAL_QUERY", "SEMANTIC_SIMILARITY" etc. - Check model docs
            }),
        });

        console.timeEnd("(vectorDb utils) generateEmbeddingApiCall");
        const responseData = await response.json();

        if (!response.ok) {
            console.error(`(vectorDb utils) Embedding API Error (${response.status}):`, responseData);
            throw new Error(`Embedding API request failed with status ${response.status}: ${responseData.error?.message || 'Unknown error'}`);
        }

        const embedding = responseData?.embedding?.values;
        if (!embedding || !Array.isArray(embedding)) {
            console.error("(vectorDb utils) Invalid embedding structure in API response:", responseData);
            throw new Error("Invalid embedding structure received from API.");
        }

        return embedding;

    } catch (error: any) {
         console.error("(vectorDb utils) Error calling Embedding API:", error);
         // Rethrow with a more specific message if possible
         throw new Error(`Failed to generate text embedding via API: ${error.message}`);
    }
}

/**
 * Generates embeddings for multiple texts using a single batch API call.
 * NOTE: Adjust the API endpoint and request body structure based on
 * the specific Google API documentation for batch embedding.
 */
export async function generateEmbeddingsBatch(texts: string[]): Promise<(number[] | null)[]> {
    if (!GEMINI_API_KEY) {
        throw new Error("Cannot generate embeddings: Missing GEMINI_API_KEY.");
    }
    if (!texts || !Array.isArray(texts) || texts.length === 0) {
        return [];
    }

    // Filter out empty texts to avoid API errors
    const validTexts = texts.map((text, index) => ({ text, originalIndex: index }))
                            .filter(item => item.text && typeof item.text === 'string' && item.text.trim());

    if (validTexts.length === 0) {
        return texts.map(() => null); // Return nulls for all original indices if no valid text
    }

    // *** IMPORTANT: Check Google API Docs for the correct batch endpoint and body ***
    // This is a placeholder structure. The actual API might be different
    // (e.g., using batchEmbedContents, different body structure).
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/${EMBEDDING_MODEL_NAME}:batchEmbedContents?key=${GEMINI_API_KEY}`; // Hypothetical batch endpoint

    const requests = validTexts.map(item => ({
        content: { parts: [{ text: item.text }] },
        // task_type might be needed here too
    }));

    console.log(`(vectorDb utils) Generating ${validTexts.length} embeddings via Batch API using ${EMBEDDING_MODEL_NAME}`);
    console.time("(vectorDb utils) generateEmbeddingsBatchApiCall");

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // *** Body structure depends heavily on the actual batch API ***
            body: JSON.stringify({ requests }), // Assuming requests is an array
        });

        console.timeEnd("(vectorDb utils) generateEmbeddingsBatchApiCall");
        const responseData = await response.json();

        if (!response.ok) {
            console.error(`(vectorDb utils) Batch Embedding API Error (${response.status}):`, responseData);
            throw new Error(`Batch Embedding API request failed with status ${response.status}: ${responseData.error?.message || 'Unknown error'}`);
        }

        // *** Response structure depends on the API. Match results to original indices. ***
        // Assuming responseData.embeddings is an array corresponding to the requests array
        const resultsMap = new Map<number, number[]>();
        if (responseData.embeddings && Array.isArray(responseData.embeddings)) {
             responseData.embeddings.forEach((embeddingData: any, i: number) => {
                 const embedding = embeddingData?.values; // Adjust based on actual response
                 if (embedding && Array.isArray(embedding)) {
                     const originalIndex = validTexts[i].originalIndex;
                     resultsMap.set(originalIndex, embedding);
                 } else {
                      console.warn(`(vectorDb utils) Invalid embedding structure for item ${i} in batch response.`);
                 }
             });
        } else {
             console.error("(vectorDb utils) Invalid batch embedding response structure:", responseData);
             throw new Error("Invalid batch embedding response structure received from API.");
        }


         // Create the final result array, preserving original order and inserting nulls for failures/empties
         return texts.map((_, index) => resultsMap.get(index) || null);

    } catch (error: any) {
        console.error("(vectorDb utils) Error calling Batch Embedding API:", error);
        throw new Error(`Failed to generate text embeddings via Batch API: ${error.message}`);
    }
} 