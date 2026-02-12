/**
 * Canvas Grade & GPA Calculator - Popup Script
 * Main UI controller for the extension popup
 */

// Helper: Check if a term is a real semester (Fall/Spring/Summer/Winter + Year)
function isRealSemester(name) {
  if (!name) return false;
  return /^(Fall|Spring|Summer|Winter)\s+\d{4}/i.test(name);
}

// Grading Scale Presets - using constants.js for single source of truth
const GRADING_SCALES = {
  njit: {
    name: 'NJIT',
    grades: LETTER_GRADES.njit,
    points: GRADE_POINTS_NJIT
  },
  plusMinus: {
    name: 'Standard Plus/Minus',
    grades: LETTER_GRADES.plusMinus,
    points: GRADE_POINTS_PLUS_MINUS
  },
  standard: {
    name: 'Standard',
    grades: LETTER_GRADES.standard,
    points: GRADE_POINTS_STANDARD
  },
  custom: {
    name: 'Custom',
    grades: LETTER_GRADES.plusMinus,
    points: {}
  }
};

// Current grading scale (default to NJIT)
let currentGradingScale = GRADING_SCALES.njit;

// State management
const state = {
  allCourses: [],      // All courses from Canvas
  courses: [],         // Filtered courses for current semester
  semesters: [],       // Available semesters
  selectedSemester: 'all',
  semesterGPA: null,
  cumulativeGPA: null,
  isConnected: false,
  isLoading: false
};

// DOM Elements
const elements = {
  // Tabs
  tabs: document.querySelectorAll('.tab'),
  tabContents: document.querySelectorAll('.tab-content'),

  // Dashboard
  connectionStatus: document.getElementById('connectionStatus'),
  semesterGPA: document.getElementById('semesterGPA'),
  semesterCredits: document.getElementById('semesterCredits'),
  cumulativeGPA: document.getElementById('cumulativeGPA'),
  totalCredits: document.getElementById('totalCredits'),
  academicStanding: document.getElementById('academicStanding'),
  targetGPA: document.getElementById('targetGPA'),
  calculateTarget: document.getElementById('calculateTarget'),
  targetResult: document.getElementById('targetResult'),
  targetMessage: document.getElementById('targetMessage'),
  courseImpactList: document.getElementById('courseImpactList'),
  refreshBtn: document.getElementById('refreshBtn'),

  // Semester Filter
  semesterSelect: document.getElementById('semesterSelect'),
  courseSemesterSelect: document.getElementById('courseSemesterSelect'),
  semesterCreditsDisplay: document.getElementById('semesterCredits'),
  manageExcludedBtn: document.getElementById('manageExcludedBtn'),

  // Courses
  coursesList: document.getElementById('coursesList'),
  coursesGpaValue: document.getElementById('coursesGpaValue'),
  coursesCreditsValue: document.getElementById('coursesCreditsValue'),

  // Add Course
  addCourseBtn: document.getElementById('addCourseBtn'),

  // Settings
  canvasUrl: document.getElementById('canvasUrl'),
  apiToken: document.getElementById('apiToken'),
  saveConnection: document.getElementById('saveConnection'),
  testConnection: document.getElementById('testConnection'),
  connectionTestResult: document.getElementById('connectionTestResult'),
  tokenHelp: document.getElementById('tokenHelp'),
  tokenHelpContent: document.getElementById('tokenHelpContent'),
  previousGPA: document.getElementById('previousGPA'),
  previousCredits: document.getElementById('previousCredits'),
  savePreviousGPA: document.getElementById('savePreviousGPA'),
  clearCache: document.getElementById('clearCache'),
  resetSemesters: document.getElementById('resetSemesters'),
  exportData: document.getElementById('exportData'),
  clearAllData: document.getElementById('clearAllData')
};

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  await initializeDarkMode();
  await initializeGradingScale();
  await initializePopup();
  setupEventListeners();
  setupAutoSyncListener();
});

/**
 * Initialize dark mode based on saved preference
 */
async function initializeDarkMode() {
  const { darkMode } = await Storage.get('darkMode');
  if (darkMode) {
    document.body.classList.add('dark-mode');
    updateDarkModeIcon(true);
  }
}

/**
 * Toggle dark mode
 */
async function toggleDarkMode() {
  const isDark = document.body.classList.toggle('dark-mode');
  await Storage.set({ darkMode: isDark });
  updateDarkModeIcon(isDark);
}

/**
 * Update dark mode toggle icon
 */
function updateDarkModeIcon(isDark) {
  const icon = document.querySelector('.dark-mode-icon');
  if (icon) {
    icon.textContent = isDark ? '☀️' : '🌙';
  }
}

/**
 * Initialize grading scale from saved preference
 */
async function initializeGradingScale() {
  const { selectedGradingScale, customGradingPoints } = await Storage.get(['selectedGradingScale', 'customGradingPoints']);

  const scaleSelect = document.getElementById('gradingScaleSelect');
  if (scaleSelect && selectedGradingScale) {
    scaleSelect.value = selectedGradingScale;
  }

  // Load custom scale if saved
  if (customGradingPoints) {
    GRADING_SCALES.custom.points = customGradingPoints;
  } else {
    // Default custom to plus/minus values
    GRADING_SCALES.custom.points = { ...GRADING_SCALES.plusMinus.points };
  }

  // Set current scale
  const scaleKey = selectedGradingScale || 'njit';
  currentGradingScale = GRADING_SCALES[scaleKey] || GRADING_SCALES.njit;

  // Update UI
  updateScalePreview();
  toggleCustomScaleEditor(scaleKey === 'custom');
}

/**
 * Handle grading scale change
 */
async function handleGradingScaleChange(scaleKey) {
  currentGradingScale = GRADING_SCALES[scaleKey] || GRADING_SCALES.njit;
  await Storage.set({ selectedGradingScale: scaleKey });

  toggleCustomScaleEditor(scaleKey === 'custom');
  updateScalePreview();

  // Recalculate GPAs with new scale
  if (state.isConnected) {
    await loadCoursesData();
  }

  showStatus('success', `Grading scale changed to ${currentGradingScale.name}`);
}

/**
 * Toggle custom scale editor visibility
 */
function toggleCustomScaleEditor(show) {
  const editor = document.getElementById('customScaleEditor');
  if (!editor) return;

  if (show) {
    editor.classList.remove('hidden');
    renderCustomScaleEditor();
  } else {
    editor.classList.add('hidden');
  }
}

/**
 * Render custom scale editor inputs
 */
function renderCustomScaleEditor() {
  const grid = document.getElementById('customScaleGrid');
  if (!grid) return;

  const grades = GRADING_SCALES.custom.grades;
  const points = GRADING_SCALES.custom.points;

  grid.innerHTML = grades.map(grade => `
    <div class="custom-scale-item">
      <label>${grade}:</label>
      <input type="number"
             id="customGrade_${grade.replace(/[+-]/g, '')}"
             data-grade="${grade}"
             min="0" max="4" step="0.1"
             value="${points[grade] ?? ''}"
             placeholder="0.0">
    </div>
  `).join('');
}

/**
 * Save custom grading scale
 */
async function saveCustomScale() {
  const grid = document.getElementById('customScaleGrid');
  if (!grid) return;

  const inputs = grid.querySelectorAll('input');
  const points = {};

  inputs.forEach(input => {
    const grade = input.dataset.grade;
    const value = parseFloat(input.value);
    if (!isNaN(value) && value >= 0 && value <= 4) {
      points[grade] = value;
    }
  });

  GRADING_SCALES.custom.points = points;
  currentGradingScale = GRADING_SCALES.custom;

  await Storage.set({
    customGradingPoints: points,
    selectedGradingScale: 'custom'
  });

  updateScalePreview();

  // Recalculate GPAs with new scale
  if (state.isConnected) {
    await loadCoursesData();
  }

  showStatus('success', 'Custom grading scale saved');
}

/**
 * Update scale preview display
 */
function updateScalePreview() {
  const preview = document.getElementById('currentScalePreview');
  if (!preview) return;

  const grades = currentGradingScale.grades;
  const points = currentGradingScale.points;

  // SECURITY: Use safe DOM construction instead of innerHTML
  preview.innerHTML = '';

  const title = document.createElement('div');
  title.className = 'scale-preview-title';
  title.textContent = `Current Scale: ${currentGradingScale.name}`;
  preview.appendChild(title);

  const gradesDiv = document.createElement('div');
  gradesDiv.className = 'scale-preview-grades';

  grades
    .filter(g => points[g] !== undefined)
    .forEach(g => {
      const span = document.createElement('span');
      span.className = 'scale-preview-item';
      span.textContent = `${g}=${points[g].toFixed(1)}`;
      gradesDiv.appendChild(span);
    });

  preview.appendChild(gradesDiv);
}

/**
 * Get grade points for a letter grade using current scale
 */
function getGradePoints(letterGrade) {
  if (!letterGrade || letterGrade === 'N/A') return null;
  return currentGradingScale.points[letterGrade] ?? null;
}

/**
 * Get available grades for current scale
 */
function getAvailableGrades() {
  return [...currentGradingScale.grades, 'N/A'];
}

/**
 * Setup listener for auto-sync updates from background script
 */
function setupAutoSyncListener() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'DATA_REFRESHED') {
      console.log('[Canvas GPA] Auto-sync update received:', message);

      // Reload data when background sync completes
      if (state.isConnected) {
        loadCoursesData();
      }

      // Update sync info
      updateLastSyncInfo();

      // Show notification if grades changed
      if (message.gradeChanges && message.gradeChanges.length > 0) {
        showStatus('info', `${message.gradeChanges.length} grade(s) updated!`);
      }
    }
    return true;
  });

  // Initialize sync info display
  updateLastSyncInfo();
}

