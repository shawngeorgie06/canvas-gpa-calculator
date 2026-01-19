/**
 * Canvas Grade & GPA Calculator - Content Script
 * Injects grade calculator UI into Canvas course pages
 */

// State for the content script
const ContentState = {
  courseId: null,
  courseData: null,
  gradingScale: null,
  isInitialized: false,
  widgetContainer: null
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initContentScript);
} else {
  initContentScript();
}

/**
 * Initialize the content script
 */
async function initContentScript() {
  // Check if we're on a Canvas course page
  const courseId = extractCourseId();
  if (!courseId) return;

  ContentState.courseId = courseId;

  // Wait for Canvas to fully load
  await waitForCanvasLoad();

  // Check if extension is configured
  const isConfigured = await checkConfiguration();
  if (!isConfigured) {
    console.log('[Canvas GPA] Extension not configured. Please set up in popup.');
    return;
  }

  // Initialize and inject UI
  await injectGradeWidget();
  ContentState.isInitialized = true;
}

/**
 * Extract course ID from URL
 */
function extractCourseId() {
  const match = window.location.pathname.match(/\/courses\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Wait for Canvas to fully load
 */
function waitForCanvasLoad() {
  return new Promise((resolve) => {
    const checkForCanvas = () => {
      // Check for common Canvas elements
      const sidebar = document.querySelector('#right-side, .right-side-wrapper');
      const content = document.querySelector('#content, .ic-Layout-contentMain');

      if (sidebar || content) {
        resolve();
      } else {
        setTimeout(checkForCanvas, 100);
      }
    };
    checkForCanvas();
  });
}

/**
 * Check if extension is configured
 */
async function checkConfiguration() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['canvasApiToken', 'canvasBaseUrl'], (result) => {
      resolve(Boolean(result.canvasApiToken && result.canvasBaseUrl));
    });
  });
}

/**
 * Get stored data
 */
function getStoredData(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, resolve);
  });
}

/**
 * Save data to storage
 */
function saveToStorage(data) {
  return new Promise((resolve) => {
    chrome.storage.local.set(data, resolve);
  });
}

/**
 * Inject the grade widget into the page
 */
async function injectGradeWidget() {
  // Find injection point (Canvas right sidebar)
  const sidebar = document.querySelector('#right-side') ||
                  document.querySelector('.right-side-wrapper') ||
                  document.querySelector('#right-side-wrapper');

  if (!sidebar) {
    console.log('[Canvas GPA] Could not find sidebar to inject widget');
    return;
  }

  // Create widget container
  const widget = createWidgetElement();
  ContentState.widgetContainer = widget;

  // Insert at top of sidebar
  sidebar.insertBefore(widget, sidebar.firstChild);

  // Load and display data
  await loadAndDisplayCourseData();
}

/**
 * Create the widget element
 */
function createWidgetElement() {
  const widget = document.createElement('div');
  widget.id = 'canvas-gpa-widget';
  widget.className = 'canvas-gpa-widget';
  widget.innerHTML = `
    <div class="cgpa-header">
      <h3 class="cgpa-title">Grade Calculator</h3>
      <button class="cgpa-refresh-btn" title="Refresh">↻</button>
    </div>
    <div class="cgpa-content">
      <div class="cgpa-loading">Loading...</div>
    </div>
  `;

  // Add refresh handler
  widget.querySelector('.cgpa-refresh-btn').addEventListener('click', async () => {
    await loadAndDisplayCourseData(true);
  });

  return widget;
}

/**
 * Load and display course data
 */
async function loadAndDisplayCourseData(forceRefresh = false) {
  const content = ContentState.widgetContainer.querySelector('.cgpa-content');
  content.innerHTML = '<div class="cgpa-loading">Loading...</div>';

  try {
    const { canvasApiToken, canvasBaseUrl } = await getStoredData(['canvasApiToken', 'canvasBaseUrl']);

    if (!canvasApiToken || !canvasBaseUrl) {
      content.innerHTML = `
        <div class="cgpa-setup">
          <p>Please configure the extension first.</p>
          <p class="cgpa-hint">Click the extension icon to set up your Canvas API token.</p>
        </div>
      `;
      return;
    }

    // Fetch course data
    const courseData = await fetchCourseData(canvasApiToken, canvasBaseUrl, ContentState.courseId);
    ContentState.courseData = courseData;

    // Get grading scale
    const gradingScale = await getGradingScaleForCourse(
      canvasApiToken,
      canvasBaseUrl,
      ContentState.courseId
    );
    ContentState.gradingScale = gradingScale;

    // Calculate grade
    const gradeResult = calculateGradeFromData(courseData);

    // Get grade info using course-specific scale
    const gradeInfo = convertGradeWithScale(gradeResult.percentage, gradingScale);

    // Render the widget
    renderWidget(courseData, gradeResult, gradeInfo, gradingScale);

  } catch (error) {
    console.error('[Canvas GPA] Error loading course data:', error);
    content.innerHTML = `
      <div class="cgpa-error">
        <p>Error loading data</p>
        <p class="cgpa-hint">${error.message}</p>
      </div>
    `;
  }
}

