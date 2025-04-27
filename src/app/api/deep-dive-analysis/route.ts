import { NextRequest, NextResponse } from 'next/server';

// Gemini API Details
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Use Flash for this focused task, should be sufficient and faster/cheaper
const GEMINI_MODEL_NAME = "gemini-2.0-flash";

if (!GEMINI_API_KEY) {
  console.error("Startup Warning: Missing GEMINI_API_KEY environment variable for deep-dive-analysis route.");
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
            return NextResponse.json({ error: 'Invalid job description provided.' }, { status: 400 });
        }
        if (jobDescription.toLowerCase().includes('could not extract description') || jobDescription.toLowerCase().includes('failed/timed out')) {
             return NextResponse.json({ error: 'Cannot analyze an incomplete job description.' }, { status: 400 });
        }

        // Construct the prompt for Gemini
        const prompt = `
            Analyze this specific job description in detail. Provide a structured analysis covering the following points. Use markdown formatting for clarity (e.g., bold headings, bullet points):

            1.  **Core Responsibilities:**
                *   Summarize the main day-to-day tasks and duties implied or stated in the description.

            2.  **Key Challenges / Problems to Solve:**
                *   Identify any potential challenges, difficult problems, or key objectives mentioned or suggested by the role's description.

            3.  **Skill Requirements Breakdown:**
                *   **Must-Have Skills:** List skills explicitly stated as required, essential, mandatory, or strongly preferred.
                *   **Nice-to-Have Skills:** List skills mentioned as advantageous, a plus, desirable, or preferred but not strictly required.
                *   **Implied Skills:** List any skills likely needed based on the responsibilities, even if not explicitly stated.

            4.  **Company Culture Clues (if any):**
                *   Based *only* on the language, tone, benefits, or values mentioned in the description, are there any hints about the company culture (e.g., fast-paced, collaborative, formal, mission-driven)? If no clues, state "No specific culture clues found in the description."

            5.  **Potential Red Flags or Ambiguities:**
                *   Point out any parts of the description that are vague, potentially contradictory, seem unusually demanding, or might be considered red flags (e.g., excessively long hours mentioned, very broad skill list for a junior role). If none, state "No obvious red flags or major ambiguities identified."

            6.  **Questions to Ask the Hiring Manager:**
                *   Suggest 2-4 specific questions a candidate could ask the hiring manager during an interview to clarify responsibilities, challenges, culture, or expectations based *directly* on ambiguities or points raised in this analysis.

            --- JOB DESCRIPTION ---
            ${jobDescription}
            --- END JOB DESCRIPTION ---

            --- DEEP DIVE ANALYSIS ---
        `;

        console.log(`Sending deep dive analysis prompt to Gemini (${GEMINI_MODEL_NAME})`);
        const requestBody = { contents: [{ parts: [{ "text": prompt }] }] };

        const geminiApiResponse = await fetch(geminiApiUrlWithKey, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });

        console.log(`Gemini Deep Dive API Response Status: ${geminiApiResponse.status} ${geminiApiResponse.statusText}`);
        const rawResponseText = await geminiApiResponse.text();

        let geminiResponseData: GeminiResponse = {}; // Initialize with the interface type
        try {
             if (rawResponseText && rawResponseText.trim().startsWith('{')) {
                 geminiResponseData = JSON.parse(rawResponseText) as GeminiResponse; // Assert type
             } else {
                 throw new Error(`Received non-JSON response or empty response from Gemini API. Status: ${geminiApiResponse.status}. Body starts with: ${rawResponseText.substring(0,100)}`);
             }
        } catch (parseError: unknown) {
             console.error("Deep Dive JSON Parsing Error:", parseError);
             const message = parseError instanceof Error ? parseError.message : 'Failed to parse AI response';
             return NextResponse.json({ error: message, details: rawResponseText.substring(0, 500) }, { status: 500 });
        }

        if (!geminiApiResponse.ok) {
             console.error("Deep Dive API Error Response (JSON):", geminiResponseData);
             const errorDetails = geminiResponseData.error?.message || `HTTP error! status: ${geminiApiResponse.status}`;
             return NextResponse.json({ error: `Failed to get deep dive analysis: ${errorDetails}` }, { status: geminiApiResponse.status });
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
              // Potentially return partial data if available, or just error
              return NextResponse.json({ error: `AI generation failed: ${finishReason}` }, { status: 500 });
          }

        let analysisText = '';
         try {
             analysisText = geminiResponseData.candidates?.[0]?.content?.parts?.[0]?.text || '';
         } catch { /* Catch block requires no variable if error object isn't used */ }

        if (!analysisText) {
             console.error("Gemini deep dive analysis response text empty after parsing structure.");
             return NextResponse.json({ error: 'Received an empty analysis from the AI model.' }, { status: 500 });
        }

        // Clean up the start if Gemini repeats the heading
        analysisText = analysisText.replace(/^\s*--- DEEP DIVE ANALYSIS ---\s*/i, '').trim();

        return NextResponse.json({ deepDiveAnalysis: analysisText });

    } catch (error: unknown) {
        console.error("API Route Deep Dive Error:", error);
        const message = error instanceof Error ? error.message : 'An internal server error occurred during deep dive analysis.';
        return NextResponse.json({ error: message }, { status: 500 });
    }
} 