/**
 * Initialize the popup with stored data
 */
async function initializePopup() {
  try {
    await Storage.initialize();

    // Load saved settings
    const token = await Storage.getApiToken();
    const baseUrl = await Storage.getBaseUrl();
    const { gpa: prevGPA, credits: prevCredits } = await Storage.getPreviousGPA();

    // Populate settings fields
    if (baseUrl) elements.canvasUrl.value = baseUrl;
    if (token) elements.apiToken.value = '••••••••••••••••'; // Mask token
    if (prevGPA !== null) elements.previousGPA.value = prevGPA;
    if (prevCredits) elements.previousCredits.value = prevCredits;

    // Check if connected and load data
    if (token && baseUrl) {
      await CanvasAPI.init(token, baseUrl);
      const isValid = await CanvasAPI.verifyToken();

      if (isValid) {
        state.isConnected = true;
        showStatus('success', 'Connected to Canvas');
        await loadCoursesData();
      } else {
        showStatus('error', 'Invalid API token. Please update in Settings.');
      }
    } else {
      showStatus('info', 'Please connect to Canvas in Settings to get started.');
    }
  } catch (error) {
    console.error('Initialization error:', error);
    showStatus('error', 'Failed to initialize. Please try again.');
  }
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Dark mode toggle
  const darkModeToggle = document.getElementById('darkModeToggle');
  if (darkModeToggle) {
    darkModeToggle.addEventListener('click', toggleDarkMode);
  }

  // Tab switching
  elements.tabs.forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Refresh button
  elements.refreshBtn.addEventListener('click', async () => {
    if (state.isConnected) {
      console.log('[GPA Popup] Manual refresh clicked - triggering background worker');
      elements.refreshBtn.disabled = true;
      elements.refreshBtn.classList.add('loading');

      try {
        // Trigger background worker refresh FIRST to fetch fresh grades
        console.log('[GPA Popup] Sending REFRESH_DATA message to background worker');
        const result = await chrome.runtime.sendMessage({ type: 'REFRESH_DATA' });
        console.log('[GPA Popup] Background refresh response:', result);

        // Wait a moment for background worker to update storage
        await new Promise(resolve => setTimeout(resolve, 500));

        // THEN clear cache and reload popup with fresh data
        console.log('[GPA Popup] Clearing cache and reloading courses...');
        await Storage.clearCache();
        await loadCoursesData();

        // Update sync time on manual refresh
        await Storage.set({ lastSyncTime: Date.now() });
        await updateLastSyncInfo();

        console.log('[GPA Popup] Refresh complete - grades updated');
      } catch (error) {
        console.error('[GPA Popup] Error during refresh:', error);
        showStatus('error', 'Refresh failed. Please try again.');
      } finally {
        elements.refreshBtn.disabled = false;
        elements.refreshBtn.classList.remove('loading');
      }
    }
  });

  // Semester filter
  elements.semesterSelect.addEventListener('change', (e) => {
    state.selectedSemester = e.target.value;
    elements.courseSemesterSelect.value = e.target.value;
    filterCoursesBySemester();
  });

  elements.courseSemesterSelect.addEventListener('change', (e) => {
    state.selectedSemester = e.target.value;
    elements.semesterSelect.value = e.target.value;
    filterCoursesBySemester();
  });

  // Add course button
  elements.addCourseBtn.addEventListener('click', addManualCourse);

  // Manage excluded semesters
  if (elements.manageExcludedBtn) {
    elements.manageExcludedBtn.addEventListener('click', manageExcludedSemesters);
  }

  // Edit semester GPA (click on GPA value to override)
  if (elements.semesterGPA) {
    elements.semesterGPA.addEventListener('click', editSemesterGPA);
    elements.semesterGPA.classList.add('clickable');
  }

  // Edit semester credits (dashboard and courses tab)
  if (elements.semesterCreditsDisplay) {
    elements.semesterCreditsDisplay.addEventListener('click', editSemesterCredits);
  }
  if (elements.coursesCreditsValue) {
    elements.coursesCreditsValue.addEventListener('click', editSemesterCredits);
  }

  // Edit cumulative GPA (click on GPA value to override)
  if (elements.cumulativeGPA) {
    elements.cumulativeGPA.addEventListener('click', editCumulativeGPA);
    elements.cumulativeGPA.classList.add('clickable');
  }

  // Edit cumulative credits
  if (elements.totalCredits) {
    elements.totalCredits.addEventListener('click', editCumulativeCredits);
    elements.totalCredits.classList.add('clickable');
  }

  // Target GPA calculator
  elements.calculateTarget.addEventListener('click', calculateTargetGPA);

  // What-If Calculator
  const whatifCourse = document.getElementById('whatifCourse');
  if (whatifCourse) {
    whatifCourse.addEventListener('change', handleWhatIfCourseChange);
  }

  const calculateWhatifBtn = document.getElementById('calculateWhatif');
  if (calculateWhatifBtn) {
    calculateWhatifBtn.addEventListener('click', calculateWhatIf);
  }

  // Settings - Connection
  elements.saveConnection.addEventListener('click', saveConnection);
  elements.testConnection.addEventListener('click', testConnection);
  elements.tokenHelp.addEventListener('click', (e) => {
    e.preventDefault();
    elements.tokenHelpContent.classList.toggle('hidden');
  });

  // Settings - Grading Scale
  const gradingScaleSelect = document.getElementById('gradingScaleSelect');
  if (gradingScaleSelect) {
    gradingScaleSelect.addEventListener('change', (e) => handleGradingScaleChange(e.target.value));
  }

  const saveCustomScaleBtn = document.getElementById('saveCustomScale');
  if (saveCustomScaleBtn) {
    saveCustomScaleBtn.addEventListener('click', saveCustomScale);
  }

  // Settings - Previous GPA
  elements.savePreviousGPA.addEventListener('click', savePreviousGPA);

  // Settings - Data management
  elements.clearCache.addEventListener('click', async () => {
    await Storage.clearCache();
    showTestResult('success', 'Cache cleared successfully');
  });

  elements.resetSemesters.addEventListener('click', async () => {
    await chrome.storage.local.set({
      detectedSemesters: [],
      upcomingSemesters: [],
      excludedSemesters: []
    });
    await Storage.clearCache();
    showTestResult('success', 'Semester detection reset. Click refresh to re-scan.');
  });

  elements.exportData.addEventListener('click', exportData);

  elements.clearAllData.addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear all data? This cannot be undone.')) {
      await Storage.clear();
      location.reload();
    }
  });
}

/**
 * Switch between tabs
 */
function switchTab(tabId) {
  elements.tabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabId);
  });

  elements.tabContents.forEach(content => {
    content.classList.toggle('active', content.id === tabId);
  });
}

/**
 * Show status banner
 */
function showStatus(type, message) {
  elements.connectionStatus.className = `status-banner ${type}`;
  elements.connectionStatus.textContent = message;
}

/**
 * Update last sync info display
 */
async function updateLastSyncInfo() {
  const syncInfoEl = document.getElementById('lastSyncInfo');
  if (!syncInfoEl) return;

  const { lastSyncTime, upcomingSemesters = [] } = await Storage.get(['lastSyncTime', 'upcomingSemesters']);

  if (lastSyncTime) {
    const date = new Date(lastSyncTime);
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = date.toLocaleDateString();

    // SECURITY: Use safe DOM construction instead of innerHTML
    syncInfoEl.innerHTML = '';

    // Add main sync info
    const mainText = document.createElement('span');
    mainText.textContent = 'Last synced: ';
    syncInfoEl.appendChild(mainText);

    const syncTime = document.createElement('span');
    syncTime.className = 'sync-time';
    syncTime.textContent = timeStr;
    syncInfoEl.appendChild(syncTime);

    const badge = document.createElement('span');
    badge.className = 'auto-sync-badge';
    badge.textContent = 'Auto-sync ON';
    syncInfoEl.appendChild(badge);

    if (upcomingSemesters.length > 0) {
      const br = document.createElement('br');
      syncInfoEl.appendChild(br);

      const info = document.createElement('small');
      info.textContent = `${upcomingSemesters.join(', ')} auto-excluded from cumulative`;
      syncInfoEl.appendChild(info);
    }
  } else {
    syncInfoEl.textContent = 'Auto-sync: Every 15 minutes';
  }
}

/**
 * Show test result
 */
function showTestResult(type, message) {
  elements.connectionTestResult.className = `test-result ${type}`;
  elements.connectionTestResult.textContent = message;
}

/**
 * Load courses data from Canvas
 */