/**
 * Fetch course data from Canvas API
 */
async function fetchCourseData(token, baseUrl, courseId) {
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  // Fetch enrollment (for current grade)
  const enrollmentResponse = await fetch(
    `${baseUrl}/api/v1/courses/${courseId}/enrollments?user_id=self`,
    { headers }
  );

  if (!enrollmentResponse.ok) {
    throw new Error('Failed to fetch enrollment data');
  }

  const enrollments = await enrollmentResponse.json();
  const enrollment = enrollments[0];

  // Fetch assignment groups
  const groupsResponse = await fetch(
    `${baseUrl}/api/v1/courses/${courseId}/assignment_groups?include[]=assignments&include[]=submission`,
    { headers }
  );

  if (!groupsResponse.ok) {
    throw new Error('Failed to fetch assignment groups');
  }

  const assignmentGroups = await groupsResponse.json();

  // Fetch course info
  const courseResponse = await fetch(
    `${baseUrl}/api/v1/courses/${courseId}`,
    { headers }
  );

  const course = courseResponse.ok ? await courseResponse.json() : null;

  return {
    enrollment,
    assignmentGroups,
    course,
    currentGrade: enrollment?.grades?.current_score,
    finalGrade: enrollment?.grades?.final_score
  };
}

/**
 * Get grading scale for a course
 */
async function getGradingScaleForCourse(token, baseUrl, courseId) {
  // Check for custom scale first
  const { customGradingScales } = await getStoredData(['customGradingScales']);
  if (customGradingScales?.[courseId]) {
    return {
      scale: customGradingScales[courseId].scale,
      source: 'manual_override',
      confidence: 100
    };
  }

  // Try Canvas API
  try {
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };

    const response = await fetch(
      `${baseUrl}/api/v1/courses/${courseId}/grading_standards`,
      { headers }
    );

    if (response.ok) {
      const standards = await response.json();
      if (standards.length > 0 && standards[0].grading_scheme) {
        const scale = convertCanvasScheme(standards[0].grading_scheme);
        return {
          scale,
          source: 'canvas_api',
          confidence: 95,
          title: standards[0].title
        };
      }
    }
  } catch (error) {
    console.warn('[Canvas GPA] Could not fetch grading standard:', error);
  }

  // Return default
  return {
    scale: getDefaultScale(),
    source: 'default_fallback',
    confidence: 50,
    warning: 'Using default scale. Please verify with syllabus.'
  };
}

/**
 * Convert Canvas grading scheme format
 */
function convertCanvasScheme(canvasScheme) {
  const scale = {};
  const sortedScheme = [...canvasScheme].sort((a, b) => b.value - a.value);

  for (let i = 0; i < sortedScheme.length; i++) {
    const current = sortedScheme[i];
    const min = current.value * 100;
    const max = i === 0 ? 100 : (sortedScheme[i - 1].value * 100) - 0.01;

    scale[current.name] = {
      min: Math.round(min * 100) / 100,
      max: Math.round(max * 100) / 100
    };
  }

  return scale;
}

/**
 * Get default grading scale
 */
function getDefaultScale() {
  return {
    'A': { min: 93, max: 100 },
    'A-': { min: 90, max: 92.99 },
    'B+': { min: 87, max: 89.99 },
    'B': { min: 83, max: 86.99 },
    'B-': { min: 80, max: 82.99 },
    'C+': { min: 77, max: 79.99 },
    'C': { min: 73, max: 76.99 },
    'C-': { min: 70, max: 72.99 },
    'D+': { min: 67, max: 69.99 },
    'D': { min: 63, max: 66.99 },
    'D-': { min: 60, max: 62.99 },
    'F': { min: 0, max: 59.99 }
  };
}

