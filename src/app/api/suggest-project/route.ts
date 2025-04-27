// src/app/api/suggest-project/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const API_KEY = process.env.GEMINI_API_KEY;

// Basic check for API Key at startup
if (!API_KEY) {
  console.error("FATAL ERROR: Missing GEMINI_API_KEY environment variable.");
  // In a real app, you might prevent the server from starting or handle this more gracefully
  // For this example, we'll let requests fail later, but log the error prominently.
}

const genAI = new GoogleGenerativeAI(API_KEY || ""); // Pass empty string if undefined, check later

const model = genAI.getGenerativeModel({
  model: "gemini-1.5-pro-latest", // Targeting Gemini 1.5 Pro
  // model: "gemini-1.5-flash-latest", // Alternative if Pro limits are too strict
});

// Optional: Configure safety settings (adjust thresholds as needed)
// const safetySettings = [
//   { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
//   { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
//   { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
//   { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
// ];

// Optional: Configure generation parameters
// const generationConfig = {
//   // temperature: 0.7, // Example: balances creativity and coherence
//   maxOutputTokens: 2048, // Limit response length
// };

export async function POST(request: NextRequest) {
  // Check for API Key on each request if it wasn't available at startup
  if (!API_KEY) {
     console.error("API Key is missing in environment variables.");
     return NextResponse.json({ error: 'Server configuration error: Missing API Key.' }, { status: 500 });
  }

  try {
    const { mySkills, requiredSkills } = await request.json();

    // Basic validation
    if (typeof mySkills !== 'string' || typeof requiredSkills !== 'string' || !mySkills || !requiredSkills) {
      return NextResponse.json({ error: 'Invalid input: Skills must be non-empty strings.' }, { status: 400 });
    }

    // --- Basic Skill Gap Calculation ---
    const mySkillsSet = new Set(
      mySkills.toLowerCase().split(',').map((s: string) => s.trim()).filter(Boolean)
    );
    const requiredSkillsList = requiredSkills.toLowerCase().split(',').map((s: string) => s.trim()).filter(Boolean);

    // Filter out skills the user already has
    const gapSkills = requiredSkillsList.filter((skill: string) => !mySkillsSet.has(skill));

    if (gapSkills.length === 0) {
      return NextResponse.json({ suggestion: "You seem to have all the required skills! Perhaps focus on a portfolio project that combines them in a unique way or tackles a complex problem within the target domain." });
    }

    // --- Construct Prompt for LLM ---
    // NOTE: Corrected the template literal interpolation for gapSkills
    const prompt = `
      You are an expert AI Career Advisor helping a software developer prepare for job applications.

      Context:
      - User's current skills: ${mySkills || 'None specified'}
      - Skills required by a target job: ${requiredSkills}
      - Identified skill gap (skills required but user lacks): ${gapSkills.join(', ')}

      Task:
      Suggest one specific, actionable, and relatively small-scale project idea (approx 3-5 sentences) that the user can build for their portfolio. The project MUST directly help demonstrate proficiency in the missing skills (${gapSkills.join(', ')}). Make the project relevant to modern software development, potentially incorporating AI/ML concepts if appropriate for the skills, but prioritize demonstrating the gap skills above all else. Avoid overly complex or long-term research projects. Output only the project suggestion text.
    `;

    // --- Call Gemini API ---
    console.log(`Sending prompt to Gemini model: ${model.model}`); // Log model name
    // console.log("Prompt:", prompt); // Uncomment for debugging prompt content

    const result = await model.generateContent(
      prompt,
      // Pass safetySettings and generationConfig if defined
      // safetySettings, // Commented out
      // generationConfig // Commented out
    );

    const response = result.response;
    const suggestionText = response.text();

    console.log("Gemini API Response Status:", response.promptFeedback || 'OK'); // Log safety feedback

    if (!suggestionText) {
        const blockReason = response.promptFeedback?.blockReason;
        const finishReason = response.candidates?.[0]?.finishReason;
        console.error("Gemini response empty.", { blockReason, finishReason });

        if (blockReason) {
          return NextResponse.json({ error: `Request blocked by safety settings: ${blockReason}` }, { status: 400 });
        }
        if (finishReason && finishReason !== 'STOP') {
             return NextResponse.json({ error: `Generation failed: ${finishReason}` }, { status: 500 });
         }
        return NextResponse.json({ error: 'Received an empty response from the AI model.' }, { status: 500 });
    }

    // --- Return Success Response ---
    return NextResponse.json({ suggestion: suggestionText.trim() });

  } catch (error: unknown) { // Use 'unknown'
    console.error("API Route Error:", error); // Log the full error server-side

    // Provide a generic error message to the client
    let errorMessage = 'An internal server error occurred.';
    let statusCode = 500;

    // Type check error before accessing properties
    const message = error instanceof Error ? error.message : String(error);

    // Check for specific error types if needed (e.g., API key auth)
    if (message?.includes('API key not valid') || message?.includes('PERMISSION_DENIED')) {
        errorMessage = 'AI API authentication error. Please check the server configuration.';
        statusCode = 500; // Internal server error essentially
    } else if (error instanceof SyntaxError) { // JSON parsing error
       errorMessage = 'Invalid request format.';
       statusCode = 400;
    } else if (message?.includes('fetch failed') || message?.includes('ENOTFOUND')) {
         errorMessage = 'Network error communicating with the AI service.';
         statusCode = 503; // Service Unavailable
    } else if (message?.includes('429') || message?.includes('rate limit')) {
         errorMessage = 'Rate limit exceeded. Please try again later.';
         statusCode = 429;
    }

    return NextResponse.json({ error: errorMessage }, { status: statusCode });
  }
}