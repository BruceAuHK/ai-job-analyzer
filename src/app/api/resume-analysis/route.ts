// src/app/api/resume-analysis/route.ts
import { NextRequest, NextResponse } from 'next/server';

// Gemini API Details
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL_NAME = "gemini-2.0-flash"; // Or your preferred model

if (!GEMINI_API_KEY) {
  console.error("Startup Warning: Missing GEMINI_API_KEY environment variable for resume-analysis route.");
}

export async function POST(request: NextRequest) {
    const currentApiKey = process.env.GEMINI_API_KEY;
     if (!currentApiKey) {
        return NextResponse.json({ error: 'Server configuration error: Missing API Key.' }, { status: 500 });
    }
    const geminiApiUrlWithKey = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_NAME}:generateContent?key=${currentApiKey}`;

    try {
        const { resumeText, commonStack } = await request.json();

        if (typeof resumeText !== 'string' || !resumeText.trim()) {
            return NextResponse.json({ error: 'Invalid resume text provided.' }, { status: 400 });
        }
        if (typeof commonStack !== 'string' || !commonStack.trim() || commonStack.toLowerCase().includes('could not parse')) {
            return NextResponse.json({ error: 'Invalid or unavailable common tech stack provided.' }, { status: 400 });
        }

        // Construct the prompt for Gemini
        const prompt = `
            Analyze the following resume text in the context of the provided "Common Tech Stack" identified from relevant job listings.

            Task:
            1.  **Overall Fitness:** Provide a brief (1-2 sentence) assessment of how well the skills and experience presented in the resume align with the Common Tech Stack.
            2.  **Strengths/Matches:** Identify 2-3 key skills or experiences from the resume that strongly match requirements in the Common Tech Stack.
            3.  **Potential Gaps/Areas for Improvement:** Identify 1-2 areas where the resume could be strengthened or clarified to better align with the Common Tech Stack. Suggest specific keywords or skills from the stack that could be incorporated if applicable based on the candidate's likely experience. Do not invent experience.
            4.  **Keywords:** List 5-10 keywords from the Common Tech Stack that the candidate should ensure are present (if relevant) in their resume for Applicant Tracking Systems (ATS).

            --- COMMON TECH STACK ---
            ${commonStack}

            --- RESUME TEXT ---
            ${resumeText}

            --- FITNESS ANALYSIS ---
        `;

        console.log(`Sending resume analysis prompt to Gemini: ${GEMINI_MODEL_NAME}`);
        const requestBody = { contents: [{ parts: [{ "text": prompt }] }] };

        const geminiApiResponse = await fetch(geminiApiUrlWithKey, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });

        console.log(`Gemini Resume Analysis API Response Status: ${geminiApiResponse.status} ${geminiApiResponse.statusText}`);
        const rawResponseText = await geminiApiResponse.text();
        // console.log("Gemini Resume Analysis API Raw Response Text:", rawResponseText);

        let geminiResponseData: any;
        try {
             if (rawResponseText && rawResponseText.trim().startsWith('{')) {
                 geminiResponseData = JSON.parse(rawResponseText);
             } else {
                 throw new Error(`Received non-JSON response or empty response from Gemini API. Status: ${geminiApiResponse.status}. Body starts with: ${rawResponseText.substring(0,100)}`);
             }
        } catch (parseError: any) {
             console.error("Resume Analysis JSON Parsing Error:", parseError);
             return NextResponse.json({ error: 'Failed to parse resume analysis response from AI model.', details: rawResponseText.substring(0, 500) }, { status: 500 });
        }

        if (!geminiApiResponse.ok) {
             console.error("Gemini Resume Analysis API Error Response (JSON):", geminiResponseData);
             const errorDetails = geminiResponseData.error?.message || `HTTP error! status: ${geminiApiResponse.status}`;
             return NextResponse.json({ error: `Failed to get resume analysis: ${errorDetails}` }, { status: geminiApiResponse.status });
        }

        let analysisText = '';
         try {
             analysisText = geminiResponseData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
             // Add safety checks if needed
         } catch (e: any) { /* Handle extraction error */ }

        if (!analysisText) {
             console.error("Gemini resume analysis response text empty after parsing structure.");
             return NextResponse.json({ error: 'Received an empty resume analysis from the AI model.' }, { status: 500 });
        }

        return NextResponse.json({ resumeAnalysis: analysisText });

    } catch (error: any) {
        console.error("API Route Resume Analysis Error:", error);
        return NextResponse.json({ error: 'An internal server error occurred during resume analysis.' }, { status: 500 });
    }
}