/**
 * GPA points mapping
 */
const GRADE_POINTS = {
  'A+': 4.0, 'A': 4.0, 'A-': 3.7,
  'B+': 3.3, 'B': 3.0, 'B-': 2.7,
  'C+': 2.3, 'C': 2.0, 'C-': 1.7,
  'D+': 1.3, 'D': 1.0, 'D-': 0.7,
  'F': 0.0
};

/**
 * Calculate grade from assignment data
 */
function calculateGradeFromData(courseData) {
  const { assignmentGroups, currentGrade } = courseData;

  // If Canvas provides current grade, use it
  if (currentGrade !== null && currentGrade !== undefined) {
    return {
      percentage: currentGrade,
      method: 'canvas_provided',
      isComplete: true
    };
  }

  // Calculate manually
  const totalWeight = assignmentGroups.reduce((sum, g) => sum + (g.group_weight || 0), 0);
  const isWeighted = totalWeight > 0;

  if (isWeighted) {
    return calculateWeightedGrade(assignmentGroups);
  } else {
    return calculatePointsGrade(assignmentGroups);
  }
}

/**
 * Calculate weighted grade
 */
function calculateWeightedGrade(groups) {
  let totalWeightedScore = 0;
  let totalWeight = 0;
  const breakdown = [];

  for (const group of groups) {
    const weight = group.group_weight || 0;
    let earned = 0;
    let possible = 0;

    for (const assignment of group.assignments || []) {
      const submission = assignment.submission;
      if (submission?.score !== null && submission?.score !== undefined && !submission.excused) {
        earned += submission.score;
        possible += assignment.points_possible || 0;
      }
    }

    if (possible > 0) {
      const groupPercent = (earned / possible) * 100;
      totalWeightedScore += (groupPercent / 100) * weight;
      totalWeight += weight;

      breakdown.push({
        name: group.name,
        weight,
        percentage: groupPercent,
        earned,
        possible
      });
    }
  }

  const percentage = totalWeight > 0 ? (totalWeightedScore / totalWeight) * 100 : null;

  return {
    percentage,
    method: 'weighted',
    totalWeight,
    breakdown
  };
}

/**
 * Calculate points-based grade
 */
function calculatePointsGrade(groups) {
  let totalEarned = 0;
  let totalPossible = 0;

  for (const group of groups) {
    for (const assignment of group.assignments || []) {
      const submission = assignment.submission;
      if (submission?.score !== null && submission?.score !== undefined && !submission.excused) {
        totalEarned += submission.score;
        totalPossible += assignment.points_possible || 0;
      }
    }
  }

  const percentage = totalPossible > 0 ? (totalEarned / totalPossible) * 100 : null;

  return {
    percentage,
    method: 'points',
    totalEarned,
    totalPossible
  };
}

/**
 * Convert grade using course-specific scale
 */
function convertGradeWithScale(percentage, gradingScale) {
  if (percentage === null) {
    return { letterGrade: null, gpaPoints: null };
  }

  const scale = gradingScale.scale;
  let letterGrade = 'F';

  const sortedGrades = Object.entries(scale).sort((a, b) => b[1].min - a[1].min);
  for (const [letter, range] of sortedGrades) {
    if (percentage >= range.min && percentage <= range.max) {
      letterGrade = letter;
      break;
    }
  }

  return {
    letterGrade,
    gpaPoints: GRADE_POINTS[letterGrade] ?? 0
  };
}

/**
 * Render the widget content
 */
