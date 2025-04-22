'use client';

import { useState, useCallback, useEffect, Fragment } from 'react';
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
  description: string;
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
  experienceSummary: string;
  marketInsights: string; // <-- NEW Field added
  topCompanies: StatItem[];
  topLocations: StatItem[];
  analysisDisclaimer: string;
}

// --- NEW: Interface for Parsed Stack Data ---
interface ParsedSkill {
    name: string;
    percentage: number | null; // Store percentage as number or null if not found
}
interface ParsedStackCategory {
    category: string;
    skills: ParsedSkill[];
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

  // --- State for Interview Questions ---
  const [loadingQuestions, setLoadingQuestions] = useState<Record<string, boolean>>({}); // jobUrl -> boolean
  const [errorQuestions, setErrorQuestions] = useState<Record<string, string | null>>({}); // jobUrl -> error string or null
  const [interviewQuestions, setInterviewQuestions] = useState<Record<string, string | null>>({}); // jobUrl -> questions string or null

  // --- NEW: State for Parsed & Filtered Stack Data ---
  const [filteredStackData, setFilteredStackData] = useState<ParsedStackCategory[]>([]);

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

  // === Helper Function: Parse and Filter Stack ===
  const parseAndFilterStack = (markdownString: string | undefined | null): ParsedStackCategory[] => {
      if (!markdownString) return [];

      const categories: ParsedStackCategory[] = [];
      // Regex to find category titles (like **Category Name:**)
      const categoryRegex = /\*\*(.*?):\*\*/g;
      // Regex to find skills with percentages (like Skill Name (~XX%))
      const skillRegex = /^(.*?)\s*(?:\(\s*~?(\d+)%\s*\))?$/; // Made percentage optional capture

      let lastIndex = 0;
      let categoryMatch;

      // Find category blocks
      while ((categoryMatch = categoryRegex.exec(markdownString)) !== null) {
          const categoryName = categoryMatch[1].trim();
          const categoryStartIndex = categoryMatch.index + categoryMatch[0].length;

          // Get content between this category and the next (or end of string)
          const nextCategoryMatch = categoryRegex.exec(markdownString);
          const categoryEndIndex = nextCategoryMatch ? nextCategoryMatch.index : markdownString.length;
          const categoryContent = markdownString.substring(categoryStartIndex, categoryEndIndex).trim();

          // Reset regex index for next search
          categoryRegex.lastIndex = categoryStartIndex;

          const skillsRaw = categoryContent.split('\n').map(s => s.replace(/^-?\s*/, '').trim()).filter(Boolean); // Split lines, remove list markers
          const filteredSkills: ParsedSkill[] = [];

          skillsRaw.forEach(skillLine => {
              const skillMatch = skillLine.match(skillRegex);
              if (skillMatch) {
                  const name = skillMatch[1].trim();
                  // Percentage is optional, default to null if not found/parsed
                  const percentage = skillMatch[2] ? parseInt(skillMatch[2], 10) : null;

                  // Apply filtering logic: Keep if percentage is >= 10 OR if no percentage is found
                  if (percentage === null || percentage >= 10) {
                      filteredSkills.push({ name, percentage });
                  }
              } else if (skillLine) { // Keep lines that don't match regex if they exist (maybe headers or notes?)
                  // We might want to handle these differently or ignore them
                  // For now, let's add them without percentage if filter is only based on percentage
                 // If we want to strictly *only* show items with >=10%, comment out the line below
                 // filteredSkills.push({ name: skillLine, percentage: null });
              }
          });

          if (filteredSkills.length > 0) {
              categories.push({ category: categoryName, skills: filteredSkills });
          }
      }

      return categories;
  };

  // --- Effect to Parse and Filter Stack Data ---
  useEffect(() => {
      if (analysisResult?.commonStack) {
          const parsedData = parseAndFilterStack(analysisResult.commonStack);
          setFilteredStackData(parsedData);
      } else {
          setFilteredStackData([]); // Clear if no stack data
      }
  }, [analysisResult?.commonStack]);

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

