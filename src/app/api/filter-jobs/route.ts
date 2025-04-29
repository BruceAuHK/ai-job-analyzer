import { NextRequest, NextResponse } from 'next/server';
// import { getVectorDbCollection, generateEmbedding } from '@/utils/vectorDb'; // <-- Comment out
// import { IncludeEnum } from 'chromadb'; // <-- Comment out

// const FILTER_RESULTS_LIMIT = 50; // How many matching job IDs to return (remains for reference)

export async function POST(request: NextRequest) {
    try {
        const { filterQuery } = await request.json();

        if (typeof filterQuery !== 'string' || !filterQuery.trim()) {
            return NextResponse.json({ error: 'Invalid filter query provided.' }, { status: 400 });
        }

        console.log(`Received filter query: "${filterQuery}" - FILTERING DISABLED`);

        // --- Vector DB Logic (Commented Out) ---
        /*
        // Get DB collection
        const { collection } = await getVectorDbCollection();

        // Embed the user's filter query using the utility function
        console.time("generateFilterEmbedding");
        const queryEmbedding = await generateEmbedding(filterQuery.trim());
        console.timeEnd("generateFilterEmbedding");

        // Query ChromaDB for relevant job IDs (URLs)
        console.time("chromaFilterQuery");
        const results = await collection.query({
            queryEmbeddings: [queryEmbedding],
            nResults: FILTER_RESULTS_LIMIT,
            include: [IncludeEnum.Metadatas] // Changed from Data to Metadatas
        });
        console.timeEnd("chromaFilterQuery");

        // Extract the IDs (URLs) from the results
        const matchingJobIds = results?.ids?.[0] || [];
        console.log(`Found ${matchingJobIds.length} potentially relevant job IDs.`);
        */
        // --- End Vector DB Logic ---

        // Return empty results as filtering is disabled
        const matchingJobIds: string[] = [];
        console.log("Filtering is disabled, returning empty results.");

        // Return the list of matching job IDs (URLs)
        return NextResponse.json({ matchingJobIds });

    } catch (error: unknown) {
        console.error("Error during job filtering (DISABLED):", error);
        const message = error instanceof Error ? error.message : 'Failed to process job filtering request.';
        return NextResponse.json({ error: message }, { status: 500 });
    }
} 