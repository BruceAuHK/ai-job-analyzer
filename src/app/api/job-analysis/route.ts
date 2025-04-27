// src/app/api/job-analysis/route.ts
import { NextRequest, NextResponse } from 'next/server';
import chromium from '@sparticuz/chromium';
import puppeteer, { Browser, Page } from 'puppeteer-core';

// Gemini API Details
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Use the smaller context Flash model again
const GEMINI_MODEL_NAME = "gemini-2.0-flash"; // Changed back from gemini-1.5-flash-latest

// Check API Key at startup (optional)
if (!GEMINI_API_KEY) {
  console.error("Startup Warning: Missing GEMINI_API_KEY environment variable.");
}

// --- Helper: Add delay ---
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- Define Interfaces (Optional but Recommended) ---
interface ScrapedJob {
    title: string | null;
    company_name: string | null;
    location: string | null;
    url: string | null;
    description: string | null; // Allow null initially
}

interface StatItem { name: string; count: number; } // Reuse or define globally

// --- Web Scraping Function for JobsDB HK (Ensure it gets full descriptions) ---
async function scrapeJobsDB_HK(query: string): Promise<ScrapedJob[]> {
    let browser: Browser | null = null;
    const allJobsData: ScrapedJob[] = [];
    const jobsDbBaseUrl = 'https://hk.jobsdb.com';
    const jobsDbSearchUrl = 'https://hk.jobsdb.com/hk/en/Search/FindJobs';
    const maxPagesToScrape = 3; // Limit pagination pages
    const detailLimitPerPageScrape = 100; // Limit description scraping

    // Selectors (Verify these regularly!)
    const KEYWORDS_INPUT_SELECTOR = '#keywords-input';
    const SEARCH_BUTTON_SELECTOR = 'button[data-automation="searchButton"]';
    const JOB_CARD_SELECTOR = 'article[data-automation="normalJob"]';
    const JOB_TITLE_SELECTOR_LIST = '[data-automation="jobTitle"]';
    const JOB_COMPANY_SELECTOR_LIST = '[data-automation="jobCompany"]';
    const JOB_LOCATION_SELECTOR_LIST = '[data-automation="jobLocation"]';
    const JOB_LINK_SELECTOR_LIST = 'a[data-automation="jobTitle"], a[data-automation="job-list-item-link-overlay"]';
    // Use a more general selector for description as layout might vary
    const JOB_DESCRIPTION_SELECTOR_DETAIL = 'div[data-automation="jobAdDetails"], #jobDescription'; // Added fallback ID
    const NEXT_PAGE_SELECTOR = 'a[aria-label="Next"]:not([aria-hidden="true"])';

    let currentPage = 1;

    try {
        console.log(`Launching browser for JobsDB scraping query: ${query}`);
        // Get executable path from @sparticuz/chromium
        const executablePath = await chromium.executablePath();

        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: executablePath,
            // Defaulting to true headless mode due to type inconsistencies with chromium.headless
            headless: true
        });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'); // Generic User Agent
        page.setDefaultNavigationTimeout(90000); // 90 seconds timeout

        // Part 1: Initial Search (Same as before)
        console.log(`Navigating to: ${jobsDbSearchUrl}`);
        await page.goto(jobsDbSearchUrl, { waitUntil: 'networkidle2' });
        console.log(`Waiting for input selector: ${KEYWORDS_INPUT_SELECTOR}`);
        await page.waitForSelector(KEYWORDS_INPUT_SELECTOR, { timeout: 25000, visible: true });
        await page.evaluate((sel) => { const el = document.querySelector(sel) as HTMLInputElement; if(el) el.value = "" }, KEYWORDS_INPUT_SELECTOR);
        await page.type(KEYWORDS_INPUT_SELECTOR, query, { delay: 100 });
        console.log(`Typed "${query}" into input.`);
        console.log(`Waiting for search button selector: ${SEARCH_BUTTON_SELECTOR}`);
        await page.waitForSelector(SEARCH_BUTTON_SELECTOR, { timeout: 10000, visible: true });
        console.log(`Clicking search button.`);
        await Promise.all([
             page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => console.warn("Navigation after search click didn't fully idle, proceeding...")),
             page.click(SEARCH_BUTTON_SELECTOR)
         ]);
         console.log(`Current URL after search: ${page.url()}`);
         console.log(`Waiting for job cards: ${JOB_CARD_SELECTOR}`);
         try {
             await page.waitForSelector(JOB_CARD_SELECTOR, { timeout: 40000, visible: true });
        console.log("Initial job cards selector found.");
         } catch {
             console.error(`Job cards selector (${JOB_CARD_SELECTOR}) not found after search. Scraping might fail. Page content snippet:`, await page.content().then(c => c.substring(0, 500)));
             throw new Error("Job cards not found after search.");
         }
         await delay(2000); // Wait for potential lazy loading

        // Part 2: Scrape Pages Loop (Same as before)
        while (currentPage <= maxPagesToScrape) {
            console.log(`--- Scraping Page ${currentPage} ---`);
            const pageJobs: ScrapedJob[] = await page.$$eval(JOB_CARD_SELECTOR, (cards, selectors, pageNum) => {
                 // ... (inner logic for extracting title, company, location, url remains the same) ...
                const jobs: ScrapedJob[] = [];
                 cards.forEach((card, index) => {
                    const titleEl = card.querySelector(selectors.titleSel);
                    const companyEl = card.querySelector(selectors.companySel);
                    const locationEl = card.querySelector(selectors.locationSel);
                    const linkEl = card.querySelector(selectors.linkSel);
                    const title = titleEl?.textContent?.trim() || null;
                    const company = companyEl?.textContent?.trim() || null;
                    const location = locationEl?.textContent?.trim() || locationEl?.parentElement?.textContent?.trim() || null;
                    const relativeUrl = linkEl?.getAttribute('href') || null;
                    let url = null;
                    try { if (relativeUrl) { url = new URL(relativeUrl, selectors.baseUrl).href; } }
                    catch(e) { console.error(`[Page Eval ${pageNum}] Error creating URL: ${relativeUrl}`, e); }
                    if (title && url) { // Require at least title and URL
                        jobs.push({ title, company_name: company, location, url, description: null });
                    } else {
                        console.log(`[Page Eval ${pageNum}] Skipping card ${index + 1}, missing essential data (title: ${!!title}, url: ${!!url}).`);
                    }
                });
                return jobs;
            }, {
                baseUrl: jobsDbBaseUrl, itemSel: JOB_CARD_SELECTOR, titleSel: JOB_TITLE_SELECTOR_LIST,
                companySel: JOB_COMPANY_SELECTOR_LIST, locationSel: JOB_LOCATION_SELECTOR_LIST, linkSel: JOB_LINK_SELECTOR_LIST
             }, currentPage);

            console.log(`Found ${pageJobs.length} jobs on page ${currentPage}.`);
            allJobsData.push(...pageJobs);

            // Pagination logic (Same as before)
            const nextButton = await page.$(NEXT_PAGE_SELECTOR);
            if (nextButton && currentPage < maxPagesToScrape) {
                console.log(`Found 'Next' button. Clicking for page ${currentPage + 1}...`);
                try {
                    await Promise.all([
                        nextButton.click(),
                         page.waitForSelector(JOB_CARD_SELECTOR, { timeout: 45000, visible: true }).catch(() => console.warn("Wait for selector after 'Next' click failed or timed out."))
                    ]);
                     await delay(3000 + Math.random() * 1000); // Increased delay after page load
                     console.log(`Navigated to page ${currentPage + 1}`);
                    currentPage++;
                } catch(navError: unknown) {
                     // Type check before accessing properties
                     const message = navError instanceof Error ? navError.message : String(navError);
                     console.error(`Error clicking 'Next' or waiting for page ${currentPage + 1}: ${message}`);
                     break;
                }
            } else {
                 if (currentPage >= maxPagesToScrape) console.log(`Reached page limit (${maxPagesToScrape}).`);
                 else console.log("'Next' button not found or not active.");
                 break;
            }
        }

        console.log(`Finished list pages. Total basic job entries: ${allJobsData.length}. Scraping descriptions...`);

        // --- Part 3: Scrape Descriptions ---
        const jobsWithUrls = allJobsData.filter(job => job.url);
        const totalJobsToDescribe = Math.min(jobsWithUrls.length, detailLimitPerPageScrape);
        console.log(`Attempting to fetch descriptions for up to ${totalJobsToDescribe} jobs with valid URLs.`);

        // --- Parallel Scraping Implementation ---
        const CONCURRENCY_LIMIT = 30; // Keep concurrency high for scraping phase
        let detailedJobsProcessed = 0;

        for (let i = 0; i < totalJobsToDescribe; i += CONCURRENCY_LIMIT) {
            const batchUrls = jobsWithUrls.slice(i, i + CONCURRENCY_LIMIT);
            console.log(`--- Scraping description batch ${i / CONCURRENCY_LIMIT + 1} (Jobs ${i + 1} to ${Math.min(i + CONCURRENCY_LIMIT, totalJobsToDescribe)}) ---`);

            const promises = batchUrls.map(async (job, index) => {
                let detailPage: Page | null = null;
                const jobIndexInTotal = i + index; // Index relative to the totalJobsToDescribe

                // --- NEW: Check if browser is available --- 
                if (!browser) {
                    console.error(` -> Browser instance not available for job: ${job.title}`);
                    return {
                        url: job.url,
                        description: 'Failed: Browser not initialized.',
                        success: false
                    };
                }
                // --- END NEW Check --- 

                try {
                    console.log(` -> Starting detail ${jobIndexInTotal + 1}/${totalJobsToDescribe}: ${job.title?.substring(0, 30) || ''}...`);
                    detailPage = await browser!.newPage(); // <-- Added non-null assertion
                    await detailPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

                    // --- NEW: Check if job.url is valid before goto ---
                    if (!job.url) {
                        console.error(` -> Skipping job due to missing URL: ${job.title}`);
                        throw new Error('Missing URL for job detail scrape'); // Throw to be caught below
                    }
                    // --- END NEW Check ---

                    await detailPage.goto(job.url, { waitUntil: 'networkidle2', timeout: 60000 });

                    const descriptionSelector = await detailPage.waitForSelector(`${JOB_DESCRIPTION_SELECTOR_DETAIL}, #jobDescription`, { timeout: 25000, visible: true });
                    // --- UPDATED: Assert el as HTMLElement --- 
                    const description = await descriptionSelector?.evaluate(el => (el as HTMLElement).innerText || el.textContent);

                    // Return the description and the original URL to match later
                    return {
                        url: job.url,
                        description: description?.replace(/\s+/g, ' ').trim() || 'Could not extract description.',
                        success: true
                    };

                } catch (detailError: unknown) {
                    // Type check error before accessing properties
                    const message = detailError instanceof Error ? detailError.message : String(detailError);
                    console.error(` -> Failed desc scrape for ${job.title}: ${message}`);
                    // Return failure status
                    return {
                        url: job.url,
                        description: 'Failed/Timed out loading description.',
                        success: false
                    };
                } finally {
                    if (detailPage) await detailPage.close();
                    // Optional small delay between starting scrapes in the *next* batch
                    // await delay(50); // e.g., wait 50ms before launching the next promise in the map (if needed)
                }
            });

            // Wait for all promises in the current batch to settle (either succeed or fail)
            const results = await Promise.allSettled(promises);

            // Process results and update the main allJobsData array
            results.forEach(result => {
                if (result.status === 'fulfilled' && result.value) {
                    const { url, description, success } = result.value as { url: string | null, description: string, success: boolean };
                    const originalJobIndex = allJobsData.findIndex(j => j.url === url);
                    if (originalJobIndex !== -1) {
                        allJobsData[originalJobIndex].description = description;
                        if (success) {
                           console.log(` -> Success batch update for ${allJobsData[originalJobIndex].title?.substring(0, 30) || ''} Desc length: ${description.length}`);
                        } else {
                           console.log(` -> Failed batch update for ${allJobsData[originalJobIndex].title?.substring(0, 30) || ''}`);
                        }
                    } else {
                        console.warn(` -> Batch: Could not find original job entry for URL: ${url}`);
                    }
                } else if (result.status === 'rejected') {
                    // Should ideally be caught within the promise, but handle here just in case
                     console.error(" -> Uncaught promise rejection in scraping batch:", result.reason);
                }
            });
            detailedJobsProcessed += batchUrls.length;
             console.log(`--- Finished description batch ${i / CONCURRENCY_LIMIT + 1}. Processed ${detailedJobsProcessed}/${totalJobsToDescribe} ---`);
             // Add a delay between batches if needed to prevent getting blocked
             if (i + CONCURRENCY_LIMIT < totalJobsToDescribe) {
                 await delay(1000 + Math.random() * 500); // Wait 1-1.5 seconds before next batch
             }
        }
        // --- End Parallel Scraping ---

    } catch (error: unknown) {
        // Type check error before accessing properties
        const message = error instanceof Error ? error.message : String(error);
        console.error("Scraping function error:", message);
        // Don't reset allJobsData here, return what was collected
    } finally {
        if (browser) {
            console.log("Closing browser...");
            await browser.close();
            console.log("Browser closed.");
        }
    }
    return allJobsData;
}
// --- End Web Scraping Function ---