async function loadCoursesData() {
  if (state.isLoading) return;

  state.isLoading = true;
  elements.refreshBtn.classList.add('loading');

  try {
    // Try cache first
    let courses = await Storage.getCachedCourses();

    if (!courses) {
      // Fetch from API
      courses = await CanvasAPI.getAllCoursesWithGrades();
      await Storage.setCachedCourses(courses);
    }

    // Get custom course data from storage
    const { customCourseData = {} } = await Storage.get('customCourseData');

    // Process each course with grading scale detection and grade calculation from assignments
    const processedCourses = await Promise.all(
      courses.map(async (course) => {
        // Fetch assignment groups from background worker to calculate grade
        let calculatedGrade = null;
        let gradeSource = 'custom';

        try {
          const groupsResponse = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
              { type: 'GET_ASSIGNMENT_GROUPS', courseId: course.id },
              (response) => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                } else if (response?.error) {
                  reject(new Error(response.error));
                } else {
                  resolve(response);
                }
              }
            );
          });

          const groups = groupsResponse?.groups || [];
          if (groups.length > 0) {
            // Calculate grade from assignments
            const gradeResult = GradeCalculator.calculateCourseGrade(groups, { includeUngraded: false });
            if (gradeResult?.percentage !== null) {
              calculatedGrade = gradeResult.percentage;
              gradeSource = 'assignments';
            }
          }
        } catch (error) {
          console.warn(`[GPA Calc] Failed to fetch assignment groups for course ${course.id}:`, error.message);
        }

        // If assignment calculation failed, try enrollment
        if (calculatedGrade === null) {
          try {
            const enrollmentArray = await new Promise((resolve, reject) => {
              chrome.runtime.sendMessage(
                { type: 'GET_ENROLLMENTS', courseId: course.id },
                (response) => {
                  if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                  } else if (response?.error) {
                    reject(new Error(response.error));
                  } else {
                    resolve(response);
                  }
                }
              );
            });
            const enrollmentData = Array.isArray(enrollmentArray) ? enrollmentArray[0] : enrollmentArray;

            // Use final score if available, otherwise current score
            const finalScore = enrollmentData?.grades?.final_score;
            const currentScore = enrollmentData?.grades?.current_score;
            calculatedGrade = finalScore !== null ? finalScore : currentScore;
            if (calculatedGrade !== null) {
              gradeSource = 'enrollment';
            }
          } catch (error) {
            console.warn(`[GPA Calc] Failed to fetch enrollment for course ${course.id}:`, error.message);
          }
        }

        const gradingScale = await GradingScaleDetector.getGradingScale(course.id, {
          canvasApi: CanvasAPI,
          storage: Storage
        });

        const customData = customCourseData[course.id];

        // Convert calculated grade to letter grade
        let letterGrade;
        let gradePoints;
        let credits = course.credits || estimateCreditHours(course);
        let term = course.term;

        // Check custom data first (user overrides take priority)
        if (customData && customData.letterGrade) {
          letterGrade = customData.letterGrade;
          gradePoints = customData.gradePoints;
          credits = customData.credits || credits;
          term = customData.term || term;
          gradeSource = 'custom';
        } else if (calculatedGrade !== null) {
          const gradeInfo = GradingScaleDetector.getGradeInfo(calculatedGrade, gradingScale);
          letterGrade = gradeInfo.letterGrade;
          gradePoints = getGradePoints(letterGrade);
          gradeSource = 'calculated';
        }

        return {
          ...course,
          credits: credits || 3,
          term: term || null,
          letterGrade: letterGrade || null,
          gradePoints: gradePoints != null ? gradePoints : null,
          calculatedGrade: calculatedGrade,
          gradingScale,
          gradeSource // 'assignments', 'enrollment', or 'custom'
        };
      })
    );

    // Add manual courses from storage
    const { manualCourses = [] } = await Storage.get('manualCourses');
    const { excludedCourses = [] } = await Storage.get('excludedCourses');

    // Combine and deduplicate courses by ID
    const combinedCourses = [...processedCourses, ...manualCourses.map(mc => ({
      ...mc,
      gradeSource: 'manual',
      calculatedGrade: null
    }))];

    // Deduplicate by course ID (keep first occurrence)
    const seenIds = new Set();
    const allCourses = combinedCourses.filter(c => {
      const id = c.id.toString();
      if (seenIds.has(id)) {
        console.log('[GPA Calc] Removing duplicate course:', c.name, c.id);
        return false;
      }
      seenIds.add(id);
      return true;
    }).map(c => ({
      ...c,
      term: normalizeSemesterName(c.term), // Normalize term names
      excludedFromGPA: excludedCourses.includes(c.id.toString()) || excludedCourses.includes(c.id)
    }));

    state.allCourses = allCourses;
    await Storage.setCourses(processedCourses); // Only save Canvas courses

    // Extract and populate semesters
    extractSemesters();
    populateSemesterDropdowns();

    // Auto-exclude upcoming semesters on first load
    await autoExcludeUpcomingSemesters();

    // Filter and display
    filterCoursesBySemester();

    // Update last sync info
    await updateLastSyncInfo();

  } catch (error) {
    console.error('Error loading courses:', error);
    showStatus('error', `Failed to load courses: ${error.message}`);
  } finally {
    state.isLoading = false;
    elements.refreshBtn.classList.remove('loading');
  }
}

/**
 * Estimate credit hours from course (fallback)
 */
function estimateCreditHours(course) {
  // Try to parse from course code (e.g., "CS 114" often = 4 credits)
  // This is a fallback - ideally user sets credits manually
  return 3; // Default to 3 credits
}

/**
 * Normalize semester name (trim, standardize format)
 */
