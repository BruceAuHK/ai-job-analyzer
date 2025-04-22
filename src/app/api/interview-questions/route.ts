import { NextRequest, NextResponse } from 'next/server';

// Gemini API Details (ensure these are accessible)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Use a capable model, Flash is likely sufficient for this focused task
const GEMINI_MODEL_NAME = "gemini-1.5-flash-latest";

if (!GEMINI_API_KEY) {
  console.error("Startup Warning: Missing GEMINI_API_KEY environment variable for interview-questions route.");
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

        let geminiResponseData: any;
        try {
            if (!geminiApiResponse.ok) {
                 console.error("Gemini API Error Raw Response:", rawResponseText);
                 // Try to parse error from JSON if possible
                 let errorMsg = `Gemini API error (${geminiApiResponse.status}): ${geminiApiResponse.statusText}.`;
                 try {
                    const errorJson = JSON.parse(rawResponseText);
                    errorMsg = errorJson.error?.message || errorMsg;
                 } catch (_) {}
                 throw new Error(errorMsg);
            }
            if (rawResponseText && rawResponseText.trim().startsWith('{')) {
                 geminiResponseData = JSON.parse(rawResponseText);
            } else {
                throw new Error("Received non-JSON response from Gemini API.");
            }
        } catch (parseError: any) {
            console.error("Interview Questions JSON Parsing/API Error:", parseError);
            return NextResponse.json({ error: `Failed to parse response from AI model: ${parseError.message}` }, { status: 500 });
        }

        // Check for safety blocks or other API-level errors reported in JSON
        const blockReason = geminiResponseData.promptFeedback?.blockReason;
        if (blockReason) {
            console.error(`Gemini request blocked by safety settings: ${blockReason}`);
            return NextResponse.json({ error: `Request blocked by safety settings: ${blockReason}` }, { status: 400 });
        }
        const finishReason = geminiResponseData.candidates?.[0]?.finishReason;
         if (finishReason && !['STOP', 'MAX_TOKENS'].includes(finishReason)) {
             console.error(`Gemini generation finished unexpectedly: ${finishReason}`);
             return NextResponse.json({ error: `AI generation failed: ${finishReason}` }, { status: 500 });
        }

        let questionsText = '';
        try {
            questionsText = geminiResponseData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } catch (e: any) {
             console.error("Error extracting questions text from Gemini response:", e);
             return NextResponse.json({ error: 'Could not extract questions from AI response structure.' }, { status: 500 });
         }


        if (!questionsText) {
             console.error("Gemini interview questions response text empty after processing.");
             return NextResponse.json({ error: 'Received empty response for interview questions from AI.' }, { status: 500 });
        }

        // Clean up potential redundant heading
        questionsText = questionsText.replace(/^\s*INTERVIEW QUESTIONS:?\s*/i, '').trim();

        return NextResponse.json({ interviewQuestions: questionsText });

    } catch (error: any) {
        console.error("API Route Interview Questions Error:", error);
        return NextResponse.json({ error: error.message || 'An internal server error occurred during interview question generation.' }, { status: 500 });
    }
} 