// src/app/api/job-analysis/route.ts
import { NextRequest, NextResponse } from 'next/server';
import puppeteer, { Browser, Page } from 'puppeteer';
import path from 'path'; // Needed for resolving DB path
import { getVectorDbCollection, generateEmbedding, generateEmbeddingsBatch } from '@/utils/vectorDb'; // Import the utility

// --- RAG Imports ---
// Use dynamic imports within the async function to potentially improve startup time
// import { ChromaClient } from 'chromadb';
// import { pipeline } from '@xenova/transformers';
// ---

// Gemini API Details
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL_NAME = "gemini-2.0-flash"; // Reverted back to 2.0-flash

// Check API Key at startup (optional)
if (!GEMINI_API_KEY) {
  console.error("Startup Warning: Missing GEMINI_API_KEY environment variable.");
}

// --- Helper: Add delay ---
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- Web Scraping Function for JobsDB HK (Ensure it gets full descriptions) ---
async function scrapeJobsDB_HK(query: string): Promise<any[]> {
    let browser: Browser | null = null;
    let allJobsData: any[] = [];
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
        // Ensure Puppeteer executable path is correctly configured for Vercel/deployment if needed
        browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
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
             page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(e => console.warn("Navigation after search click didn't fully idle, proceeding...")),
             page.click(SEARCH_BUTTON_SELECTOR)
         ]);
         console.log(`Current URL after search: ${page.url()}`);
         console.log(`Waiting for job cards: ${JOB_CARD_SELECTOR}`);
         try {
             await page.waitForSelector(JOB_CARD_SELECTOR, { timeout: 40000, visible: true });
             console.log("Initial job cards selector found.");
         } catch (e) {
             console.error(`Job cards selector (${JOB_CARD_SELECTOR}) not found after search. Scraping might fail. Page content snippet:`, await page.content().then(c => c.substring(0, 500)));
             // Optionally take a screenshot for debugging
             // await page.screenshot({ path: 'debug_screenshot_no_cards.png' });
             throw new Error("Job cards not found after search."); // Stop if essential element missing
         }
         await delay(2000); // Wait for potential lazy loading

        // Part 2: Scrape Pages Loop (Same as before)
        while (currentPage <= maxPagesToScrape) {
            console.log(`--- Scraping Page ${currentPage} ---`);
            const pageJobs = await page.$$eval(JOB_CARD_SELECTOR, (cards, selectors, pageNum) => {
                 // ... (inner logic for extracting title, company, location, url remains the same) ...
                const jobs: any[] = [];
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
                         page.waitForSelector(JOB_CARD_SELECTOR, { timeout: 45000, visible: true }).catch(e=> console.warn("Wait for selector after 'Next' click failed or timed out."))
                     ]);
                     await delay(3000 + Math.random() * 1000); // Increased delay after page load
                     console.log(`Navigated to page ${currentPage + 1}`);
                     currentPage++;
                 } catch(navError: any) {
                      console.error(`Error clicking 'Next' or waiting for page ${currentPage + 1}: ${navError.message}`);
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
        const CONCURRENCY_LIMIT = 30; // <--- INCREASED FROM PREVIOUS VALUE (e.g., 5)
        let detailedJobsProcessed = 0;

        for (let i = 0; i < totalJobsToDescribe; i += CONCURRENCY_LIMIT) {
            const batchUrls = jobsWithUrls.slice(i, i + CONCURRENCY_LIMIT);
            console.log(`--- Scraping description batch ${i / CONCURRENCY_LIMIT + 1} (Jobs ${i + 1} to ${Math.min(i + CONCURRENCY_LIMIT, totalJobsToDescribe)}) ---`);

            const promises = batchUrls.map(async (job, index) => {
                let detailPage: Page | null = null;
                const jobIndexInTotal = i + index; // Index relative to the totalJobsToDescribe
                try {
                    console.log(` -> Starting detail ${jobIndexInTotal + 1}/${totalJobsToDescribe}: ${job.title.substring(0, 30)}...`);
                    detailPage = await browser.newPage(); // Creates a new page context
                    await detailPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
                    await detailPage.goto(job.url, { waitUntil: 'networkidle2', timeout: 60000 });

                    const descriptionSelector = await detailPage.waitForSelector(`${JOB_DESCRIPTION_SELECTOR_DETAIL}, #jobDescription`, { timeout: 25000, visible: true });
                    const description = await descriptionSelector?.evaluate(el => el.innerText || el.textContent);

                    // Return the description and the original URL to match later
                    return {
                        url: job.url,
                        description: description?.replace(/\s+/g, ' ').trim() || 'Could not extract description.',
                        success: true
                    };

                } catch (detailError: any) {
                    console.error(` -> Failed desc scrape for ${job.title}: ${detailError.message}`);
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
                    const { url, description, success } = result.value;
                    const originalJobIndex = allJobsData.findIndex(j => j.url === url);
                    if (originalJobIndex !== -1) {
                        allJobsData[originalJobIndex].description = description;
                        if (success) {
                           console.log(` -> Success batch update for ${allJobsData[originalJobIndex].title.substring(0, 30)}. Desc length: ${description.length}`);
                        } else {
                           console.log(` -> Failed batch update for ${allJobsData[originalJobIndex].title.substring(0, 30)}.`);
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

    } catch (error: any) {
        console.error("Scraping function error:", error);
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
    // Remove dynamic imports for Chroma/Transformers
    // const { ChromaClient } = await import('chromadb');
    // const { pipeline, env } = await import('@xenova/transformers');
    // Remove env settings here, handled in vectorDb.ts
    // env.allowLocalModels = true;
    // env.useBrowserCache = false;

    const currentApiKey = process.env.GEMINI_API_KEY;
    if (!currentApiKey) { return NextResponse.json({ error: 'Server config error: Missing API Key.' }, { status: 500 }); }
    const geminiApiUrlWithKey = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_NAME}:generateContent?key=${currentApiKey}`;

    let scrapedJobResults: any[] = [];
    let topCompanies: { name: string, count: number }[] = [];
    let topLocations: { name: string, count: number }[] = [];

    try {
        // Destructure potential resumeText from the body
        const { userRoleQuery, resumeText } = await request.json();

        if (typeof userRoleQuery !== 'string' || !userRoleQuery.trim()) { return NextResponse.json({ error: 'Invalid input: Missing userRoleQuery.' }, { status: 400 }); }
        // resumeText is optional, so no strict check needed unless you want to enforce it
        const hasResume = typeof resumeText === 'string' && resumeText.trim().length > 0;
        console.log(`Received analysis request for: "${userRoleQuery}" ${hasResume ? 'WITH resume' : 'without resume'}.`);

        // === Step 1: Execute Web Scraping ===
        scrapedJobResults = await scrapeJobsDB_HK(userRoleQuery);
        console.log(`Scraping finished. Found ${scrapedJobResults.length} basic job entries.`);
        const jobsWithDescriptionsCount = scrapedJobResults.filter(j => j.description && !j.description.includes('Failed') && !j.description.includes('Could not')).length;
        console.log(`Found ${jobsWithDescriptionsCount} jobs with successfully scraped descriptions.`);


        // === Step 2: Calculate Statistics (from all scraped jobs) ===
        if (scrapedJobResults.length > 0) {
            // ... (statistic calculation remains the same) ...
            const companyCounts: { [key: string]: number } = {};
            const locationCounts: { [key: string]: number } = {};
            scrapedJobResults.forEach(job => {
                if (job.company_name) { companyCounts[job.company_name] = (companyCounts[job.company_name] || 0) + 1; }
                if (job.location) { const cleanLocation = job.location.split(',')[0].trim(); if(cleanLocation) locationCounts[cleanLocation] = (locationCounts[cleanLocation] || 0) + 1; }
            });
            topCompanies = Object.entries(companyCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 10);
            topLocations = Object.entries(locationCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 10);
            console.log("Top Companies:", topCompanies.map(c=>`${c.name}(${c.count})`));
            console.log("Top Locations:", topLocations.map(l=>`${l.name}(${l.count})`));
        }

        // === Step 3a: Initialize DB & Embeddings (USING UTILITY) ===
        let collection: any = null;
        // let extractor: any = null; // REMOVE extractor
        try {
            // Get collection only
            const { collection: dbCollection } = await getVectorDbCollection();
            collection = dbCollection;
            console.log("Vector DB collection initialized.");
        } catch (initError: any) {
            console.error("FATAL: Failed to initialize Vector DB or Embedding Model via utility:", initError);
            // Critical failure - can't proceed with RAG
            // Provide a more specific error if possible, e.g., check initError.message
             const friendlyMessage = initError.message.includes('connect')
                 ? 'Could not connect to the vector database. Please ensure it is running and accessible.'
                 : 'Internal server error during analysis setup (Vector DB/Model).';
             return NextResponse.json({ error: friendlyMessage }, { status: 500 });
        }


        // === Step 3b: Embed and Store/Update Jobs - UPDATED FOR BATCHING ===
        const jobsToProcess = scrapedJobResults.filter(job =>
            job.url && job.description && !job.description.includes('Failed') && !job.description.includes('Could not')
        );
        console.log(`Embedding and upserting ${jobsToProcess.length} jobs with descriptions via BATCH API...`); // Update log
        const EMBEDDING_BATCH_SIZE = 20; // How many embeddings to request per API call (Adjust based on API limits/performance)
        let upsertedCount = 0;

        for (let i = 0; i < jobsToProcess.length; i += EMBEDDING_BATCH_SIZE) {
            const batchJobs = jobsToProcess.slice(i, i + EMBEDDING_BATCH_SIZE);
            const batchDescriptions = batchJobs.map(job => job.description); // Get descriptions for the batch

            console.time(`embeddingApiBatch_${i / EMBEDDING_BATCH_SIZE}`);
            let batchEmbeddings: (number[] | null)[] = [];
            try {
                // Call the new batch embedding function
                batchEmbeddings = await generateEmbeddingsBatch(batchDescriptions);
            } catch (batchEmbedError: any) {
                console.error(`Failed to embed batch starting at index ${i}: ${batchEmbedError.message}`);
                 // Decide how to handle batch failure: skip batch, retry, etc. Here we just log and continue.
                 batchEmbeddings = batchDescriptions.map(() => null); // Set all to null on batch failure
            }
            console.timeEnd(`embeddingApiBatch_${i / EMBEDDING_BATCH_SIZE}`);


            // Prepare data for ChromaDB upsert, skipping jobs where embedding failed
            const jobIds: string[] = [];
            const embeddings: number[][] = [];
            const metadatas: Record<string, any>[] = [];
            const documents: string[] = [];

            batchJobs.forEach((job, index) => {
                const embedding = batchEmbeddings[index]; // Get the corresponding embedding result
                if (embedding) { // Only include if embedding was successful
                    jobIds.push(job.url);
                    embeddings.push(embedding);
                    metadatas.push({
                        title: job.title || 'N/A',
                        company: job.company_name || 'N/A',
                        location: job.location || 'N/A',
                        snippet: job.description?.substring(0, 150) + '...' || '',
                    });
                    documents.push(job.description);
                } else {
                     console.warn(`Skipping job ${job.url} due to failed embedding in batch.`);
                }
            });

            if (jobIds.length > 0) {
                try {
                    console.time(`chromaUpsertBatch_${i / EMBEDDING_BATCH_SIZE}`);
                    await collection.upsert({ ids: jobIds, embeddings, metadatas, documents });
                    console.timeEnd(`chromaUpsertBatch_${i / EMBEDDING_BATCH_SIZE}`);
                    upsertedCount += jobIds.length;
                    console.log(`Upserted batch ${i / EMBEDDING_BATCH_SIZE + 1} (${jobIds.length} valid embeddings), total upserted: ${upsertedCount}`);
                } catch (dbUpsertError: any) {
                    console.error(`ChromaDB Upsert Error (Batch ${i / EMBEDDING_BATCH_SIZE + 1}):`, dbUpsertError);
                }
            } else {
                 console.log(`Skipping upsert for batch ${i / EMBEDDING_BATCH_SIZE + 1} as no valid embeddings were generated.`);
            }

             // Add a small delay between BATCH API calls if needed
             if (i + EMBEDDING_BATCH_SIZE < jobsToProcess.length) {
                 await delay(100); // e.g., 100ms delay between batch API calls
             }
        }
        console.log(`Finished embedding and upserting ${upsertedCount} jobs.`);


        // === Step 3c: Retrieve Relevant Context via RAG ===
        const ragLimit = hasResume ? 50 : 30; // Increased limits
        let contextJobSummaries = 'No specific job details retrieved.';
        let retrievedJobsCount = 0;
        let candidateJobsForPrompt: any[] = [];

        try {
            console.log(`Performing RAG query for: "${userRoleQuery}" (limit: ${ragLimit})`);
            console.time("ragQuery");
            // Generate query embedding using the imported function
            const queryEmbedding = await generateEmbedding(userRoleQuery); // Use generateEmbedding

            const results = await collection.query({
                queryEmbeddings: [queryEmbedding],
                nResults: ragLimit,
                include: ["metadatas", "documents"]
            });
            console.timeEnd("ragQuery");

            if (results && results.documents && results.documents.length > 0 && results.documents[0].length > 0) {
                retrievedJobsCount = results.documents[0].length; // Actual retrieved count
                results.documents[0].forEach((doc, index) => {
                    const meta = results.metadatas?.[0]?.[index] || {};
                    const jobId = results.ids?.[0]?.[index]; // *** Get the URL (ID) ***
                    if (jobId) { // Only include if we have a URL/ID
                        const jobData = {
                            id: jobId, // Store the URL here
                            title: meta.title || 'N/A',
                            company: meta.company || 'N/A',
                            location: meta.location || 'N/A',
                            description: doc || '(Document text missing)',
                        };
                        candidateJobsForPrompt.push(jobData);
                    }
                });

                // Modify context string to EXPLICITLY include the URL for the LLM
                 contextJobSummaries = candidateJobsForPrompt.map((job, index) => {
                     return `Relevant Job Candidate ${index + 1}:\n` +
                            `Title: ${job.title}\n` +
                            `Company: ${job.company}\n` +
                            `Location: ${job.location}\n` +
                            `URL: ${job.id}\n` + // *** Add URL here ***
                            `Description: ${job.description}`;
                 }).join('\n\n---\n\n');

                console.log(`Retrieved ${candidateJobsForPrompt.length} valid candidate jobs via RAG.`); // Log count of jobs with IDs

            } else { console.log("RAG query returned no matching documents."); }
        } catch (ragError: any) { console.error("RAG Query Error:", ragError); }


        // === Step 4: Prepare Prompt for Gemini ===
        console.log(`Context length for LLM: ${contextJobSummaries.length} chars. Has Resume: ${hasResume}`);

        // **Modify prioritization instruction to request MORE jobs (e.g., top 15-20)**
        const prioritizationInstruction = hasResume
            ? `Prioritize the **top 15-20 most relevant jobs** from the **Relevant Job Information provided below** based *strictly* on how well the **candidate's resume (provided below)** matches the requirements listed in the job's Title and full Description. Consider skills, experience level, and technologies mentioned.
              **For each prioritized job, output its title as a markdown link using its corresponding URL (e.g., '[Job Title](URL)') in bold, followed by its 1-sentence justification explaining the resume match.**
              Format as a numbered list. Ensure there is a blank line (double newline in markdown) separating each complete numbered item (title link and justification) from the next. If fewer than 15 jobs are highly relevant, list only those.
              Start this section *exactly* with "3. Job Prioritization (based on your resume):".`
            : `Prioritize the **top 15-20 most relevant jobs** from the **Relevant Job Information provided below** based *strictly* on how well their Title and full Description match the user's query: "${userRoleQuery}".
              **For each prioritized job, output its title as a markdown link using its corresponding URL (e.g., '[Job Title](URL)') in bold, followed by its 1-sentence justification.**
              Format as a numbered list. Ensure there is a blank line (double newline in markdown) separating each complete numbered item (title link and justification) from the next. If fewer than 15 jobs are highly relevant, list only those.
              Start this section *exactly* with "3. Job Prioritization:".`;

        const prompt = `
          You are an expert AI Career Advisor analyzing the job market.
          Context:
          - User's target role/skill query: "${userRoleQuery}"
          ${hasResume ? `- User's Resume Text:\n"""\n${resumeText}\n"""` : ''}
          - The following ${candidateJobsForPrompt.length} job descriptions (with URLs) were retrieved as potentially relevant...

          Tasks:
          Based *only* on the provided context...
          1.  **Common Tech Stack:**
              a. Identify the key technologies, programming languages, frameworks, cloud platforms, databases, and core concepts mentioned.
              b. Group these skills into relevant categories (e.g., Languages, Frameworks/Libraries, Cloud, Databases, Concepts/Methodologies, Tools).
              c. For the **top 10-15 most prominent skills overall**, estimate the percentage (%) of the provided job descriptions that mention them.
              d. Present the results clearly, listing categories with their skills, and indicating the estimated percentages for the top skills using "~XX%" notation.
              Start this section *exactly* with "1. Common Tech Stack:".

          2.  **Suggested Project Ideas:** Suggest 2-3 specific, actionable project ideas suitable for a portfolio to help someone targeting "${userRoleQuery}" roles, based on the tech stack identified.
              **Format each suggestion as: '1. **Project Title/Concept:** Brief description.'**
              **Ensure there is a blank line (double newline in markdown) separating each complete numbered item from the next.**
              Start this section *exactly* with "2. Suggested Project Ideas:".

          3.  **Job Prioritization:**
              ${prioritizationInstruction}

          4.  **Experience Level Summary:** Analyze required years of experience (e.g., 'X+ years', 'minimum Y years', 'fresh graduates'). Summarize typical levels sought (e.g., 'Mostly Mid-Level (3-7 years)', 'Mix of Junior and Senior', 'Entry-Level focus'). If rarely mentioned, state that.
              Start this section *exactly* with "4. Experience Level Summary:".

          --- Relevant Job Information (Candidates Found: ${candidateJobsForPrompt.length}) ---
          ${contextJobSummaries}
          --- END Relevant Job Information ---

          Analysis Output:
        `;


        // === Step 5: Call Gemini API ===
        console.log(`Sending analysis prompt to Gemini (${GEMINI_MODEL_NAME}) ${hasResume ? 'with resume context' : ''}`);
        console.time("geminiApiCall");
        const requestBody = { contents: [{ parts: [{ "text": prompt }] }] };
        const geminiApiResponse = await fetch(geminiApiUrlWithKey, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody),
        });
        console.timeEnd("geminiApiCall");
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
        } catch (e: any) {
             console.error("Error processing Gemini response:", e);
             return NextResponse.json({ error: `Failed to process AI response: ${e.message}` }, { status: 500 });
        }

         if (!analysisText) { console.error("Gemini response text empty after processing."); return NextResponse.json({ error: 'Received empty analysis from AI.' }, { status: 500 }); }

         // *** ADD LOGGING HERE ***
         console.log("--- Full Gemini Analysis Text ---");
         console.log(analysisText);
         console.log("--- End Gemini Analysis Text ---");

         // --- Parsing Logic ---
         let commonStack = "Could not parse stack from analysis.";
         let projectIdeas = "Could not parse projects from analysis.";
         let jobPrioritization = "Could not parse prioritization.";
         let experienceSummary = "Could not parse experience summary.";

        const stackMarker = /^1\.\s*Common Tech Stack:/mi;
        const projectMarker = /^2\.\s*Suggested Project Ideas:/mi;
        const priorityMarker = /^3\.\s*Job Prioritization(\s*\(based on your resume\))?:/mi;
        const experienceMarker = /^4\.\s*Experience Level Summary:/mi;

        const stackMatch = analysisText.match(stackMarker);
        const projectMatch = analysisText.match(projectMarker);
        const priorityMatch = analysisText.match(priorityMarker); // Check this match
        const experienceMatch = analysisText.match(experienceMarker);

        // *** ADD LOGGING HERE ***
        console.log("Priority Marker Regex:", priorityMarker);
        console.log("Priority Match Result:", priorityMatch ? `Found at index ${priorityMatch.index}` : "Not Found");

        const stackIdx = stackMatch?.index ?? -1;
        const projectIdx = projectMatch?.index ?? -1;
        const priorityIdx = priorityMatch?.index ?? -1;
        const experienceIdx = experienceMatch?.index ?? -1;
        const calculateContentStart = (match: RegExpMatchArray | null, index: number): number => { /* ... */
            if (!match || index === -1) return -1;
            const endOfMarkerLine = analysisText.indexOf('\n', index + match[0].length);
            return endOfMarkerLine !== -1 ? endOfMarkerLine + 1 : index + match[0].length;
        };
        const stackContentStart = calculateContentStart(stackMatch, stackIdx);
        const projectContentStart = calculateContentStart(projectMatch, projectIdx);
        const priorityContentStart = calculateContentStart(priorityMatch, priorityIdx);
        const experienceContentStart = calculateContentStart(experienceMatch, experienceIdx);

        const sections = [
            { name: 'stack', index: stackIdx, contentStart: stackContentStart },
            { name: 'project', index: projectIdx, contentStart: projectContentStart },
            { name: 'priority', index: priorityIdx, contentStart: priorityContentStart },
            { name: 'experience', index: experienceIdx, contentStart: experienceContentStart }
        ].filter(s => s.index !== -1).sort((a, b) => a.index - b.index);

        console.log("Found & Sorted Sections:", sections.map(s => s.name));

        for (let i = 0; i < sections.length; i++) {
            const currentSection = sections[i]; const nextSection = sections[i + 1];
            const contentStartIndex = currentSection.contentStart;
            const contentEndIndex = nextSection ? nextSection.index : undefined;
            const sectionText = analysisText.substring(contentStartIndex, contentEndIndex).trim();
            console.log(`Extracting section: ${currentSection.name}, Start: ${contentStartIndex}, End: ${contentEndIndex ?? 'EOF'}, Length: ${sectionText.length}`);
            if (currentSection.name === 'stack') commonStack = sectionText || commonStack;
            else if (currentSection.name === 'project') projectIdeas = sectionText || projectIdeas;
            else if (currentSection.name === 'priority') {
                jobPrioritization = sectionText || jobPrioritization;
                 // *** ADD LOGGING HERE ***
                 console.log("--- Extracted Job Prioritization Text ---");
                 console.log(jobPrioritization);
                 console.log("--- End Extracted Job Prioritization Text ---");
            }
            else if (currentSection.name === 'experience') experienceSummary = sectionText || experienceSummary;
        }
         // --- End of Parsing Logic ---


        // === Step 7: Return Combined Results ===
        // Return ALL originally scraped jobs for the frontend list
        const allJobLinksForFrontend = scrapedJobResults.map(job => ({
            title: job.title || 'Scraped Job',
            url: job.url || '#',
            snippet: job.description && !job.description.includes('Failed') && !job.description.includes('Could not')
                ? job.description.substring(0, 150) + '...'
                : `${job.company_name || ''} - ${job.location || ''}`.substring(0, 150),
            company_name: job.company_name || undefined,
            location: job.location || undefined
        }));

        return NextResponse.json({
            jobListings: allJobLinksForFrontend, // Full list for display
            commonStack: commonStack,
            projectIdeas: projectIdeas,
            jobPrioritization: jobPrioritization,
            experienceSummary: experienceSummary,
            topCompanies: topCompanies,         // Based on full scrape
            topLocations: topLocations,         // Based on full scrape
            analysisDisclaimer: `Note: Stats from ${scrapedJobResults.length} scraped jobs. AI analysis prioritized the top matches from ${candidateJobsForPrompt.length} relevant descriptions ${hasResume ? 'based on the provided resume' : 'retrieved via RAG'}. Verify details.`, // Updated disclaimer
        });

    } catch (error: any) {
        console.error("API Route General Error:", error);
        // Return specific error from utility if it was a connection/init error
         const errorMessage = error.message.includes('vector database')
            ? error.message // Pass the specific DB/model error
            : `An internal server error occurred: ${error.message || 'Unknown error'}`;
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}