// src/app/api/job-analysis/route.ts
import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios'; // <-- Added axios import


// --- Removed Playwright Debugging Logs ---

// Gemini API Details
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Use the smaller context Flash model again
const GEMINI_MODEL_NAME = "gemini-2.0-flash"; // Changed back from gemini-1.5-flash-latest

// Check API Key at startup (optional)
if (!GEMINI_API_KEY) {
  console.error("Startup Warning: Missing GEMINI_API_KEY environment variable.");
}

// --- Helper: Add delay ---
// const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms)); // Removed unused

// --- Define Interfaces (Optional but Recommended) ---
interface ScrapedJob {
    title: string | null;
    company_name: string | null;
    location: string | null;
    url: string | null;
    description: string | null;
}

// Interface for the initial job data extracted by ScrapingBee
interface ExtractedJob {
    title?: string | null;
    company_name?: string | null;
    location?: string | null;
    url?: string | null;
}

interface StatItem { name: string; count: number; } // Reuse or define globally

// --- NEW Web Scraping Function using ScrapingBee ---
async function scrapeJobsDB_HK(query: string): Promise<ScrapedJob[]> {
    console.time("scrapeJobsDB_HK_total");
    const apiKey = process.env.SCRAPINGBEE_API_KEY;
    if (!apiKey) {
        console.error("ScrapingBee API Key not found in environment variables.");
        // Return empty array or throw error depending on desired handling
        return [];
    }

    try {
        console.log(`[ScrapingBee] Starting search request for query: "${query}"`);
        const searchParams = {
            api_key: apiKey,
            url: `https://hk.jobsdb.com/hk/search-jobs/${encodeURIComponent(query)}/1`,
            render_js: true,
            premium_proxy: true,
            block_resources: false,
            wait_for: 'article[data-automation="job-card"]',
            extract_rules: JSON.stringify({
                jobs: {
                    selector: 'article[data-automation="job-card"]', // Target job cards
                    type: 'list', // Expect multiple elements
                    output: {
                        // Extract title text
                        title: '[data-automation="jobTitle"]',
                        // Extract company text
                        company_name: '[data-automation="jobCompany"]',
                         // Extract location text
                        location: '[data-automation="jobLocation"]',
                        // Extract the URL from the link containing the title
                        // Look for the link within the job card, often wrapping the title
                        url: {
                            selector: 'a[data-automation="jobTitle"]', // Link wrapping title
                            output: '@href' // Extract the href attribute
                        }
                    },
                },
            }),
        };
        console.log("[ScrapingBee] Search Params:", { url: searchParams.url, wait_for: searchParams.wait_for, render_js: searchParams.render_js }); // Log key params
        console.time("scrapingbee_search_request");
        const searchResponse = await axios.get('https://app.scrapingbee.com/api/v1/', {
            params: searchParams,
            headers: { 'Accept': 'application/json' }
        });
        console.timeEnd("scrapingbee_search_request");
        console.log(`[ScrapingBee] Search Response Status: ${searchResponse.status}`);
        // console.log("[ScrapingBee] Search Response Headers:", searchResponse.headers); // Optional: Log headers if needed

        const jobsList: ExtractedJob[] = searchResponse.data?.jobs || [];
        console.log(`[ScrapingBee] Found ${jobsList.length} initial listings from search response.`);

        const DETAIL_FETCH_LIMIT = 5;
        const jobsToDetail = jobsList.slice(0, DETAIL_FETCH_LIMIT);
        console.log(`[ScrapingBee] Will fetch details for ${jobsToDetail.length} jobs...`);

        console.time("scrapingbee_detail_requests_all");
        const scrapedJobs: ScrapedJob[] = await Promise.all(
            jobsToDetail.map(async (job: ExtractedJob, index: number): Promise<ScrapedJob> => {
                const detailTimerLabel = `scrapingbee_detail_request_${index}`;
                console.time(detailTimerLabel);
                let description: string | null = null;
                const jobUrl = job.url ? `https://hk.jobsdb.com${job.url}` : null;

                if (jobUrl) {
                    await new Promise(resolve => setTimeout(resolve, 200 + index * 50)); // Keep delay
                    try {
                        const detailParams = {
                            api_key: apiKey,
                            url: jobUrl,
                            render_js: true,
                            premium_proxy: true,
                            block_resources: true,
                            wait_for: 'div[data-automation="jobAdDetails"]',
                            extract_rules: JSON.stringify({
                                description: 'div[data-automation="jobAdDetails"]',
                            }),
                        };
                        console.log(`[ScrapingBee Detail ${index}] Fetching: ${jobUrl}`);
                        // console.log(`[ScrapingBee Detail ${index}] Params:`, detailParams); // Optional: Log full detail params

                        const detailResponse = await axios.get('https://app.scrapingbee.com/api/v1/', {
                            params: detailParams,
                            headers: { 'Accept': 'application/json' }
                        });
                        console.log(`[ScrapingBee Detail ${index}] Response Status: ${detailResponse.status}`);
                        description = detailResponse.data?.description || 'No description available (Extractor failed).';

                    } catch (error: unknown) {
                        const errorDetails = error instanceof Error ? error.message : String(error);
                        // Check for axios specific error response
                        if (axios.isAxiosError(error) && error.response?.data?.message) {
                             const axiosErrorMessage = error.response.data.message;
                             console.error(`Failed to scrape description for ${jobUrl}: AxiosError - ${axiosErrorMessage}`);
                             description = `Failed to fetch description: ${axiosErrorMessage.substring(0,100)}`;
                         } else {
                             console.error(`Failed to scrape description for ${jobUrl}: ${errorDetails}`);
                             description = `Failed to fetch description: ${errorDetails.substring(0,100)}`;
                         }
                    }
                } else {
                    console.warn(`Skipping description fetch for job index ${index} due to missing URL.`);
                     // Assign specific string
                    description = 'No URL found for description scraping.';
                }

                // At this point, 'description' MUST be a string
                // Ensure TS knows this for safety, although logic dictates it.
                const finalDescription = description as string; 

                // Log the length *after* try/catch/else
                console.log(`[ScrapingBee Detail ${index}] Processed. Desc length: ${finalDescription.length}`);

                // Construct the final ScrapedJob object
                return {
                    title: job.title || null,
                    company_name: job.company_name || null,
                    location: job.location || null,
                    url: jobUrl,
                    description: finalDescription, // Use the guaranteed string value
                };
            })
        );
        console.timeEnd("scrapingbee_detail_requests_all");

        console.log(`Finished fetching details. Total jobs with attempted descriptions: ${scrapedJobs.length}`);
        console.timeEnd("scrapeJobsDB_HK_total");
        return scrapedJobs;

    } catch (error: unknown) { // Use unknown type for error
        // Check for axios specific error response
        let errorDetails = error instanceof Error ? error.message : String(error);
         if (axios.isAxiosError(error) && error.response?.data?.message) {
             errorDetails = `AxiosError: ${error.response.data.message}`;
         }
        console.error(`ScrapingBee API request failed: ${errorDetails}`);
        console.timeEnd("scrapeJobsDB_HK_total"); // Ensure timer ends on error too
        return [];
    }
}
// --- End Web Scraping Function ---