function normalizeSemesterName(term) {
  if (!term) return 'Unknown Term';

  // Handle term as object (Canvas returns { name: "Fall 2024", ... })
  let termStr = typeof term === 'object' ? (term.name || 'Unknown Term') : term;

  if (typeof termStr !== 'string') return 'Unknown Term';

  // Trim whitespace
  let normalized = termStr.trim();

  // Standardize format: "Fall 2024", "Spring 2025", etc.
  const match = normalized.match(/(Spring|Summer|Fall|Winter)\s*'?(\d{2,4})/i);
  if (match) {
    const season = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
    let year = parseInt(match[2]);
    if (year < 100) year += 2000;
    normalized = `${season} ${year}`;
  }

  return normalized;
}

/**
 * Extract unique semesters from courses
 */
function extractSemesters() {
  const semesterSet = new Map();

  console.log('[GPA Calc] All courses:', state.allCourses);

  // First, normalize all course terms
  state.allCourses.forEach(course => {
    course.term = normalizeSemesterName(course.term);
  });

  state.allCourses.forEach(course => {
    console.log('[GPA Calc] Course term:', course.name, '→', course.term);
    const termName = course.term || 'Unknown Term';
    if (!semesterSet.has(termName)) {
      // Try to parse semester info for sorting
      const sortKey = getSemesterSortKey(termName);
      semesterSet.set(termName, { name: termName, sortKey });
    }
  });

  // Only show real semesters (Fall/Spring/Summer/Winter + Year)
  state.semesters = Array.from(semesterSet.values())
    .filter(s => isRealSemester(s.name))
    .sort((a, b) => b.sortKey - a.sortKey)
    .map(s => s.name);

  console.log('[GPA Calc] Extracted semesters:', state.semesters);

  // Mark which semesters are upcoming (for display purposes)
  state.upcomingSemesters = state.semesters.filter(sem => isFutureSemester(sem));
  console.log('[GPA Calc] Upcoming semesters:', state.upcomingSemesters);
}

/**
 * Get sort key for semester (higher = more recent)
 */
function getSemesterSortKey(termName) {
  // Parse patterns like "Fall 2024", "Spring 2025", "Summer 2024"
  const match = termName.match(/(Spring|Summer|Fall|Winter)\s*(\d{2,4})/i);
  if (match) {
    let year = parseInt(match[2]);
    if (year < 100) year += 2000; // Convert "24" to "2024"

    const season = match[1].toLowerCase();
    const seasonOrder = { winter: 0, spring: 1, summer: 2, fall: 3 };
    const seasonValue = seasonOrder[season] || 0;

    return year * 10 + seasonValue;
  }

  // Fallback: try to find any year
  const yearMatch = termName.match(/(\d{4})/);
  if (yearMatch) {
    return parseInt(yearMatch[1]) * 10;
  }

  return 0;
}

/**
 * Populate semester dropdown menus
 */
function populateSemesterDropdowns() {
  // Show upcoming semesters with indicator
  const options = state.semesters.map(sem => {
    const isUpcoming = state.upcomingSemesters && state.upcomingSemesters.includes(sem);
    return `<option value="${sem}">${sem}${isUpcoming ? ' (upcoming)' : ''}</option>`;
  }).join('');

  elements.semesterSelect.innerHTML = options;
  elements.courseSemesterSelect.innerHTML = options;

  // Auto-select most recent COMPLETED semester (not upcoming)
  if (!state.selectedSemester || state.selectedSemester === 'all' || !state.semesters.includes(state.selectedSemester)) {
    const completedSemesters = state.semesters.filter(s => !state.upcomingSemesters?.includes(s));
    state.selectedSemester = completedSemesters[0] || state.semesters[0] || '';
  }

  elements.semesterSelect.value = state.selectedSemester;
  elements.courseSemesterSelect.value = state.selectedSemester;
}

/**
 * Filter courses by selected semester
 */
function filterCoursesBySemester() {
  state.courses = state.allCourses.filter(course =>
    course.term === state.selectedSemester
  );

  // Update displays
  updateGPADisplay();
  updateCoursesGPADisplay();
  renderCoursesList();
  renderCourseImpact();
  populateWhatIfCourses();
}

/**
 * Update GPA display
 */
async function updateGPADisplay() {
  // Calculate semester GPA (excluding courses marked as excluded)
  const includedSemesterCourses = state.courses.filter(c => !c.excludedFromGPA);
  const semesterResult = GPACalculator.calculateSemesterGPA(includedSemesterCourses);
  state.semesterGPA = semesterResult;

  // Check for GPA and credit overrides for this semester
  const { semesterGPAOverrides = {} } = await Storage.get('semesterGPAOverrides');
  const { semesterCreditOverrides = {} } = await Storage.get('semesterCreditOverrides');
  const semesterKey = state.selectedSemester || 'all';
  const gpaOverride = semesterGPAOverrides[semesterKey];
  const creditOverride = semesterCreditOverrides[semesterKey];

  // Use overrides if set, otherwise use calculated
  const displayCredits = creditOverride != null ? creditOverride : (semesterResult.totalCredits || 0);
  const effectiveGPA = gpaOverride != null ? gpaOverride : semesterResult.gpa;

  const gpaHasOverride = gpaOverride != null;
  const creditsHasOverride = creditOverride != null;

  if (elements.semesterGPA) {
    elements.semesterGPA.textContent = GPACalculator.formatGPA(effectiveGPA) + (gpaHasOverride ? ' ✓' : '');
  }
  if (elements.semesterCreditsDisplay) {
    elements.semesterCreditsDisplay.innerHTML = `${displayCredits} credits ${creditsHasOverride ? '(edited)' : ''} ✏️`;
  }

  // Calculate cumulative GPA = Average of each semester's GPA
  let { excludedSemesters = [] } = await Storage.get('excludedSemesters');
  const { cumulativeCreditOverride } = await Storage.get('cumulativeCreditOverride');
  const { cumulativeGPAOverride } = await Storage.get('cumulativeGPAOverride');

  // Also exclude any semester that hasn't been completed yet (double-check)
  const upcomingSemesters = state.semesters.filter(sem => isFutureSemester(sem));
  excludedSemesters = [...new Set([...excludedSemesters, ...upcomingSemesters])];

  // Get all completed courses (only real semesters, exclude future and individually excluded)
  const completedCourses = state.allCourses.filter(c =>
    c.term &&
    isRealSemester(c.term) &&
    !excludedSemesters.includes(c.term) &&
    !c.excludedFromGPA &&
    !isFutureSemester(c.term)
  );

  // Group by semester and calculate each semester's GPA
  const semesterGPAs = {};
  const semesterCredits = {};

  for (const course of completedCourses) {
    const sem = course.term || 'Unknown';
    if (!semesterGPAs[sem]) {
      semesterGPAs[sem] = { totalQP: 0, totalCr: 0 };
    }
    if (course.gradePoints != null && course.credits) {
      semesterGPAs[sem].totalQP += course.gradePoints * course.credits;
      semesterGPAs[sem].totalCr += course.credits;
    }
  }

  // Calculate GPA for each semester
  const semesterGPAList = [];
  let totalCredits = 0;

  for (const [sem, data] of Object.entries(semesterGPAs)) {
    if (data.totalCr > 0) {
      const semGPA = data.totalQP / data.totalCr;
      semesterGPAList.push({ semester: sem, gpa: semGPA, credits: data.totalCr });
      totalCredits += data.totalCr;
    }
  }

  // Cumulative GPA = average of semester GPAs
  const calculatedCumulativeGPA = semesterGPAList.length > 0
    ? semesterGPAList.reduce((sum, s) => sum + s.gpa, 0) / semesterGPAList.length
    : null;

  state.cumulativeGPA = {
    cumulativeGPA: calculatedCumulativeGPA,
    totalCredits: totalCredits,
    semesterGPAList: semesterGPAList
  };

  // Use overrides if set
  const displayTotalCredits = cumulativeCreditOverride != null
    ? cumulativeCreditOverride
    : totalCredits;
  const displayCumulativeGPA = cumulativeGPAOverride != null
    ? cumulativeGPAOverride
    : calculatedCumulativeGPA;

  const cumCreditsHasOverride = cumulativeCreditOverride != null;
  const cumGpaHasOverride = cumulativeGPAOverride != null;

  if (elements.cumulativeGPA) {
    elements.cumulativeGPA.textContent = GPACalculator.formatGPA(displayCumulativeGPA) + (cumGpaHasOverride ? ' ✓' : '');
  }
  if (elements.totalCredits) {
    elements.totalCredits.innerHTML = `${displayTotalCredits} total credits ${cumCreditsHasOverride ? '(edited)' : ''} ✏️`;
  }

  // Update exclude button text
  if (elements.manageExcludedBtn) {
    const excludedCount = excludedSemesters.length;
    elements.manageExcludedBtn.textContent = excludedCount > 0
      ? `Excluded (${excludedCount})`
      : 'Exclude...';
  }

  // Show cumulative breakdown - simple: each semester GPA, then average
  const cumulativeBreakdownEl = document.getElementById('cumulativeBreakdown');
  if (cumulativeBreakdownEl && semesterGPAList.length > 0) {
    // Filter to only real semesters
    const realSemesterGPAs = semesterGPAList.filter(s => isRealSemester(s.semester));

    let rows = '';
    let gpaSum = 0;

    for (const semData of realSemesterGPAs) {
      gpaSum += semData.gpa;
      rows += `<div class="gpa-breakdown-row">
        <span>✓ ${semData.semester}</span>
        <span>${semData.gpa.toFixed(2)} GPA (${semData.credits} cr)</span>
      </div>`;
    }

    // Show excluded semesters (only real ones like Spring 2026)
    let excludedRows = '';
    for (const sem of excludedSemesters) {
      if (isRealSemester(sem)) {
        excludedRows += `<div class="gpa-breakdown-row" style="opacity: 0.5;">
          <span>✗ ${sem}</span>
          <span>NOT COUNTED</span>
        </div>`;
      }
    }

    const avgGPA = realSemesterGPAs.length > 0 ? gpaSum / realSemesterGPAs.length : 0;

    cumulativeBreakdownEl.innerHTML = `
      <div class="gpa-breakdown-title">Cumulative GPA:</div>
      ${rows}
      ${excludedRows}
      <div class="gpa-breakdown-total">
        (${realSemesterGPAs.map(s => s.gpa.toFixed(2)).join(' + ')}) ÷ ${realSemesterGPAs.length} = <strong>${avgGPA.toFixed(2)} GPA</strong>
      </div>
    `;
  } else if (cumulativeBreakdownEl) {
    cumulativeBreakdownEl.innerHTML = '<div class="gpa-breakdown">No completed semesters found</div>';
  }

  // Update academic standing (use displayed GPA, which may be overridden)
  const standingGPA = displayCumulativeGPA != null ? displayCumulativeGPA : effectiveGPA;
  const standing = GPACalculator.getAcademicStanding(standingGPA);
  updateAcademicStanding(standing);
}

/**
 * Update GPA display in the Courses tab
 */
async function updateCoursesGPADisplay() {
  if (!elements.coursesGpaValue || !elements.coursesCreditsValue) return;

  // Calculate semester GPA for the filtered courses (excluding excluded courses)
  const includedCourses = state.courses.filter(c => !c.excludedFromGPA);
  const semesterResult = GPACalculator.calculateSemesterGPA(includedCourses);

  // Check for GPA and credit overrides for this semester
  const { semesterGPAOverrides = {} } = await Storage.get('semesterGPAOverrides');
  const { semesterCreditOverrides = {} } = await Storage.get('semesterCreditOverrides');
  const semesterKey = state.selectedSemester || 'all';
  const gpaOverride = semesterGPAOverrides[semesterKey];
  const creditOverride = semesterCreditOverrides[semesterKey];

  // Use overrides if set, otherwise use calculated
  const displayCredits = creditOverride != null ? creditOverride : (semesterResult.totalCredits || 0);
  const effectiveGPA = gpaOverride != null ? gpaOverride : semesterResult.gpa;

  const gpaHasOverride = gpaOverride != null;
  const creditsHasOverride = creditOverride != null;

  elements.coursesGpaValue.textContent = GPACalculator.formatGPA(effectiveGPA) + (gpaHasOverride ? ' ✓' : '');
  elements.coursesCreditsValue.innerHTML = `${displayCredits} cr ${creditsHasOverride ? '(edited)' : ''} ✏️`;
  elements.coursesCreditsValue.classList.add('clickable');

  // Show calculation breakdown
  const breakdownEl = document.getElementById('gpaCalculationBreakdown');
  if (breakdownEl && includedCourses.length > 0) {
    let totalQP = 0;
    let totalCr = 0;
    const rows = includedCourses.map(c => {
      const qp = (c.gradePoints || 0) * (c.credits || 0);
      totalQP += qp;
      totalCr += (c.credits || 0);
      return `<div class="gpa-breakdown-row">
        <span>${c.name}</span>
        <span>${c.letterGrade || 'N/A'} (${c.gradePoints?.toFixed(1) || '0'}) × ${c.credits || 0}cr = ${qp.toFixed(1)}</span>
      </div>`;
    }).join('');

    breakdownEl.innerHTML = `
      <div class="gpa-breakdown-title">GPA Calculation:</div>
      ${rows}
      <div class="gpa-breakdown-total">
        Total: ${totalQP.toFixed(2)} quality points ÷ ${totalCr} credits = ${totalCr > 0 ? (totalQP / totalCr).toFixed(3) : 'N/A'} GPA
      </div>
    `;
  } else if (breakdownEl) {
    breakdownEl.innerHTML = '';
  }
}

/**
 * Edit semester GPA directly (override calculated value)
 */
async function editSemesterGPA() {
  const semesterKey = state.selectedSemester || 'all';
  const { semesterGPAOverrides = {} } = await Storage.get('semesterGPAOverrides');
  const currentOverride = semesterGPAOverrides[semesterKey];
  const calculatedGPA = state.semesterGPA?.gpa;

  const input = prompt(
    `Override Semester GPA for ${semesterKey === 'all' ? 'All Semesters' : semesterKey}\n\n` +
    `Calculated GPA: ${calculatedGPA != null ? calculatedGPA.toFixed(2) : 'N/A'}\n` +
    `Current override: ${currentOverride != null ? currentOverride.toFixed(2) : 'None'}\n\n` +
    `Enter your actual GPA from transcript (or leave empty to use calculated):`,
    currentOverride != null ? currentOverride : (calculatedGPA || '')
  );

  if (input === null) return; // Cancelled

  if (input.trim() === '') {
    // Remove override
    delete semesterGPAOverrides[semesterKey];
  } else {
    const newGPA = parseFloat(input);
    if (isNaN(newGPA) || newGPA < 0 || newGPA > 4.0) {
      alert('Please enter a valid GPA between 0 and 4.0');
      return;
    }
    semesterGPAOverrides[semesterKey] = newGPA;
  }

  await Storage.set({ semesterGPAOverrides });
  updateGPADisplay();
  updateCoursesGPADisplay();
  showStatus('success', 'Semester GPA updated');
}

/**
 * Edit cumulative GPA directly (override calculated value)
 */
async function editCumulativeGPA() {
  const { cumulativeGPAOverride } = await Storage.get('cumulativeGPAOverride');
  const calculatedGPA = state.cumulativeGPA?.cumulativeGPA;

  const input = prompt(
    `Override Cumulative GPA\n\n` +
    `Calculated GPA: ${calculatedGPA != null ? calculatedGPA.toFixed(2) : 'N/A'}\n` +
    `Current override: ${cumulativeGPAOverride != null ? cumulativeGPAOverride.toFixed(2) : 'None'}\n\n` +
    `Enter your actual cumulative GPA from transcript:`,
    cumulativeGPAOverride != null ? cumulativeGPAOverride : (calculatedGPA || '')
  );

  if (input === null) return; // Cancelled

  if (input.trim() === '') {
    await Storage.set({ cumulativeGPAOverride: null });
  } else {
    const newGPA = parseFloat(input);
    if (isNaN(newGPA) || newGPA < 0 || newGPA > 4.0) {
      alert('Please enter a valid GPA between 0 and 4.0');
      return;
    }
    await Storage.set({ cumulativeGPAOverride: newGPA });
  }

  updateGPADisplay();
  showStatus('success', 'Cumulative GPA updated');
}

/**
 * Edit semester credits
 */
async function editSemesterCredits() {
  const semesterKey = state.selectedSemester || 'all';
  const { semesterCreditOverrides = {} } = await Storage.get('semesterCreditOverrides');
  const currentOverride = semesterCreditOverrides[semesterKey];
  const calculatedCredits = state.semesterGPA?.totalCredits || 0;

  const input = prompt(
    `Edit Credits for ${semesterKey === 'all' ? 'All Semesters' : semesterKey}\n\n` +
    `Calculated from courses: ${calculatedCredits} credits\n` +
    `Current override: ${currentOverride != null ? currentOverride : 'None'}\n\n` +
    `Enter new total credits (or leave empty to use calculated):`,
    currentOverride != null ? currentOverride : calculatedCredits
  );

  if (input === null) return; // Cancelled

  if (input.trim() === '') {
    // Remove override
    delete semesterCreditOverrides[semesterKey];
  } else {
    const newCredits = parseInt(input);
    if (isNaN(newCredits) || newCredits < 0) {
      alert('Please enter a valid number');
      return;
    }
    semesterCreditOverrides[semesterKey] = newCredits;
  }

  await Storage.set({ semesterCreditOverrides });
  updateGPADisplay();
  updateCoursesGPADisplay();
  showStatus('success', 'Credits updated');
}

/**
 * Edit cumulative credits (total credits override)
 */
async function editCumulativeCredits() {
  const { cumulativeCreditOverride } = await Storage.get('cumulativeCreditOverride');
  const { excludedSemesters = [] } = await Storage.get('excludedSemesters');

  // Calculate actual credits from all non-excluded courses
  const includedCourses = state.allCourses.filter(c => !excludedSemesters.includes(c.term));
  const calculatedCredits = includedCourses.reduce((sum, c) => sum + (c.credits || 0), 0);

  const { credits: prevCredits } = await Storage.getPreviousGPA();
  const totalCalculated = calculatedCredits + (prevCredits || 0);

  const input = prompt(
    `Edit Total Cumulative Credits\n\n` +
    `Previous credits (settings): ${prevCredits || 0}\n` +
    `Current semester credits: ${calculatedCredits}\n` +
    `Calculated total: ${totalCalculated}\n` +
    `Current override: ${cumulativeCreditOverride != null ? cumulativeCreditOverride : 'None'}\n\n` +
    `Excluded semesters: ${excludedSemesters.length > 0 ? excludedSemesters.join(', ') : 'None'}\n\n` +
    `Enter new total credits (or leave empty to use calculated):`,
    cumulativeCreditOverride != null ? cumulativeCreditOverride : totalCalculated
  );

  if (input === null) return; // Cancelled

  if (input.trim() === '') {
    // Remove override
    await Storage.set({ cumulativeCreditOverride: null });
  } else {
    const newCredits = parseInt(input);
    if (isNaN(newCredits) || newCredits < 0) {
      alert('Please enter a valid number');
      return;
    }
    await Storage.set({ cumulativeCreditOverride: newCredits });
  }

  updateGPADisplay();
  showStatus('success', 'Cumulative credits updated');
}

/**
 * Manage excluded semesters (for cumulative GPA)
 */
async function manageExcludedSemesters() {
  const { excludedSemesters = [] } = await Storage.get('excludedSemesters');

  // Build list of all semesters with their status
  const semestersList = state.semesters.map(sem => {
    const isExcluded = excludedSemesters.includes(sem);
    const isUpcoming = isFutureSemester(sem);
    return `${isExcluded ? '[X]' : '[ ]'} ${sem}${isUpcoming ? ' (upcoming)' : ''}`;
  }).join('\n');

  const input = prompt(
    `Manage Excluded Semesters\n\n` +
    `These semesters will NOT count toward cumulative GPA.\n` +
    `[X] = Excluded, [ ] = Included\n\n` +
    `Current semesters:\n${semestersList}\n\n` +
    `Enter semester names to TOGGLE (comma-separated):\n` +
    `Example: Spring 2026, Summer 2026\n\n` +
    `Or enter "auto" to auto-exclude upcoming semesters:`,
    excludedSemesters.join(', ')
  );

  if (input === null) return; // Cancelled

  if (input.trim().toLowerCase() === 'auto') {
    // Auto-detect and exclude future semesters
    const upcomingSemesters = state.semesters.filter(sem => isFutureSemester(sem));
    await Storage.set({ excludedSemesters: upcomingSemesters });
    showStatus('success', `Excluded ${upcomingSemesters.length} upcoming semester(s)`);
  } else if (input.trim() === '') {
    // Clear all exclusions
    await Storage.set({ excludedSemesters: [] });
    showStatus('success', 'All semesters included in cumulative GPA');
  } else {
    // Parse input and toggle
    const toToggle = input.split(',').map(s => s.trim()).filter(s => s);
    const newExcluded = [...excludedSemesters];

    for (const sem of toToggle) {
      // Find matching semester (case-insensitive)
      const matchingSem = state.semesters.find(s =>
        s.toLowerCase() === sem.toLowerCase()
      );

      if (matchingSem) {
        const idx = newExcluded.indexOf(matchingSem);
        if (idx >= 0) {
          newExcluded.splice(idx, 1); // Remove (include)
        } else {
          newExcluded.push(matchingSem); // Add (exclude)
        }
      }
    }

    await Storage.set({ excludedSemesters: newExcluded });
    showStatus('success', `Updated excluded semesters: ${newExcluded.length > 0 ? newExcluded.join(', ') : 'None'}`);
  }

  updateGPADisplay();
}

/**
 * Check if a semester is NOT YET COMPLETED (in progress or future)
 * Returns true if the semester hasn't finished yet
 */
function isFutureSemester(termName) {
  if (!termName) return false;

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-11 (Jan=0, Dec=11)

  // Try various patterns: "Spring 2026", "Spring '26", "Spring2026", etc.
  const match = termName.match(/(Spring|Summer|Fall|Winter)\s*'?(\d{2,4})/i);
  if (!match) {
    console.log('[GPA Calc] Could not parse semester:', termName);
    return false;
  }

  let year = parseInt(match[2]);
  if (year < 100) year += 2000;

  const season = match[1].toLowerCase();

  // Semester START months (when the semester begins)
  // A semester is "future/upcoming" if it hasn't started yet
  const seasonStartMonth = {
    winter: 1,   // Winter starts ~January
    spring: 1,   // Spring starts ~January
    summer: 5,   // Summer starts ~May
    fall: 8      // Fall starts ~August
  };

  const semesterStartMonth = seasonStartMonth[season] ?? 1;
  const currentMonthAdjusted = currentMonth + 1; // Convert from 0-indexed to 1-indexed

  console.log(`[GPA Calc] Checking ${termName}: year=${year}, season=${season}, startMonth=${semesterStartMonth}, currentYear=${currentYear}, currentMonth=${currentMonthAdjusted}`);

  // If semester year is greater than current year, it's future
  if (year > currentYear) {
    console.log(`[GPA Calc] ${termName} is FUTURE (future year)`);
    return true;
  }

  // If same year, check if semester hasn't started yet
  if (year === currentYear && semesterStartMonth > currentMonthAdjusted) {
    console.log(`[GPA Calc] ${termName} is FUTURE (hasn't started yet)`);
    return true;
  }

  console.log(`[GPA Calc] ${termName} is CURRENT or PAST (include in cumulative GPA)`);
  return false;
}

/**
 * Auto-exclude upcoming/in-progress semesters
 * Only completed semesters should count toward cumulative GPA
 */
async function autoExcludeUpcomingSemesters() {
  // Find all upcoming/in-progress semesters
  const upcomingSemesters = state.semesters.filter(sem => isFutureSemester(sem));

  console.log('[GPA Calc] Upcoming/in-progress semesters to exclude:', upcomingSemesters);

  if (upcomingSemesters.length > 0) {
    // Always set excluded semesters to include all upcoming ones
    const { excludedSemesters = [] } = await Storage.get('excludedSemesters');

    // Merge existing exclusions with upcoming semesters
    const allExcluded = [...new Set([...excludedSemesters, ...upcomingSemesters])];

    await Storage.set({ excludedSemesters: allExcluded });
    console.log('[GPA Calc] Excluded semesters set to:', allExcluded);
  }
}

/**
 * Update academic standing display
 */
function updateAcademicStanding(standing) {
  if (!elements.academicStanding) return;

  const { primaryStanding, isDeansList, isGoodStanding, isProbation } = standing;

  elements.academicStanding.className = 'standing-card';
  if (isDeansList) {
    elements.academicStanding.classList.add('deans-list');
  } else if (isProbation) {
    elements.academicStanding.classList.add('probation');
  } else if (isGoodStanding) {
    elements.academicStanding.classList.add('good-standing');
  }

  if (primaryStanding) {
    elements.academicStanding.innerHTML = `
      <span class="standing-icon">${primaryStanding.icon}</span>
      <span class="standing-text">${primaryStanding.name}</span>
    `;
  }
}

/**
 * Render courses list
 */
async function renderCoursesList() {
  if (state.courses.length === 0) {
    elements.coursesList.innerHTML = '<p class="placeholder">No courses found</p>';
    return;
  }

  const { excludedSemesters = [] } = await Storage.get('excludedSemesters');

  const html = state.courses.map(course => {
    // Handle N/A grade class specially
    const letterClass = course.letterGrade === 'N/A' ? 'na' : (course.letterGrade ? course.letterGrade.charAt(0).toLowerCase() : '');
    const showTerm = state.selectedSemester === 'all' && course.term;
    const isManual = course.isManual || course.gradeSource === 'manual';
    const isExcluded = excludedSemesters.includes(course.term);
    const isUpcoming = isFutureSemester(course.term);

    // Only show percentage if it makes sense (matches letter grade roughly)
    // Hide misleading percentages when teacher set a different final grade
    const showPercentage = course.calculatedGrade !== null &&
                           course.gradeSource !== 'canvas' &&
                           course.gradeSource !== 'custom' &&
                           !isManual;

    // Flag courses that might need review (no letter grade or calculated grade seems off)
    const needsReview = !course.letterGrade ||
                        (course.gradeSource === 'calculated' && course.calculatedGrade !== null &&
                         (course.calculatedGrade < 50 || course.calculatedGrade > 100));

    const isExcludedFromGPA = course.excludedFromGPA;

    return `
      <div class="course-card ${isManual ? 'manual-course' : ''} ${needsReview ? 'needs-review' : ''} ${isExcluded ? 'upcoming' : ''} ${isExcludedFromGPA ? 'excluded-from-gpa' : ''}" data-course-id="${course.id}">
        <div class="course-header">
          <span class="course-name">${course.name} ${isManual ? '<span class="manual-badge">Manual</span>' : ''} ${isExcluded ? '<span class="upcoming-badge">Excluded</span>' : ''} ${isExcludedFromGPA ? '<span class="upcoming-badge">Not in GPA</span>' : ''}</span>
          <span class="course-credits">${course.credits} cr${showTerm ? ' · ' + course.term : ''}</span>
        </div>
        <div class="course-grade">
          ${course.letterGrade ? `<span class="grade-letter ${letterClass}">${course.letterGrade}</span>` : '<span class="grade-letter na">N/A</span>'}
          <span class="grade-points">${course.gradePoints != null ? '→ ' + course.gradePoints.toFixed(1) + ' pts' : (course.letterGrade === 'N/A' ? '<span class="na-text">No grade yet</span>' : '')}</span>
          ${showPercentage && course.calculatedGrade != null ? `<span class="grade-percentage-small">(${course.calculatedGrade.toFixed(1)}%)</span>` : ''}
        </div>
        ${needsReview ? '<div class="review-warning">⚠️ Grade may be incorrect - click Edit to fix</div>' : ''}
        <div class="course-source">
          ${isManual
            ? '<span class="custom-badge">📝 Transcript</span>'
            : course.gradeSource === 'custom'
              ? '<span class="custom-badge">✏️ Edited</span>'
              : course.gradeSource === 'canvas'
                ? '<span class="transcript-badge">📋 Canvas Grade</span>'
                : '<span class="calculated-badge">🔢 Calculated</span>'}
          <button class="edit-grade-btn" data-course-id="${course.id}">Edit</button>
          <button class="exclude-course-btn ${course.excludedFromGPA ? 'excluded' : ''}" data-course-id="${course.id}">${course.excludedFromGPA ? 'Include' : 'Exclude'}</button>
          ${isManual ? `<button class="delete-course-btn" data-course-id="${course.id}">Delete</button>` : ''}
        </div>
      </div>
    `;
  }).join('');

  elements.coursesList.innerHTML = html;

  // Add event listeners for edit grade buttons
  document.querySelectorAll('.edit-grade-btn').forEach(btn => {
    btn.addEventListener('click', () => openGradeEditor(btn.dataset.courseId));
  });

  // Add event listeners for exclude buttons
  document.querySelectorAll('.exclude-course-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleCourseExclusion(btn.dataset.courseId));
  });

  // Add event listeners for delete buttons (manual courses)
  document.querySelectorAll('.delete-course-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteManualCourse(btn.dataset.courseId));
  });
}

