/**
 * Dashboard Component
 * Creates a comprehensive GPA dashboard for injection into Canvas pages
 */

const Dashboard = {
  container: null,
  data: null,

  /**
   * Initialize and render the dashboard
   * @param {HTMLElement} parentElement - Element to inject dashboard into
   * @param {object} data - Dashboard data
   */
  init(parentElement, data) {
    this.data = data;
    this.container = this.createContainer();
    this.render();

    if (parentElement) {
      parentElement.appendChild(this.container);
    }

    return this.container;
  },

  /**
   * Create the dashboard container
   */
  createContainer() {
    const container = document.createElement('div');
    container.id = 'cgpa-full-dashboard';
    container.className = 'cgpa-dashboard';
    return container;
  },

  /**
   * Update dashboard with new data
   * @param {object} data - New dashboard data
   */
  update(data) {
    this.data = data;
    this.render();
  },

  /**
   * Render the dashboard content
   */
  render() {
    if (!this.data) return;

    const {
      semesterGPA,
      semesterCredits,
      cumulativeGPA,
      totalCredits,
      courses,
      academicStanding,
      targetGPA
    } = this.data;

    // Determine standing class
    let standingClass = 'good';
    let standingIcon = '✓';
    let standingText = 'Good Standing';

    if (academicStanding?.isDeansList) {
      standingClass = 'deans-list';
      standingIcon = '✅';
      standingText = "Dean's List";
    } else if (academicStanding?.isProbation) {
      standingClass = 'probation';
      standingIcon = '⚠️';
      standingText = 'Academic Probation';
    }

    this.container.innerHTML = `
      <div class="cgpa-dashboard-header">
        <h2 class="cgpa-dashboard-title">GPA Dashboard</h2>
        <button class="cgpa-dashboard-refresh" title="Refresh">↻</button>
      </div>

      <div class="cgpa-gpa-cards">
        <div class="cgpa-gpa-card semester">
          <span class="cgpa-gpa-card-label">Semester GPA</span>
          <span class="cgpa-gpa-card-value">${this.formatGPA(semesterGPA)}</span>
          <span class="cgpa-gpa-card-credits">${semesterCredits || 0} credits</span>
        </div>
        <div class="cgpa-gpa-card cumulative">
          <span class="cgpa-gpa-card-label">Cumulative GPA</span>
          <span class="cgpa-gpa-card-value">${this.formatGPA(cumulativeGPA)}</span>
          <span class="cgpa-gpa-card-credits">${totalCredits || 0} total credits</span>
        </div>
      </div>

      <div class="cgpa-standing-card ${standingClass}">
        <span class="cgpa-standing-icon">${standingIcon}</span>
        <span class="cgpa-standing-text">${standingText}</span>
      </div>

      ${targetGPA ? this.renderTargetSection(targetGPA, cumulativeGPA, semesterCredits) : ''}

      <div class="cgpa-course-list">
        <h3 class="cgpa-course-list-header">Course Breakdown</h3>
        ${this.renderCourseList(courses)}
      </div>

      <div class="cgpa-disclaimer">
        Not affiliated with Canvas or Instructure. For educational purposes only.
        Always verify grades with official transcripts.
      </div>
    `;

    // Add event listeners
    this.container.querySelector('.cgpa-dashboard-refresh')?.addEventListener('click', () => {
      this.onRefresh?.();
    });
  },

  /**
   * Render target GPA section
   */
  renderTargetSection(targetGPA, currentGPA, semesterCredits) {
    if (!targetGPA) return '';

    const requiredGPA = this.calculateRequiredGPA(targetGPA, currentGPA, semesterCredits);

    return `
      <div class="cgpa-target-section">
        <h3>Target GPA: ${targetGPA.toFixed(2)}</h3>
        <p class="cgpa-target-info">
          ${requiredGPA <= 4.0
            ? `Need <strong>${requiredGPA.toFixed(2)}</strong> this semester to reach goal`
            : `Target requires more than 4.0 GPA - not achievable this semester`
          }
        </p>
      </div>
    `;
  },

  /**
   * Render course list
   */
  renderCourseList(courses) {
    if (!courses || courses.length === 0) {
      return '<p class="cgpa-no-courses">No courses found</p>';
    }

    return courses.map(course => {
      const letterClass = course.letterGrade
        ? course.letterGrade.charAt(0).toLowerCase()
        : '';

      const scaleWarning = course.gradingScale?.source === 'default_fallback'
        ? '<span class="cgpa-scale-warning" title="Using default scale">⚠️</span>'
        : '';

      return `
        <div class="cgpa-course-item">
          <div class="cgpa-course-info">
            <span class="cgpa-course-name">${course.name}</span>
            <span class="cgpa-course-credits">${course.credits || 0} cr</span>
          </div>
          <div class="cgpa-course-grade">
            <span class="cgpa-course-percentage">
              ${course.currentGrade !== null ? course.currentGrade.toFixed(1) + '%' : 'N/A'}
            </span>
            ${course.letterGrade
              ? `<span class="cgpa-course-letter ${letterClass}">${course.letterGrade}</span>`
              : ''
            }
            <span class="cgpa-course-points">
              ${course.gradePoints !== null ? course.gradePoints.toFixed(1) : '--'}
            </span>
            ${scaleWarning}
          </div>
        </div>
      `;
    }).join('');
  },

  /**
   * Format GPA for display
   */
  formatGPA(gpa) {
    if (gpa === null || gpa === undefined) {
      return '--';
    }
    return gpa.toFixed(2);
  },

  /**
   * Calculate required GPA for target
   */
  calculateRequiredGPA(targetGPA, currentGPA, semesterCredits) {
    if (!currentGPA || !semesterCredits) {
      return targetGPA;
    }

    // Simplified calculation - assumes this is first semester
    // For cumulative, would need more data
    return targetGPA;
  },

  /**
   * Set refresh callback
   * @param {function} callback - Refresh callback
   */
  setOnRefresh(callback) {
    this.onRefresh = callback;
  },

  /**
   * Destroy the dashboard
   */
  destroy() {
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
    this.data = null;
  }
};

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Dashboard;
}