  // --- NEW: Interview Questions Handler ---
  const handleGenerateQuestions = useCallback(async (jobUrl: string, jobDescription: string) => {
    if (!jobUrl || !jobDescription || jobDescription === 'No description available.') {
        setErrorQuestions(prev => ({ ...prev, [jobUrl]: 'Full job description unavailable.' }));
        return;
    }

    setLoadingQuestions(prev => ({ ...prev, [jobUrl]: true }));
    setErrorQuestions(prev => ({ ...prev, [jobUrl]: null }));
    setInterviewQuestions(prev => ({ ...prev, [jobUrl]: null })); // Clear previous questions

    try {
        const response = await fetch('/api/interview-questions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jobDescription }),
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || `HTTP error! Status: ${response.status}`);
        }
        setInterviewQuestions(prev => ({ ...prev, [jobUrl]: data.interviewQuestions }));
    } catch (err: any) {
        console.error("Generate questions fetch error:", err);
        setErrorQuestions(prev => ({ ...prev, [jobUrl]: err.message || 'Error generating questions.' }));
        setInterviewQuestions(prev => ({ ...prev, [jobUrl]: null })); // Clear on error
    } finally {
        setLoadingQuestions(prev => ({ ...prev, [jobUrl]: false }));
    }
  }, []); // No dependencies needed if it only uses args and fetch

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
        marketInsights,
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

    exportContent += `## Overall Market Insights\n\n${marketInsights || 'N/A'}\n\n`;
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

            {/* --- NEW: Overall Market Insights Section --- */}
            <section className={`${styles.resultCard} ${styles.fullWidthCard} ${styles.marginTopMedium} ${styles.marginBottomMedium}`}>
              <h2 className={styles.sectionTitle}>Overall Market Insights</h2>
              <div className={styles.analysisContent}>
                {(analysisResult.marketInsights && !analysisResult.marketInsights.toLowerCase().includes('could not parse'))
                  ? <ReactMarkdown>{analysisResult.marketInsights}</ReactMarkdown>
                  : <p className={styles.noResultsText}>Could not generate market insights summary.</p>
                }
              </div>
            </section>
            {/* --- END NEW --- */}

            {/* *** Export Button *** */}
            <div style={{ marginBottom: '1.5rem', textAlign: 'right' }}>
              <button
                onClick={handleExportAnalysis}
                className={styles.analyzeButtonSmall}
                disabled={!analysisResult}
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
                          // Use URL as the key for state management
                          const key = job.url || `job-${index}`;
                          const jobTitle = job.title || 'Job Title Unavailable';
                          const companyName = job.company_name;
                          const location = job.location;
                          const snippet = job.snippet || 'No snippet available.';
                          const canGenerateQuestions = job.description && job.description !== 'No description available.';

                          return (
                           <li key={key} className={styles.jobListItem}> {/* Use URL or index for key */}
                               <a href={job.url} target="_blank" rel="noopener noreferrer" className={styles.jobTitleLink}>
                                   {jobTitle}
                               </a>
                               <div className={styles.jobMeta}>
                                    {companyName && ( <span title="Company"> {/* ... icon ... */} {companyName} </span> )}
                                    {location && ( <span title="Location"> {/* ... icon ... */} {location} </span> )}
                                    {!companyName && !location && <span>Details unavailable</span>}
                                </div>
                               {job.snippet && <p className={styles.jobSnippet}>{snippet}</p>}

                               {/* --- Action Buttons for Job Item --- */}
                               <div className={styles.jobItemActions}>
                                   {/* Find Similar Button */}
                                    <button
                                        onClick={() => handleFindSimilarJobs(job)}
                                        disabled={loadingSimilar || loadingFilter || !job.url || job.url === '#'}
                                        className={`${styles.analyzeButtonSmall} ${styles.jobActionButton}`}
                                        title={`Find jobs similar to ${jobTitle}`}
                                    >
                                       Find Similar
                                    </button>

                                    {/* --- Generate Questions Button --- */}
                                   <button
                                        onClick={() => handleGenerateQuestions(key, job.description)}
                                        disabled={!canGenerateQuestions || loadingQuestions[key]}
                                        className={`${styles.analyzeButtonSmall} ${styles.jobActionButton}`}
                                        title={canGenerateQuestions ? `Generate potential interview questions for ${jobTitle}` : "Full description needed to generate questions"}
                                    >
                                        {loadingQuestions[key] ? "Generating..." : "Interview Qs"}
                                    </button>
                               </div>

                               {/* --- Display Area for Questions --- */}
                               {loadingQuestions[key] && (
                                  <div className={`${styles.loadingIndicatorSmall} ${styles.marginTopMedium}`}>
                                      {/* Small Spinner SVG */}
                                      <svg className={styles.spinnerSmall} viewBox="0 0 50 50"><circle className={styles.spinnerCircle} cx="25" cy="25" r="20" fill="none" strokeWidth="5"></circle><circle className={styles.spinnerPath} cx="25" cy="25" r="20" fill="none" strokeWidth="5" strokeLinecap="round"><animateTransform attributeName="transform" type="rotate" from="0 25 25" to="360 25 25" dur="1s" repeatCount="indefinite"></animateTransform></circle></svg>
                                      <span>Loading Questions...</span>
                                  </div>
                               )}
                               {errorQuestions[key] && (
                                  <div className={`${styles.errorBoxSmall} ${styles.marginTopMedium}`} role="alert">
                                      {errorQuestions[key]}
                                  </div>
                               )}
                               {interviewQuestions[key] && !loadingQuestions[key] && !errorQuestions[key] && (
                                  <div className={`${styles.interviewQuestionsBox} ${styles.marginTopMedium}`}>
                                       <h4 className={styles.interviewQuestionsTitle}>Potential Interview Questions:</h4>
                                       {/* Use ReactMarkdown for potential list formatting from Gemini */}
                                       <ReactMarkdown>
                                          {interviewQuestions[key]}
                                       </ReactMarkdown>
                                   </div>
                               )}
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
                      {(analysisResult.jobPrioritization || '').includes("based on your resume")
                          ? " (Top matches for your resume from relevant jobs found)"
                          : " (Top matches for your query from relevant jobs found)"}
                  </span>
              </h2>
              <div className={`${styles.analysisContent} ${styles.jobRecommendationsContent}`}>
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
               {!resumeText && <p className={styles.infoText}>Paste resume above to enable detailed analysis.</p>}
               <button onClick={handleAnalyzeResume} disabled={loadingResume || !resumeText.trim() || !canAnalyzeExtras} className={`${styles.analyzeButtonSmall} ${styles.marginTopMedium}`}>
                   {loadingResume ? ( <> {/* Spinner */} Analyzing...</> ) : ( "Get Detailed Resume Feedback" )}
               </button>
               {loadingResume && <div className={styles.loadingIndicator} style={{padding: '1rem 0'}}><p>Loading feedback...</p></div>}
               {errorResume && <div className={styles.errorBoxSmall} role="alert">{errorResume}</div>}
               {resumeAnalysisResult && !loadingResume && !errorResume && (
                   <div className={`${styles.analysisContent} ${styles.marginTopMedium}`}> <ReactMarkdown>{resumeAnalysisResult}</ReactMarkdown> </div>
               )}
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
             {/* --- Common Tech Stack (Filtered & Rendered Directly) --- */}
             <section className={`${styles.resultCard} ${styles.analysisColumn}`}>
               <h2 className={styles.sectionTitle}>
                 Common Tech Stack <span className={styles.titleSubText}>(Skills mentioned in ≥10% of jobs)</span>
               </h2>
               <div className={`${styles.analysisContent} ${styles.techStackContent}`}>
                 {filteredStackData.length > 0 ? (
                   filteredStackData.map((categoryData) => (
                     // Use Fragment to avoid unnecessary divs unless needed for styling
                     <Fragment key={categoryData.category}>
                       <strong className={styles.techStackCategoryTitle}>
                         {categoryData.category}:
                       </strong>
                       <ul className={styles.techStackSkillList}>
                         {categoryData.skills.map((skill, index) => (
                           <li key={`${categoryData.category}-${skill.name}-${index}`}>
                             {skill.name}
                             {/* Conditionally display percentage */}
                             {skill.percentage !== null && (
                               <span className={styles.techStackPercentage}>
                                 {`(~${skill.percentage}%)`}
                               </span>
                             )}
                           </li>
                         ))}
                       </ul>
                     </Fragment>
                   ))
                 ) : (analysisResult.commonStack && !analysisResult.commonStack.toLowerCase().includes('could not parse')) ? (
                    <p className={styles.noResultsText}>No skills found meeting the ≥10% threshold.</p>
                  ) : (
                    <p className={styles.noResultsText}>Could not analyze tech stack.</p>
                 )}
               </div>
            </section>

             {/* --- Suggested Projects (Still uses ReactMarkdown) --- */}
             <section className={`${styles.resultCard} ${styles.analysisColumn}`}>
               <h2 className={styles.sectionTitle}>Suggested Portfolio Projects <span className={styles.titleSubText}>(Based on Prioritized Jobs)</span></h2>
               <div className={styles.analysisContent}>
                  {(analysisResult.projectIdeas && !analysisResult.projectIdeas.toLowerCase().includes('could not parse'))
                      ? <ReactMarkdown>{analysisResult.projectIdeas}</ReactMarkdown>
                      : <p className={styles.noResultsText}>Could not generate project ideas.</p>
                  }
            </div>
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