/**
 * Open grade editor for a course
 */
async function openGradeEditor(courseId) {
  const course = state.courses.find(c => c.id == courseId);
  if (!course) return;

  const grades = getAvailableGrades();
  const currentGrade = course.letterGrade || '';
  const currentCredits = course.credits || 3;
  const currentTerm = course.term || '';
  const isManual = course.isManual || course.gradeSource === 'manual';
  const isUpcoming = isFutureSemester(currentTerm);

  // Create a simple form prompt
  const input = prompt(
    `Edit ${course.name}\n\n` +
    `Current Grade: ${currentGrade} (${course.gradePoints != null ? course.gradePoints.toFixed(1) + ' pts' : 'N/A'})\n` +
    (course.calculatedGrade !== null ? `Canvas %: ${course.calculatedGrade?.toFixed(1)}%\n` : '') +
    `Credits: ${currentCredits}\n` +
    `Semester: ${currentTerm || 'Not set'}${isUpcoming ? ' (upcoming)' : ''}\n\n` +
    `Enter: GRADE,CREDITS,SEMESTER\n` +
    `Grades: ${grades.join(', ')}\n` +
    `Example: A,3,Fall 2024\n` +
    `(Use N/A for courses without grades yet)`,
    `${currentGrade},${currentCredits},${currentTerm}`
  );

  if (!input) return;

  const parts = input.split(',').map(p => p.trim());
  let newGrade = parts[0] ? parts[0].toUpperCase() : currentGrade;
  const newCredits = parts[1] ? parseInt(parts[1]) : currentCredits;
  const newTerm = parts[2] || currentTerm;

  // Normalize N/A variations
  if (newGrade === 'NA' || newGrade === 'N/A' || newGrade === '') {
    newGrade = 'N/A';
  }

  if (newGrade && newGrade !== 'N/A' && !grades.includes(newGrade)) {
    alert('Invalid grade. Please enter one of: ' + grades.join(', '));
    return;
  }

  if (isManual) {
    // Update manual course
    await updateManualCourse(courseId, course.name, newGrade, newCredits, newTerm);
  } else {
    // Save as custom data for Canvas course
    await saveCustomCourseData(courseId, newGrade, newCredits, newTerm);
  }
}