function renderWidget(courseData, gradeResult, gradeInfo, gradingScale) {
  const content = ContentState.widgetContainer.querySelector('.cgpa-content');
  const percentage = gradeResult.percentage;

  // Determine scale source display
  const sourceDisplay = {
    'manual_override': { icon: '✓', text: 'Manual', class: 'manual' },
    'canvas_api': { icon: '✅', text: 'Canvas API', class: 'api' },
    'default_fallback': { icon: '⚠️', text: 'Default', class: 'default' }
  };
  const source = sourceDisplay[gradingScale.source] || sourceDisplay.default_fallback;

  // Get letter grade class
  const letterClass = gradeInfo.letterGrade ? gradeInfo.letterGrade.charAt(0).toLowerCase() : '';

  content.innerHTML = `
    <div class="cgpa-grade-display">
      <div class="cgpa-percentage">${percentage !== null ? percentage.toFixed(1) + '%' : 'N/A'}</div>
      <div class="cgpa-letter-grade ${letterClass}">${gradeInfo.letterGrade || '--'}</div>
      <div class="cgpa-gpa-points">${gradeInfo.gpaPoints !== null ? gradeInfo.gpaPoints.toFixed(1) + ' GPA pts' : ''}</div>
    </div>

    <div class="cgpa-scale-info">
      <span class="cgpa-scale-source ${source.class}">${source.icon} ${source.text} (${gradingScale.confidence}%)</span>
      <button class="cgpa-edit-scale-btn">Edit Scale</button>
    </div>

    ${gradingScale.warning ? `<div class="cgpa-warning">${gradingScale.warning}</div>` : ''}

    <div class="cgpa-scale-preview">
      ${formatScalePreview(gradingScale.scale)}
    </div>

    <div class="cgpa-whatif-section">
      <h4>What-If Calculator</h4>
      <div class="cgpa-whatif-inputs">
        <select class="cgpa-assignment-select">
          <option value="">Select assignment...</option>
          ${renderAssignmentOptions(courseData.assignmentGroups)}
        </select>
        <input type="number" class="cgpa-whatif-score" placeholder="Score %" min="0" max="100">
        <button class="cgpa-whatif-calc-btn">Calculate</button>
      </div>
      <div class="cgpa-whatif-result"></div>
    </div>

    <div class="cgpa-target-section">
      <h4>Target Grade</h4>
      <div class="cgpa-target-inputs">
        <span>To get</span>
        <select class="cgpa-target-grade">
          <option value="A">A (93%+)</option>
          <option value="A-">A- (90%+)</option>
          <option value="B+">B+ (87%+)</option>
          <option value="B">B (83%+)</option>
        </select>
        <button class="cgpa-target-calc-btn">Calculate</button>
      </div>
      <div class="cgpa-target-result"></div>
    </div>
  `;

  // Add event listeners
  setupWidgetEventListeners();
}

/**
 * Format scale for preview
 */
function formatScalePreview(scale) {
  const sortedGrades = Object.entries(scale)
    .sort((a, b) => b[1].min - a[1].min)
    .slice(0, 4); // Show top 4

  return sortedGrades.map(([letter, range]) =>
    `<span class="cgpa-scale-item">${letter}: ${range.min}%</span>`
  ).join('');
}

/**
 * Render assignment options for what-if calculator
 */
function renderAssignmentOptions(assignmentGroups) {
  const options = [];

  for (const group of assignmentGroups) {
    for (const assignment of group.assignments || []) {
      const submission = assignment.submission;
      const hasScore = submission?.score !== null && submission?.score !== undefined;
      const label = `${assignment.name} (${hasScore ? submission.score + '/' : ''}${assignment.points_possible || 0} pts)`;

      options.push(`<option value="${assignment.id}" data-points="${assignment.points_possible || 0}">${label}</option>`);
    }
  }

  return options.join('');
}

/**
 * Setup event listeners for widget interactions
 */
function setupWidgetEventListeners() {
  const widget = ContentState.widgetContainer;

  // Edit scale button
  widget.querySelector('.cgpa-edit-scale-btn')?.addEventListener('click', openScaleEditor);

  // What-if calculator
  widget.querySelector('.cgpa-whatif-calc-btn')?.addEventListener('click', calculateWhatIf);

  // Target calculator
  widget.querySelector('.cgpa-target-calc-btn')?.addEventListener('click', calculateTarget);
}

/**
 * Open grading scale editor
 */
async function openScaleEditor() {
  const scale = ContentState.gradingScale?.scale || getDefaultScale();

  const scaleStr = Object.entries(scale)
    .sort((a, b) => b[1].min - a[1].min)
    .map(([letter, range]) => `${letter}: ${range.min}-${range.max}`)
    .join('\n');

  const newScaleStr = prompt(
    `Edit Grading Scale\n\nFormat: A: 93-100\n\nCurrent scale:\n${scaleStr}`,
    scaleStr
  );

  if (newScaleStr && newScaleStr !== scaleStr) {
    const newScale = parseScaleString(newScaleStr);

    if (Object.keys(newScale).length > 0) {
      // Save to storage
      const { customGradingScales = {} } = await getStoredData(['customGradingScales']);
      customGradingScales[ContentState.courseId] = {
        scale: newScale,
        lastUpdated: new Date().toISOString()
      };
      await saveToStorage({ customGradingScales });

      // Refresh
      await loadAndDisplayCourseData(true);
    } else {
      alert('Could not parse grading scale. Please use format: A: 93-100');
    }
  }
}

