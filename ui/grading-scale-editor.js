/**
 * Grading Scale Editor Component
 * Provides a modal interface for editing course grading scales
 */

const GradingScaleEditor = {
  modal: null,
  courseId: null,
  currentScale: null,
  onSave: null,

  /**
   * Open the grading scale editor modal
   * @param {string} courseId - Course ID
   * @param {object} currentScale - Current grading scale
   * @param {function} onSave - Callback when scale is saved
   */
  open(courseId, currentScale, onSave) {
    this.courseId = courseId;
    this.currentScale = currentScale || this.getDefaultScale();
    this.onSave = onSave;

    this.createModal();
    this.render();
    document.body.appendChild(this.modal);
  },

  /**
   * Close the editor modal
   */
  close() {
    if (this.modal) {
      this.modal.remove();
      this.modal = null;
    }
  },

  /**
   * Create the modal element
   */
  createModal() {
    this.modal = document.createElement('div');
    this.modal.className = 'cgpa-scale-editor-overlay';
    this.modal.innerHTML = `
      <div class="cgpa-scale-editor-modal">
        <div class="cgpa-scale-editor-header">
          <h3>Edit Grading Scale</h3>
          <button class="cgpa-scale-editor-close">&times;</button>
        </div>
        <div class="cgpa-scale-editor-content">
          <p class="cgpa-scale-editor-help">
            Set the minimum percentage required for each letter grade.
            Maximum is automatically calculated based on the next higher grade.
          </p>
          <div class="cgpa-scale-editor-presets">
            <span>Presets:</span>
            <button class="cgpa-preset-btn" data-preset="standard">Standard (A=90)</button>
            <button class="cgpa-preset-btn" data-preset="plus-minus">Plus/Minus (A=93)</button>
            <button class="cgpa-preset-btn" data-preset="seven-point">7-Point (A=93)</button>
          </div>
          <div class="cgpa-scale-editor-table">
            <table>
              <thead>
                <tr>
                  <th>Grade</th>
                  <th>Min %</th>
                  <th>Max %</th>
                  <th>GPA</th>
                </tr>
              </thead>
              <tbody id="cgpa-scale-rows"></tbody>
            </table>
          </div>
          <div class="cgpa-scale-editor-notes">
            <label for="cgpa-scale-notes">Notes (optional):</label>
            <textarea id="cgpa-scale-notes" placeholder="e.g., Professor confirmed A is 93%+"></textarea>
          </div>
        </div>
        <div class="cgpa-scale-editor-footer">
          <button class="cgpa-btn cgpa-btn-secondary cgpa-scale-cancel">Cancel</button>
          <button class="cgpa-btn cgpa-btn-primary cgpa-scale-save">Save Scale</button>
        </div>
      </div>
    `;

    // Add styles
    this.addStyles();

    // Add event listeners
    this.modal.querySelector('.cgpa-scale-editor-close').addEventListener('click', () => this.close());
    this.modal.querySelector('.cgpa-scale-cancel').addEventListener('click', () => this.close());
    this.modal.querySelector('.cgpa-scale-save').addEventListener('click', () => this.save());

    // Preset buttons
    this.modal.querySelectorAll('.cgpa-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => this.applyPreset(btn.dataset.preset));
    });

    // Close on overlay click
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) {
        this.close();
      }
    });
  },

  /**
   * Render the scale table
   */
  render() {
    const tbody = this.modal.querySelector('#cgpa-scale-rows');
    const gradeOrder = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F'];
    const gpaPoints = {
      'A+': 4.0, 'A': 4.0, 'A-': 3.7,
      'B+': 3.3, 'B': 3.0, 'B-': 2.7,
      'C+': 2.3, 'C': 2.0, 'C-': 1.7,
      'D+': 1.3, 'D': 1.0, 'D-': 0.7,
      'F': 0.0
    };

    let html = '';
    const scale = this.currentScale.scale || this.currentScale;

    for (const grade of gradeOrder) {
      const range = scale[grade];
      if (!range) continue;

      html += `
        <tr data-grade="${grade}">
          <td class="cgpa-grade-cell">${grade}</td>
          <td>
            <input type="number" class="cgpa-min-input" value="${range.min}"
                   min="0" max="100" step="0.1" data-grade="${grade}">
          </td>
          <td class="cgpa-max-cell">${range.max}</td>
          <td class="cgpa-gpa-cell">${gpaPoints[grade]?.toFixed(1) || '0.0'}</td>
        </tr>
      `;
    }

    tbody.innerHTML = html;

    // Add input listeners
    this.modal.querySelectorAll('.cgpa-min-input').forEach(input => {
      input.addEventListener('change', () => this.updateMaxValues());
    });
  },

  /**
   * Update max values based on min values
   */
  updateMaxValues() {
    const rows = this.modal.querySelectorAll('#cgpa-scale-rows tr');
    const inputs = Array.from(rows).map(row => ({
      grade: row.dataset.grade,
      input: row.querySelector('.cgpa-min-input'),
      maxCell: row.querySelector('.cgpa-max-cell')
    }));

    // Sort by min value descending
    inputs.sort((a, b) => parseFloat(b.input.value) - parseFloat(a.input.value));

    // Update max values
    for (let i = 0; i < inputs.length; i++) {
      const current = inputs[i];
      const prev = inputs[i - 1];

      if (i === 0) {
        current.maxCell.textContent = '100';
      } else if (prev) {
        const maxVal = parseFloat(prev.input.value) - 0.01;
        current.maxCell.textContent = maxVal.toFixed(2);
      }
    }
  },

  /**
   * Apply a preset scale
   */
  applyPreset(preset) {
    const presets = {
      'standard': {
        'A': { min: 90, max: 100 },
        'B': { min: 80, max: 89.99 },
        'C': { min: 70, max: 79.99 },
        'D': { min: 60, max: 69.99 },
        'F': { min: 0, max: 59.99 }
      },
      'plus-minus': {
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
      },
      'seven-point': {
        'A': { min: 93, max: 100 },
        'A-': { min: 90, max: 92.99 },
        'B+': { min: 87, max: 89.99 },
        'B': { min: 83, max: 86.99 },
        'B-': { min: 80, max: 82.99 },
        'C+': { min: 77, max: 79.99 },
        'C': { min: 70, max: 76.99 },
        'D': { min: 60, max: 69.99 },
        'F': { min: 0, max: 59.99 }
      }
    };

    this.currentScale = presets[preset] || presets['plus-minus'];
    this.render();
  },

  /**
   * Save the scale
   */
  async save() {
    const scale = {};
    const inputs = this.modal.querySelectorAll('.cgpa-min-input');

    inputs.forEach(input => {
      const grade = input.dataset.grade;
      const min = parseFloat(input.value);
      const maxCell = input.closest('tr').querySelector('.cgpa-max-cell');
      const max = parseFloat(maxCell.textContent);

      if (!isNaN(min) && !isNaN(max)) {
        scale[grade] = { min, max };
      }
    });

    const notes = this.modal.querySelector('#cgpa-scale-notes').value;

    // Validate scale
    const validation = this.validateScale(scale);
    if (!validation.isValid) {
      alert('Invalid scale: ' + validation.errors.join(', '));
      return;
    }

    // Save to storage
    try {
      const { customGradingScales = {} } = await new Promise(resolve => {
        chrome.storage.local.get('customGradingScales', resolve);
      });

      customGradingScales[this.courseId] = {
        scale,
        userNotes: notes,
        lastUpdated: new Date().toISOString()
      };

      await new Promise(resolve => {
        chrome.storage.local.set({ customGradingScales }, resolve);
      });

      if (this.onSave) {
        this.onSave(scale, notes);
      }

      this.close();
    } catch (error) {
      console.error('Error saving scale:', error);
      alert('Failed to save scale. Please try again.');
    }
  },

  /**
   * Validate the scale
   */
  validateScale(scale) {
    const errors = [];
    const grades = Object.entries(scale).sort((a, b) => b[1].min - a[1].min);

    // Check for required grades
    if (!Object.keys(scale).some(g => g.startsWith('A'))) {
      errors.push('Must include at least one A grade');
    }
    if (!Object.keys(scale).includes('F')) {
      errors.push('Must include F grade');
    }

    // Check for valid ranges
    for (const [grade, range] of grades) {
      if (range.min < 0 || range.min > 100) {
        errors.push(`${grade}: min must be between 0 and 100`);
      }
      if (range.max < range.min) {
        errors.push(`${grade}: max cannot be less than min`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  },

  /**
   * Get default grading scale
   */
  getDefaultScale() {
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
  },

  /**
   * Add modal styles
   */
  addStyles() {
    if (document.getElementById('cgpa-scale-editor-styles')) return;

    const style = document.createElement('style');
    style.id = 'cgpa-scale-editor-styles';
    style.textContent = `
      .cgpa-scale-editor-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }

      .cgpa-scale-editor-modal {
        background: white;
        border-radius: 12px;
        width: 90%;
        max-width: 500px;
        max-height: 90vh;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      }

      .cgpa-scale-editor-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 20px;
        border-bottom: 1px solid #e5e7eb;
      }

      .cgpa-scale-editor-header h3 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
      }

      .cgpa-scale-editor-close {
        background: none;
        border: none;
        font-size: 24px;
        cursor: pointer;
        color: #6b7280;
        padding: 0;
        line-height: 1;
      }

      .cgpa-scale-editor-content {
        padding: 20px;
        overflow-y: auto;
        flex: 1;
      }

      .cgpa-scale-editor-help {
        font-size: 13px;
        color: #6b7280;
        margin: 0 0 16px;
      }

      .cgpa-scale-editor-presets {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
        margin-bottom: 16px;
      }

      .cgpa-scale-editor-presets span {
        font-size: 13px;
        color: #374151;
      }

      .cgpa-preset-btn {
        padding: 6px 12px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        background: white;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .cgpa-preset-btn:hover {
        background: #f3f4f6;
        border-color: #9ca3af;
      }

      .cgpa-scale-editor-table table {
        width: 100%;
        border-collapse: collapse;
        font-size: 14px;
      }

      .cgpa-scale-editor-table th,
      .cgpa-scale-editor-table td {
        padding: 8px 12px;
        text-align: left;
        border-bottom: 1px solid #e5e7eb;
      }

      .cgpa-scale-editor-table th {
        font-weight: 600;
        color: #374151;
        font-size: 12px;
        text-transform: uppercase;
      }

      .cgpa-grade-cell {
        font-weight: 600;
      }

      .cgpa-min-input {
        width: 70px;
        padding: 6px 8px;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        font-size: 14px;
      }

      .cgpa-min-input:focus {
        outline: none;
        border-color: #3b82f6;
        box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
      }

      .cgpa-max-cell,
      .cgpa-gpa-cell {
        color: #6b7280;
      }

      .cgpa-scale-editor-notes {
        margin-top: 16px;
      }

      .cgpa-scale-editor-notes label {
        display: block;
        font-size: 13px;
        font-weight: 500;
        margin-bottom: 4px;
      }

      .cgpa-scale-editor-notes textarea {
        width: 100%;
        padding: 8px 12px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-size: 14px;
        resize: vertical;
        min-height: 60px;
      }

      .cgpa-scale-editor-footer {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
        padding: 16px 20px;
        border-top: 1px solid #e5e7eb;
      }

      .cgpa-btn {
        padding: 8px 16px;
        border: none;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
      }

      .cgpa-btn-primary {
        background: #3b82f6;
        color: white;
      }

      .cgpa-btn-primary:hover {
        background: #2563eb;
      }

      .cgpa-btn-secondary {
        background: #e5e7eb;
        color: #374151;
      }

      .cgpa-btn-secondary:hover {
        background: #d1d5db;
      }
    `;
    document.head.appendChild(style);
  }
};

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GradingScaleEditor;
}