// --- API Route Handler ---
export async function POST(request: NextRequest) {
    // --- Vector DB / RAG Code Removed ---

    const currentApiKey = process.env.GEMINI_API_KEY;
    if (!currentApiKey) { return NextResponse.json({ error: 'Server config error: Missing API Key.' }, { status: 500 }); }
    // Construct URL using the large-context Flash model
    const geminiApiUrlWithKey = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_NAME}:generateContent?key=${currentApiKey}`;

    let scrapedJobResults: ScrapedJob[] = [];
    let topCompanies: StatItem[] = [];
    let topLocations: StatItem[] = [];

    try {
        // Destructure potential resumeText from the body
        const { userRoleQuery, resumeText } = await request.json();

        if (typeof userRoleQuery !== 'string' || !userRoleQuery.trim()) { return NextResponse.json({ error: 'Invalid input: Missing userRoleQuery.' }, { status: 400 }); }
        // resumeText is optional, so no strict check needed unless you want to enforce it
        const hasResume = typeof resumeText === 'string' && resumeText.trim().length > 0;
        console.log(`Received analysis request for: "${userRoleQuery}" ${hasResume ? 'WITH resume' : 'without resume'}. Bypassing RAG.`);

        // === Step 1: Execute Web Scraping ===
        scrapedJobResults = await scrapeJobsDB_HK(userRoleQuery);
        console.log(`Scraping finished. Found ${scrapedJobResults.length} basic job entries.`);
        const jobsWithDescriptions = scrapedJobResults.filter(j =>
            j.url && j.description && !j.description.includes('Failed') && !j.description.includes('Could not')
        );
        console.log(`Found ${jobsWithDescriptions.length} jobs with successfully scraped descriptions.`);

        // === Step 2: Calculate Statistics (from all scraped jobs) ===
        // This remains the same, calculated from the full scrape
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

        // === Step 3: Prepare Job Context for LLM (No RAG) ===
        // Format all successfully scraped jobs with descriptions
        let allScrapedJobContext = 'No job details available for analysis.';
        if (jobsWithDescriptions.length > 0) {
            allScrapedJobContext = jobsWithDescriptions.map((job, index) => {
                return `Job ${index + 1}:\n` + // Simplified identifier
                       `Title: ${job.title || 'N/A'}\n` +
                       `Company: ${job.company_name || 'N/A'}\n` + // Include company
                       `Location: ${job.location || 'N/A'}\n` + // Include location
                       `URL: ${job.url || '#'}\n` +
                       `Description: ${job.description || 'No description available.'}`;
            }).join('\n\n---\n\n');
        }
        console.log(`Prepared context with ${jobsWithDescriptions.length} full job descriptions.`);
        // Optional: Add a check for context length if needed
        const MAX_CONTEXT_CHARS = 800000; // Estimate ~800k chars as a safe limit before hitting token issues
        if (allScrapedJobContext.length > MAX_CONTEXT_CHARS) {
            console.warn(`Context length (${allScrapedJobContext.length} chars) is very large, potentially exceeding limits. Truncating.`);
            allScrapedJobContext = allScrapedJobContext.substring(0, MAX_CONTEXT_CHARS) + "\n\n... (Context Truncated) ...";
            // Alternatively, could select a subset of jobs here instead of hard truncation
        }


        // === Step 4: Prepare Prompt for Gemini (Using ALL Scraped Context) ===
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
          - The following ${jobsWithDescriptions.length} job descriptions (with URLs) were scraped from the search results page(s). **You have the full context needed for analysis below.**

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

          --- Scraped Job Information (Found: ${jobsWithDescriptions.length}) ---
          ${allScrapedJobContext}
          --- END Scraped Job Information ---

          Analysis Output:
        `;


        // === Step 5: Call Gemini API ===
        console.log(`Sending analysis prompt to Gemini (${GEMINI_MODEL_NAME}) ${hasResume ? 'with resume context' : ''} (Non-RAG)`); // Updated log
        console.time("geminiApiCallLargeContext");
        const requestBody = { contents: [{ parts: [{ "text": prompt }] }] };
        const geminiApiResponse = await fetch(geminiApiUrlWithKey, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody),
        });
        console.timeEnd("geminiApiCallLargeContext");
        console.log(`Gemini API Response Status: ${geminiApiResponse.status} ${geminiApiResponse.statusText}`);
        const rawResponseText = await geminiApiResponse.text();


        // === Step 6: Parse Gemini Response ===
        let analysisText = '';
        try {
            // Check for non-JSON errors first
             if (!geminiApiResponse.ok) {
                 console.error("Gemini API Error Raw Response:", rawResponseText);
                 throw new Error(`Gemini API error (${geminiApiResponse.status}): ${geminiApiResponse.statusText}. Check logs for details.`);
             }
             // Attempt to parse JSON
             if (rawResponseText && rawResponseText.trim().startsWith('{')) {
                 const geminiResponseData = JSON.parse(rawResponseText);
                 // Check for safety blocks or other API-level errors reported in JSON
                 const blockReason = geminiResponseData.promptFeedback?.blockReason;
                 if (blockReason) {
                     console.error(`Gemini request blocked by safety settings: ${blockReason}`);
                     throw new Error(`Request blocked by safety settings: ${blockReason}`);
                 }
                 const finishReason = geminiResponseData.candidates?.[0]?.finishReason;
                  if (finishReason && !['STOP', 'MAX_TOKENS'].includes(finishReason)) { // Allow MAX_TOKENS
                      console.error(`Gemini generation finished unexpectedly: ${finishReason}`);
                      // Potentially throw, or just log and try to extract partial text
                  }
                  analysisText = geminiResponseData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
              } else {
                  // Handle unexpected non-JSON success response? Very unlikely.
                  console.warn("Received non-JSON success response from Gemini:", rawResponseText.substring(0, 200));
                  analysisText = rawResponseText; // Use raw text if parse fails but status was OK?
              }
         } catch (e: unknown) {
              console.error("Error processing Gemini response:", e);
              // Type check error before accessing properties
              const message = e instanceof Error ? e.message : 'Failed to process AI response';
              return NextResponse.json({ error: message }, { status: 500 });
         }


        if (!analysisText) { console.error("Gemini response text empty after processing."); return NextResponse.json({ error: 'Received empty analysis from AI.' }, { status: 500 }); }

        console.log("--- Full Gemini Analysis Text ---");
        console.log(analysisText); // Ensure this is uncommented
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
           landscape: landscapeMatch ? `Found at index ${landscapeMatch.index}` : (hasResume ? "Not Found" : "Not Applicable (No Resume)") // <-- NEW Log
        });

        // Calculate Indices
        const stackIdx = stackMatch?.index ?? -1;
        const projectIdx = projectMatch?.index ?? -1;
        const priorityIdx = priorityMatch?.index ?? -1;
        const experienceIdx = experienceMatch?.index ?? -1;
        const insightsIdx = insightsMatch?.index ?? -1;
        const trendsIdx = trendsMatch?.index ?? -1;
        const landscapeIdx = landscapeMatch?.index ?? -1; // <-- NEW Index

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
        const landscapeContentStart = calculateContentStart(landscapeMatch, landscapeIdx); // <-- NEW Content Start

        // Sort sections found
        const sections = [
            { name: 'stack', index: stackIdx, contentStart: stackContentStart },
            { name: 'project', index: projectIdx, contentStart: projectContentStart },
            { name: 'priority', index: priorityIdx, contentStart: priorityContentStart },
            { name: 'experience', index: experienceIdx, contentStart: experienceContentStart },
            { name: 'insights', index: insightsIdx, contentStart: insightsContentStart },
            { name: 'trends', index: trendsIdx, contentStart: trendsContentStart },
            // Conditionally add landscape section only if the marker was found
             ...(landscapeIdx !== -1 && landscapeContentStart !== -1 ? [{ name: 'landscape', index: landscapeIdx, contentStart: landscapeContentStart }] : [])
        ].filter(s => s.index !== -1 && s.contentStart !== -1).sort((a, b) => a.index - b.index);

        console.log("Found & Sorted Sections for Parsing:", sections.map(s => s.name));

        // Extract section text
        if (hasResume) competitiveLandscape = "Could not parse competitive analysis."; // Reset default if resume exists but parsing fails
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
            else if (currentSection.name === 'landscape') competitiveLandscape = sectionText || competitiveLandscape; // <-- NEW Assignment
        }
        // --- End of Parsing Logic ---

        // === Step 7: Return Combined Results ===
        // Return ALL originally scraped jobs for the frontend list
        const allJobLinksForFrontend = scrapedJobResults.map(job => ({
            title: job.title || 'Scraped Job',
            url: job.url || '#',
            // Keep snippet for potential card display, but add full description
            snippet: job.description && !job.description.includes('Failed') && !job.description.includes('Could not')
                ? job.description.substring(0, 150) + '...'
                : `${job.company_name || ''} - ${job.location || ''}`.substring(0, 150),
            description: job.description || 'No description available.', // ADD FULL DESCRIPTION
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
             competitiveLandscapeLength: hasResume ? competitiveLandscape.length : "N/A", // <-- NEW Log item
             topCompaniesCount: topCompanies.length,
             topLocationsCount: topLocations.length,
             commonStackParsed: !commonStack.startsWith("Could not parse"),
             projectIdeasParsed: !projectIdeas.startsWith("Could not parse"),
             jobPrioritizationParsed: !jobPrioritization.startsWith("Could not parse"),
             experienceSummaryParsed: !experienceSummary.startsWith("Could not parse"),
             marketInsightsParsed: !marketInsights.startsWith("Could not parse"),
             detailedTrendsParsed: !detailedTrends.startsWith("Could not parse"),
             competitiveLandscapeParsed: hasResume ? !competitiveLandscape.startsWith("Could not parse") : "N/A", // <-- NEW Log item
         });

        return NextResponse.json({
            jobListings: allJobLinksForFrontend,
            commonStack: commonStack,
            projectIdeas: projectIdeas,
            jobPrioritization: jobPrioritization,
            experienceSummary: experienceSummary,
            marketInsights: marketInsights,
            detailedTrends: detailedTrends,
            competitiveLandscape: hasResume ? competitiveLandscape : null, // <-- NEW Field (null if no resume)
            topCompanies: topCompanies,
            topLocations: topLocations,
            analysisDisclaimer: `Note: Stats from ${scrapedJobResults.length} scraped jobs. AI analysis prioritizes jobs based on fit and potential using ${jobsWithDescriptions.length} full descriptions sent directly to the model. Verify details.`,
        });

    } catch (error: unknown) {
        console.error("API Route General Error:", error);
        // Type check error before accessing properties
        const message = error instanceof Error ? error.message : String(error);
        const errorMessage = `An internal server error occurred: ${message}`;
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}