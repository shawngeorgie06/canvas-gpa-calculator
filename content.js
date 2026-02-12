/**
 * Canvas Grade & GPA Calculator - Content Script
 * Injects grade calculator UI into Canvas course pages
 */

// State for the content script
const ContentState = {
  courseId: null,
  courseData: null,
  gradingScale: null,
  gradePoints: GRADE_POINTS_NJIT,  // Default to NJIT, will be updated from storage
  excludedAssignments: [],
  isInitialized: false,
  widgetContainer: null,
  toggleButton: null,
  assignmentListExpanded: false,
  widgetVisible: true,
  widgetMinimized: false
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
  return match ? parseInt(match[1], 10) : null;
}

/**
 * SECURITY: Sanitize HTML to prevent XSS attacks
 * Escapes dangerous characters in user-supplied strings
 */
function sanitizeHTML(str) {
  if (typeof str !== 'string') return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * SECURITY: Validate Canvas course ID format
 * Must be a positive integer
 */
function isValidCourseId(courseId) {
  if (!courseId) return false;
  const num = parseInt(courseId, 10);
  return Number.isFinite(num) && num > 0;
}

/**
 * SECURITY: Validate assignment ID format
 */
function isValidAssignmentId(assignmentId) {
  if (!assignmentId) return false;
  const num = parseInt(assignmentId, 10);
  return Number.isFinite(num) && num > 0;
}

/**
 * Wait for Canvas to fully load (using MutationObserver for efficiency)
 * Replaces polling approach with event-driven monitoring
 */
function waitForCanvasLoad(timeout = 5000) {
  return new Promise((resolve) => {
    // Check if element already exists (immediate case)
    const sidebar = document.querySelector('#right-side, .right-side-wrapper');
    const content = document.querySelector('#content, .ic-Layout-contentMain');

    if (sidebar || content) {
      resolve();
      return;
    }

    // Watch for DOM changes using MutationObserver (more efficient than polling every 100ms)
    const observer = new MutationObserver(() => {
      const sidebar = document.querySelector('#right-side, .right-side-wrapper');
      const content = document.querySelector('#content, .ic-Layout-contentMain');

      if (sidebar || content) {
        observer.disconnect();
        resolve();
      }
    });

    // Observe body for child list changes (new elements added)
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Timeout after specified milliseconds (don't wait forever if elements never appear)
    setTimeout(() => {
      observer.disconnect();
      console.warn('[Canvas GPA] Timeout waiting for Canvas to load, proceeding anyway');
      resolve();
    }, timeout);
  });
}

/**
 * Check if extension is configured
 */
async function checkConfiguration() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['canvasApiTokenEncrypted', 'canvasBaseUrl'], (result) => {
      resolve(Boolean(result.canvasApiTokenEncrypted && result.canvasBaseUrl));
    });
  });
}

/**
 * Get stored data with error handling
 */
function getStoredData(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      if (chrome.runtime.lastError) {
        console.error('[Canvas GPA] Storage read error:', chrome.runtime.lastError);
        reject(chrome.runtime.lastError);
      } else {
        resolve(result);
      }
    });
  });
}

/**
 * Save data to storage with error handling
 */