/**
 * Update a manual course
 */
async function updateManualCourse(courseId, name, letterGrade, credits, term) {
  const { manualCourses = [] } = await Storage.get('manualCourses');

  // Handle N/A grade - no grade points (use current grading scale)
  const isNA = letterGrade === 'N/A' || letterGrade === 'NA' || !letterGrade;
  const gradePointsValue = isNA ? null : getGradePoints(letterGrade);

  const updated = manualCourses.map(c => {
    if (c.id === courseId) {
      return {
        ...c,
        name,
        letterGrade: isNA ? 'N/A' : letterGrade,
        gradePoints: gradePointsValue,
        credits,
        term,
        lastUpdated: new Date().toISOString()
      };
    }
    return c;
  });

  await Storage.set({ manualCourses: updated });
  await loadCoursesData();
  showStatus('success', 'Course updated');
}

/**
 * Save custom course data (grade, credits, term)
 */
async function saveCustomCourseData(courseId, letterGrade, credits, term) {
  try {
    console.log(`[GPA Calc] Saving course ${courseId}: grade=${letterGrade}, credits=${credits}, term=${term}`);

    // Get existing custom data
    const { customCourseData = {} } = await Storage.get('customCourseData');
    console.log('[GPA Calc] Current customCourseData:', customCourseData);

    // Handle N/A grade - no grade points (use current grading scale)
    const isNA = letterGrade === 'N/A' || letterGrade === 'NA' || !letterGrade;
    const gradePointsValue = isNA ? null : getGradePoints(letterGrade);

    customCourseData[courseId] = {
      letterGrade: isNA ? 'N/A' : letterGrade,
      gradePoints: gradePointsValue,
      credits,
      term,
      lastUpdated: new Date().toISOString()
    };

    console.log('[GPA Calc] Updated customCourseData:', customCourseData);

    const result = await Storage.set({ customCourseData });
    console.log('[GPA Calc] Storage.set() result:', result);

    // Reload to apply changes
    console.log('[GPA Calc] Reloading courses data...');
    await loadCoursesData();
    console.log('[GPA Calc] Courses reloaded successfully');
    showStatus('success', 'Course updated');
  } catch (error) {
    console.error('[GPA Calc] Error saving course:', error);
    showStatus('error', 'Failed to save course: ' + error.message);
  }
}

