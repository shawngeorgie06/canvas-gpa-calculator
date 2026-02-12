/**
 * Canvas Grade & GPA Calculator - Background Service Worker
 * Handles background tasks, alarms, and messaging
 */

console.log('[Canvas GPA] Background service worker loading...');

// Load required utility scripts
importScripts('utils/constants.js');
importScripts('utils/grading-scales.js');
importScripts('utils/storage.js');

console.log('[Canvas GPA] Utilities loaded');

// Check and setup alarm when service worker starts
setupRefreshAlarm();

// Initialize extension on install
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[Canvas GPA] Extension installed/updated:', details.reason);

  try {
    // Initialize storage with defaults (single source of truth from Storage.defaults)
    await Storage.initialize();
  } catch (error) {
    console.error('[Canvas GPA] Failed to initialize storage:', error);
  }

  // Set up periodic refresh alarm
  setupRefreshAlarm();
});

// Startup - ensure refresh alarm is active
chrome.runtime.onStartup?.addListener?.(() => {
  console.log('[Canvas GPA] Service worker started');
  setupRefreshAlarm();
});

// Helper function to setup/verify refresh alarm
function setupRefreshAlarm() {
  console.log('[Canvas GPA] Setting up refresh alarm...');
  try {
    // Clear any existing alarm first to avoid duplicates
    chrome.alarms.clear('refreshGrades', (wasCleared) => {
      console.log('[Canvas GPA] Cleared existing alarm. Was it active?', wasCleared);

      // Create new alarm
      chrome.alarms.create('refreshGrades', {
        periodInMinutes: 15
      });
      console.log('[Canvas GPA] ✓ Refresh alarm created - will run every 15 minutes');
      console.log('[Canvas GPA] Next refresh will occur in ~15 minutes');
    });
  } catch (error) {
    console.error('[Canvas GPA] ✗ Failed to setup refresh alarm:', error);
  }
}

// Handle alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'refreshGrades') {
    console.log('[Canvas GPA] Periodic grade refresh triggered at', new Date().toLocaleTimeString());
    const result = await refreshGradesInBackground();
    console.log('[Canvas GPA] Periodic refresh result:', result);
  }
});

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // SECURITY: Only accept messages from the extension itself
  if (sender.id !== chrome.runtime.id) {
    console.warn('[Canvas GPA] Rejecting message from untrusted sender:', sender.id);
    sendResponse({ error: 'Untrusted sender' });
    return;
  }

  handleMessage(message, sender)
    .then(response => sendResponse(response))
    .catch(error => sendResponse({ error: error.message }));

  // Return true to indicate async response
  return true;
});

/**
 * Handle incoming messages
 * SECURITY: Validates all message parameters before processing
 */
async function handleMessage(message, sender) {
  console.log('[Canvas GPA] Received message:', message.type);

  // SECURITY: Validate message structure
  if (!message || typeof message !== 'object' || !message.type) {
    console.error('[Canvas GPA] Invalid message format');
    return { error: 'Invalid message format' };
  }

  // SECURITY: Validate message type is a string
  if (typeof message.type !== 'string') {
    console.error('[Canvas GPA] Invalid message type');
    return { error: 'Invalid message type' };
  }

  // SECURITY: Whitelist of allowed message types
  const allowedTypes = [
    'GET_COURSES', 'GET_COURSE_GRADES', 'GET_GRADING_SCALE',
    'SET_CUSTOM_SCALE', 'CALCULATE_GPA', 'REFRESH_DATA',
    'VERIFY_TOKEN', 'GET_ASSIGNMENT_GROUPS', 'GET_ENROLLMENTS',
    'GET_COURSE_INFO', 'GET_GRADING_STANDARDS'
  ];

  if (!allowedTypes.includes(message.type)) {
    console.error('[Canvas GPA] Unknown message type:', message.type);
    return { error: 'Unknown message type' };
  }

  // SECURITY: Validate courseId if present
  if (message.courseId !== undefined) {
    if (!Number.isInteger(message.courseId) || message.courseId <= 0) {
      console.error('[Canvas GPA] Invalid courseId');
      return { error: 'Invalid course ID' };
    }
  }

  try {
    switch (message.type) {
      case 'GET_COURSES':
        return await getCourses();

      case 'GET_COURSE_GRADES':
        return await getCourseGrades(message.courseId);

      case 'GET_GRADING_SCALE':
        return await getGradingScale(message.courseId);

      case 'SET_CUSTOM_SCALE':
        // Validate scale object
        if (!message.scale || typeof message.scale !== 'object') {
          return { error: 'Invalid scale format' };
        }
        return await setCustomScale(message.courseId, message.scale);

      case 'CALCULATE_GPA':
        return await calculateGPA();

      case 'REFRESH_DATA':
        return await refreshGradesInBackground();

      case 'VERIFY_TOKEN':
        return await verifyToken();

      case 'GET_ASSIGNMENT_GROUPS':
        return await getAssignmentGroups(message.courseId);

      case 'GET_ENROLLMENTS':
        return await getEnrollments(message.courseId);

      case 'GET_COURSE_INFO':
        return await getCourseInfo(message.courseId);

      case 'GET_GRADING_STANDARDS':
        return await getGradingStandards(message.courseId);
    }
  } catch (error) {
    console.error('[Canvas GPA] Message handler error:', error.name);
    return { error: 'Internal server error' };
  }
}

