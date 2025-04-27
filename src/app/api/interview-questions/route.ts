import { NextRequest, NextResponse } from 'next/server';

// Gemini API Details (ensure these are accessible)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Use a capable model, Flash is likely sufficient for this focused task
const GEMINI_MODEL_NAME = "gemini-2.0-flash";

if (!GEMINI_API_KEY) {
  console.error("Startup Warning: Missing GEMINI_API_KEY environment variable for interview-questions route.");
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
        const { jobDescription } = await request.json();

        if (typeof jobDescription !== 'string' || !jobDescription.trim()) {
            return NextResponse.json({ error: 'Invalid or missing job description.' }, { status: 400 });
        }

        // Construct the prompt for Gemini
        const prompt = `
            You are an expert hiring manager reviewing a job description.
            Based *only* on the following job description, generate 5-7 potential interview questions an interviewer might ask a candidate for this specific role. Include a mix of:
            - Technical questions (related to specific skills/technologies mentioned).
            - Behavioral questions (related to responsibilities or required soft skills mentioned).
            - Situational questions (hypothetical scenarios based on the role's tasks described).

            Format the output as a numbered list.

            --- JOB DESCRIPTION ---
            ${jobDescription}
            --- END JOB DESCRIPTION ---

            INTERVIEW QUESTIONS:
        `;

        console.log(`Sending interview questions prompt to Gemini: ${GEMINI_MODEL_NAME}`);
        const requestBody = { contents: [{ parts: [{ "text": prompt }] }] };

        const geminiApiResponse = await fetch(geminiApiUrlWithKey, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });

        console.log(`Gemini Interview Questions API Response Status: ${geminiApiResponse.status} ${geminiApiResponse.statusText}`);
        const rawResponseText = await geminiApiResponse.text();

        let geminiResponseData: GeminiResponse = {}; // Initialize with the interface type
        try {
            if (rawResponseText && rawResponseText.trim().startsWith('{')) {
                geminiResponseData = JSON.parse(rawResponseText) as GeminiResponse; // Assert type
            } else {
                throw new Error(`Received non-JSON response...`);
            }
        } catch (parseError: unknown) {
            console.error("Interview Questions JSON Parsing Error:", parseError);
            return NextResponse.json({ error: 'Failed to parse interview questions response from AI model.', details: rawResponseText.substring(0, 500) }, { status: 500 });
        }

        if (!geminiApiResponse.ok) {
            console.error("Interview Questions API Error Response (JSON):", geminiResponseData);
            const errorDetails = geminiResponseData.error?.message || `HTTP error! status: ${geminiApiResponse.status}`;
            return NextResponse.json({ error: `Failed to get interview questions: ${errorDetails}` }, { status: geminiApiResponse.status });
        }

        let analysisText = '';
        try {
            analysisText = geminiResponseData.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } catch { /* Catch block requires no variable if error object isn't used */ }

        if (!analysisText) {
            console.error("Gemini interview questions response text empty after processing.");
            return NextResponse.json({ error: 'Received empty response for interview questions from AI.' }, { status: 500 });
        }

        // Clean up potential redundant heading
        analysisText = analysisText.replace(/^\s*INTERVIEW QUESTIONS:?\s*/i, '').trim();

        return NextResponse.json({ interviewQuestions: analysisText });

    } catch (error: unknown) {
        console.error("API Route Interview Questions Error:", error);
        const message = error instanceof Error ? error.message : 'An internal server error occurred during question generation.';
        return NextResponse.json({ error: message }, { status: 500 });
    }
} 