/**
 * Parse scale string into scale object
 */
function parseScaleString(str) {
  const scale = {};
  const lines = str.split('\n');

  for (const line of lines) {
    const match = line.match(/([A-F][+-]?)\s*:\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/i);
    if (match) {
      scale[match[1].toUpperCase()] = {
        min: parseFloat(match[2]),
        max: parseFloat(match[3])
      };
    }
  }

  return scale;
}

/**
 * Calculate what-if scenario
 */
function calculateWhatIf() {
  const widget = ContentState.widgetContainer;
  const select = widget.querySelector('.cgpa-assignment-select');
  const scoreInput = widget.querySelector('.cgpa-whatif-score');
  const resultDiv = widget.querySelector('.cgpa-whatif-result');

  const assignmentId = select.value;
  const score = parseFloat(scoreInput.value);

  if (!assignmentId || isNaN(score)) {
    resultDiv.innerHTML = '<p class="cgpa-error-text">Please select an assignment and enter a score</p>';
    return;
  }

  // Create modified assignment groups
  const modifiedGroups = JSON.parse(JSON.stringify(ContentState.courseData.assignmentGroups));

  for (const group of modifiedGroups) {
    for (const assignment of group.assignments || []) {
      if (assignment.id.toString() === assignmentId) {
        if (!assignment.submission) {
          assignment.submission = {};
        }
        assignment.submission.score = (score / 100) * (assignment.points_possible || 0);
      }
    }
  }

  // Calculate new grade
  const newResult = calculateGradeFromData({ ...ContentState.courseData, assignmentGroups: modifiedGroups });
  const newGradeInfo = convertGradeWithScale(newResult.percentage, ContentState.gradingScale);

  const currentPct = ContentState.courseData.currentGrade || 0;
  const change = newResult.percentage - currentPct;
  const changeClass = change >= 0 ? 'positive' : 'negative';
  const changeSign = change >= 0 ? '+' : '';

  resultDiv.innerHTML = `
    <p class="cgpa-result-text">
      With ${score}%: <strong>${newResult.percentage?.toFixed(1)}% (${newGradeInfo.letterGrade})</strong>
      <span class="cgpa-change ${changeClass}">${changeSign}${change.toFixed(1)}%</span>
    </p>
  `;
}

/**
 * Calculate target grade requirement
 */
function calculateTarget() {
  const widget = ContentState.widgetContainer;
  const select = widget.querySelector('.cgpa-target-grade');
  const resultDiv = widget.querySelector('.cgpa-target-result');

  const targetLetter = select.value;
  const scale = ContentState.gradingScale?.scale || getDefaultScale();
  const targetMin = scale[targetLetter]?.min || 90;

  const currentPct = ContentState.courseData.currentGrade || 0;

  if (currentPct >= targetMin) {
    resultDiv.innerHTML = `<p class="cgpa-success-text">You already have ${targetLetter}!</p>`;
    return;
  }

  // Find ungraded assignments
  const ungraded = [];
  for (const group of ContentState.courseData.assignmentGroups) {
    for (const assignment of group.assignments || []) {
      const submission = assignment.submission;
      if (!submission || submission.score === null || submission.score === undefined) {
        if (assignment.points_possible > 0) {
          ungraded.push(assignment);
        }
      }
    }
  }

  if (ungraded.length === 0) {
    resultDiv.innerHTML = `<p class="cgpa-error-text">No ungraded assignments remaining</p>`;
    return;
  }

  // Simplified calculation (assumes points-based)
  const needed = targetMin - currentPct;

  resultDiv.innerHTML = `
    <p class="cgpa-result-text">
      Need to gain <strong>${needed.toFixed(1)}%</strong> on remaining ${ungraded.length} assignment(s)
    </p>
    <p class="cgpa-hint-text">Use what-if calculator for specific scenarios</p>
  `;
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'REFRESH_DATA') {
    loadAndDisplayCourseData(true);
  }
  sendResponse({ success: true });
});