/**
 * Refresh grades in background with auto-sync features
 */
async function refreshGradesInBackground() {
  try {
    console.log('[Canvas GPA] Starting background grade refresh...');

    // Get decrypted token from Storage utility
    const canvasApiToken = await Storage.getApiToken();
    const canvasBaseUrl = await Storage.getBaseUrl();
    const { settings, cache: oldCache } = await chrome.storage.local.get([
      'settings',
      'cache'
    ]);

    if (!canvasApiToken || !canvasBaseUrl) {
      console.warn('[Canvas GPA] Refresh failed - not configured');
      return { success: false, reason: 'Not configured' };
    }

    console.log('[Canvas GPA] Token and URL found, fetching courses...');

    // Fetch courses with term info
    const coursesResponse = await fetch(
      `${canvasBaseUrl}/api/v1/courses?enrollment_state=active&include[]=total_scores&include[]=term&per_page=50`,
      {
        headers: {
          'Authorization': `Bearer ${canvasApiToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!coursesResponse.ok) {
      throw new Error(`API error: ${coursesResponse.status}`);
    }

    const courses = await coursesResponse.json();

    // Auto-sync: Detect semesters and upcoming ones
    const semesterInfo = await autoDetectSemesters(courses);

    // Auto-sync: Auto-exclude upcoming semesters
    await autoExcludeUpcomingSemesters(semesterInfo.upcomingSemesters);

    // Auto-sync: Check for grade changes
    const gradeChanges = detectGradeChanges(oldCache?.courses, courses);

    // Update cache - CLEAR grade cache to force fresh fetch
    await chrome.storage.local.set({
      cache: {
        courses,
        coursesTimestamp: Date.now(),
        grades: {},  // Clear old grade cache to force refresh
        gradesTimestamp: {}  // Clear timestamps
      },
      lastSyncTime: Date.now(),
      detectedSemesters: semesterInfo.semesters,
      upcomingSemesters: semesterInfo.upcomingSemesters
    });

    // Notify if grades changed
    if (gradeChanges.length > 0 && settings?.enableNotifications) {
      await notifyGradeChanges(gradeChanges);
    }

    // Notify content scripts and popup
    chrome.runtime.sendMessage({
      type: 'DATA_REFRESHED',
      gradeChanges: gradeChanges,
      upcomingSemesters: semesterInfo.upcomingSemesters
    }).catch(() => {});

    // Notify any open Canvas tabs
    const tabs = await chrome.tabs.query({ url: '*://*.instructure.com/*' });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: 'REFRESH_DATA' }).catch(() => {});
    }

    // SECURITY: Only log generic completion message, not sensitive data
    if (gradeChanges.length > 0) {
      console.log('[Canvas GPA] Auto-sync completed - grade changes detected');
    } else {
      console.log('[Canvas GPA] Auto-sync completed');
    }

    return {
      success: true,
      courseCount: courses.length,
      semesters: semesterInfo.semesters,
      upcomingSemesters: semesterInfo.upcomingSemesters,
      gradeChanges: gradeChanges.length
    };
  } catch (error) {
    console.error('[Canvas GPA] Background refresh error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Auto-detect semesters from courses and identify upcoming ones
 */
async function autoDetectSemesters(courses) {
  const semesterSet = new Map();
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12

  console.log('[Canvas GPA] Detecting semesters. Current date:', now.toDateString(), `(Year: ${currentYear}, Month: ${currentMonth})`);

  for (const course of courses) {
    const termName = course.term?.name || 'Unknown Term';

    // Only process real semesters (Fall/Spring/Summer/Winter + Year)
    if (!isRealSemester(termName)) continue;

    if (!semesterSet.has(termName)) {
      const isUpcoming = isFutureSemester(termName, currentYear, currentMonth);
      console.log(`[Canvas GPA] Semester "${termName}": isUpcoming = ${isUpcoming}`);
      semesterSet.set(termName, {
        name: termName,
        isUpcoming: isUpcoming,
        sortKey: getSemesterSortKey(termName)
      });
    }
  }

  // Sort by most recent first
  const allSemesters = Array.from(semesterSet.values())
    .sort((a, b) => b.sortKey - a.sortKey);

  const detected = allSemesters.map(s => s.name);
  const upcoming = allSemesters.filter(s => s.isUpcoming).map(s => s.name);

  console.log('[Canvas GPA] Detected semesters:', detected);
  console.log('[Canvas GPA] Upcoming semesters:', upcoming);

  return {
    semesters: detected,
    upcomingSemesters: upcoming
  };
}

/**
 * Check if a term is a real semester (Fall/Spring/Summer/Winter + Year)
 */
function isRealSemester(name) {
  if (!name) return false;
  return /^(Fall|Spring|Summer|Winter)\s+\d{4}/i.test(name);
}

/**
 * Check if a semester is upcoming (not yet started)
 */
function isFutureSemester(termName, currentYear, currentMonth) {
  const match = termName.match(/(Spring|Summer|Fall|Winter)\s*'?(\d{2,4})/i);
  if (!match) return false;

  let year = parseInt(match[2]);
  if (year < 100) year += 2000;

  const season = match[1].toLowerCase();

  // Semester START months
  const seasonStartMonth = {
    winter: 1,   // Winter starts ~January
    spring: 1,   // Spring starts ~January
    summer: 5,   // Summer starts ~May
    fall: 8      // Fall starts ~August
  };

  const semesterStartMonth = seasonStartMonth[season] ?? 1;

  console.log(`[Canvas GPA] Checking if "${termName}" is upcoming: season=${season}, year=${year}, startMonth=${semesterStartMonth}, currentYear=${currentYear}, currentMonth=${currentMonth}`);

  // Future year = upcoming
  if (year > currentYear) {
    console.log(`[Canvas GPA]   -> Year ${year} > ${currentYear} = UPCOMING`);
    return true;
  }

  // Same year but semester hasn't started yet = upcoming
  if (year === currentYear && semesterStartMonth > currentMonth) {
    console.log(`[Canvas GPA]   -> Start month ${semesterStartMonth} > current month ${currentMonth} = UPCOMING`);
    return true;
  }

  console.log(`[Canvas GPA]   -> NOT upcoming (current/past semester)`);
  return false;
}

/**
 * Get sort key for semester ordering
 */
function getSemesterSortKey(termName) {
  const match = termName.match(/(Spring|Summer|Fall|Winter)\s*(\d{2,4})/i);
  if (match) {
    let year = parseInt(match[2]);
    if (year < 100) year += 2000;

    const seasonOrder = { winter: 0, spring: 1, summer: 2, fall: 3 };
    const seasonValue = seasonOrder[match[1].toLowerCase()] || 0;

    return year * 10 + seasonValue;
  }
  return 0;
}

/**
 * Auto-exclude upcoming semesters from cumulative GPA
 */
async function autoExcludeUpcomingSemesters(upcomingSemesters) {
  if (!upcomingSemesters || upcomingSemesters.length === 0) return;

  const { excludedSemesters = [] } = await chrome.storage.local.get('excludedSemesters');

  // Merge with existing exclusions (don't remove user's manual exclusions)
  const allExcluded = [...new Set([...excludedSemesters, ...upcomingSemesters])];

  await chrome.storage.local.set({ excludedSemesters: allExcluded });

  console.log('[Canvas GPA] Auto-excluded upcoming semesters:', upcomingSemesters);
}

/**
 * Detect grade changes between old and new course data
 */
function detectGradeChanges(oldCourses, newCourses) {
  const changes = [];

  if (!oldCourses || !Array.isArray(oldCourses)) return changes;

  for (const newCourse of newCourses) {
    const oldCourse = oldCourses.find(c => c.id === newCourse.id);
    if (!oldCourse) continue;

    // Check for grade changes in enrollments
    const oldGrade = oldCourse.enrollments?.[0]?.computed_current_score;
    const newGrade = newCourse.enrollments?.[0]?.computed_current_score;

    if (oldGrade !== newGrade && newGrade != null) {
      changes.push({
        courseId: newCourse.id,
        courseName: newCourse.name,
        oldGrade: oldGrade,
        newGrade: newGrade,
        change: newGrade - (oldGrade || 0)
      });
    }
  }

  return changes;
}

/**
 * Send notification for grade changes
 */
async function notifyGradeChanges(changes) {
  if (changes.length === 0) return;

  // Create notification
  const message = changes.length === 1
    ? `${changes[0].courseName}: ${changes[0].oldGrade?.toFixed(1) || 'N/A'}% → ${changes[0].newGrade?.toFixed(1)}%`
    : `${changes.length} courses have grade updates`;

  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon.svg'),
      title: 'Canvas GPA - Grade Update',
      message: message
    });
  } catch (error) {
    console.log('[Canvas GPA] Could not create notification:', error);
  }
}

/**
 * Get courses from Canvas
 */
async function getCourses() {
  const canvasApiToken = await Storage.getApiToken();
  const canvasBaseUrl = await Storage.getBaseUrl();
  const { cache } = await chrome.storage.local.get(['cache']);

  if (!canvasApiToken || !canvasBaseUrl) {
    throw new Error('Extension not configured');
  }

  // Check cache first (1 hour)
  if (cache?.courses && cache?.coursesTimestamp) {
    const age = Date.now() - cache.coursesTimestamp;
    if (age < 60 * 60 * 1000) {
      return { courses: cache.courses, fromCache: true };
    }
  }

  // Fetch from API
  const response = await fetch(
    `${canvasBaseUrl}/api/v1/courses?enrollment_state=active&include[]=total_scores&include[]=term&per_page=50`,
    {
      headers: {
        'Authorization': `Bearer ${canvasApiToken}`,
        'Content-Type': 'application/json'
      }
    }
  );

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const courses = await response.json();

  // Update cache
  await chrome.storage.local.set({
    cache: {
      ...cache,
      courses,
      coursesTimestamp: Date.now()
    }
  });

  return { courses, fromCache: false };
}

/**
 * Get grades for a specific course
 */
async function getCourseGrades(courseId) {
  const canvasApiToken = await Storage.getApiToken();
  const canvasBaseUrl = await Storage.getBaseUrl();
  const { cache } = await chrome.storage.local.get(['cache']);

  if (!canvasApiToken || !canvasBaseUrl) {
    throw new Error('Extension not configured');
  }

  // Check cache (15 minutes)
  if (cache?.grades?.[courseId] && cache?.gradesTimestamp?.[courseId]) {
    const age = Date.now() - cache.gradesTimestamp[courseId];
    if (age < 15 * 60 * 1000) {
      return { grades: cache.grades[courseId], fromCache: true };
    }
  }

  // Fetch enrollment for grades
  const enrollmentResponse = await fetch(
    `${canvasBaseUrl}/api/v1/courses/${courseId}/enrollments?user_id=self`,
    {
      headers: {
        'Authorization': `Bearer ${canvasApiToken}`,
        'Content-Type': 'application/json'
      }
    }
  );

  if (!enrollmentResponse.ok) {
    throw new Error(`API error: ${enrollmentResponse.status}`);
  }

  const enrollments = await enrollmentResponse.json();
  const enrollment = enrollments[0];
  const grades = enrollment?.grades || {};

  // Update cache
  const updatedCache = {
    ...cache,
    grades: {
      ...cache?.grades,
      [courseId]: grades
    },
    gradesTimestamp: {
      ...cache?.gradesTimestamp,
      [courseId]: Date.now()
    }
  };
  await chrome.storage.local.set({ cache: updatedCache });

  return { grades, fromCache: false };
}

/**
 * Get grading scale for a course
 */
async function getGradingScale(courseId) {
  const canvasApiToken = await Storage.getApiToken();
  const canvasBaseUrl = await Storage.getBaseUrl();
  const { customGradingScales } = await chrome.storage.local.get(['customGradingScales']);

  // Check for custom scale first
  if (customGradingScales?.[courseId]) {
    return {
      scale: customGradingScales[courseId].scale,
      source: 'manual_override',
      confidence: 100
    };
  }

  if (!canvasApiToken || !canvasBaseUrl) {
    return getDefaultGradingScale();
  }

  // Try Canvas API
  try {
    const response = await fetch(
      `${canvasBaseUrl}/api/v1/courses/${courseId}/grading_standards`,
      {
        headers: {
          'Authorization': `Bearer ${canvasApiToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.ok) {
      const standards = await response.json();
      if (standards.length > 0 && standards[0].grading_scheme) {
        return {
          scale: GradingScales.convertCanvasScheme(standards[0].grading_scheme),
          source: 'canvas_api',
          confidence: 95,
          title: standards[0].title
        };
      }
    }
  } catch (error) {
    console.warn('[Canvas GPA] Could not fetch grading standard:', error);
  }

  return {
    scale: GradingScales.getDefault(),
    source: 'default_fallback',
    confidence: 50,
    warning: 'Using default scale. Please verify with syllabus.'
  };
}

/**
 * Set custom grading scale
 */
async function setCustomScale(courseId, scale) {
  const { customGradingScales } = await chrome.storage.local.get('customGradingScales');

  const updatedScales = {
    ...customGradingScales,
    [courseId]: {
      scale,
      lastUpdated: new Date().toISOString()
    }
  };

  await chrome.storage.local.set({ customGradingScales: updatedScales });
  return { success: true };
}

/**
 * Parse the Link header to get next page URL (for pagination support)
 */
function parseNextLink(linkHeader) {
  if (!linkHeader) return null;

  const links = linkHeader.split(',');
  for (const link of links) {
    const match = link.match(/<([^>]+)>;\s*rel="next"/);
    if (match) {
      // Extract just the path portion
      const url = new URL(match[1]);
      return url.pathname + url.search;
    }
  }
  return null;
}

/**
 * Get assignment groups for a course (with caching and pagination)
 */
async function getAssignmentGroups(courseId) {
  const canvasApiToken = await Storage.getApiToken();
  const canvasBaseUrl = await Storage.getBaseUrl();
  const { cache } = await chrome.storage.local.get(['cache']);

  if (!canvasApiToken || !canvasBaseUrl) {
    throw new Error('Extension not configured');
  }

  // Check cache (30 minutes for assignment groups - less frequently updated)
  const cacheKey = `assignmentGroups_${courseId}`;
  if (cache?.[cacheKey] && cache?.gradesTimestamp?.[cacheKey]) {
    const age = Date.now() - cache.gradesTimestamp[cacheKey];
    if (age < 30 * 60 * 1000) {
      return { groups: cache[cacheKey], fromCache: true };
    }
  }

  // Fetch from API with pagination support
  // Canvas API uses Link header for pagination when there are more results
  const allGroups = [];
  let url = `/api/v1/courses/${courseId}/assignment_groups?include[]=assignments&include[]=submission&per_page=100`;

  while (url) {
    const response = await fetch(
      `${canvasBaseUrl}${url}`,
      {
        headers: {
          'Authorization': `Bearer ${canvasApiToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    allGroups.push(...(Array.isArray(data) ? data : [data]));

    // Check for next page in Link header
    const linkHeader = response.headers.get('Link');
    url = linkHeader ? parseNextLink(linkHeader) : null;
  }

  const groups = allGroups;

  // Update cache
  await chrome.storage.local.set({
    cache: {
      ...cache,
      [cacheKey]: groups,
      gradesTimestamp: {
        ...cache?.gradesTimestamp,
        [cacheKey]: Date.now()
      }
    }
  });

  return { groups, fromCache: false };
}

/**
 * Get enrollments (grades) for a course
 */
async function getEnrollments(courseId) {
  const canvasApiToken = await Storage.getApiToken();
  const canvasBaseUrl = await Storage.getBaseUrl();

  if (!canvasApiToken || !canvasBaseUrl) {
    throw new Error('Extension not configured');
  }

  const response = await fetch(
    `${canvasBaseUrl}/api/v1/courses/${courseId}/enrollments?user_id=self&include[]=grades`,
    {
      headers: {
        'Authorization': `Bearer ${canvasApiToken}`,
        'Content-Type': 'application/json'
      }
    }
  );

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  let enrollmentData = await response.json();

  // Filter to only student enrollments (exclude auditors, teachers, etc.)
  if (Array.isArray(enrollmentData)) {
    const studentEnrollment = enrollmentData.find(e => e.type === 'StudentEnrollment');
    if (studentEnrollment) {
      enrollmentData = [studentEnrollment];
      // SECURITY: Don't log actual grade scores, only confirm enrollment was found
      console.log(`[BG] Course ${courseId}: enrollment data retrieved`);
    }
  }

  return enrollmentData;
}

/**
 * Get course info
 */
async function getCourseInfo(courseId) {
  const canvasApiToken = await Storage.getApiToken();
  const canvasBaseUrl = await Storage.getBaseUrl();

  if (!canvasApiToken || !canvasBaseUrl) {
    throw new Error('Extension not configured');
  }

  const response = await fetch(
    `${canvasBaseUrl}/api/v1/courses/${courseId}`,
    {
      headers: {
        'Authorization': `Bearer ${canvasApiToken}`,
        'Content-Type': 'application/json'
      }
    }
  );

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return await response.json();
}

/**
 * Get grading standards for a course (uses existing getGradingScale logic)
 * Note: This is a wrapper around getGradingScale that returns standards data
 */
async function getGradingStandards(courseId) {
  return await getGradingScale(courseId);
}

/**
 * Calculate GPA from stored courses
 */
async function calculateGPA() {
  const { currentSemester, previousGPA, previousCredits } = await chrome.storage.local.get([
    'currentSemester',
    'previousGPA',
    'previousCredits'
  ]);

  const courses = currentSemester?.courses || [];

  // Calculate semester GPA
  let totalQualityPoints = 0;
  let totalCredits = 0;

  for (const course of courses) {
    if (course.gradePoints !== null && course.credits) {
      totalQualityPoints += course.gradePoints * course.credits;
      totalCredits += course.credits;
    }
  }

  const semesterGPA = totalCredits > 0 ? totalQualityPoints / totalCredits : null;

  // Calculate cumulative GPA
  let cumulativeGPA = semesterGPA;

  if (previousGPA !== null && previousCredits > 0) {
    const prevQualityPoints = previousGPA * previousCredits;
    const totalQP = prevQualityPoints + totalQualityPoints;
    const totalCr = previousCredits + totalCredits;
    cumulativeGPA = totalCr > 0 ? totalQP / totalCr : null;
  }

  return {
    semesterGPA: semesterGPA !== null ? Math.round(semesterGPA * 1000) / 1000 : null,
    semesterCredits: totalCredits,
    cumulativeGPA: cumulativeGPA !== null ? Math.round(cumulativeGPA * 1000) / 1000 : null,
    totalCredits: (previousCredits || 0) + totalCredits
  };
}

/**
 * Verify API token
 */
async function verifyToken() {
  const canvasApiToken = await Storage.getApiToken();
  const canvasBaseUrl = await Storage.getBaseUrl();

  if (!canvasApiToken || !canvasBaseUrl) {
    return { valid: false, reason: 'Not configured' };
  }

  try {
    const response = await fetch(`${canvasBaseUrl}/api/v1/users/self`, {
      headers: {
        'Authorization': `Bearer ${canvasApiToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      const user = await response.json();
      return { valid: true, user: user.name };
    } else {
      return { valid: false, reason: `HTTP ${response.status}` };
    }
  } catch (error) {
    return { valid: false, reason: error.message };
  }
}

// NOTE: convertCanvasScheme and getDefaultGradingScale moved to utils/grading-scales.js
// Use GradingScales.convertCanvasScheme() and GradingScales.getDefault() instead

// Log when service worker starts
console.log('[Canvas GPA] Background service worker started');
