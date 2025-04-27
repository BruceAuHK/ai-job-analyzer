import { NextRequest, NextResponse } from 'next/server';
import { getVectorDbCollection, generateEmbedding } from '@/utils/vectorDb';

const FILTER_RESULTS_LIMIT = 50; // How many matching job IDs to return

export async function POST(request: NextRequest) {
    try {
        const { filterQuery } = await request.json();

        if (typeof filterQuery !== 'string' || !filterQuery.trim()) {
            return NextResponse.json({ error: 'Invalid filter query provided.' }, { status: 400 });
        }

        console.log(`Received filter query: "${filterQuery}"`);

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
            include: ["metadatas"] // Only need IDs (which are URLs) and maybe metadatas for context
        });
        console.timeEnd("chromaFilterQuery");

        // Extract the IDs (URLs) from the results
        const matchingJobIds = results?.ids?.[0] || [];
        console.log(`Found ${matchingJobIds.length} potentially relevant job IDs.`);

        // Return the list of matching job IDs (URLs)
        return NextResponse.json({ matchingJobIds });

    } catch (error: unknown) {
        console.error("Error during job filtering:", error);
        const message = error instanceof Error ? error.message : 'Failed to process job filtering request.';
        return NextResponse.json({ error: message }, { status: 500 });
    }
} 