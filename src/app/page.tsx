'use client';

import { useState, useCallback, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
// --- Chart.js Imports ---
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    BarElement,
    Title,
    Tooltip,
    Legend,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
// --- End Chart.js Imports ---
import styles from './Home.module.css'; // Your CSS module file

// --- Register Chart.js Components ---
ChartJS.register(
    CategoryScale,
    LinearScale,
    BarElement,
    Title,
    Tooltip,
    Legend
);
// --- End Registration ---

// Interface for individual job listings received from backend
interface JobListing {
  title: string;
  url: string;
  snippet?: string;
  company_name?: string;
  location?: string;
}
// Interface for statistics items
interface StatItem { name: string; count: number; }

// Updated interface for the main analysis result object from /api/job-analysis
interface AnalysisResult {
  jobListings: JobListing[];
  commonStack: string;
  projectIdeas: string;
  jobPrioritization: string;
  experienceSummary: string; // Added
  topCompanies: StatItem[];  // Added
  topLocations: StatItem[];  // Added
  analysisDisclaimer: string;
}

export default function Home() {
  // State for initial market analysis
  const [userRoleQuery, setUserRoleQuery] = useState('');
  const [resumeText, setResumeText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);

  // State for resume analysis feature
  const [loadingResume, setLoadingResume] = useState(false);
  const [errorResume, setErrorResume] = useState<string | null>(null);
  const [resumeAnalysisResult, setResumeAnalysisResult] = useState<string | null>(null);

  // State for skill gap analysis feature
  const [loadingSkillGap, setLoadingSkillGap] = useState(false);
  const [errorSkillGap, setErrorSkillGap] = useState<string | null>(null);
  const [skillGapResult, setSkillGapResult] = useState<string | null>(null);

  // State for strategy tips feature
  const [loadingStrategy, setLoadingStrategy] = useState(false);
  const [errorStrategy, setErrorStrategy] = useState<string | null>(null);
  const [strategyTips, setStrategyTips] = useState<string | null>(null);

  // Add state for dynamic loading messages
  const [loadingStepMessage, setLoadingStepMessage] = useState('');

  // **NEW** Semantic Filtering
  const [filterQuery, setFilterQuery] = useState('');
  const [loadingFilter, setLoadingFilter] = useState(false);
  const [errorFilter, setErrorFilter] = useState<string | null>(null);
  const [filteredJobIds, setFilteredJobIds] = useState<string[] | null>(null); // Stores IDs from filter API

  // **NEW** Similar Jobs
  const [loadingSimilar, setLoadingSimilar] = useState(false);
  const [errorSimilar, setErrorSimilar] = useState<string | null>(null);
  const [similarJobsResult, setSimilarJobsResult] = useState<JobListing[] | null>(null); // Stores jobs from similar API
  const [similarJobsSourceTitle, setSimilarJobsSourceTitle] = useState<string | null>(null); // To show context

  // === Derived State ===
  // Determine which list of jobs to display based on current state
  const jobsToDisplay = (() => {
      if (similarJobsResult) return similarJobsResult;
      if (filteredJobIds && analysisResult) {
          return (analysisResult.jobListings || []).filter(job => filteredJobIds.includes(job.url));
      }
      if (analysisResult) return analysisResult.jobListings || [];
      return [];
  })();
  const displayMode: 'initial' | 'filtered' | 'similar' = similarJobsResult ? 'similar' : (filteredJobIds ? 'filtered' : 'initial');

  // === Chart Configuration ===
  const chartOptions = {
      indexAxis: 'y' as const, // Display bars horizontally for better label readability
      elements: {
          bar: {
              borderWidth: 2,
          },
      },
      responsive: true,
      maintainAspectRatio: false, // Allow chart height to be controlled by container
      plugins: {
          legend: {
              display: false, // Hide legend as it's obvious from the title
          },
          title: {
              display: false, // We have section titles already
          },
          tooltip: {
              callbacks: {
                  label: function(context: any) {
                      let label = context.dataset.label || '';
                      if (label) {
                          label += ': ';
                      }
                      if (context.parsed.x !== null) {
                           // Display the count from the data
                          label += `${context.parsed.x} jobs`;
                      }
                      return label;
                  }
              }
          }
      },
      scales: {
        x: {
          beginAtZero: true,
           ticks: {
                precision: 0 // Ensure whole numbers on the axis
           }
        }
      },
  };

  const getChartData = (items: StatItem[], label: string, backgroundColor: string, borderColor: string) => {
      const labels = items.map(item => item.name);
      const data = items.map(item => item.count);
      return {
          labels,
          datasets: [
              {
                  label: label,
                  data: data,
                  borderColor: borderColor,
                  backgroundColor: backgroundColor,
                  barThickness: 15, // Adjust bar thickness
              },
          ],
      };
  };

  // --- Effect to cycle through loading messages ---
  useEffect(() => {
    let timers: NodeJS.Timeout[] = [];
    if (loading) {
        // Reset messages when loading starts
        setLoadingStepMessage("Initiating job search...");

        // Simulate backend steps with delays (adjust timings as needed)
        timers.push(setTimeout(() => {
            if(loading) setLoadingStepMessage("Scraping job list pages (up to 3)...");
        }, 2500)); // Example delay

        timers.push(setTimeout(() => {
             if(loading) setLoadingStepMessage("Fetching key job details (up to 10)...");
        }, 8000)); // Example delay

        timers.push(setTimeout(() => {
            if(loading) setLoadingStepMessage("Sending data to AI for analysis...");
        }, 18000)); // Example delay

        timers.push(setTimeout(() => {
             if(loading) setLoadingStepMessage("Generating insights & recommendations (almost there!)...");
        }, 28000)); // Example delay

    } else {
      setLoadingStepMessage(''); // Clear message when loading finishes
    }

    // Cleanup function to clear timeouts if component unmounts or loading stops early
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [loading]); // This effect runs whenever the 'loading' state changes

  // --- API Call Handlers ---

  // Handler for Initial Market Analysis (includes stats + 4 AI tasks)
  const handleAnalyzeMarket = useCallback(async () => {
    if (!userRoleQuery.trim()) { setError('Please enter role/skill.'); return; }
    // Reset ALL results and errors on new analysis
    setError(null); setAnalysisResult(null);
    // Keep resume text, but clear derived results
    // setResumeText(''); // Keep resume text if entered
    setResumeAnalysisResult(null); setSkillGapResult(null); setStrategyTips(null);
    setErrorResume(null); setErrorSkillGap(null); setErrorStrategy(null);
    setErrorFilter(null); setErrorSimilar(null);
    setFilteredJobIds(null); setSimilarJobsResult(null); setSimilarJobsSourceTitle(null);
    setFilterQuery('');
    setLoading(true);

    try {
      const requestBody = {
          userRoleQuery: userRoleQuery.trim(),
          // Conditionally include resumeText if it's not empty
          ...(resumeText.trim() && { resumeText: resumeText.trim() })
      };
      console.log("Sending analysis request with:", Object.keys(requestBody)); // Log keys being sent

      const response = await fetch('/api/job-analysis', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody), // Send role query and potentially resume
      });
      const data = await response.json();
      if (!response.ok) throw new Error((data as any).error || `HTTP error! Status: ${response.status}`);
      setAnalysisResult(data as AnalysisResult);

      // Optionally clear resume analysis if the main analysis is re-run
      // setResumeAnalysisResult(null);
      // setErrorResume(null);

    } catch (err: any) { console.error("Market analysis fetch error:", err); setError(err.message || 'Error during market analysis.'); setAnalysisResult(null); }
    finally { setLoading(false); }
  }, [userRoleQuery, resumeText]); // Add resumeText as dependency

  // Resume Analysis Handler
  const handleAnalyzeResume = useCallback(async () => {
      if (!resumeText.trim()) { setErrorResume('Please paste resume text.'); return; }
      if (!analysisResult?.commonStack || analysisResult.commonStack.toLowerCase().includes('could not parse')) { setErrorResume('Run market analysis first.'); return; }
      setLoadingResume(true); setErrorResume(null); setResumeAnalysisResult(null);
      try {
          const response = await fetch('/api/resume-analysis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resumeText: resumeText.trim(), commonStack: analysisResult.commonStack }) });
          const data = await response.json(); if (!response.ok) throw new Error(data.error);
          setResumeAnalysisResult(data.resumeAnalysis);
      } catch (err: any) { setErrorResume(err.message); setResumeAnalysisResult(null); }
      finally { setLoadingResume(false); }
  }, [resumeText, analysisResult]);

   // Skill Gap Handler
  const handleAnalyzeSkillGap = useCallback(async () => {
    if (!analysisResult?.commonStack || analysisResult.commonStack.toLowerCase().includes('could not parse')) { setErrorSkillGap('Run market analysis first.'); return; }
    setLoadingSkillGap(true); setErrorSkillGap(null); setSkillGapResult(null);
    try {
        const response = await fetch('/api/skill-gap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commonStack: analysisResult.commonStack }) });
        const data = await response.json(); if (!response.ok) throw new Error(data.error);
        setSkillGapResult(data.skillGapAnalysis);
    } catch (err: any) { setErrorSkillGap(err.message); setSkillGapResult(null); }
    finally { setLoadingSkillGap(false); }
}, [analysisResult]);

  // Search Strategy Handler
  const handleGetStrategy = useCallback(async () => {
      if (!analysisResult) { setErrorStrategy('Run market analysis first.'); return; }
      if (!analysisResult.commonStack || analysisResult.commonStack.toLowerCase().includes('could not parse')) { setErrorStrategy('Market analysis incomplete.'); return; }
      setLoadingStrategy(true); setErrorStrategy(null); setStrategyTips(null);
      try {
          const response = await fetch('/api/search-strategy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userRoleQuery: userRoleQuery, commonStack: analysisResult.commonStack, experienceSummary: analysisResult.experienceSummary || 'N/A', jobPrioritization: analysisResult.jobPrioritization || 'N/A', topCompanies: analysisResult.topCompanies || [], topLocations: analysisResult.topLocations || [] }) });
          const data = await response.json(); if (!response.ok) throw new Error(data.error);
          setStrategyTips(data.strategyTips);
      } catch (err: any) { setErrorStrategy(err.message); setStrategyTips(null); }
      finally { setLoadingStrategy(false); }
  }, [userRoleQuery, analysisResult]);

  // **NEW** Semantic Filter Handler
  const handleFilterJobs = useCallback(async () => {
      if (!filterQuery.trim()) { setErrorFilter('Please enter filter text.'); return; }
      if (!analysisResult) { setErrorFilter('Run market analysis first.'); return; } // Need original list later
      setLoadingFilter(true); setErrorFilter(null); setFilteredJobIds(null);
      setSimilarJobsResult(null); setSimilarJobsSourceTitle(null); // Clear similar results when filtering

      try {
          const response = await fetch('/api/filter-jobs', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filterQuery: filterQuery.trim() }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || `HTTP error! Status: ${response.status}`);
          setFilteredJobIds(data.matchingJobIds || []); // Store the returned IDs
      } catch (err: any) {
          console.error("Filter jobs fetch error:", err);
          setErrorFilter(err.message || 'Error applying filter.');
          setFilteredJobIds(null);
      } finally {
          setLoadingFilter(false);
      }
  }, [filterQuery, analysisResult]);

  // **NEW** Clear Filter Handler
  const handleClearFilter = () => {
    setFilterQuery('');
    setFilteredJobIds(null);
    setErrorFilter(null);
    setLoadingFilter(false);
    // Also clear similar jobs if they were displayed
    setSimilarJobsResult(null);
    setSimilarJobsSourceTitle(null);
    setErrorSimilar(null);
    setLoadingSimilar(false);
  };

  // **NEW** Find Similar Jobs Handler
  const handleFindSimilarJobs = useCallback(async (sourceJob: JobListing) => {
      if (!sourceJob || !sourceJob.url || !sourceJob.title) {
          setErrorSimilar('Invalid job selected.'); return;
      }
      setLoadingSimilar(true); setErrorSimilar(null); setSimilarJobsResult(null); setSimilarJobsSourceTitle(null);
      setFilteredJobIds(null); // Clear filters when finding similar
      setFilterQuery('');

      try {
          const response = await fetch('/api/similar-jobs', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sourceJobUrl: sourceJob.url }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || `HTTP error! Status: ${response.status}`);
          setSimilarJobsResult(data.similarJobs || []);
          setSimilarJobsSourceTitle(sourceJob.title); // Store title for context
      } catch (err: any) {
          console.error("Similar jobs fetch error:", err);
          setErrorSimilar(err.message || 'Error finding similar jobs.');
          setSimilarJobsResult(null);
      } finally {
          setLoadingSimilar(false);
      }
  }, []);

  const handleKeyPress = (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      // Allow Shift+Enter in textarea, but trigger on Enter alone in input
      if (event.key === 'Enter' && !event.shiftKey) {
        // Check if the event target is the role input or the resume textarea
        if (event.currentTarget.id === 'roleInput' || event.currentTarget.id === 'resumeInputInitial') {
           event.preventDefault(); // Prevent default newline in textarea on simple Enter
           if (!loading) {
               handleAnalyzeMarket();
           }
        }
      }
  };
  const handleFilterKeyPress = (event: React.KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter' && !loadingFilter) { handleFilterJobs(); } };
  const canAnalyzeExtras = !!analysisResult?.commonStack && !analysisResult.commonStack.toLowerCase().includes('could not parse');

  // *** ADD Export Handler ***
  const handleExportAnalysis = useCallback(() => {
    if (!analysisResult) return; // Should not happen if button is enabled, but good practice

    // 1. Gather the data
    const {
        commonStack,
        projectIdeas,
        jobPrioritization,
        experienceSummary,
        topCompanies,
        topLocations
    } = analysisResult;
    // Include strategy tips if available
    const strategy = strategyTips || "Not generated.";

    // 2. Format the content (Markdown)
    let exportContent = `# AI Job Market Analysis Export\n\n`;
    exportContent += `**Analyzed For:** ${userRoleQuery || 'N/A'}\n\n`;
    exportContent += `**Date Exported:** ${new Date().toLocaleString()}\n\n`;
    exportContent += `---\n\n`;

    exportContent += `## Top Job Recommendations\n\n${jobPrioritization || 'N/A'}\n\n`;
    exportContent += `---\n\n`;

    exportContent += `## Common Tech Stack Analysis\n\n${commonStack || 'N/A'}\n\n`;
    exportContent += `---\n\n`;

    exportContent += `## Suggested Portfolio Projects\n\n${projectIdeas || 'N/A'}\n\n`;
    exportContent += `---\n\n`;

    exportContent += `## Typical Experience Level Summary\n\n${experienceSummary || 'N/A'}\n\n`;
    exportContent += `---\n\n`;

     exportContent += `## Personalized Search Strategy\n\n${strategy}\n\n`;
     exportContent += `---\n\n`;

    exportContent += `## Market Statistics\n\n`;
    exportContent += `### Top Hiring Companies:\n`;
    if (topCompanies && topCompanies.length > 0) {
        topCompanies.forEach((c, i) => exportContent += `${i + 1}. ${c.name} (${c.count})\n`);
    } else {
        exportContent += `N/A\n`;
    }
    exportContent += `\n### Top Locations:\n`;
     if (topLocations && topLocations.length > 0) {
        topLocations.forEach((l, i) => exportContent += `${i + 1}. ${l.name} (${l.count})\n`);
    } else {
        exportContent += `N/A\n`;
    }
    exportContent += `\n---\n`;

    // Include resume analysis if available
    if (resumeAnalysisResult) {
        exportContent += `\n## Resume Fitness Analysis\n\n${resumeAnalysisResult}\n\n`;
        exportContent += `---\n\n`;
    }

    // Include skill gap analysis if available
     if (skillGapResult) {
         exportContent += `\n## Skill Gap & Learning Recommendations\n\n${skillGapResult}\n\n`;
         exportContent += `---\n\n`;
     }

    // 3. Implement Download Logic
    try {
        const blob = new Blob([exportContent], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        // Sanitize query for filename
        const safeQuery = userRoleQuery.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'analysis';
        link.download = `job_analysis_${safeQuery}.md`; // Set filename
        document.body.appendChild(link); // Required for Firefox
        link.click();
        document.body.removeChild(link); // Clean up
        URL.revokeObjectURL(url); // Free up memory
    } catch (error) {
        console.error("Error exporting analysis:", error);
        // Optionally show an error to the user
        setError("Could not export analysis data.");
    }

  }, [analysisResult, strategyTips, resumeAnalysisResult, skillGapResult, userRoleQuery]); // Dependencies

  // --- JSX Rendering ---
  return (
    <main className={styles.pageContainer}>
      <div className={styles.contentWrapper}>
        {/* Header */}
        <div className={styles.header}>
             <h1 className={styles.mainTitle}>AI Job Market & Profile Analyzer</h1>
             <p className={styles.subTitle}>
                 Analyze job requirements, see prioritized listings, get project ideas, assess resume fit, identify skill gaps, and get search strategy tips.
             </p>
         </div>

        {/* Input Section - MODIFIED */}
        <div className={styles.inputSection}>
          <div className={styles.inputWrapper} style={{alignItems: 'flex-start', marginBottom: '1rem'}}> {/* Adjust alignment */}
            <div style={{flexGrow: 1, width: '100%'}}> {/* Wrapper for label + input */}
              <label htmlFor="roleInput" className={styles.inputLabel}>1. Analyze Market For:</label>
              <input
                id="roleInput"
                type="text"
                value={userRoleQuery}
                onChange={(e) => setUserRoleQuery(e.target.value)}
                onKeyPress={handleKeyPress} // Attach keypress here
                placeholder="e.g., AI Engineer HK..."
                className={styles.textInput}
                disabled={loading}
              />
            </div>
          </div>
           <div style={{width: '100%', marginTop: '1rem'}}> {/* Wrapper for label + textarea */}
               <label htmlFor="resumeInputInitial" className={styles.inputLabel}>2. (Optional) Paste Resume for Personalized Priority:</label>
               <textarea
                   id="resumeInputInitial"
                   rows={8}
                   value={resumeText}
                   onChange={(e) => setResumeText(e.target.value)}
                   onKeyPress={handleKeyPress} // Attach keypress here too if desired
                   placeholder="Paste your full resume text here..."
                   className={`${styles.textArea} ${styles.marginBottomMedium}`}
                   disabled={loading}
               />
               <p className={styles.infoText}>Providing your resume will tailor the 'Job Prioritization' section to jobs matching your profile.</p>
           </div>
           {/* Move Button Below Textarea */}
           <div style={{marginTop: '1rem', textAlign: 'right'}}>
                <button onClick={handleAnalyzeMarket} disabled={loading || !userRoleQuery.trim()} className={styles.analyzeButton} >
                     {loading ? ( <>{/* Spinner */} Analyzing Market...</> ) : ( "Analyze Market" )}
                </button>
           </div>
        </div>

        {/* Loading/Error States - UPDATED */}
        {loading && (
            <div className={styles.loadingIndicator}>
                <div className={styles.loadingSpinner}>
                    {/* Your SVG Spinner Here */}
                    <svg className={styles.spinner} viewBox="0 0 50 50">
                        <circle className={styles.spinnerCircle} cx="25" cy="25" r="20" fill="none" strokeWidth="5"></circle>
                        <circle className={styles.spinnerPath} cx="25" cy="25" r="20" fill="none" strokeWidth="5" strokeLinecap="round">
                            <animateTransform attributeName="transform" type="rotate" from="0 25 25" to="360 25 25" dur="1s" repeatCount="indefinite"></animateTransform>
                            <animate attributeName="stroke-dasharray" values="1, 200; 89, 200; 89, 200" dur="1.5s" repeatCount="indefinite"></animate>
                        </circle>
                    </svg>
                </div>
                <p className={styles.loadingText}>Analyzing Market...</p>
                {/* Display the dynamic step message */}
                <p className={styles.loadingSubText}>{loadingStepMessage || 'Please wait...'}</p>
                <p className={styles.infoText}>(This process involves web scraping and AI analysis, which can take 30-90 seconds)</p>
            </div>
        )}
        {error && ( <div className={styles.errorBox} role="alert"> <p className={styles.errorTitle}>Market Analysis Error</p> <p>{error}</p> </div> )}

        {/* --- Display Sections --- */}
        {analysisResult && !loading && !error && (
          <div className={styles.allResultsContainer}>

                 {/* *** ADD Export Button Here *** */}
                 <div style={{ marginBottom: '1.5rem', textAlign: 'right' }}>
                     <button
                         onClick={handleExportAnalysis}
                         className={styles.analyzeButtonSmall} // Use smaller button style
                         disabled={!analysisResult} // Disable if no results
                         title="Download analysis sections as a Markdown file"
                     >
                         Export Analysis Results (.md)
                     </button>
                 </div>

                 {/* --- Job List Section (Full List - Filter/Similar) --- */}
                 <section className={`${styles.resultCard} ${styles.fullWidthCard} ${styles.marginTopLarge}`}>
                    {/* ... Title ... */}
                    <h2 className={styles.sectionTitle}>
                         {displayMode === 'similar' && `Similar Jobs to "${similarJobsSourceTitle || 'Selected Job'}"`}
                         {displayMode === 'filtered' && `Filtered Job Listings (${jobsToDisplay.length} matching)`}
                         {displayMode === 'initial' && `All Scraped Job Listings (${(analysisResult.jobListings || []).length} found)`}
                     </h2>
                     {/* ... Filter Input Area ... */}
                      {displayMode !== 'similar' && ( <div className={`${styles.inputWrapper} ${styles.marginBottomMedium}`}> {/* ... filter input/buttons ... */} </div> )}
                     {/* ... Back Button ... */}
                     {/* ... Loading/Error for Filter/Similar ... */}
                     {/* ... The Job List Itself (ul/li loop) ... */}
                       {jobsToDisplay.length > 0 ? (
                         <ul className={styles.jobList}>
                             {jobsToDisplay.map((job: JobListing, index: number) => {
                                // Add checks for potentially missing data
                                const jobTitle = job.title || 'Job Title Unavailable';
                                const jobUrl = job.url || '#'; // Use '#' if URL is missing
                                const companyName = job.company_name;
                                const location = job.location;
                                const snippet = job.snippet || 'No snippet available.';

                                return (
                                 <li key={jobUrl + '-' + index} className={styles.jobListItem}> {/* Ensure key is unique */}
                                     <a href={jobUrl} target="_blank" rel="noopener noreferrer" className={styles.jobTitleLink}>
                                         {jobTitle}
                                     </a>
                                     <div className={styles.jobMeta}>
                                         {/* Conditionally render only if data exists */}
                                         {companyName && (
                                             <span title="Company">
                                                 {/* Building Icon SVG */}
                                                 <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className={styles.jobMetaIcon}>
                                                    <path fillRule="evenodd" d="M9.965 1.026a.75.75 0 0 1 .5.671v1.018l.75-.75a.75.75 0 1 1 1.06 1.06l-.75.75h1.018a.75.75 0 0 1 .671.5.75.75 0 0 1-.67.965h-1.02a.75.75 0 0 1-.5-.671V4.518l-.75.75a.75.75 0 1 1-1.06-1.06l.75-.75H9.018a.75.75 0 0 1-.671-.5.75.75 0 0 1 .965-.67h1.02Zm-2.93 1.93a.75.75 0 0 1 .5.671v1.018l.75-.75a.75.75 0 0 1 1.06 1.06l-.75.75h1.018a.75.75 0 0 1 .671.5.75.75 0 0 1-.67.965h-1.02a.75.75 0 0 1-.5-.671V7.518l-.75.75a.75.75 0 1 1-1.06-1.06l.75-.75H6.018a.75.75 0 0 1-.671-.5.75.75 0 0 1 .965-.67h1.02ZM4.035 6a.75.75 0 0 1 .5.671v1.018l.75-.75a.75.75 0 1 1 1.06 1.06l-.75.75h1.018a.75.75 0 0 1 .671.5.75.75 0 0 1-.67.965H6.518a.75.75 0 0 1-.5-.671v-1.02l-.75.75a.75.75 0 0 1-1.06-1.06l.75-.75H4.018a.75.75 0 0 1-.671-.5.75.75 0 0 1 .965-.67h.722Zm-2-.5a.75.75 0 0 0-.671.5v11.5c0 .138.112.25.25.25h11.5a.25.25 0 0 0 .25-.25V6.035a.75.75 0 0 0-.5-.671.75.75 0 0 0-.671.5V16H2.75V6.035a.75.75 0 0 0-.67-.5Z" clipRule="evenodd" />
                                                </svg>
                                                 {companyName}
                                             </span>
                                         )}
                                         {location && (
                                             <span title="Location">
                                                 {/* Map Pin Icon SVG */}
                                                 <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className={styles.jobMetaIcon}>
                                                    <path fillRule="evenodd" d="m7.539.402 7 3.499c.323.162.561.48.561.842v8.402c0 .362-.238.68-.561.842l-7 3.5a.75.75 0 0 1-.478 0l-7-3.5a.75.75 0 0 1-.561-.842V4.743c0-.362.238-.68.561-.842l7-3.5a.75.75 0 0 1 .478 0Zm-.037 1.499L2 5.196v7.91l5.5 2.749 5.5-2.749V5.196L7.502 1.9ZM8 5.75a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-1.5 0v-2.5A.75.75 0 0 1 8 5.75Zm0 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
                                                </svg>
                                                 {location}
                                             </span>
                                         )}
                                         {!companyName && !location && <span>Details unavailable</span>}
                                     </div>
                                     {/* Render snippet only if it's not the fallback */}
                                     {job.snippet && <p className={styles.jobSnippet}>{snippet}</p>}
                                     {/* Add "Find Similar" button */}
                                      <button
                                          onClick={() => handleFindSimilarJobs(job)} // Pass the original job object
                                          disabled={loadingSimilar || loadingFilter || jobUrl === '#'} // Disable if URL missing
                                          className={`${styles.analyzeButtonSmall} ${styles.marginTopMedium}`}
                                          style={{fontSize: '0.75rem', padding: '0.25rem 0.5rem'}}
                                          title={`Find jobs similar to ${jobTitle}`}
                                      >
                                         Find Similar
                                      </button>
                                 </li>
                                );
                             })}
                         </ul>
                     ) : (
                          <p className={styles.noResultsText}>
                             {loadingFilter || loadingSimilar ? '' : (displayMode === 'filtered' ? 'No jobs match your filter.' : (displayMode === 'similar' ? 'Could not find similar jobs.' : 'No jobs found initially.'))}
                         </p>
                     )}
                 </section>

                {/* --- Top Job Recommendations Section --- */}
                 <section className={`${styles.resultCard} ${styles.fullWidthCard} ${styles.marginTopLarge}`}>
                    <h2 className={styles.sectionTitle}>
                        Top Job Recommendations
                        <span className={styles.titleSubText}>
                            {/* Check if the string actually contains the specific phrase */}
                            {(analysisResult.jobPrioritization || '').includes("based on your resume")
                                ? " (Top matches for your resume from relevant jobs found)"
                                : " (Top matches for your query from relevant jobs found)"}
                        </span>
                    </h2>
                    <div className={styles.analysisContent}>
                        {(analysisResult.jobPrioritization && !analysisResult.jobPrioritization.toLowerCase().includes('could not parse'))
                         ? <ReactMarkdown>{analysisResult.jobPrioritization}</ReactMarkdown>
                         : <p className={styles.noResultsText}>Could not generate job recommendations. Please try again or refine your query.</p>
                        }
                    </div>
                 </section>


                {/* --- Market Statistics Section - UPDATED --- */}
                <section className={`${styles.resultCard} ${styles.fullWidthCard} ${styles.marginTopLarge}`}>
                    <h2 className={styles.sectionTitle}>Market Statistics (Based on Scraped Jobs)</h2>
                    <div className={styles.statsGrid}>
                         {/* --- Top Companies Chart --- */}
                        <div className={styles.chartContainer}>
                            <h3 className={styles.statsSubtitle}>Top Hiring Companies:</h3>
                            {(analysisResult.topCompanies && analysisResult.topCompanies.length > 0) ? (
                                <div className={styles.chartWrapper}>
                                    <Bar
                                        options={chartOptions}
                                        data={getChartData(
                                            analysisResult.topCompanies,
                                            'Jobs Found',
                                            'rgba(75, 75, 192, 0.6)', // Example color
                                            'rgba(75, 75, 192, 1)'
                                        )}
                                    />
                                </div>
                            ) : <p className={styles.noResultsText}>N/A</p>}
                        </div>

                         {/* --- Top Locations Chart --- */}
                        <div className={styles.chartContainer}>
                             <h3 className={styles.statsSubtitle}>Top Locations:</h3>
                             {(analysisResult.topLocations && analysisResult.topLocations.length > 0) ? (
                                 <div className={styles.chartWrapper}>
                                     <Bar
                                         options={chartOptions}
                                         data={getChartData(
                                             analysisResult.topLocations,
                                             'Jobs Found',
                                             'rgba(192, 75, 75, 0.6)', // Example color
                                             'rgba(192, 75, 75, 1)'
                                         )}
                                     />
                                 </div>
                             ) : <p className={styles.noResultsText}>N/A</p>}
                         </div>

                         {/* --- Experience Level (remains text) --- */}
                         <div className={styles.statsFullSpan}>
                             <h3 className={styles.statsSubtitle}>Typical Experience Level:</h3>
                             <div className={styles.analysisContent}> <ReactMarkdown>{analysisResult.experienceSummary || 'N/A'}</ReactMarkdown> </div>
                         </div>
                    </div>
                </section>

                {/* --- Search Strategy Section --- */}
                <section className={`${styles.resultCard} ${styles.fullWidthCard} ${styles.marginTopLarge}`}>
                    <div className={styles.skillGapHeader}>
                        <h2 className={styles.sectionTitle}>Personalized Search Strategy</h2>
                        <button onClick={handleGetStrategy} disabled={loadingStrategy || !canAnalyzeExtras} className={styles.analyzeButtonSmall}>
                            {loadingStrategy ? ( <> {/* Spinner */} Generating...</> ) : ( "Get Strategy Tips" )}
                        </button>
                    </div>
                    {!canAnalyzeExtras && <p className={styles.infoText}>Run 'Analyze Market' first.</p>}
                    {errorStrategy && <div className={styles.errorBoxSmall} role="alert">{errorStrategy}</div>}
                    {strategyTips && !loadingStrategy && !errorStrategy && (
                         <div className={`${styles.analysisContent} ${styles.marginTopMedium}`}> <ReactMarkdown>{strategyTips}</ReactMarkdown> </div>
                     )}
                </section>

                {/* --- Resume Analysis Section (Optional - can still use for separate feedback) --- */}
                 <section className={`${styles.resultCard} ${styles.fullWidthCard} ${styles.marginTopLarge}`}>
                     <h2 className={styles.sectionTitle}>Resume Fitness Analysis <span className={styles.titleSubText}>(Detailed Feedback vs. Market)</span></h2>
                     {/* Keep this section if you want separate, detailed feedback */}
                     {/* If resumeText state is already filled from above, no need for another textarea */}
                      {!resumeText && <p className={styles.infoText}>Paste resume above to enable detailed analysis.</p>}
                     <button onClick={handleAnalyzeResume} disabled={loadingResume || !resumeText.trim() || !canAnalyzeExtras} className={styles.analyzeButton}>
                         {loadingResume ? ( <> {/* Spinner */} Analyzing...</> ) : ( "Get Detailed Resume Feedback" )}
                     </button>
                     {/* ... error/result display ... */}
                 </section>

                {/* --- Skill Gap & Learning Section --- */}
                  <section className={`${styles.resultCard} ${styles.fullWidthCard} ${styles.marginTopLarge}`}>
                      <div className={styles.skillGapHeader}>
                          <h2 className={styles.sectionTitle}>Skill Gap & Learning Recommendations</h2>
                          <button onClick={handleAnalyzeSkillGap} disabled={loadingSkillGap || !canAnalyzeExtras} className={styles.analyzeButtonSmall}>
                              {loadingSkillGap ? ( <> {/* Spinner */} Analyzing...</> ) : ( "Analyze Skill Gaps" )}
                          </button>
                      </div>
                      {!canAnalyzeExtras && <p className={styles.infoText}>Run 'Analyze Market' first.</p>}
                      {errorSkillGap && <div className={styles.errorBoxSmall} role="alert">{errorSkillGap}</div>}
                      {skillGapResult && !loadingSkillGap && !errorSkillGap && ( <div className={`${styles.analysisContent} ${styles.marginTopMedium}`}> <ReactMarkdown>{skillGapResult}</ReactMarkdown> </div> )}
                  </section>

                {/* --- Original Analysis Grid (Stack & Projects) --- */}
                <div className={`${styles.resultsGrid} ${styles.marginTopLarge}`}>
                   {/* REMOVE this section - it was the duplicate job list */}
                   {/*
                   <section className={`${styles.resultCard} ${styles.jobListColumn}`}>
                       <h2 className={styles.sectionTitle}> Scraped Job Listings <span className={styles.titleSubText}>({analysisResult.jobListings.length} found)</span> </h2>
                       {analysisResult.jobListings?.length > 0 ? (
                           <ul className={styles.jobList}>
                               {analysisResult.jobListings.map((job: JobListing, index: number) => (
                                   <li key={job.url || index} className={styles.jobListItem}>
                                       // ... content ...
                                   </li>
                               ))}
                           </ul>
                       ) : (
                           <p className={styles.noResultsText}>No jobs found.</p>
                       )}
                   </section>
                   */}

                   {/* KEEP these analysis sections */}
                   <section className={`${styles.resultCard} ${styles.analysisColumn}`}>
                      <h2 className={styles.sectionTitle}>Common Tech Stack <span className={styles.titleSubText}>(Initial Analysis)</span></h2>
                      <div className={styles.analysisContent}> <ReactMarkdown>{analysisResult.commonStack || 'N/A'}</ReactMarkdown> </div>
                   </section>
                   <section className={`${styles.resultCard} ${styles.analysisColumn}`}>
                      <h2 className={styles.sectionTitle}>Suggested Portfolio Projects <span className={styles.titleSubText}>(Initial Analysis)</span></h2>
                      <div className={styles.analysisContent}> <ReactMarkdown>{analysisResult.projectIdeas || 'N/A'}</ReactMarkdown> </div>
                   </section>

                </div>

                {/* Disclaimer */}
                <p className={styles.disclaimer}>{analysisResult.analysisDisclaimer}</p>

          </div> // End allResultsContainer
        )}
      </div>
    </main>
  );
}