/**
 * Add a manual course (not in Canvas)
 */
async function addManualCourse() {
  const grades = getAvailableGrades();

  const input = prompt(
    `Add Course from Transcript\n\n` +
    `Enter: COURSE NAME, GRADE, CREDITS, SEMESTER\n\n` +
    `Grades: ${grades.join(', ')}\n` +
    `Example: IT 202, B+, 3, Fall 2024\n` +
    `(Use N/A for upcoming courses without grades)`
  );

  if (!input) return;

  const parts = input.split(',').map(p => p.trim());
  if (parts.length < 4) {
    alert('Please enter all 4 fields: Name, Grade, Credits, Semester');
    return;
  }

  const [name, grade, creditsStr, term] = parts;
  const credits = parseInt(creditsStr);

  const normalizedGrade = grade.toUpperCase();
  const isNA = normalizedGrade === 'N/A' || normalizedGrade === 'NA' || normalizedGrade === '';

  if (!isNA && !grades.includes(normalizedGrade)) {
    alert('Invalid grade. Use: ' + grades.join(', '));
    return;
  }

  if (isNaN(credits) || credits < 1 || credits > 6) {
    alert('Credits must be a number between 1 and 6');
    return;
  }

  // Generate unique ID for manual course
  const courseId = 'manual_' + Date.now();

  // Get existing manual courses
  const { manualCourses = [] } = await Storage.get('manualCourses');

  // Handle N/A grade - no grade points (use current grading scale)
  const finalGrade = isNA ? 'N/A' : normalizedGrade;
  const gradePointsValue = isNA ? null : getGradePoints(normalizedGrade);

  manualCourses.push({
    id: courseId,
    name: name,
    letterGrade: finalGrade,
    gradePoints: gradePointsValue,
    credits: credits,
    term: term,
    isManual: true,
    addedAt: new Date().toISOString()
  });

  await Storage.set({ manualCourses });

  // Reload to show new course
  await loadCoursesData();
  showStatus('success', `Added ${name}`);
}

/**
 * Toggle course exclusion from GPA calculation
 */
async function toggleCourseExclusion(courseId) {
  const { excludedCourses = [] } = await Storage.get('excludedCourses');

  const idx = excludedCourses.indexOf(courseId);
  if (idx >= 0) {
    // Remove from excluded (include in GPA)
    excludedCourses.splice(idx, 1);
  } else {
    // Add to excluded (exclude from GPA)
    excludedCourses.push(courseId);
  }

  await Storage.set({ excludedCourses });

  // Update the course in state
  state.allCourses = state.allCourses.map(c => ({
    ...c,
    excludedFromGPA: excludedCourses.includes(c.id.toString()) || excludedCourses.includes(c.id)
  }));
  state.courses = state.courses.map(c => ({
    ...c,
    excludedFromGPA: excludedCourses.includes(c.id.toString()) || excludedCourses.includes(c.id)
  }));

  // Refresh displays
  updateGPADisplay();
  updateCoursesGPADisplay();
  renderCoursesList();
  showStatus('success', idx >= 0 ? 'Course included in GPA' : 'Course excluded from GPA');
}

/**
 * Delete a manual course
 */
async function deleteManualCourse(courseId) {
  if (!confirm('Delete this course?')) return;

  const { manualCourses = [] } = await Storage.get('manualCourses');
  const updated = manualCourses.filter(c => c.id !== courseId);
  await Storage.set({ manualCourses: updated });

  await loadCoursesData();
  showStatus('success', 'Course deleted');
}

/**
 * Render course impact list
 */
function renderCourseImpact() {
  if (!state.courses || state.courses.length === 0) {
    elements.courseImpactList.innerHTML = '<p class="placeholder">Connect to Canvas to see courses</p>';
    return;
  }

  const isUpcomingOrInProgress = isFutureSemester(state.selectedSemester);

  // Check if courses have grades
  const coursesWithGrades = state.courses.filter(c =>
    c.letterGrade &&
    c.letterGrade !== 'N/A' &&
    c.gradePoints != null
  );

  // Upcoming semester (future, no grades yet)
  if (isUpcomingOrInProgress && coursesWithGrades.length === 0) {
    elements.courseImpactList.innerHTML = '<p class="placeholder">No grades yet for this semester</p>';
    return;
  }

  // Completed semester (past) - no longer can improve grades
  if (!isUpcomingOrInProgress) {
    elements.courseImpactList.innerHTML = '<p class="placeholder">Semester complete - great work!</p>';
    return;
  }

  // In-progress semester - show impact analysis
  try {
    const validCourses = state.courses.filter(c =>
      c.letterGrade &&
      c.letterGrade !== 'A' &&
      c.letterGrade !== 'A+' &&
      c.letterGrade !== 'N/A' &&
      c.gradePoints != null
    );

    if (validCourses.length === 0) {
      elements.courseImpactList.innerHTML = '<p class="placeholder">All courses at A - keep it up!</p>';
      return;
    }

    const impacts = validCourses
      .map(course => {
        try {
          const impact = GPACalculator.calculateGradeImpact(state.courses, course.id, 93);
          return {
            ...impact,
            courseId: course.id
          };
        } catch (e) {
          return null;
        }
      })
      .filter(i => i && i.gpaChange != null && i.gpaChange > 0)
      .sort((a, b) => (b.gpaChange || 0) - (a.gpaChange || 0))
      .slice(0, 5);

    if (impacts.length === 0) {
      elements.courseImpactList.innerHTML = '<p class="placeholder">All courses at A - great job!</p>';
      return;
    }

    const html = impacts.map(impact => `
      <div class="impact-item">
        <span class="impact-course">${impact.courseName || 'Course'} → A</span>
        <span class="impact-change positive">+${impact.gpaChange != null ? impact.gpaChange.toFixed(2) : '0.00'} GPA</span>
      </div>
    `).join('');

    elements.courseImpactList.innerHTML = html;
  } catch (error) {
    console.error('Error rendering course impact:', error);
    elements.courseImpactList.innerHTML = '<p class="placeholder">Could not calculate impact</p>';
  }
}

/**
 * Populate What-If Calculator course dropdown
 */
function populateWhatIfCourses() {
  const select = document.getElementById('whatifCourse');
  if (!select) return;

  // Only show current semester courses with grades
  const coursesWithGrades = state.courses.filter(c =>
    c.calculatedGrade != null || c.letterGrade
  );

  if (coursesWithGrades.length === 0) {
    select.innerHTML = '<option value="">No courses with grades</option>';
    return;
  }

  select.innerHTML = '<option value="">Select a course</option>' +
    coursesWithGrades.map(c =>
      `<option value="${c.id}" data-grade="${c.calculatedGrade || ''}">${c.name}</option>`
    ).join('');
}

/**
 * Handle What-If course selection
 */
function handleWhatIfCourseChange() {
  const select = document.getElementById('whatifCourse');
  const currentInput = document.getElementById('whatifCurrent');

  if (!select || !currentInput) return;

  const selectedOption = select.options[select.selectedIndex];
  const grade = selectedOption?.dataset?.grade;

  if (grade) {
    currentInput.value = parseFloat(grade).toFixed(1);
  }
}

/**
 * Calculate What-If result
 */
function calculateWhatIf() {
  const currentGrade = parseFloat(document.getElementById('whatifCurrent')?.value);
  const finalWeight = parseFloat(document.getElementById('whatifFinalWeight')?.value);
  const desiredGrade = parseFloat(document.getElementById('whatifDesired')?.value);
  const resultDiv = document.getElementById('whatifResult');

  if (!resultDiv) return;

  // Validate inputs
  if (isNaN(currentGrade) || isNaN(finalWeight) || isNaN(desiredGrade)) {
    resultDiv.className = 'whatif-result warning';
    resultDiv.classList.remove('hidden');
    resultDiv.innerHTML = '<span class="result-message">Please fill in all fields</span>';
    return;
  }

  if (finalWeight <= 0 || finalWeight > 100) {
    resultDiv.className = 'whatif-result warning';
    resultDiv.classList.remove('hidden');
    resultDiv.innerHTML = '<span class="result-message">Final weight must be between 1-100%</span>';
    return;
  }

  // Calculate required final exam score
  // Formula: desired = (current * (100 - finalWeight) + finalScore * finalWeight) / 100
  // Solving for finalScore: finalScore = (desired * 100 - current * (100 - finalWeight)) / finalWeight
  const currentWeight = 100 - finalWeight;
  const requiredScore = (desiredGrade * 100 - currentGrade * currentWeight) / finalWeight;

  resultDiv.classList.remove('hidden');

  if (requiredScore <= 0) {
    // Already achieved
    resultDiv.className = 'whatif-result success';
    resultDiv.innerHTML = `
      <span class="result-message">Great news!</span>
      <span class="result-score">Already there</span>
      <span class="result-message">You've already secured this grade. Even a 0% on the final keeps you above ${desiredGrade}%!</span>
    `;
  } else if (requiredScore <= 60) {
    // Easily achievable
    resultDiv.className = 'whatif-result success';
    resultDiv.innerHTML = `
      <span class="result-message">You need to score at least:</span>
      <span class="result-score">${requiredScore.toFixed(1)}%</span>
      <span class="result-message">on your final exam. Very achievable!</span>
    `;
  } else if (requiredScore <= 90) {
    // Achievable but challenging
    resultDiv.className = 'whatif-result warning';
    resultDiv.innerHTML = `
      <span class="result-message">You need to score at least:</span>
      <span class="result-score">${requiredScore.toFixed(1)}%</span>
      <span class="result-message">on your final exam. Study hard!</span>
    `;
  } else if (requiredScore <= 100) {
    // Difficult but possible
    resultDiv.className = 'whatif-result warning';
    resultDiv.innerHTML = `
      <span class="result-message">You need to score at least:</span>
      <span class="result-score">${requiredScore.toFixed(1)}%</span>
      <span class="result-message">on your final exam. It's tough but possible!</span>
    `;
  } else {
    // Impossible
    resultDiv.className = 'whatif-result impossible';
    resultDiv.innerHTML = `
      <span class="result-message">Unfortunately...</span>
      <span class="result-score">Not possible 😔</span>
      <span class="result-message">You would need ${requiredScore.toFixed(1)}% on the final, which exceeds 100%. Consider aiming for a ${desiredGrade - 10}% grade instead.</span>
    `;
  }
}