function saveToStorage(data) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(data, () => {
      if (chrome.runtime.lastError) {
        console.error('[Canvas GPA] Storage write error:', chrome.runtime.lastError);
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Create the floating toggle button
 */
function createToggleButton() {
  const button = document.createElement('button');
  button.id = 'cgpa-toggle-btn';
  button.className = 'cgpa-toggle-btn';
  button.setAttribute('data-tooltip', 'Show Grade Calculator (Ctrl+Shift+G)');
  button.innerHTML = '<span class="cgpa-toggle-icon">📊</span>';

  button.addEventListener('click', async () => {
    await toggleWidgetVisible();
  });

  document.body.appendChild(button);
  ContentState.toggleButton = button;

  return button;
}

/**
 * Set widget visibility
 * @param {boolean} visible - Whether widget should be visible
 */
async function setWidgetVisible(visible) {
  ContentState.widgetVisible = visible;
  await saveToStorage({ widgetVisible: visible });

  if (ContentState.widgetContainer) {
    ContentState.widgetContainer.classList.toggle('hidden', !visible);
  }

  if (ContentState.toggleButton) {
    ContentState.toggleButton.classList.toggle('widget-hidden', !visible);
    ContentState.toggleButton.setAttribute(
      'data-tooltip',
      visible ? 'Hide Grade Calculator (Ctrl+Shift+G)' : 'Show Grade Calculator (Ctrl+Shift+G)'
    );
  }
}

/**
 * Toggle widget visibility
 */
async function toggleWidgetVisible() {
  const newState = !ContentState.widgetVisible;
  await setWidgetVisible(newState);

  // If showing and not yet loaded, load data
  if (newState && !ContentState.courseData) {
    await loadAndDisplayCourseData();
  }
}

/**
 * Toggle widget minimized state
 */
function toggleWidgetMinimized() {
  ContentState.widgetMinimized = !ContentState.widgetMinimized;

  if (ContentState.widgetContainer) {
    ContentState.widgetContainer.classList.toggle('minimized', ContentState.widgetMinimized);

    // Update minimize button icon
    const minBtn = ContentState.widgetContainer.querySelector('.cgpa-minimize-btn:not(.cgpa-close-btn)');
    if (minBtn) {
      minBtn.innerHTML = ContentState.widgetMinimized ? '+' : '−';
      minBtn.title = ContentState.widgetMinimized ? 'Expand' : 'Minimize';
    }
  }
}

/**
 * Setup keyboard shortcuts
 */
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', async (e) => {
    // Ctrl+Shift+G to toggle widget
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'g') {
      e.preventDefault();
      await toggleWidgetVisible();
    }
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

  // Load visibility preference
  const { widgetVisible } = await getStoredData(['widgetVisible']);
  ContentState.widgetVisible = widgetVisible !== false; // Default to true

  // Create widget container
  const widget = createWidgetElement();
  ContentState.widgetContainer = widget;

  // Apply initial visibility state
  if (!ContentState.widgetVisible) {
    widget.classList.add('hidden');
  }

  // Insert at top of sidebar
  sidebar.insertBefore(widget, sidebar.firstChild);

  // Create floating toggle button
  createToggleButton();
  if (!ContentState.widgetVisible) {
    ContentState.toggleButton.classList.add('widget-hidden');
    ContentState.toggleButton.setAttribute('data-tooltip', 'Show Grade Calculator (Ctrl+Shift+G)');
  }

  // Setup keyboard shortcuts
  setupKeyboardShortcuts();

  // Load and display data only if widget is visible
  if (ContentState.widgetVisible) {
    await loadAndDisplayCourseData();
  }
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
      <div class="cgpa-header-buttons">
        <button class="cgpa-minimize-btn" title="Minimize">−</button>
        <button class="cgpa-refresh-btn" title="Refresh">↻</button>
        <button class="cgpa-close-btn cgpa-minimize-btn" title="Hide (Ctrl+Shift+G)">×</button>
      </div>
    </div>
    <div class="cgpa-content">
      <div class="cgpa-loading">Loading...</div>
    </div>
  `;

  // Add refresh handler with debounce to prevent rapid clicking
  let isRefreshing = false;
  widget.querySelector('.cgpa-refresh-btn').addEventListener('click', async () => {
    if (isRefreshing) return; // Prevent multiple simultaneous refreshes

    isRefreshing = true;
    const refreshBtn = widget.querySelector('.cgpa-refresh-btn');
    refreshBtn.disabled = true;

    try {
      await loadAndDisplayCourseData(true);
    } finally {
      isRefreshing = false;
      refreshBtn.disabled = false;
    }
  });

  // Add minimize handler
  widget.querySelector('.cgpa-minimize-btn').addEventListener('click', () => {
    toggleWidgetMinimized();
  });

  // Add close/hide handler
  widget.querySelector('.cgpa-close-btn').addEventListener('click', async () => {
    await setWidgetVisible(false);
  });

  return widget;
}

/**
 * Load and display course data
 * SECURITY: Does NOT retrieve or store tokens - uses background worker via message passing
 */
async function loadAndDisplayCourseData(forceRefresh = false) {
  const content = ContentState.widgetContainer.querySelector('.cgpa-content');
  content.innerHTML = '<div class="cgpa-loading">Loading...</div>';

  try {
    // Check if configured by asking background worker (doesn't expose token)
    let isConfigured = false;
    try {
      await chrome.runtime.sendMessage({ type: 'VERIFY_TOKEN' });
      isConfigured = true;
    } catch (error) {
      isConfigured = false;
    }

    if (!isConfigured) {
      content.innerHTML = `
        <div class="cgpa-setup">
          <p>Please configure the extension first.</p>
          <p class="cgpa-hint">Click the extension icon to set up your Canvas API token.</p>
        </div>
      `;
      return;
    }

    // Fetch course data (via background worker as API gateway - NO TOKEN PASSED)
    const courseData = await fetchCourseData(ContentState.courseId);
    ContentState.courseData = courseData;

    // Get grading scale (via background worker as API gateway - NO TOKEN PASSED)
    const gradingScale = await getGradingScaleForCourse(ContentState.courseId);
    ContentState.gradingScale = gradingScale;

    // Load the user's selected grading scale to get correct GPA points mapping
    const gradePoints = await getGradePointsScale();
    ContentState.gradePoints = gradePoints;

    // Load excluded assignments
    const { excludedAssignments = {} } = await getStoredData(['excludedAssignments']);
    ContentState.excludedAssignments = excludedAssignments[ContentState.courseId] || [];

    // Calculate grade (with exclusions applied)
    const gradeResult = calculateGradeFromData(courseData, ContentState.excludedAssignments);

    // Fallback to Canvas enrollment current_score if assignment calculation failed
    if (gradeResult.percentage === null && courseData.currentGrade !== null) {
      gradeResult.percentage = courseData.currentGrade;
      gradeResult.source = 'enrollment';
    }

    // Get grade info using course-specific scale AND correct GPA points
    const gradeInfo = convertGradeWithScale(gradeResult.percentage, gradingScale, gradePoints);

    // Render the widget
    renderWidget(courseData, gradeResult, gradeInfo, gradingScale);

  } catch (error) {
    // Log full error internally, show generic message to user
    console.error('[Canvas GPA] Error loading course data:', error.message || error);

    let userMessage = 'Unable to load course data. Please try again.';
    if (error.message?.includes('not configured')) {
      userMessage = 'Extension not configured. Please check your API token.';
    } else if (error.message?.includes('unauthorized')) {
      userMessage = 'Invalid API token. Please check your credentials.';
    }

    content.innerHTML = `
      <div class="cgpa-error">
        <p>Error loading data</p>
        <p class="cgpa-hint">${sanitizeHTML(userMessage)}</p>
      </div>
    `;
  }
}

/**
 * Fetch course data from Canvas API via background worker (centralized gateway)
 */
async function fetchCourseData(courseId) {
  try {
    // Fetch all data from background service worker (API gateway)
    // This centralizes API access and ensures consistent rate limiting, caching, and error handling
    const [enrollmentData, groupsData, courseData] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'GET_ENROLLMENTS', courseId }),
      chrome.runtime.sendMessage({ type: 'GET_ASSIGNMENT_GROUPS', courseId }),
      chrome.runtime.sendMessage({ type: 'GET_COURSE_INFO', courseId })
    ]);

    const enrollment = enrollmentData[0];

    return {
      enrollment,
      assignmentGroups: groupsData.groups || [],
      course: courseData,
      currentGrade: enrollment?.grades?.current_score,
      finalGrade: enrollment?.grades?.final_score
    };
  } catch (error) {
    console.error('[Canvas GPA] Error fetching course data:', error.message || error);
    throw error;
  }
}

/**
 * Get grading scale for a course (via background worker as API gateway)
 */
async function getGradingScaleForCourse(courseId) {
  try {
    // Request grading scale from background service worker
    // This handles: custom scales, Canvas API lookup, and defaults
    const scale = await chrome.runtime.sendMessage({
      type: 'GET_GRADING_STANDARDS',
      courseId
    });
    return scale;
  } catch (error) {
    console.error('[Canvas GPA] Error fetching grading scale:', error);
    // Fallback to default
    return {
      scale: GradingScales.getDefault(),
      source: 'default_fallback',
      confidence: 50,
      warning: 'Using default scale. Verify with your syllabus.'
    };
  }
}

// NOTE: convertCanvasScheme and getDefaultScale moved to utils/grading-scales.js
// Use GradingScales.convertCanvasScheme() and GradingScales.getDefault() instead

/**
 * Get current grading scale from storage
 * Returns the appropriate GRADE_POINTS based on user's selected scale
 */
async function getGradePointsScale() {
  try {
    const { selectedGradingScale = 'njit' } = await getStoredData(['selectedGradingScale']);

    const scales = {
      'njit': GRADE_POINTS_NJIT,
      'plusMinus': GRADE_POINTS_PLUS_MINUS,
      'standard': GRADE_POINTS_STANDARD
    };

    return scales[selectedGradingScale] || GRADE_POINTS_NJIT;
  } catch (error) {
    console.error('[Canvas GPA] Error getting grading scale, using default:', error);
    return GRADE_POINTS_NJIT;
  }
}

/**
 * Calculate grade from assignment data
 * @param {object} courseData - Course data with assignment groups
 * @param {array} excludedAssignments - Array of assignment IDs to exclude
 */
function calculateGradeFromData(courseData, excludedAssignments = []) {
  const { assignmentGroups } = courseData;

  // Always calculate manually when we have exclusions to respect
  // (Canvas-provided grade doesn't account for user exclusions)
  const totalWeight = assignmentGroups.reduce((sum, g) => sum + (g.group_weight || 0), 0);
  const isWeighted = totalWeight > 0;

  if (isWeighted) {
    return calculateWeightedGrade(assignmentGroups, excludedAssignments);
  } else {
    return calculatePointsGrade(assignmentGroups, excludedAssignments);
  }
}

/**
 * Calculate weighted grade
 * @param {array} groups - Assignment groups
 * @param {array} excludedAssignments - Array of assignment IDs to exclude
 */
function calculateWeightedGrade(groups, excludedAssignments = []) {
  const excludedSet = new Set(excludedAssignments.map(id => id.toString()));
  let totalWeightedScore = 0;
  let totalWeight = 0;
  const breakdown = [];

  for (const group of groups) {
    const weight = group.group_weight || 0;
    let earned = 0;
    let possible = 0;
    let gradedCount = 0;

    for (const assignment of group.assignments || []) {
      // Skip excluded assignments
      if (excludedSet.has(assignment.id.toString())) {
        continue;
      }
      const submission = assignment.submission;
      if (submission?.score !== null && submission?.score !== undefined && !submission.excused) {
        earned += submission.score;
        possible += assignment.points_possible || 0;
        gradedCount++;
      }
    }

    if (possible > 0) {
      const groupPercent = (earned / possible) * 100;
      totalWeightedScore += (groupPercent / 100) * weight;
      totalWeight += weight;

      breakdown.push({
        name: group.name,
        id: group.id,
        weight,
        percentage: groupPercent,
        earned,
        possible,
        gradedCount
      });
    } else if (weight > 0) {
      // Track groups with no grades yet
      breakdown.push({
        name: group.name,
        id: group.id,
        weight,
        percentage: null,
        earned: 0,
        possible: 0,
        gradedCount: 0
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
 * @param {array} groups - Assignment groups
 * @param {array} excludedAssignments - Array of assignment IDs to exclude
 */
function calculatePointsGrade(groups, excludedAssignments = []) {
  const excludedSet = new Set(excludedAssignments.map(id => id.toString()));
  let totalEarned = 0;
  let totalPossible = 0;
  const breakdown = [];

  for (const group of groups) {
    let groupEarned = 0;
    let groupPossible = 0;
    let gradedCount = 0;

    for (const assignment of group.assignments || []) {
      // Skip excluded assignments
      if (excludedSet.has(assignment.id.toString())) {
        continue;
      }
      const submission = assignment.submission;
      if (submission?.score !== null && submission?.score !== undefined && !submission.excused) {
        groupEarned += submission.score;
        groupPossible += assignment.points_possible || 0;
        gradedCount++;
      }
    }

    totalEarned += groupEarned;
    totalPossible += groupPossible;

    breakdown.push({
      name: group.name,
      id: group.id,
      weight: null,
      percentage: groupPossible > 0 ? (groupEarned / groupPossible) * 100 : null,
      earned: groupEarned,
      possible: groupPossible,
      gradedCount
    });
  }

  const percentage = totalPossible > 0 ? (totalEarned / totalPossible) * 100 : null;

  return {
    percentage,
    method: 'points',
    totalEarned,
    totalPossible,
    breakdown
  };
}

/**
 * Convert grade using course-specific scale
 * @param {number} percentage - Grade percentage
 * @param {object} gradingScale - Grading scale with letter grade ranges
 * @param {object} gradePoints - GPA points mapping for letter grades
 */
function convertGradeWithScale(percentage, gradingScale, gradePoints = GRADE_POINTS_NJIT) {
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
    gpaPoints: gradePoints[letterGrade] ?? 0
  };
}

/**
 * Generate SVG pie chart for grade breakdown
 * @param {array} breakdown - Array of category data with name, weight/percentage, etc.
 * @param {number} centerPercentage - The overall percentage to show in center
 * @returns {string} SVG markup
 */
function generatePieChartSVG(breakdown, centerPercentage) {
  const size = 180;
  const center = size / 2;
  const radius = 55;
  const circumference = 2 * Math.PI * radius;

  // Filter to only categories with grades
  const gradedCategories = breakdown.filter(cat => cat.percentage !== null);

  if (gradedCategories.length === 0) {
    return `
      <svg class="cgpa-pie-svg" viewBox="0 0 ${size} ${size}">
        <circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="#e5e7eb" stroke-width="35"/>
        <text x="${center}" y="${center}" text-anchor="middle" dominant-baseline="middle" transform="rotate(90 ${center} ${center})">
          <tspan class="cgpa-pie-center-text" dy="-5">N/A</tspan>
          <tspan class="cgpa-pie-center-label" x="${center}" dy="18">No grades</tspan>
        </text>
      </svg>
    `;
  }

  // Calculate total weight or equal distribution
  const hasWeights = gradedCategories.some(cat => cat.weight > 0);
  let totalWeight;

  if (hasWeights) {
    totalWeight = gradedCategories.reduce((sum, cat) => sum + (cat.weight || 0), 0);
  } else {
    totalWeight = gradedCategories.length;
  }

  // Generate segments
  let currentOffset = 0;
  const segments = gradedCategories.map((cat, index) => {
    const weight = hasWeights ? (cat.weight || 0) : 1;
    const segmentLength = (weight / totalWeight) * circumference;
    const dashArray = `${segmentLength} ${circumference - segmentLength}`;
    const dashOffset = -currentOffset;
    currentOffset += segmentLength;

    return `<circle
      class="cgpa-pie-segment cgpa-pie-color-${index % 8}"
      cx="${center}" cy="${center}" r="${radius}"
      stroke-dasharray="${dashArray}"
      stroke-dashoffset="${dashOffset}"
      data-category="${cat.name}"
      data-percentage="${cat.percentage?.toFixed(1) || 0}%"
    />`;
  }).join('');

  // Center text (rotated back to normal)
  const centerText = centerPercentage !== null
    ? `<text x="${center}" y="${center}" text-anchor="middle" dominant-baseline="middle" transform="rotate(90 ${center} ${center})">
        <tspan class="cgpa-pie-center-text" dy="-5">${centerPercentage.toFixed(1)}%</tspan>
        <tspan class="cgpa-pie-center-label" x="${center}" dy="18">Overall</tspan>
      </text>`
    : '';

  return `
    <svg class="cgpa-pie-svg" viewBox="0 0 ${size} ${size}">
      ${segments}
      ${centerText}
    </svg>
  `;
}

/**
 * Generate pie chart legend HTML
 * @param {array} breakdown - Category breakdown data
 * @returns {string} HTML markup for legend
 */
function generatePieChartLegend(breakdown) {
  const gradedCategories = breakdown.filter(cat => cat.percentage !== null);

  if (gradedCategories.length === 0) {
    return '<div class="cgpa-pie-legend"><span style="color: #9ca3af; font-size: 12px;">No graded categories yet</span></div>';
  }

  const legendItems = gradedCategories.map((cat, index) => {
    const weightText = cat.weight ? `(${cat.weight}%)` : '';
    return `
      <div class="cgpa-pie-legend-item">
        <div class="cgpa-pie-legend-left">
          <span class="cgpa-pie-legend-dot cgpa-legend-color-${index % 8}"></span>
          <span class="cgpa-pie-legend-name" title="${cat.name}">${cat.name}</span>
          <span class="cgpa-pie-legend-weight">${weightText}</span>
        </div>
        <span class="cgpa-pie-legend-percent">${cat.percentage.toFixed(0)}%</span>
      </div>
    `;
  }).join('');

  return `<div class="cgpa-pie-legend">${legendItems}</div>`;
}

/**
 * Render the assignment list with exclusion toggles
 * @param {array} assignmentGroups - Assignment groups from course data
 * @param {array} excludedAssignments - Array of excluded assignment IDs
 * @returns {string} HTML markup for assignment list
 */
function renderAssignmentList(assignmentGroups, excludedAssignments) {
  const excludedSet = new Set(excludedAssignments.map(id => id.toString()));
  const isExpanded = ContentState.assignmentListExpanded;

  let groupsHtml = '';

  for (const group of assignmentGroups) {
    const assignments = group.assignments || [];
    if (assignments.length === 0) continue;

    const assignmentItems = assignments.map(assignment => {
      const isExcluded = excludedSet.has(assignment.id.toString());
      const submission = assignment.submission;
      const hasScore = submission?.score !== null && submission?.score !== undefined;
      const isExcused = submission?.excused;

      let scoreDisplay;
      if (isExcused) {
        scoreDisplay = '<span class="cgpa-assignment-ungraded">Excused</span>';
      } else if (hasScore) {
        scoreDisplay = `<span class="cgpa-assignment-score">${submission.score}/${assignment.points_possible || 0}</span>`;
      } else {
        scoreDisplay = '<span class="cgpa-assignment-ungraded">--</span>';
      }

      const excludedLabel = isExcluded ? '<span class="cgpa-assignment-excluded-label">excluded</span>' : '';

      return `
        <div class="cgpa-assignment-item ${isExcluded ? 'excluded' : ''}" data-assignment-id="${assignment.id}">
          <input type="checkbox"
                 class="cgpa-assignment-checkbox"
                 ${!isExcluded ? 'checked' : ''}
                 data-assignment-id="${assignment.id}"
                 title="${isExcluded ? 'Click to include in grade' : 'Click to exclude from grade'}">
          <span class="cgpa-assignment-name" title="${assignment.name}">${assignment.name}</span>
          ${excludedLabel}
          ${scoreDisplay}
        </div>
      `;
    }).join('');

    groupsHtml += `
      <div class="cgpa-assignment-group">
        <div class="cgpa-assignment-group-name">${group.name}</div>
        ${assignmentItems}
      </div>
    `;
  }

  return `
    <div class="cgpa-assignment-section">
      <div class="cgpa-assignment-header">
        <h4>Assignments</h4>
        <span class="cgpa-assignment-toggle ${isExpanded ? 'expanded' : ''}">▼</span>
      </div>
      <div class="cgpa-assignment-list ${isExpanded ? 'expanded' : ''}">
        ${groupsHtml}
      </div>
    </div>
  `;
}

/**
 * Handle assignment toggle (include/exclude)
 * @param {string} assignmentId - ID of the assignment to toggle
 */
async function handleAssignmentToggle(assignmentId) {
  // SECURITY: Validate assignment ID is a valid number
  if (!isValidAssignmentId(assignmentId)) {
    console.error('[Canvas GPA] Invalid assignment ID:', assignmentId);
    return;
  }

  // SECURITY: Verify assignment exists in the course
  let assignmentExists = false;
  for (const group of ContentState.courseData?.assignmentGroups || []) {
    if (group.assignments?.some(a => a.id.toString() === assignmentId.toString())) {
      assignmentExists = true;
      break;
    }
  }

  if (!assignmentExists) {
    console.error('[Canvas GPA] Assignment not found in course:', assignmentId);
    return;
  }

  const { excludedAssignments = {} } = await getStoredData(['excludedAssignments']);
  const courseExclusions = excludedAssignments[ContentState.courseId] || [];

  const index = courseExclusions.indexOf(assignmentId);
  if (index === -1) {
    // Add to exclusions
    courseExclusions.push(assignmentId);
  } else {
    // Remove from exclusions
    courseExclusions.splice(index, 1);
  }

  excludedAssignments[ContentState.courseId] = courseExclusions;
  await saveToStorage({ excludedAssignments });

  // Update local state
  ContentState.excludedAssignments = courseExclusions;

  // Recalculate and re-render
  const gradeResult = calculateGradeFromData(ContentState.courseData, courseExclusions);
  const gradeInfo = convertGradeWithScale(gradeResult.percentage, ContentState.gradingScale, ContentState.gradePoints);
  renderWidget(ContentState.courseData, gradeResult, gradeInfo, ContentState.gradingScale);
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

  // Generate pie chart if we have breakdown data
  const breakdown = gradeResult.breakdown || [];
  const pieChartSVG = generatePieChartSVG(breakdown, percentage);
  const pieChartLegend = generatePieChartLegend(breakdown);

  // Generate assignment list
  const assignmentListHtml = renderAssignmentList(courseData.assignmentGroups, ContentState.excludedAssignments);

  content.innerHTML = `
    <div class="cgpa-grade-display">
      <div class="cgpa-percentage">${percentage !== null ? percentage.toFixed(1) + '%' : 'N/A'}</div>
      <div class="cgpa-letter-grade ${letterClass}">${gradeInfo.letterGrade || '--'}</div>
      <div class="cgpa-gpa-points">${gradeInfo.gpaPoints !== null ? gradeInfo.gpaPoints.toFixed(1) + ' GPA pts' : ''}</div>
    </div>

    <div class="cgpa-pie-container">
      <div class="cgpa-pie-chart">
        ${pieChartSVG}
      </div>
      ${pieChartLegend}
    </div>

    <div class="cgpa-scale-info">
      <span class="cgpa-scale-source ${source.class}">${source.icon} ${source.text} (${gradingScale.confidence}%)</span>
      <button class="cgpa-edit-scale-btn">Edit Scale</button>
    </div>

    ${gradingScale.warning ? `<div class="cgpa-warning">${gradingScale.warning}</div>` : ''}

    <div class="cgpa-scale-preview">
      ${formatScalePreview(gradingScale.scale)}
    </div>

    ${assignmentListHtml}

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
          <option value="A">A (90%+)</option>
          <option value="B+">B+ (85%+)</option>
          <option value="B">B (80%+)</option>
          <option value="C+">C+ (75%+)</option>
          <option value="C">C (70%+)</option>
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

  // Assignment list toggle
  const assignmentHeader = widget.querySelector('.cgpa-assignment-header');
  if (assignmentHeader) {
    assignmentHeader.addEventListener('click', () => {
      ContentState.assignmentListExpanded = !ContentState.assignmentListExpanded;
      const list = widget.querySelector('.cgpa-assignment-list');
      const toggle = widget.querySelector('.cgpa-assignment-toggle');
      if (list) {
        list.classList.toggle('expanded', ContentState.assignmentListExpanded);
      }
      if (toggle) {
        toggle.classList.toggle('expanded', ContentState.assignmentListExpanded);
      }
    });
  }

  // Assignment checkboxes for exclusion - Use event delegation (single listener)
  // This avoids adding multiple listeners to each checkbox and prevents memory leaks
  const assignmentList = widget.querySelector('.cgpa-assignment-list');
  if (assignmentList) {
    // Remove old listener if it exists (prevent duplicate listeners on re-renders)
    if (assignmentList._checkboxListener) {
      assignmentList.removeEventListener('change', assignmentList._checkboxListener);
    }

    // Add single delegated listener to parent container
    const checkboxListener = async (e) => {
      if (e.target.classList.contains('cgpa-assignment-checkbox')) {
        const assignmentId = e.target.dataset.assignmentId;
        if (assignmentId) {
          await handleAssignmentToggle(assignmentId);
        }
      }
    };

    assignmentList.addEventListener('change', checkboxListener);
    assignmentList._checkboxListener = checkboxListener; // Store reference for cleanup
  }
}

/**
 * Open grading scale editor modal
 */
async function openScaleEditor() {
  const scale = ContentState.gradingScale?.scale || getDefaultScale();

  // Remove existing modal if any
  const existingModal = document.getElementById('cgpa-scale-modal');
  if (existingModal) existingModal.remove();

  // Create modal overlay
  const modal = document.createElement('div');
  modal.id = 'cgpa-scale-modal';
  modal.className = 'cgpa-modal-overlay';

  // Get current values sorted by grade
  const grades = ['A', 'B+', 'B', 'C+', 'C', 'D', 'F'];

  modal.innerHTML = `
    <div class="cgpa-modal">
      <div class="cgpa-modal-header">
        <h3>Edit Grading Scale</h3>
        <button class="cgpa-modal-close">&times;</button>
      </div>
      <div class="cgpa-modal-body">
        <p class="cgpa-modal-hint">Enter the minimum percentage for each letter grade based on your syllabus.</p>
        <div class="cgpa-scale-inputs">
          ${grades.map(grade => {
            const currentMin = scale[grade]?.min ?? '';
            return `
              <div class="cgpa-scale-row">
                <label class="cgpa-scale-label">${grade}</label>
                <input type="number"
                       class="cgpa-scale-input"
                       data-grade="${grade}"
                       value="${currentMin}"
                       min="0"
                       max="100"
                       step="0.1"
                       placeholder="Min %">
                <span class="cgpa-scale-percent">%</span>
              </div>
            `;
          }).join('')}
        </div>
        <div class="cgpa-modal-presets">
          <span>Presets:</span>
          <button class="cgpa-preset-btn" data-preset="njit">NJIT Default</button>
          <button class="cgpa-preset-btn" data-preset="standard">Standard (93/85/80...)</button>
        </div>
      </div>
      <div class="cgpa-modal-footer">
        <button class="cgpa-modal-cancel">Cancel</button>
        <button class="cgpa-modal-save">Save Scale</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Event listeners
  modal.querySelector('.cgpa-modal-close').addEventListener('click', () => modal.remove());
  modal.querySelector('.cgpa-modal-cancel').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });

  // Preset buttons
  modal.querySelectorAll('.cgpa-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.preset;
      const presetScales = {
        njit: { 'A': 90, 'B+': 85, 'B': 80, 'C+': 75, 'C': 70, 'D': 60, 'F': 0 },
        standard: { 'A': 93, 'B+': 87, 'B': 83, 'C+': 77, 'C': 73, 'D': 65, 'F': 0 }
      };
      const values = presetScales[preset];
      if (values) {
        modal.querySelectorAll('.cgpa-scale-input').forEach(input => {
          const grade = input.dataset.grade;
          if (values[grade] !== undefined) {
            input.value = values[grade];
          }
        });
      }
    });
  });

  // Save button
  modal.querySelector('.cgpa-modal-save').addEventListener('click', async () => {
    const newScale = {};
    const inputs = modal.querySelectorAll('.cgpa-scale-input');

    // Collect values
    const values = [];
    inputs.forEach(input => {
      const grade = input.dataset.grade;
      const min = parseFloat(input.value);
      if (!isNaN(min)) {
        values.push({ grade, min });
      }
    });

    // Sort by min descending and calculate max values
    values.sort((a, b) => b.min - a.min);

    for (let i = 0; i < values.length; i++) {
      const { grade, min } = values[i];
      const max = i === 0 ? 100 : values[i - 1].min - 0.01;
      newScale[grade] = { min, max: Math.round(max * 100) / 100 };
    }

    if (Object.keys(newScale).length === 0) {
      alert('Please enter at least one grade value.');
      return;
    }

    // Validate the grading scale (check for overlaps, gaps, and valid ranges)
    const errors = GradingScales.validateScale(newScale);
    if (errors.length > 0) {
      alert('Invalid grading scale:\n\n' + errors.join('\n'));
      return;
    }

    // Save to storage
    const { customGradingScales = {} } = await getStoredData(['customGradingScales']);
    customGradingScales[ContentState.courseId] = {
      scale: newScale,
      lastUpdated: new Date().toISOString()
    };
    await saveToStorage({ customGradingScales });

    // Close modal and refresh
    modal.remove();
    await loadAndDisplayCourseData(true);
  });
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

  // Create modified assignment groups (using structuredClone for better performance)
  const modifiedGroups = structuredClone(ContentState.courseData.assignmentGroups);

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

  // Calculate new grade (respecting current exclusions)
  const newResult = calculateGradeFromData(
    { ...ContentState.courseData, assignmentGroups: modifiedGroups },
    ContentState.excludedAssignments
  );
  const newGradeInfo = convertGradeWithScale(newResult.percentage, ContentState.gradingScale, ContentState.gradePoints);

  // Get current grade for comparison
  const currentResult = calculateGradeFromData(ContentState.courseData, ContentState.excludedAssignments);
  const currentPct = currentResult.percentage || 0;
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

  // Get current grade (respecting exclusions)
  const currentResult = calculateGradeFromData(ContentState.courseData, ContentState.excludedAssignments);
  const currentPct = currentResult.percentage || 0;

  if (currentPct >= targetMin) {
    resultDiv.innerHTML = `<p class="cgpa-success-text">You already have ${targetLetter}!</p>`;
    return;
  }

  // Find ungraded assignments (excluding excluded ones)
  const excludedSet = new Set(ContentState.excludedAssignments.map(id => id.toString()));
  const ungraded = [];
  for (const group of ContentState.courseData.assignmentGroups) {
    for (const assignment of group.assignments || []) {
      // Skip excluded assignments
      if (excludedSet.has(assignment.id.toString())) {
        continue;
      }
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

// Listen for messages from background extension (NOT from page scripts)
// SECURITY: Verify message comes from extension, not from page context
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // SECURITY: Only accept messages from the extension itself
  if (sender.id !== chrome.runtime.id) {
    console.warn('[Canvas GPA] Rejecting message from untrusted sender');
    sendResponse({ error: 'Untrusted sender' });
    return;
  }

  // SECURITY: Only accept whitelisted message types
  if (message.type === 'REFRESH_DATA') {
    loadAndDisplayCourseData(true);
    sendResponse({ success: true });
  } else {
    sendResponse({ error: 'Unknown message type' });
  }
});
