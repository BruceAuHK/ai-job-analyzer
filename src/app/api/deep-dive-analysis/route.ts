import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
// Puppeteer can be commented out or removed if scrapeJobsDB_HK is no longer called directly
// import puppeteer, { Browser, Page } from 'puppeteer';

// Gemini API Details
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Use Flash for this focused task, should be sufficient and faster/cheaper
const GEMINI_MODEL_NAME = "gemini-2.0-flash";

if (!GEMINI_API_KEY) {
  console.error("Startup Warning: Missing GEMINI_API_KEY environment variable for deep-dive-analysis route.");
}

// --- Interfaces --- (Copied from job-analysis/route.ts)
interface ScrapedJob {
    title: string | null;
    company_name: string | null;
    location: string | null;
    url: string | null;
    description: string | null;
}
interface StatItem { name: string; count: number; }

// --- Define a basic interface for the expected Gemini JSON response --- (Added based on usage)
interface GeminiResponse {
    candidates?: {
        content?: { parts?: { text?: string }[] };
        finishReason?: string;
    }[];
    error?: { message?: string };
    promptFeedback?: { blockReason?: string };
}

// --- Helpers --- (Copied from job-analysis/route.ts)
const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

function sanitizeQueryToFilename(query: string): string | null {
    if (!query || typeof query !== 'string') return null;
    const sanitized = query
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\s\-_]/g, '') // Allow letters, numbers, space, hyphen, UNDERSCORE
        .replace(/\s+/g, '_');          // Replace spaces with underscores
    if (!sanitized) return null;        // Return null if query is empty after sanitize
    return `${sanitized}.json`;
}

// --- Web Scraping Function (Keep commented out or remove if definitely unused) ---
// export async function scrapeJobsDB_HK(query: string): Promise<ScrapedJob[]> { /* ... */ }

