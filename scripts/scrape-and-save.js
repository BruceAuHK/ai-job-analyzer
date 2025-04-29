// scripts/scrape-and-save.js
const fs = require('fs/promises'); // Use promise-based fs
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from .env file (if you have one)
dotenv.config();

// Adjust the import path based on your project structure
// Use require for CommonJS modules
const { scrapeJobsDB_HK } = require('../src/app/api/job-analysis/route');

// --- Configuration ---
const QUERIES_TO_SCRAPE = {
  "AI": "ai.json",
  "Python": "python.json",
  "Java": "java.json",
  "C++": "cpp.json",
  "Quant": "quant.json",
  "Full Stack": "full_stack.json",
  "Data Scientist": "data_scientist.json",
  "React Developer": "react_developer.json",
  // Cloud & DevOps
  "DevOps Engineer": "devops_engineer.json",
  "AWS": "aws.json",
  "Cloud Engineer": "cloud_engineer.json",
  // Data & ML
  "Data Engineer": "data_engineer.json",
  "Machine Learning Engineer": "machine_learning_engineer.json",
  "Business Analyst": "business_analyst.json",
  // Backend
  "Node.js Developer": "nodejs_developer.json",
  "Backend Engineer": "backend_engineer.json",
  // Other Tech Roles
  "Cybersecurity": "cybersecurity.json",
  "QA Engineer": "qa_engineer.json",
  "Mobile Developer": "mobile_developer.json",
  // Finance/Quant Specific
  "Quantitative Developer": "quantitative_developer.json",
  "Quantitative Researcher": "quantitative_researcher.json",
  // Management/Product
  "Project Manager": "project_manager.json",
  "Product Manager": "product_manager.json"
};

const OUTPUT_DIR = path.join(__dirname, '..', 'src', 'app', 'api', 'job-analysis', 'pre-scraped-data');
const DELAY_BETWEEN_SCRAPES_MS = 15000; // 15 seconds delay

// Helper to ensure directory exists
async function ensureDirectoryExists(dirPath) {
  try {
    await fs.access(dirPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log(`Creating directory: ${dirPath}`);
      await fs.mkdir(dirPath, { recursive: true });
    } else {
      throw error;
    }
  }
}

// --- Main Scraping Logic ---
async function scrapeAndSave(query, filename) {
  console.log(`\n--- Starting scrape for query: "${query}" ---`);
  try {
    // Ensure the scrapeJobsDB_HK function is correctly imported and configured
    const results = await scrapeJobsDB_HK(query);

    if (!results || results.length === 0) {
        console.warn(`No results found for query: "${query}". Skipping save.`);
        return;
    }

    const filepath = path.join(OUTPUT_DIR, filename);
    await fs.writeFile(filepath, JSON.stringify(results, null, 2), 'utf-8');
    console.log(`✅ Successfully saved ${results.length} results for "${query}" to ${filepath}`);

  } catch (error) {
    console.error(`❌ Error scraping or saving for query "${query}":`, error);
  }
}

// --- Execution ---
async function runAll() {
  console.log("Starting pre-scraping process...");
  await ensureDirectoryExists(OUTPUT_DIR);

  const queries = Object.entries(QUERIES_TO_SCRAPE);

  for (let i = 0; i < queries.length; i++) {
    const [query, filename] = queries[i];
    await scrapeAndSave(query, filename);

    if (i < queries.length - 1) {
      console.log(`--- Waiting ${DELAY_BETWEEN_SCRAPES_MS / 1000} seconds before next scrape ---`);
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_SCRAPES_MS));
    }
  }

  console.log("\n--- Pre-scraping process finished. ---");
}

// --- Run the script ---
runAll().catch(error => {
  console.error("An unexpected error occurred during the scraping process:", error);
  process.exit(1);
});