/**
 * Calculate target GPA
 */
async function calculateTargetGPA() {
  const targetGPA = parseFloat(elements.targetGPA.value);

  if (isNaN(targetGPA) || targetGPA < 0 || targetGPA > 4.0) {
    elements.targetResult.className = 'target-result error';
    elements.targetResult.classList.remove('hidden');
    elements.targetMessage.textContent = 'Please enter a valid GPA between 0 and 4.0';
    return;
  }

  const { gpa: prevGPA, credits: prevCredits } = await Storage.getPreviousGPA();
  const semesterCredits = state.semesterGPA?.totalCredits || 0;

  const result = GPACalculator.calculateRequiredGPA(
    targetGPA,
    prevGPA,
    prevCredits,
    semesterCredits
  );

  elements.targetResult.classList.remove('hidden');

  if (result.alreadyAchieved) {
    elements.targetResult.className = 'target-result';
    elements.targetMessage.textContent = result.explanation;
  } else if (result.isImpossible) {
    elements.targetResult.className = 'target-result warning';
    elements.targetMessage.textContent = result.explanation;
  } else {
    elements.targetResult.className = 'target-result';
    elements.targetMessage.textContent = result.explanation;
  }
}

/**
 * Save Canvas connection settings
 */
async function saveConnection() {
  const url = elements.canvasUrl.value.trim();
  const token = elements.apiToken.value.trim();

  if (!url) {
    showTestResult('error', 'Please enter your Canvas URL');
    return;
  }

  // SECURITY: Validate Canvas URL format and domain
  try {
    const urlObj = new URL(url);

    // Must use HTTPS
    if (urlObj.protocol !== 'https:') {
      showTestResult('error', 'Canvas URL must use HTTPS (https://...)');
      return;
    }

    // Must be a Canvas instance (.instructure.com)
    if (!urlObj.hostname.includes('instructure.com')) {
      showTestResult('error', 'Must be a valid Canvas instance URL (e.g., https://your-school.instructure.com)');
      return;
    }
  } catch (error) {
    showTestResult('error', 'Invalid URL format. Use: https://your-school.instructure.com');
    return;
  }

  try {
    // Don't save masked token
    if (token && !token.includes('•')) {
      await Storage.setApiToken(token);
    }
    await Storage.setBaseUrl(url);

    // Test and connect
    const savedToken = await Storage.getApiToken();
    if (savedToken) {
      await CanvasAPI.init(savedToken, url);
      const isValid = await CanvasAPI.verifyToken();

      if (isValid) {
        state.isConnected = true;
        showTestResult('success', 'Connected successfully!');
        showStatus('success', 'Connected to Canvas');
        await loadCoursesData();
      } else {
        showTestResult('error', 'Invalid token. Please check and try again.');
      }
    } else {
      showTestResult('error', 'No token was entered. Please paste your Canvas API token.');
    }
  } catch (error) {
    console.error('[Canvas GPA] Save connection error:', error);
    showTestResult('error', `Connection error: ${error.message}`);
  }
}

/**
 * Test Canvas connection
 */
async function testConnection() {
  const url = elements.canvasUrl.value.trim();
  const token = elements.apiToken.value.trim();

  console.log('[Canvas GPA] Test connection initiated');
  console.log('[Canvas GPA] URL:', url);
  console.log('[Canvas GPA] Token length:', token.length);

  if (!url || !token || token.includes('•')) {
    showTestResult('error', 'Please enter both URL and token');
    return;
  }

  // Validate URL format
  if (!url.startsWith('https://') && !url.startsWith('http://')) {
    showTestResult('error', 'Canvas URL must start with https:// (e.g., https://njit.instructure.com)');
    return;
  }

  try {
    console.log('[Canvas GPA] Initializing CanvasAPI...');
    await CanvasAPI.init(token, url);
    console.log('[Canvas GPA] CanvasAPI initialized. Verifying token...');
    const isValid = await CanvasAPI.verifyToken();

    if (isValid) {
      console.log('[Canvas GPA] Token verified successfully');
      showTestResult('success', 'Connection successful! You can save these settings.');
    } else {
      console.log('[Canvas GPA] Token verification returned false');
      showTestResult('error', 'Token is invalid or expired. Please check Canvas account settings and generate a new token.');
    }
  } catch (error) {
    console.error('[Canvas GPA] Connection test error:', error);
    console.error('[Canvas GPA] Error message:', error.message);
    console.error('[Canvas GPA] Full error:', error);
    showTestResult('error', `Connection error: ${error.message}`);
  }
}

/**
 * Save previous GPA
 */
async function savePreviousGPA() {
  const gpa = parseFloat(elements.previousGPA.value);
  const credits = parseInt(elements.previousCredits.value);

  if (isNaN(gpa) && isNaN(credits)) {
    await Storage.setPreviousGPA(null, 0);
  } else {
    await Storage.setPreviousGPA(
      isNaN(gpa) ? null : gpa,
      isNaN(credits) ? 0 : credits
    );
  }

  // Recalculate cumulative GPA
  updateGPADisplay();
  showTestResult('success', 'Previous GPA saved');
}

/**
 * Export all data
 */
async function exportData() {
  // SECURITY: Show confirmation before exporting data
  if (!confirm('Export data?\n\nNote: Only non-sensitive data will be exported (no API tokens or credentials)')) {
    return;
  }

  const allData = await Storage.get(null);

  // SECURITY: Filter out sensitive data before exporting
  const exportData = {};

  // Allow exporting non-sensitive fields
  const allowedFields = [
    'previousGPA',
    'previousCredits',
    'currentSemester',
    'customGradingScales',
    'excludedAssignments',
    'widgetVisible',
    'settings',
    'cache',
    'darkMode',
    'excludedSemesters',
    'customCourseData',
    'manualCourses',
    'excludedCourses',
    'semesterGPAOverrides',
    'semesterCreditOverrides',
    'cumulativeGPAOverride',
    'cumulativeCreditOverride',
    'lastSyncTime',
    'detectedSemesters',
    'upcomingSemesters'
  ];

  for (const field of allowedFields) {
    if (field in allData) {
      exportData[field] = allData[field];
    }
  }

  // SECURITY: Remove encrypted tokens from customGradingScales if present
  if (exportData.customGradingScales) {
    for (const courseId in exportData.customGradingScales) {
      delete exportData.customGradingScales[courseId].userNotes;  // Remove any notes that might contain sensitive info
    }
  }

  const exportDate = new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `canvas-gpa-data-${exportDate}.json`;
  a.click();

  URL.revokeObjectURL(url);
}

/**
 * Open grading scale editor
 */
function openScaleEditor(courseId) {
  // For now, send message to content script or open in new tab
  // In full implementation, this would open a modal
  const course = state.courses.find(c => c.id === courseId);
  if (!course) return;

  const currentScale = course.gradingScale?.scale || GradingScaleDetector.DEFAULT_SCALE_PLUS_MINUS;

  // Simple prompt-based editor for now
  const scaleStr = Object.entries(currentScale)
    .sort((a, b) => b[1].min - a[1].min)
    .map(([letter, range]) => `${letter}: ${range.min}-${range.max}`)
    .join('\n');

  const newScaleStr = prompt(
    `Edit grading scale for ${course.name}\n\nFormat: A: 93-100\n\nCurrent scale:\n${scaleStr}`,
    scaleStr
  );

  if (newScaleStr && newScaleStr !== scaleStr) {
    parseAndSaveScale(courseId, newScaleStr);
  }
}

/**
 * Parse and save custom grading scale
 */
async function parseAndSaveScale(courseId, scaleStr) {
  const scale = {};
  const lines = scaleStr.split('\n');

  for (const line of lines) {
    const match = line.match(/([A-F][+-]?)\s*:\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/i);
    if (match) {
      scale[match[1].toUpperCase()] = {
        min: parseFloat(match[2]),
        max: parseFloat(match[3])
      };
    }
  }

  if (Object.keys(scale).length > 0) {
    await Storage.setCustomGradingScale(courseId, scale, 'Manually edited');

    // Refresh courses
    await loadCoursesData();
    showStatus('success', 'Grading scale updated');
  } else {
    alert('Could not parse grading scale. Please use format: A: 93-100');
  }
}