// --- API Route Handler ---
export async function POST(request: NextRequest) {
    console.time("job_analysis_POST_total"); // Time the whole POST request
    // --- Vector DB / RAG Code Removed ---

    const currentApiKey = process.env.GEMINI_API_KEY;
    if (!currentApiKey) { return NextResponse.json({ error: 'Server config error: Missing API Key.' }, { status: 500 }); }
    // Construct URL using the large-context Flash model
    const geminiApiUrlWithKey = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_NAME}:generateContent?key=${currentApiKey}`;

    let scrapedJobResults: ScrapedJob[] = [];
    let topCompanies: StatItem[] = [];
    let topLocations: StatItem[] = [];

    try {
        console.log("[POST Handler] Parsing request body...");
        const { userRoleQuery, resumeText } = await request.json();

        if (typeof userRoleQuery !== 'string' || !userRoleQuery.trim()) { return NextResponse.json({ error: 'Invalid input: Missing userRoleQuery.' }, { status: 400 }); }
        // resumeText is optional, so no strict check needed unless you want to enforce it
        const hasResume = typeof resumeText === 'string' && resumeText.trim().length > 0;
        console.log(`[POST Handler] Request parsed for: "${userRoleQuery}" ${hasResume ? 'WITH resume' : 'without resume'}.`);

        // === Step 1: Execute Web Scraping (Now uses ScrapingBee) ===
        console.log("[POST Handler] Starting Step 1: Web Scraping...");
        console.time("step1_scrape_duration");
        scrapedJobResults = await scrapeJobsDB_HK(userRoleQuery); // Calls the new function
        console.timeEnd("step1_scrape_duration");
        console.log(`[POST Handler] Step 1 complete. ${scrapedJobResults.length} jobs processed.`);
        // Filter for jobs where description fetching was successful (or at least attempted and didn't hard fail)
        const jobsWithDescriptions = scrapedJobResults.filter(j =>
            j.url && j.description && !j.description.startsWith('Failed to fetch description') && j.description !== 'No URL found' && j.description !== 'No description available (Extractor failed).'
        );
        console.log(`Found ${jobsWithDescriptions.length} jobs with valid descriptions for AI analysis.`);

        // === Step 2: Calculate Statistics (from all scraped jobs) ===
        console.log("[POST Handler] Starting Step 2: Calculate Statistics...");
        console.time("step2_stats_duration");
        if (scrapedJobResults.length > 0) {
            // ... (statistic calculation remains the same) ...
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
        console.timeEnd("step2_stats_duration");
        console.log("[POST Handler] Step 2 complete.");

        // === Step 3: Prepare Job Context for LLM (No RAG) ===
        console.log("[POST Handler] Starting Step 3: Prepare LLM Context...");
        console.time("step3_context_prep_duration");
        // Format all successfully scraped jobs with descriptions
        let allScrapedJobContext = 'No valid job details available for analysis.';
        if (jobsWithDescriptions.length > 0) {
            allScrapedJobContext = jobsWithDescriptions.map((job, index) => {
                return `Job ${index + 1}:\\n` +
                       `Title: ${job.title || 'N/A'}\\n` +
                       `Company: ${job.company_name || 'N/A'}\\n` +
                       `Location: ${job.location || 'N/A'}\\n` +
                       `URL: ${job.url || '#'}\\n` + // Use the potentially cleaned URL
                       `Description: ${job.description || 'No description available.'}`; // Use the fetched description
            }).join('\\n\\n---\\n\\n');
            console.log(`Prepared context with ${jobsWithDescriptions.length} full job descriptions.`);
        } else {
            console.log("No valid job descriptions found to send to AI.");
            // Consider returning early or adjusting the prompt if no descriptions are available
        }
        // Optional: Add a check for context length if needed
        const MAX_CONTEXT_CHARS = 800000; // Estimate ~800k chars as a safe limit before hitting token issues
        if (allScrapedJobContext.length > MAX_CONTEXT_CHARS) {
            console.warn(`Context length (${allScrapedJobContext.length} chars) is very large, potentially exceeding limits. Truncating.`);
            allScrapedJobContext = allScrapedJobContext.substring(0, MAX_CONTEXT_CHARS) + "\\n\\n... (Context Truncated) ...";
            // Alternatively, could select a subset of jobs here instead of hard truncation
        }
        console.log(`Prepared context length: ${allScrapedJobContext.length} chars.`);
        console.timeEnd("step3_context_prep_duration");
        console.log("[POST Handler] Step 3 complete.");


        // === Step 4: Prepare Prompt for Gemini (Using ALL Scraped Context) ===
        console.log("[POST Handler] Starting Step 4: Prepare Gemini Prompt...");
        console.time("step4_prompt_prep_duration");
        console.log(`Context length for LLM: ${allScrapedJobContext.length} chars. Has Resume: ${hasResume}`);

        // --- UPDATED Prioritization Instructions (Reduce Job Count) ---
        const prioritizationInstruction = hasResume
            ? `Analyze the **Scraped Job Information provided below** and identify the most relevant jobs for the candidate based on their resume. **List the top 15 jobs, prioritizing the most promising ones first** based on the following factors:
              1.  **Strong Resume Match:** How well the **candidate's resume (provided below)** aligns with the job's core requirements (skills, experience). This is the primary factor.
              2.  **Potential Growth:** Roles that mention learning opportunities, clear career paths, exposure to new technologies, or significant project impact.
              3.  **Tech Stack Value:** Jobs utilizing modern, in-demand, or strategically valuable technologies.
              4.  **Job Function Value:** Roles offering valuable experience for career progression.

              **For each listed job (up to 15), provide a detailed analysis including the following, formatted EXACTLY as shown:**

              1. [Job Title](URL)
                  *   **Overall Fit & Potential:** (1-2 sentences explaining the core match based on resume AND highlighting the job's potential based on growth/tech/function value).
                  *   **Ratings (Estimate based on Description & Resume):**
                      *   **Resume-Skill Match:** [High/Medium/Low] - (Briefly justify based on resume alignment with stated requirements).
                      *   **Tech Stack Value:** [High/Medium/Low] - (Briefly justify why based on the modernity/demand for the listed technologies).
                      *   **Potential Growth:** [High/Medium/Low/Unclear] - (Briefly justify based on mentions of learning, project scope, or career path hints in the description).
                      *   **Job Function Value:** [High/Medium/Low] - (Briefly justify why the core tasks/responsibilities are strategically valuable for career progression in this field).
                      *   **Estimated Hiring Difficulty:** [High/Medium/Low] - (Briefly justify based on required experience level, niche skills, or market competitiveness).
                  *   **Key Alignment Points:** (2-3 bullet points highlighting resume skills/experience matching requirements OR positive aspects like growth/tech).
                  *   **Potential Gaps/Concerns:** (1-2 bullet points mentioning areas where the resume might fall short OR other considerations like required travel, niche domain).

              **Ensure the markdown link for the title is correctly formed using square brackets around the title and parentheses around the URL: [TITLE](URL).**
              Ensure there is a blank line (double newline in markdown) separating each complete numbered job analysis (including all its sub-points) from the next. **List up to 15 jobs if available and relevant.**
              **Important: Do NOT include any disclaimers about not being able to access external websites or analyze the provided text. Perform the analysis based SOLELY on the job descriptions and resume text given in this prompt. Do NOT add any concluding summary sentence after the final numbered job analysis.**
              Start this section *exactly* with "3. Job Prioritization (based on your resume & potential):".`
            : `Analyze the **Scraped Job Information provided below** and identify the most relevant jobs based on the user's query: "${userRoleQuery}". **List the top 15 jobs, prioritizing the most promising ones first** based on the following factors:
              1.  **Relevance to Query:** How well the job description aligns with the user's search query. This is the primary factor.
              2.  **Potential Growth:** Roles that mention learning opportunities, clear career paths, exposure to new technologies, or significant project impact.
              3.  **Tech Stack Value:** Jobs utilizing modern, in-demand, or strategically valuable technologies relevant to the query.
              4.  **Job Function Value:** Roles offering valuable experience for career progression in the query's field.

              **For each listed job (up to 15), provide a detailed analysis including the following, formatted EXACTLY as shown:**

              1. [Job Title](URL)
                  *   **Relevance & Potential:** (1-2 sentences explaining how the job description aligns with the query AND highlighting the job's potential based on growth/tech/function value).
                  *   **Ratings (Estimate based on Description):**
                      *   **Query-Skill Match:** [High/Medium/Low] - (Briefly justify based on alignment with the user query "${userRoleQuery}").
                      *   **Tech Stack Value:** [High/Medium/Low] - (Briefly justify why based on the modernity/demand for the listed technologies in the context of the query).
                      *   **Potential Growth:** [High/Medium/Low/Unclear] - (Briefly justify based on mentions of learning, project scope, or career path hints in the description).
                       *   **Job Function Value:** [High/Medium/Low] - (Briefly justify why the core tasks/responsibilities are strategically valuable for career progression in the field related to "${userRoleQuery}").
                  *   **Key Alignment Points:** (2-3 bullet points highlighting aspects matching the query OR positive aspects like growth/tech).
                  *   **Potential Considerations:** (1-2 bullet points mentioning factors a user might want to consider, e.g., required experience level, specific domain knowledge).

              **Ensure the markdown link for the title is correctly formed using square brackets around the title and parentheses around the URL: [TITLE](URL).**
              Ensure there is a blank line (double newline in markdown) separating each complete numbered job analysis (including all its sub-points) from the next. **List up to 15 jobs if available and relevant.**
               **Important: Do NOT include any disclaimers about not being able to access external websites or analyze the provided text. Perform the analysis based SOLELY on the job descriptions given in this prompt. Do NOT add any concluding summary sentence after the final numbered job analysis.**
              Start this section *exactly* with "3. Job Prioritization (based on query & potential):".`;
        // --- END UPDATED Prioritization Instructions ---

        // --- NEW: Define Market Insights Instruction ---
        const marketInsightsInstruction = `
          5.  **Overall Market Insights:** Based on all the preceding analysis (common skills, experience levels, job functions) from the provided job descriptions, provide a concise (3-5 sentence) summary of the current job market for a '${userRoleQuery}' in Hong Kong. Comment on the general demand level (implied by the number/types of jobs), the most critical skill areas to possess, and the typical experience range sought.
              Start this section *exactly* with "5. Overall Market Insights:".`;
        // --- END NEW ---

        // --- NEW: Define Detailed Market Trends Instruction ---
        const detailedTrendsInstruction = `
          6.  **Detailed Market Trends & Insights:** Analyze all provided job descriptions for '${userRoleQuery}' to identify broader trends:
              *   **Key Skill Clusters:** What technical or soft skills frequently appear together in job requirements? (List 2-3 common clusters).
              *   **Emerging vs. Core Skills:** Are there any skills mentioned that seem newer or more cutting-edge compared to consistently required core skills? (Mention 1-2 if apparent).
              *   **Role Variations:** Are there distinct types or specializations of '${userRoleQuery}' apparent from the descriptions (e.g., focus on research vs. implementation, specific industry applications)? (Mention 1-2 variations if clear).
              *   **Hiring Company Profile:** Based *only* on the job descriptions and company names provided, what types of companies (e.g., startups, large enterprises, finance, tech) seem to be hiring most actively for this role? (Briefly summarize).
              Present these findings clearly with bullet points under the relevant subheadings provided above.
              Start this section *exactly* with "6. Detailed Market Trends & Insights:".`;
        // --- END NEW ---

        // --- NEW: Define Competitive Landscape Instruction (Conditional) ---
        const competitiveLandscapeInstruction = hasResume
            ? `
          7.  **Competitive Landscape Analysis (Resume vs. Market):** Compare the provided **User's Resume Text** against the **Common Tech Stack** (Task 1) and **Experience Level Summary** (Task 4) derived from the job market analysis. Provide a concise (3-5 bullet points) assessment covering:
              *   **Overall Alignment:** How well does the candidate's profile generally align with the overall market demands identified?
              *   **Key Strengths vs. Market:** What specific skills/experiences from the resume are particularly strong assets in this market context?
              *   **Potential Competitive Gaps:** Where might the candidate face the strongest competition based on common market requirements identified in the stack/experience analysis (e.g., needing deeper experience in a core skill, lacking a frequently mentioned technology)?
              *   **Positioning Advice:** Briefly suggest how the candidate might position themselves effectively (e.g., emphasize specific niche skills, highlight relevant project experience).
              Focus on the comparison between the *individual resume* and the *aggregate market data*.
              Start this section *exactly* with "7. Competitive Landscape Analysis (Resume vs. Market):".`
            : ''; // Empty string if no resume provided
        // --- END NEW ---

        const prompt = `
          You are an expert AI Career Advisor analyzing the job market.
          Context:
          - User's target role/skill query: "${userRoleQuery}"
          ${hasResume ? `- User's Resume Text:\n"""\n${resumeText}\n"""` : ''}
          - The following ${jobsWithDescriptions.length} job descriptions (with URLs) were processed via a scraping service. **You have the full context needed for analysis below.**

          Tasks:
          Based *only* on the provided context...
          1.  **Common Tech Stack:**
              a. Analyze **all** the provided job descriptions below.
              b. Identify the key technologies, programming languages, frameworks, cloud platforms, databases, and core concepts mentioned.
              c. Group these skills into relevant categories (e.g., Languages, Frameworks/Libraries, Cloud, Databases, Concepts/Methodologies, Tools). Make the category names bold (**Category Name:**).
              d. List the skills under each category. For the **top 10-15 most prominent skills overall** across all categories, estimate the percentage (%) of the provided job descriptions that mention them and add it next to the skill (e.g., Java (~80%), Spring Boot (~60%)).
              e. Present the results clearly. Start this section *exactly* with "1. Common Tech Stack:".

          2.  **Suggested Project Ideas:** Suggest 2-3 specific, actionable project ideas suitable for a portfolio. **Base these suggestions primarily on the skills, technologies, and job functions required by the jobs you identify as most promising in the 'Job Prioritization' task (Task 3 below).** The projects should directly help demonstrate suitability for those prioritized roles.
              **Format each suggestion as: '1. **Project Title/Concept:** Brief description.'**
              **Ensure there is a blank line (double newline in markdown) separating each complete numbered item from the next.**
              Start this section *exactly* with "2. Suggested Project Ideas:".

          3.  **Job Prioritization:**
              ${prioritizationInstruction}

          4.  **Experience Level Summary:** Analyze required years of experience (e.g., 'X+ years', 'minimum Y years', 'fresh graduates') mentioned across **all** the provided job descriptions. Summarize typical levels sought (e.g., 'Mostly Mid-Level (3-7 years)', 'Mix of Junior and Senior', 'Entry-Level focus'). If rarely mentioned, state that.
              Start this section *exactly* with "4. Experience Level Summary:".

          5.  **Overall Market Insights:**
              ${marketInsightsInstruction}

          6.  **Detailed Market Trends & Insights:**
              ${detailedTrendsInstruction}

          ${competitiveLandscapeInstruction}

          --- Scraped Job Information (Processed: ${jobsWithDescriptions.length}) ---
          ${allScrapedJobContext}
          --- END Scraped Job Information ---

          Analysis Output:
        `;


        // === Step 5: Call Gemini API ===
        console.log("[POST Handler] Starting Step 5: Call Gemini API...");
        console.time("step5_gemini_call_duration"); // Renamed from geminiApiCallLargeContext for consistency
        const requestBody = { contents: [{ parts: [{ "text": prompt }] }] };
        const geminiApiResponse = await fetch(geminiApiUrlWithKey, {
             method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody),
        });
        console.timeEnd("step5_gemini_call_duration");
        console.log(`[POST Handler] Step 5 complete. Gemini Status: ${geminiApiResponse.status}`);
        const rawResponseText = await geminiApiResponse.text();


        // === Step 6: Parse Gemini Response ===
        console.log("[POST Handler] Starting Step 6: Parse Gemini Response...");
        console.time("step6_gemini_parse_duration");
        let analysisText = '';
         try {
             if (!geminiApiResponse.ok) {
                 console.error("Gemini API Error Raw Response:", rawResponseText);
                 throw new Error(`Gemini API error (${geminiApiResponse.status}): ${geminiApiResponse.statusText}. Check logs for details.`);
             }
             if (rawResponseText && rawResponseText.trim().startsWith('{')) {
                 const geminiResponseData = JSON.parse(rawResponseText);
                 const blockReason = geminiResponseData.promptFeedback?.blockReason;
                 if (blockReason) {
                     console.error(`Gemini request blocked by safety settings: ${blockReason}`);
                     throw new Error(`Request blocked by safety settings: ${blockReason}`);
                 }
                 const finishReason = geminiResponseData.candidates?.[0]?.finishReason;
                  if (finishReason && !['STOP', 'MAX_TOKENS'].includes(finishReason)) {
                      console.error(`Gemini generation finished unexpectedly: ${finishReason}`);
                  }
                  analysisText = geminiResponseData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
              } else {
                  console.warn("Received non-JSON success response from Gemini:", rawResponseText.substring(0, 200));
                  analysisText = rawResponseText;
              }
         } catch (e: unknown) {
              console.error("Error processing Gemini response:", e);
              const message = e instanceof Error ? e.message : 'Failed to process AI response';
              return NextResponse.json({ error: message }, { status: 500 });
         }
        console.timeEnd("step6_gemini_parse_duration");
        console.log("[POST Handler] Step 6 complete.");

        if (!analysisText) { console.error("Gemini response text empty after processing."); return NextResponse.json({ error: 'Received empty analysis from AI.' }, { status: 500 }); }

        console.log("--- Full Gemini Analysis Text ---");
        console.log(analysisText);
        console.log("--- End Gemini Analysis Text ---");

        // --- Parsing Logic ---
        let commonStack = "Could not parse stack from analysis.";
        let projectIdeas = "Could not parse projects from analysis.";
        let jobPrioritization = "Could not parse prioritization.";
        let experienceSummary = "Could not parse experience summary.";
        let marketInsights = "Could not parse market insights.";
        let detailedTrends = "Could not parse detailed trends.";
        let competitiveLandscape = "Competitive analysis requires a resume.";

        // Define Markers (More Flexible)
        const stackMarker = /^\s*1\.\s+Common Tech Stack:/mi;
        const projectMarker = /^\s*2\.\s+Suggested Project Ideas:/mi;
        const priorityMarker = /^\s*3\.\s+Job Prioritization\s*\(based on (?:your resume|query)\s*(?:(?:&|and)\s*potential)?\):/mi;
        const experienceMarker = /^\s*4\.\s+Experience Level Summary:/mi;
        // Allow potential variations in numbering or leading whitespace for insights/trends/landscape
        const insightsMarker = /^\s*\d*\.?\s*Overall Market Insights:/mi; // Optional number & dot
        const trendsMarker = /^\s*\d*\.?\s*Detailed Market Trends & Insights:/mi; // Optional number & dot
        const landscapeMarker = /^\s*\d*\.?\s*Competitive Landscape Analysis\s*\(Resume vs\. Market\):/mi; // Optional number & dot

        // Match Markers
        const stackMatch = analysisText.match(stackMarker);
        const projectMatch = analysisText.match(projectMarker);
        const priorityMatch = analysisText.match(priorityMarker);
        const experienceMatch = analysisText.match(experienceMarker);
        const insightsMatch = analysisText.match(insightsMarker); // Use updated marker
        const trendsMatch = analysisText.match(trendsMarker);     // Use updated marker
        const landscapeMatch = hasResume ? analysisText.match(landscapeMarker) : null; // Use updated marker

        // Log Match Results
        console.log("Marker Match Results:", {
           stack: stackMatch ? `Found at index ${stackMatch.index}` : "Not Found",
           project: projectMatch ? `Found at index ${projectMatch.index}` : "Not Found",
           priority: priorityMatch ? `Found at index ${priorityMatch.index}` : "Not Found",
           experience: experienceMatch ? `Found at index ${experienceMatch.index}` : "Not Found",
           insights: insightsMatch ? `Found at index ${insightsMatch.index}` : "Not Found",
           trends: trendsMatch ? `Found at index ${trendsMatch.index}` : "Not Found",
           landscape: landscapeMatch ? `Found at index ${landscapeMatch.index}` : (hasResume ? "Not Found" : "Not Applicable (No Resume)")
        });

        // Calculate Indices
        const stackIdx = stackMatch?.index ?? -1;
        const projectIdx = projectMatch?.index ?? -1;
        const priorityIdx = priorityMatch?.index ?? -1;
        const experienceIdx = experienceMatch?.index ?? -1;
        const insightsIdx = insightsMatch?.index ?? -1;
        const trendsIdx = trendsMatch?.index ?? -1;
        const landscapeIdx = landscapeMatch?.index ?? -1;

        // Calculate Content Start Points
        const calculateContentStart = (match: RegExpMatchArray | null, index: number): number => {
            if (!match || index === -1) return -1;
            const endOfMarker = index + match[0].length;
            const nextNewline = analysisText.indexOf('\n', endOfMarker);
            return nextNewline !== -1 ? nextNewline + 1 : endOfMarker;
        };
        const stackContentStart = calculateContentStart(stackMatch, stackIdx);
        const projectContentStart = calculateContentStart(projectMatch, projectIdx);
        const priorityContentStart = calculateContentStart(priorityMatch, priorityIdx);
        const experienceContentStart = calculateContentStart(experienceMatch, experienceIdx);
        const insightsContentStart = calculateContentStart(insightsMatch, insightsIdx);
        const trendsContentStart = calculateContentStart(trendsMatch, trendsIdx);
        const landscapeContentStart = calculateContentStart(landscapeMatch, landscapeIdx);

        // Sort sections found
        const sections = [
            { name: 'stack', index: stackIdx, contentStart: stackContentStart },
            { name: 'project', index: projectIdx, contentStart: projectContentStart },
            { name: 'priority', index: priorityIdx, contentStart: priorityContentStart },
            { name: 'experience', index: experienceIdx, contentStart: experienceContentStart },
            { name: 'insights', index: insightsIdx, contentStart: insightsContentStart },
            { name: 'trends', index: trendsIdx, contentStart: trendsContentStart },
            ...(landscapeIdx !== -1 && landscapeContentStart !== -1 ? [{ name: 'landscape', index: landscapeIdx, contentStart: landscapeContentStart }] : [])
        ].filter(s => s.index !== -1 && s.contentStart !== -1).sort((a, b) => a.index - b.index);

        console.log("Found & Sorted Sections for Parsing:", sections.map(s => s.name));

        // Extract section text
        if (hasResume) competitiveLandscape = "Could not parse competitive analysis.";
        for (let i = 0; i < sections.length; i++) {
            const currentSection = sections[i];
            const nextSection = sections[i + 1];
            const contentStartIndex = currentSection.contentStart;
            const contentEndIndex = nextSection ? nextSection.index : undefined;
            const sectionText = analysisText.substring(contentStartIndex, contentEndIndex).trim();

            console.log(`\n--- Extracted Section: ${currentSection.name} ---`);
            console.log(`Start Index: ${contentStartIndex}, End Index: ${contentEndIndex ?? 'EOF'}`);
            console.log(`Extracted Text Length: ${sectionText.length}`);
            console.log(`Text Preview: ${sectionText.substring(0, 100)}...`);
            console.log(`--- End Extracted Section: ${currentSection.name} ---\n`);

            if (currentSection.name === 'stack') commonStack = sectionText || commonStack;
            else if (currentSection.name === 'project') projectIdeas = sectionText || projectIdeas;
            else if (currentSection.name === 'priority') jobPrioritization = sectionText || jobPrioritization;
            else if (currentSection.name === 'experience') experienceSummary = sectionText || experienceSummary;
            else if (currentSection.name === 'insights') marketInsights = sectionText || marketInsights;
            else if (currentSection.name === 'trends') detailedTrends = sectionText || detailedTrends;
            else if (currentSection.name === 'landscape') competitiveLandscape = sectionText || competitiveLandscape;
        }
        // --- End of Parsing Logic ---

        // === Step 7: Return Combined Results ===
        // Return ALL originally scraped jobs for the frontend list
        const allJobLinksForFrontend = scrapedJobResults.map(job => ({
            title: job.title || 'Scraped Job',
            url: job.url || '#',
            snippet: job.description && !job.description.startsWith('Failed') && !job.description.startsWith('No URL')
                ? job.description.substring(0, 150) + '...'
                : `Company: ${job.company_name || 'N/A'} | Location: ${job.location || 'N/A'} (Description fetch issues)`.substring(0,150),
            description: job.description || 'No description available.',
            company_name: job.company_name || undefined,
            location: job.location || undefined
        }));

         // Final Log Before Returning
         console.log("Data being returned to frontend:", {
             jobListingsCount: allJobLinksForFrontend.length,
             commonStackLength: commonStack.length,
             projectIdeasLength: projectIdeas.length,
             jobPrioritizationLength: jobPrioritization.length,
             experienceSummaryLength: experienceSummary.length,
             marketInsightsLength: marketInsights.length,
             detailedTrendsLength: detailedTrends.length,
             competitiveLandscapeLength: hasResume ? competitiveLandscape.length : "N/A",
             topCompaniesCount: topCompanies.length,
             topLocationsCount: topLocations.length,
             commonStackParsed: !commonStack.startsWith("Could not parse"),
             projectIdeasParsed: !projectIdeas.startsWith("Could not parse"),
             jobPrioritizationParsed: !jobPrioritization.startsWith("Could not parse"),
             experienceSummaryParsed: !experienceSummary.startsWith("Could not parse"),
             marketInsightsParsed: !marketInsights.startsWith("Could not parse"),
             detailedTrendsParsed: !detailedTrends.startsWith("Could not parse"),
             competitiveLandscapeParsed: hasResume ? !competitiveLandscape.startsWith("Could not parse") : "N/A",
         });

        console.timeEnd("job_analysis_POST_total");
        return NextResponse.json({
            jobListings: allJobLinksForFrontend,
            commonStack: commonStack,
            projectIdeas: projectIdeas,
            jobPrioritization: jobPrioritization,
            experienceSummary: experienceSummary,
            marketInsights: marketInsights,
            detailedTrends: detailedTrends,
            competitiveLandscape: hasResume ? competitiveLandscape : null,
            topCompanies: topCompanies,
            topLocations: topLocations,
            analysisDisclaimer: `Note: Stats from ${scrapedJobResults.length} initial listings processed via ScrapingBee. AI analysis prioritizes jobs based on fit and potential using ${jobsWithDescriptions.length} successfully fetched descriptions. Verify details.`,
        });

    } catch (error: unknown) {
        console.error("API Route General Error:", error);
        const message = error instanceof Error ? error.message : String(error);
        const errorMessage = `An internal server error occurred: ${message}`;
        console.timeEnd("job_analysis_POST_total");
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}