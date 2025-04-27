// src/app/api/search-strategy/route.ts
import { NextRequest, NextResponse } from 'next/server';

// Gemini API Details
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Use a capable model, Flash should be fine for this kind of reasoning
const GEMINI_MODEL_NAME = "gemini-2.0-flash";

if (!GEMINI_API_KEY) {
  console.error("Startup Warning: Missing GEMINI_API_KEY for search-strategy route.");
}

// Define a basic interface for the expected response
interface GeminiResponse {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    error?: { message?: string };
    promptFeedback?: { blockReason?: string };
}

export async function POST(request: NextRequest) {
    const currentApiKey = process.env.GEMINI_API_KEY;
     if (!currentApiKey) {
        return NextResponse.json({ error: 'Server configuration error: Missing API Key.' }, { status: 500 });
    }
    const geminiApiUrlWithKey = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_NAME}:generateContent?key=${currentApiKey}`;

    try {
        // Extract all relevant analysis data passed from the frontend
        const {
            userRoleQuery,
            commonStack,
            experienceSummary,
            jobPrioritization,
            topCompanies, // Optional but useful context
            topLocations // Optional but useful context
        } = await request.json();

        // --- Input Validation ---
        if (!userRoleQuery || typeof userRoleQuery !== 'string') {
             return NextResponse.json({ error: 'Missing or invalid userRoleQuery.' }, { status: 400 });
        }
         if (!commonStack || typeof commonStack !== 'string' || commonStack.toLowerCase().includes('could not parse')) {
             return NextResponse.json({ error: 'Missing or invalid commonStack analysis.' }, { status: 400 });
         }
         // Add checks for other required inputs if necessary

        // --- Construct Prompt for Gemini ---
        // Combine the analysis into a context for the strategy prompt
        let analysisContext = `Common Tech Stack:\n${commonStack}\n\n`;
        if (experienceSummary && !experienceSummary.toLowerCase().includes('could not parse')) {
            analysisContext += `Typical Experience Level:\n${experienceSummary}\n\n`;
        }
        if (jobPrioritization && !jobPrioritization.toLowerCase().includes('could not parse')) {
            analysisContext += `Job Prioritization Suggestion:\n${jobPrioritization}\n\n`;
        }
        if (topCompanies && topCompanies.length > 0) {
             analysisContext += `Top Hiring Companies Found:\n${topCompanies.map((c: { name: string, count: number }) => `- ${c.name} (${c.count} jobs)`).join('\n')}\n\n`;
        }
        if (topLocations && topLocations.length > 0) {
             analysisContext += `Top Job Locations Found:\n${topLocations.map((l: { name: string, count: number }) => `- ${l.name} (${l.count} jobs)`).join('\n')}\n\n`;
        }


        const prompt = `
            You are an expert AI Career Advisor. A user is searching for jobs related to "${userRoleQuery}".
            Based *only* on the following market analysis derived from scraped job descriptions from JobsDB Hong Kong, provide 3-5 actionable and concise job search strategy tips tailored to this specific analysis.

            Focus on providing practical advice the user can implement immediately. Examples include:
            - Specific keywords to add/remove from their search or resume based on the common tech stack.
            - Types of companies or industries to focus on (drawing from top companies if relevant).
            - Skills from the common stack to particularly emphasize on their profile or learn next.
            - Suggestions for tailoring their application materials based on the analysis.
            - Potential networking approaches relevant to the findings (e.g., targeting specific companies or skill areas).

            Keep tips brief and focused. Format as a numbered list.

            --- MARKET ANALYSIS SUMMARY ---
            ${analysisContext}
            --- END ANALYSIS SUMMARY ---

            SEARCH STRATEGY TIPS:
        `;

        console.log(`Sending strategy prompt to Gemini: ${GEMINI_MODEL_NAME}`);
        // Log prompt snippet for debugging if needed
        // console.log("Strategy Prompt Snippet:", prompt.substring(0, 400) + "...");

        const requestBody = { contents: [{ parts: [{ "text": prompt }] }] };

        const geminiApiResponse = await fetch(geminiApiUrlWithKey, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });

        console.log(`Gemini Strategy API Response Status: ${geminiApiResponse.status} ${geminiApiResponse.statusText}`);
        const rawResponseText = await geminiApiResponse.text();

        let geminiResponseData: GeminiResponse = {}; // Initialize with the interface type
        try {
             if (rawResponseText && rawResponseText.trim().startsWith('{')) {
                 geminiResponseData = JSON.parse(rawResponseText) as GeminiResponse; // Assert type
             } else { throw new Error(`Received non-JSON response...`); }
        } catch (parseErr: unknown) {
             console.error("Search Strategy JSON Parsing Error:", parseErr);
             return NextResponse.json({ error: 'Failed to parse strategy response from AI model.' }, { status: 500 });
        }

        // Check for safety blocks or API errors
        const blockReason = geminiResponseData.candidates?.[0]?.finishReason === 'SAFETY' ? geminiResponseData.promptFeedback?.blockReason || 'Unknown Safety Block' : null;
        if (blockReason) { console.error(`Gemini strategy request blocked: ${blockReason}`); return NextResponse.json({ error: `Request blocked: ${blockReason}` }, { status: 400 }); }
        if (!geminiApiResponse.ok) { console.error("Gemini strategy API Error:", geminiResponseData); return NextResponse.json({ error: 'Failed to get strategy from AI model.' }, { status: geminiApiResponse.status }); }

        // Extract text
        let strategyText = '';
        try {
            strategyText = geminiResponseData.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } catch { /* Catch block requires no variable if error object isn't used */ }

        if (!strategyText) { console.error("Gemini strategy response text empty."); return NextResponse.json({ error: 'Received empty strategy advice.' }, { status: 500 }); }

        // Clean up the start if Gemini repeats the heading
        strategyText = strategyText.replace(/^\s*SEARCH STRATEGY TIPS:?\s*/i, '').trim();

        return NextResponse.json({ strategyTips: strategyText });

    } catch (error: unknown) {
        console.error("API Route Search Strategy Error:", error);
        const message = error instanceof Error ? error.message : 'An internal server error occurred during strategy generation.';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}