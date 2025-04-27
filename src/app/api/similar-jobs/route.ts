import { NextRequest, NextResponse } from 'next/server';
import { getVectorDbCollection, generateEmbedding } from '@/utils/vectorDb'; // Import generateEmbedding too

const SIMILAR_RESULTS_LIMIT = 5; // How many similar jobs to return

export async function POST(request: NextRequest) {
    try {
        // Use a defined type for the request body
        interface SimilarJobsRequestBody {
            sourceJobUrl?: string;
        }
        // Assert the type after parsing
        const requestBody = await request.json() as SimilarJobsRequestBody;
        const sourceJobUrl = requestBody?.sourceJobUrl;

        if (typeof sourceJobUrl !== 'string' || !sourceJobUrl.trim()) {
            return NextResponse.json({ error: 'Invalid input: Missing sourceJobUrl.' }, { status: 400 });
        }

        console.log(`Finding similar jobs for: ${sourceJobUrl}`);

        // Get DB collection
        const { collection } = await getVectorDbCollection();

        // --- Strategy 1: Use the sourceJobUrl (ID) to retrieve its embedding ---
        let sourceEmbedding: number[] | null | undefined = null;
        try {
            console.time("chromaGetSourceEmbedding");
            const sourceJobData = await collection.get({
                ids: [sourceJobUrl],
                include: ["embeddings"]
            });
            console.timeEnd("chromaGetSourceEmbedding");
            sourceEmbedding = sourceJobData?.embeddings?.[0];
        } catch (error: unknown) { // <--- CHANGE THIS LINE
            console.error("API Route Similar Jobs Error:", error);
            const message = error instanceof Error ? error.message : 'An internal server error occurred.';
            return NextResponse.json({ error: message }, { status: 500 });
        }

        if (!sourceEmbedding) {
             // --- Fallback Strategy: Retrieve document and re-embed ---
             console.warn(`Embedding not found directly for ${sourceJobUrl}. Trying to retrieve document and re-embed.`);
             const sourceDocData = await collection.get({ ids: [sourceJobUrl], include: ["documents"] });
             const sourceDocument = sourceDocData?.documents?.[0];
             if (!sourceDocument) {
                console.error(`Could not find document for source job: ${sourceJobUrl}`);
                return NextResponse.json({ error: `Could not find document data for the selected job URL.` }, { status: 404 });
             }
             // Use the imported generateEmbedding function
             console.log("Generating fallback embedding via API...");
             sourceEmbedding = await generateEmbedding(sourceDocument); // Use generateEmbedding
             console.log("Using fallback generated embedding.");
        }

        if (!sourceEmbedding) {
             // If fallback also failed
             throw new Error(`Could not retrieve or generate embedding for source job: ${sourceJobUrl}`);
        }

        // --- Query for similar jobs using the source embedding ---
        console.time("chromaSimilarQuery");
        const results = await collection.query({
            queryEmbeddings: [sourceEmbedding],
            nResults: SIMILAR_RESULTS_LIMIT + 1,
            include: ["metadatas", "documents"]
        });
        console.timeEnd("chromaSimilarQuery");

        // Process results: Format and exclude the source job
        const similarJobs = [];
        const ids = results?.ids?.[0] || [];
        const metadatas = results?.metadatas?.[0] || [];
        const documents = results?.documents?.[0] || []; // For snippets

        for (let i = 0; i < ids.length; i++) {
            const jobId = ids[i];
            // Exclude the source job itself from the results
            if (jobId === sourceJobUrl) {
                continue;
            }
            // Stop if we have enough similar jobs
            if (similarJobs.length >= SIMILAR_RESULTS_LIMIT) {
                break;
            }

            const meta = metadatas[i] || {};
            const doc = documents[i] || '';
            similarJobs.push({
                url: jobId, // The ID is the URL
                title: meta.title || 'N/A',
                company_name: meta.company || 'N/A',
                location: meta.location || 'N/A',
                // Use metadata snippet first, fallback to document start
                 snippet: meta.snippet || (doc ? doc.substring(0, 150) + '...' : 'No snippet available.'),
            });
        }

        console.log(`Found ${similarJobs.length} similar jobs.`);
        return NextResponse.json({ similarJobs });

    } catch (error: unknown) {
        console.error("API Route Similar Jobs Error:", error);
        const message = error instanceof Error ? error.message : 'An internal server error occurred.';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

// Define or import JobListing interface if not already present
// Remove unused interface definition if it's truly not used in this file
// interface JobListing {
//   title: string;
//   url: string;
//   snippet?: string;
//   description: string;
//   company_name?: string;
//   location?: string;
// } 