export async function POST(request: NextRequest) {
    const currentApiKey = process.env.GEMINI_API_KEY;
     if (!currentApiKey) {
        return NextResponse.json({ error: 'Server configuration error: Missing API Key.' }, { status: 500 });
    }
    const geminiApiUrlWithKey = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_NAME}:generateContent?key=${currentApiKey}`;

    let scrapedJobResults: ScrapedJob[] = [];
    let topCompanies: StatItem[] = [];
    let topLocations: StatItem[] = [];

    try {
        const { userRoleQuery, resumeText } = await request.json();

        if (typeof userRoleQuery !== 'string' || !userRoleQuery.trim()) {
             return NextResponse.json({ error: 'Invalid input: Missing userRoleQuery.' }, { status: 400 });
        }
        const hasResume = typeof resumeText === 'string' && resumeText.trim().length > 0;
        console.log(`Received analysis request for pre-saved query: "${userRoleQuery}" ${hasResume ? 'WITH resume' : 'without resume'}.`);

        // === Step 1: Load Data from Pre-scraped File ===
        const filename = sanitizeQueryToFilename(userRoleQuery);
        if (!filename) {
            console.error(`Could not generate valid filename for query: "${userRoleQuery}"`);
            return NextResponse.json({ error: 'Invalid query format.' }, { status: 400 });
        }

        const DATA_DIR = path.join(process.cwd(), 'src', 'app', 'api', 'job-analysis', 'pre-scraped-data');
        const filepath = path.join(DATA_DIR, filename);

        try {
            console.log(`Attempting to load data from: ${filepath}`);
            const fileContent = await fs.readFile(filepath, 'utf-8');
            scrapedJobResults = JSON.parse(fileContent) as ScrapedJob[];
            console.log(`Successfully loaded ${scrapedJobResults.length} job entries from ${filename}`);
        } catch (error: any) {
             if (error.code === 'ENOENT') {
                console.error(`Pre-scraped data file not found for query "${userRoleQuery}" at ${filepath}`);
                return NextResponse.json({ error: `Analysis data for "${userRoleQuery}" is not available.` }, { status: 404 });
             } else {
                console.error(`Error reading or parsing data file ${filepath}:`, error);
                return NextResponse.json({ error: 'Failed to load analysis data.' }, { status: 500 });
             }
        }
        // --- End Step 1: Load Data ---

        // Filter jobs based on the description field from the loaded data
        const jobsWithContent = scrapedJobResults.filter(j =>
            j.url &&
            j.description &&
            !j.description.includes('Failed') &&
            !j.description.includes('Could not') &&
            !j.description.includes('Failed getting description text')
        );
         console.log(`Using ${jobsWithContent.length} jobs with valid descriptions from loaded data.`);

        // === Step 2: Calculate Statistics (from loaded data) ===
        if (scrapedJobResults.length > 0) {
            const companyCounts: { [key: string]: number } = {};
            const locationCounts: { [key: string]: number } = {};
            scrapedJobResults.forEach(job => {
                if (job.company_name) { companyCounts[job.company_name] = (companyCounts[job.company_name] || 0) + 1; }
                if (job.location) { const cleanLocation = job.location.split(',')[0].trim(); if(cleanLocation) locationCounts[cleanLocation] = (locationCounts[cleanLocation] || 0) + 1; }
            });
            topCompanies = Object.entries(companyCounts).map(([name, count]): StatItem => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 10);
            topLocations = Object.entries(locationCounts).map(([name, count]): StatItem => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 10);
            console.log("Top Companies:", topCompanies.map(c=>`${c.name}(${c.count})`));
            console.log("Top Locations:", topLocations.map(l=>`${l.name}(${l.count})`));
        }

        // === Step 3: Prepare Job Context for LLM (using loaded data) ===
        let allScrapedJobContext = 'No job details available for analysis.';
        if (jobsWithContent.length > 0) {
             allScrapedJobContext = jobsWithContent.map((job, index) => {
                 const descriptionForContext = job.description || 'No description content available.';
                 return `Job ${index + 1}:\n` +
                        `Title: ${job.title || 'N/A'}\n` +
                        `Company: ${job.company_name || 'N/A'}\n` +
                        `Location: ${job.location || 'N/A'}\n` +
                        `URL: ${job.url || '#'}\n` +
                        `Description: ${descriptionForContext}`;
             }).join('\n\n---\n\n');
        }
         console.log(`Prepared context for Gemini using ${jobsWithContent.length} jobs (using plain text descriptions).`);
        const MAX_CONTEXT_CHARS = 800000; // Estimate ~800k chars as a safe limit before hitting token issues
        if (allScrapedJobContext.length > MAX_CONTEXT_CHARS) {
            console.warn(`Context length (${allScrapedJobContext.length} chars) is very large, potentially exceeding limits. Truncating.`);
            allScrapedJobContext = allScrapedJobContext.substring(0, MAX_CONTEXT_CHARS) + "\n\n... (Context Truncated) ...";
        }

        // === Step 4: Prepare Prompt for Gemini (Remains the same) ===
        const prioritizationInstruction = hasResume ? `...` : `...`; // Keep existing definitions
        const marketInsightsInstruction = `...`;
        const detailedTrendsInstruction = `...`;
        const competitiveLandscapeInstruction = hasResume ? `...` : '';
         const prompt = `
           You are an expert AI Career Advisor analyzing the job market.
           Context:
           - User's target role/skill query: "${userRoleQuery}"
           ${hasResume ? `- User's Resume Text:\n"""\n${resumeText}\n"""` : ''}
           - The following ${jobsWithContent.length} job descriptions (with URLs) were loaded from pre-saved data. **You have the full context needed for analysis below.**

           Tasks:
           Based *only* on the provided context...
           1.  **Common Tech Stack:**
           2.  **Suggested Project Ideas:**
           3.  **Job Prioritization:**
               ${prioritizationInstruction}
           4.  **Experience Level Summary:**
           5.  **Overall Market Insights:**
               ${marketInsightsInstruction}
           6.  **Detailed Market Trends & Insights:**
               ${detailedTrendsInstruction}
           ${competitiveLandscapeInstruction}

           --- Scraped Job Information (Found: ${jobsWithContent.length}) ---
           ${allScrapedJobContext}
           --- END Scraped Job Information ---

           Analysis Output:
         `;

        // === Step 5: Call Gemini API (Remains the same) ===
         console.log(`Sending analysis prompt to Gemini (${GEMINI_MODEL_NAME}) ${hasResume ? 'with resume context' : ''} (Using pre-saved data)`);
         console.time("geminiApiCallLargeContext");
         const requestBody = { contents: [{ parts: [{ "text": prompt }] }] };
         const geminiApiResponse = await fetch(geminiApiUrlWithKey, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });
         console.timeEnd("geminiApiCallLargeContext");

        // Always check if the fetch itself was successful
        if (!geminiApiResponse.ok) {
            const errorText = await geminiApiResponse.text(); // Read error text
            console.error(`Deep Dive API HTTP Error (${geminiApiResponse.status}):`, errorText);
            const errorDetails = `HTTP error! status: ${geminiApiResponse.status}. ${errorText.substring(0, 100)}`; // Add snippet of error
            return NextResponse.json({ error: `Failed to get deep dive analysis: ${errorDetails}` }, { status: geminiApiResponse.status });
        }

        // Try parsing the JSON body
        let geminiData: GeminiResponse;
        try {
            geminiData = await geminiApiResponse.json() as GeminiResponse;
        } catch (parseError: any) {
             console.error("Deep Dive API Error: Failed to parse JSON response:", parseError);
             return NextResponse.json({ error: 'Failed to parse AI response.' }, { status: 500 });
        }

        // Check for safety blocks or other API-level errors reported in JSON
        const blockReason = geminiData.promptFeedback?.blockReason;
        if (blockReason) {
            console.error(`Gemini request blocked by safety settings: ${blockReason}`);
            return NextResponse.json({ error: `Request blocked by safety settings: ${blockReason}` }, { status: 400 });
        }
        const finishReason = geminiData.candidates?.[0]?.finishReason;
         if (finishReason && !['STOP', 'MAX_TOKENS'].includes(finishReason)) {
             console.error(`Gemini generation finished unexpectedly: ${finishReason}`);
             // Potentially return partial data if available, or just error
             return NextResponse.json({ error: `AI generation failed: ${finishReason}` }, { status: 500 });
         }

        let analysisText = '';
         try {
             analysisText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
         } catch { /* Catch block requires no variable if error object isn't used */ }

        if (!analysisText) {
             console.error("Gemini deep dive analysis response text empty after parsing structure.");
             return NextResponse.json({ error: 'Received an empty analysis from the AI model.' }, { status: 500 });
        }

        // Clean up the start if Gemini repeats the heading
        analysisText = analysisText.replace(/^\s*--- DEEP DIVE ANALYSIS ---\s*/i, '').trim();

        // === Step 7: Return Combined Results (Remains the same) ===
        const allJobLinksForFrontend = scrapedJobResults.map(job => ({ /* ... */ }));
         console.log("Data being returned to frontend:", { /* ... */ });
        return NextResponse.json({
            deepDiveAnalysis: analysisText,
            analysisDisclaimer: `Note: Analysis based on pre-saved data for "${userRoleQuery}". Stats from ${scrapedJobResults.length} jobs. AI analysis used ${jobsWithContent.length} full descriptions. Verify details.`,
        });

    } catch (error: unknown) {
        console.error("API Route General Error:", error);
        const message = error instanceof Error ? error.message : String(error);
        const errorMessage = `An internal server error occurred: ${message}`;
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
} 