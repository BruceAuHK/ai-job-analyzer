// src/app/api/skill-gap/route.ts
import { NextRequest, NextResponse } from 'next/server';

// Gemini API Details (ensure these are accessible, e.g., from process.env or defined)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL_NAME = "gemini-2.0-flash"; // Or your preferred model

if (!GEMINI_API_KEY) {
  console.error("Startup Warning: Missing GEMINI_API_KEY environment variable for skill-gap route.");
}

// Define a basic interface for the expected response
interface GeminiResponse {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
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
        const { commonStack } = await request.json();

        if (typeof commonStack !== 'string' || !commonStack.trim() || commonStack.toLowerCase().includes('could not parse')) {
            return NextResponse.json({ error: 'Invalid or unavailable common tech stack provided.' }, { status: 400 });
        }

        // Construct the prompt for Gemini
        const prompt = `
            Analyze the following common tech stack identified from job listings for a specific role.
            Assume a candidate is interested in roles requiring these skills.

            Task:
            1. Identify 2-3 potential skill areas within this stack where a candidate (perhaps with junior-to-mid level experience) might commonly have gaps or need deeper proficiency to be highly competitive. Briefly explain why these are important.
            2. For each identified gap area, suggest 2-3 specific, actionable learning resources or approaches. Examples: specific online course platforms (Udemy, Coursera), official documentation sites, types of personal projects to build, specific libraries/tools to master, or key concepts to research further.

            --- COMMON TECH STACK ---
            ${commonStack}
            --- ANALYSIS & RECOMMENDATIONS ---
        `;

        console.log(`Sending skill gap analysis prompt to Gemini: ${GEMINI_MODEL_NAME}`);
        const requestBody = { contents: [{ parts: [{ "text": prompt }] }] };

        const geminiApiResponse = await fetch(geminiApiUrlWithKey, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });

        console.log(`Gemini Skill Gap API Response Status: ${geminiApiResponse.status} ${geminiApiResponse.statusText}`);
        const rawResponseText = await geminiApiResponse.text();
        // console.log("Gemini Skill Gap API Raw Response Text:", rawResponseText); // Log full response if needed for debug

        let geminiResponseData: GeminiResponse = {}; // Initialize with the interface type
        try {
            if (rawResponseText && rawResponseText.trim().startsWith('{')) {
                 geminiResponseData = JSON.parse(rawResponseText) as GeminiResponse; // Assert type
             } else {
                throw new Error(`Received non-JSON response...`);
            }
        } catch (parseError: unknown) {
            console.error("Skill Gap JSON Parsing Error:", parseError);
             // No need to use 'parseError' variable if only logging it
            return NextResponse.json({ error: 'Failed to parse skill gap response from AI model.', details: rawResponseText.substring(0, 500) }, { status: 500 });
        }

        if (!geminiApiResponse.ok) {
             console.error("Gemini Skill Gap API Error Response (JSON):", geminiResponseData);
             const errorDetails = geminiResponseData.error?.message || `HTTP error! status: ${geminiApiResponse.status}`;
             return NextResponse.json({ error: `Failed to get skill gap analysis: ${errorDetails}` }, { status: geminiApiResponse.status });
        }

        let analysisText = '';
         try {
             analysisText = geminiResponseData.candidates?.[0]?.content?.parts?.[0]?.text || '';
         } catch { /* Catch block requires no variable if error object isn't used */ }

        if (!analysisText) {
             console.error("Gemini skill gap response text empty after parsing structure.");
             return NextResponse.json({ error: 'Received an empty skill gap analysis from the AI model.' }, { status: 500 });
        }

        return NextResponse.json({ skillGapAnalysis: analysisText });

    } catch (error: unknown) { // Use 'unknown'
        console.error("API Route Skill Gap Error:", error);
        // Type check error before accessing properties
        const message = error instanceof Error ? error.message : 'An internal server error occurred during skill gap analysis.';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}