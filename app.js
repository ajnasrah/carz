// Carz Inc Training Course Application
// Main application logic

// Check if user is logged in
const currentUser = localStorage.getItem('carzCurrentUser');
if (!currentUser) {
    window.location.href = 'login.html';
}

class TrainingApp {
    constructor() {
        this.currentUser = currentUser;
        this.currentModule = null;
        this.currentLesson = null;
        this.currentQuiz = null;
        this.progress = this.loadProgress();
        this.init();
    }

    init() {
        this.renderNavigation();
        this.showWelcome();
        this.updateProgressBar();
        this.addUserInfo();
    }

    addUserInfo() {
        // Add user info and logout to sidebar
        const logo = document.querySelector('.logo');
        if (logo && this.currentUser) {
            const userInfo = document.createElement('div');
            userInfo.className = 'user-info';
            userInfo.innerHTML = `
                <p style="color: #4ade80; margin-top: 10px; font-size: 0.9em;">Welcome, ${this.currentUser}</p>
                <button onclick="app.logout()" style="background: none; border: 1px solid #666; color: #888; padding: 5px 15px; border-radius: 5px; cursor: pointer; margin-top: 8px; font-size: 0.8em;">Logout</button>
            `;
            logo.appendChild(userInfo);
        }
    }

    logout() {
        localStorage.removeItem('carzCurrentUser');
        window.location.href = 'login.html';
    }

    loadProgress() {
        // Load from user-specific data
        const allUsers = JSON.parse(localStorage.getItem('carzAllUsers') || '{}');
        const userData = allUsers[this.currentUser];

        if (userData && userData.completedLessons) {
            return {
                completedLessons: userData.completedLessons || [],
                completedQuizzes: userData.completedQuizzes || [],
                quizScores: userData.quizScores || {}
            };
        }

        return {
            completedLessons: [],
            completedQuizzes: [],
            quizScores: {}
        };
    }

    saveProgress() {
        // Save to user-specific data
        const allUsers = JSON.parse(localStorage.getItem('carzAllUsers') || '{}');

        if (!allUsers[this.currentUser]) {
            allUsers[this.currentUser] = {
                name: this.currentUser,
                startedAt: new Date().toISOString(),
                lastActive: new Date().toISOString()
            };
        }

        const progressPercent = Math.round((this.getCompletedItems() / this.getTotalItems()) * 100);

        allUsers[this.currentUser].completedLessons = this.progress.completedLessons;
        allUsers[this.currentUser].completedQuizzes = this.progress.completedQuizzes;
        allUsers[this.currentUser].quizScores = this.progress.quizScores;
        allUsers[this.currentUser].progress = progressPercent;
        allUsers[this.currentUser].currentModule = this.currentModule ? this.currentModule.title : 'Module 1';
        allUsers[this.currentUser].lastActive = new Date().toISOString();

        localStorage.setItem('carzAllUsers', JSON.stringify(allUsers));
        this.updateProgressBar();
    }

    getTotalItems() {
        let total = 0;
        courseData.modules.forEach(module => {
            total += module.lessons.length;
            if (module.quiz) total += 1;
        });
        return total;
    }

    getCompletedItems() {
        return this.progress.completedLessons.length + this.progress.completedQuizzes.length;
    }

    updateProgressBar() {
        const total = this.getTotalItems();
        const completed = this.getCompletedItems();
        const percentage = Math.round((completed / total) * 100);

        document.getElementById('overall-progress').style.width = percentage + '%';
        document.getElementById('progress-text').textContent = percentage + '% Complete';
    }

    renderNavigation() {
        const navMenu = document.getElementById('nav-menu');
        navMenu.innerHTML = '';

        courseData.modules.forEach((module, moduleIndex) => {
            const moduleItem = document.createElement('li');
            moduleItem.className = 'nav-module';

            // Check if this module contains the current lesson or quiz
            const isCurrentModule = (this.currentModule && this.currentModule.id === module.id);
            if (isCurrentModule) {
                moduleItem.classList.add('expanded');
            }

            const moduleHeader = document.createElement('div');
            moduleHeader.className = 'module-header';
            moduleHeader.innerHTML = `
                <span class="module-number">Module ${moduleIndex + 1}</span>
                <span class="module-title">${module.title}</span>
                <span class="module-toggle">${isCurrentModule ? '−' : '+'}</span>
            `;
            moduleHeader.onclick = () => this.toggleModule(moduleItem);

            const lessonList = document.createElement('ul');
            lessonList.className = 'lesson-list';

            module.lessons.forEach(lesson => {
                const lessonItem = document.createElement('li');
                lessonItem.className = 'nav-lesson';
                lessonItem.setAttribute('data-lesson-id', lesson.id);
                if (this.progress.completedLessons.includes(lesson.id)) {
                    lessonItem.classList.add('completed');
                }
                // Add active class if this is the current lesson
                if (this.currentLesson && this.currentLesson.id === lesson.id) {
                    lessonItem.classList.add('active');
                }
                lessonItem.innerHTML = `
                    <span class="lesson-check">${this.progress.completedLessons.includes(lesson.id) ? '✓' : '○'}</span>
                    <span class="lesson-title">${lesson.title}</span>
                `;
                lessonItem.onclick = (e) => {
                    e.stopPropagation();
                    this.showLesson(module.id, lesson.id);
                };
                lessonList.appendChild(lessonItem);
            });

            // Add quiz item
            if (module.quiz) {
                const quizItem = document.createElement('li');
                quizItem.className = 'nav-quiz';
                quizItem.setAttribute('data-quiz-id', module.quiz.id);
                if (this.progress.completedQuizzes.includes(module.quiz.id)) {
                    quizItem.classList.add('completed');
                }
                // Add active class if this is the current quiz
                if (this.currentQuiz && this.currentQuiz.id === module.quiz.id) {
                    quizItem.classList.add('active');
                }
                const score = this.progress.quizScores[module.quiz.id];
                quizItem.innerHTML = `
                    <span class="quiz-icon">${this.progress.completedQuizzes.includes(module.quiz.id) ? '★' : '☆'}</span>
                    <span class="quiz-title">${module.quiz.title}</span>
                    ${score !== undefined ? `<span class="quiz-score">${score}%</span>` : ''}
                `;
                quizItem.onclick = (e) => {
                    e.stopPropagation();
                    this.showQuiz(module.id);
                };
                lessonList.appendChild(quizItem);
            }

            moduleItem.appendChild(moduleHeader);
            moduleItem.appendChild(lessonList);
            navMenu.appendChild(moduleItem);
        });
    }

    toggleModule(moduleItem) {
        moduleItem.classList.toggle('expanded');
        const toggle = moduleItem.querySelector('.module-toggle');
        toggle.textContent = moduleItem.classList.contains('expanded') ? '−' : '+';
    }

    showWelcome() {
        const contentArea = document.getElementById('content-area');
        contentArea.innerHTML = `
            <div class="welcome-screen">
                <h1>Welcome to Carz Inc Training Academy</h1>
                <p class="welcome-subtitle">Wholesale Car Buying - Complete Beginner Course</p>

                <div class="welcome-stats">
                    <div class="stat">
                        <span class="stat-number">${courseData.modules.length}</span>
                        <span class="stat-label">Modules</span>
                    </div>
                    <div class="stat">
                        <span class="stat-number">${courseData.modules.reduce((acc, m) => acc + m.lessons.length, 0)}</span>
                        <span class="stat-label">Lessons</span>
                    </div>
                    <div class="stat">
                        <span class="stat-number">${courseData.modules.filter(m => m.quiz).length}</span>
                        <span class="stat-label">Quizzes</span>
                    </div>
                </div>

                <div class="welcome-content">
                    <h2>What You'll Learn</h2>
                    <ul class="learning-objectives">
                        <li>How wholesale car buying works and why dealers use it</li>
                        <li>Navigating OVE and online auction platforms</li>
                        <li>Reading and understanding vehicle listings</li>
                        <li>Using MMR to evaluate deals</li>
                        <li>Understanding condition reports and grades</li>
                        <li>Calculating profit and maximum bid amounts</li>
                        <li>Bidding strategies and avoiding common mistakes</li>
                        <li>Post-purchase processes: payment, title, transport</li>
                    </ul>
                </div>

                <button class="start-button" onclick="app.startCourse()">
                    Start Training
                </button>

                ${this.getCompletedItems() > 0 ? `
                    <button class="continue-button" onclick="app.continueCourse()">
                        Continue Where You Left Off
                    </button>
                    <button class="reset-button" onclick="app.resetProgress()">
                        Reset Progress
                    </button>
                ` : ''}
            </div>
        `;
    }

    startCourse() {
        const firstModule = courseData.modules[0];
        const firstLesson = firstModule.lessons[0];
        this.showLesson(firstModule.id, firstLesson.id);
    }

    continueCourse() {
        // Find first incomplete lesson
        for (const module of courseData.modules) {
            for (const lesson of module.lessons) {
                if (!this.progress.completedLessons.includes(lesson.id)) {
                    this.showLesson(module.id, lesson.id);
                    return;
                }
            }
            if (module.quiz && !this.progress.completedQuizzes.includes(module.quiz.id)) {
                this.showQuiz(module.id);
                return;
            }
        }
        // All complete, show first lesson
        this.startCourse();
    }

    resetProgress() {
        if (confirm('Are you sure you want to reset all progress? This cannot be undone.')) {
            this.progress = {
                completedLessons: [],
                completedQuizzes: [],
                quizScores: {}
            };
            this.saveProgress();
            this.renderNavigation();
            this.showWelcome();
        }
    }

    showLesson(moduleId, lessonId) {
        const module = courseData.modules.find(m => m.id === moduleId);
        const lesson = module.lessons.find(l => l.id === lessonId);
        const lessonIndex = module.lessons.indexOf(lesson);

        this.currentModule = module;
        this.currentLesson = lesson;

        // Expand the module in nav and highlight current lesson
        const navModules = document.querySelectorAll('.nav-module');
        navModules.forEach((navModule, index) => {
            if (courseData.modules[index].id === moduleId) {
                navModule.classList.add('expanded');
                navModule.querySelector('.module-toggle').textContent = '−';
            }
        });

        // Remove active class from all items and add to current
        document.querySelectorAll('.nav-lesson, .nav-quiz').forEach(item => {
            item.classList.remove('active');
        });
        const currentLessonItem = document.querySelector(`[data-lesson-id="${lessonId}"]`);
        if (currentLessonItem) {
            currentLessonItem.classList.add('active');
        }

        const contentArea = document.getElementById('content-area');
        contentArea.innerHTML = `
            <div class="lesson-view">
                <div class="lesson-header">
                    <span class="breadcrumb">Module ${courseData.modules.indexOf(module) + 1} → Lesson ${lessonIndex + 1}</span>
                    <h1>${lesson.title}</h1>
                </div>

                <div class="lesson-content">
                    ${lesson.content}
                </div>

                <div class="lesson-actions">
                    ${lessonIndex > 0 ? `
                        <button class="nav-button prev" onclick="app.prevLesson()">
                            ← Previous Lesson
                        </button>
                    ` : '<div></div>'}

                    <button class="complete-button ${this.progress.completedLessons.includes(lessonId) ? 'completed' : ''}"
                            onclick="app.completeLesson('${lessonId}')">
                        ${this.progress.completedLessons.includes(lessonId) ? '✓ Completed' : 'Mark Complete'}
                    </button>

                    ${lessonIndex < module.lessons.length - 1 ? `
                        <button class="nav-button next" onclick="app.nextLesson()">
                            Next Lesson →
                        </button>
                    ` : module.quiz ? `
                        <button class="nav-button next quiz" onclick="app.showQuiz('${moduleId}')">
                            Take Quiz →
                        </button>
                    ` : '<div></div>'}
                </div>
            </div>
        `;

        // Scroll to top
        contentArea.scrollTop = 0;
    }

    completeLesson(lessonId) {
        if (!this.progress.completedLessons.includes(lessonId)) {
            this.progress.completedLessons.push(lessonId);
            this.saveProgress();
            this.renderNavigation();

            // Update button
            const btn = document.querySelector('.complete-button');
            btn.classList.add('completed');
            btn.textContent = '✓ Completed';
        }
    }

    nextLesson() {
        const lessonIndex = this.currentModule.lessons.indexOf(this.currentLesson);
        if (lessonIndex < this.currentModule.lessons.length - 1) {
            const nextLesson = this.currentModule.lessons[lessonIndex + 1];
            this.showLesson(this.currentModule.id, nextLesson.id);
        }
    }

    prevLesson() {
        const lessonIndex = this.currentModule.lessons.indexOf(this.currentLesson);
        if (lessonIndex > 0) {
            const prevLesson = this.currentModule.lessons[lessonIndex - 1];
            this.showLesson(this.currentModule.id, prevLesson.id);
        }
    }

    showQuiz(moduleId) {
        const module = courseData.modules.find(m => m.id === moduleId);
        const quiz = module.quiz;

        this.currentModule = module;
        this.currentQuiz = quiz;
        this.quizAnswers = {};

        // Expand the module and highlight current quiz
        const navModules = document.querySelectorAll('.nav-module');
        navModules.forEach((navModule, index) => {
            if (courseData.modules[index].id === moduleId) {
                navModule.classList.add('expanded');
                navModule.querySelector('.module-toggle').textContent = '−';
            }
        });

        // Remove active class from all items and add to current quiz
        document.querySelectorAll('.nav-lesson, .nav-quiz').forEach(item => {
            item.classList.remove('active');
        });
        const currentQuizItem = document.querySelector(`[data-quiz-id="${quiz.id}"]`);
        if (currentQuizItem) {
            currentQuizItem.classList.add('active');
        }

        const contentArea = document.getElementById('content-area');
        contentArea.innerHTML = `
            <div class="quiz-view">
                <div class="quiz-header">
                    <span class="breadcrumb">Module ${courseData.modules.indexOf(module) + 1}</span>
                    <h1>${quiz.title}</h1>
                    <p class="quiz-instructions">Answer all questions below. You need 70% to pass.</p>
                </div>

                <form class="quiz-form" onsubmit="app.submitQuiz(event)">
                    ${quiz.questions.map((q, i) => `
                        <div class="quiz-question" data-question="${i}">
                            <h3>Question ${i + 1}</h3>
                            <p class="question-text">${q.question}</p>
                            <div class="options">
                                ${q.options.map((opt, j) => `
                                    <label class="option">
                                        <input type="radio" name="q${i}" value="${j}" required>
                                        <span class="option-text">${opt}</span>
                                    </label>
                                `).join('')}
                            </div>
                        </div>
                    `).join('')}

                    <div class="quiz-actions">
                        <button type="submit" class="submit-quiz-button">Submit Quiz</button>
                    </div>
                </form>
            </div>
        `;
    }

    submitQuiz(event) {
        event.preventDefault();

        const quiz = this.currentQuiz;
        const form = event.target;
        let correct = 0;
        let results = [];

        quiz.questions.forEach((q, i) => {
            const selected = parseInt(form[`q${i}`].value);
            const isCorrect = selected === q.correct;
            if (isCorrect) correct++;
            results.push({
                question: q.question,
                selected: selected,
                correct: q.correct,
                isCorrect: isCorrect,
                explanation: q.explanation,
                options: q.options
            });
        });

        const score = Math.round((correct / quiz.questions.length) * 100);
        const passed = score >= 70;

        // Save progress
        this.progress.quizScores[quiz.id] = score;
        if (passed && !this.progress.completedQuizzes.includes(quiz.id)) {
            this.progress.completedQuizzes.push(quiz.id);
        }
        this.saveProgress();
        this.renderNavigation();

        // Show results
        this.showQuizResults(score, passed, results);
    }

    showQuizResults(score, passed, results) {
        const contentArea = document.getElementById('content-area');
        const moduleIndex = courseData.modules.indexOf(this.currentModule);
        const nextModule = courseData.modules[moduleIndex + 1];

        contentArea.innerHTML = `
            <div class="quiz-results">
                <div class="results-header ${passed ? 'passed' : 'failed'}">
                    <h1>${passed ? 'Congratulations!' : 'Keep Learning'}</h1>
                    <div class="score-display">
                        <span class="score-number">${score}%</span>
                        <span class="score-label">${passed ? 'PASSED' : 'NOT PASSED'}</span>
                    </div>
                    <p>${passed ? 'You\'ve mastered this module!' : 'You need 70% to pass. Review the lessons and try again.'}</p>
                </div>

                <div class="results-breakdown">
                    <h2>Question Breakdown</h2>
                    ${results.map((r, i) => `
                        <div class="result-item ${r.isCorrect ? 'correct' : 'incorrect'}">
                            <div class="result-header">
                                <span class="result-icon">${r.isCorrect ? '✓' : '✗'}</span>
                                <span class="result-question">Q${i + 1}: ${r.question}</span>
                            </div>
                            <div class="result-details">
                                <p><strong>Your answer:</strong> ${r.options[r.selected]}</p>
                                ${!r.isCorrect ? `<p><strong>Correct answer:</strong> ${r.options[r.correct]}</p>` : ''}
                                <p class="explanation"><strong>Explanation:</strong> ${r.explanation}</p>
                            </div>
                        </div>
                    `).join('')}
                </div>

                <div class="results-actions">
                    ${!passed ? `
                        <button class="retry-button" onclick="app.showQuiz('${this.currentModule.id}')">
                            Retry Quiz
                        </button>
                        <button class="review-button" onclick="app.showLesson('${this.currentModule.id}', '${this.currentModule.lessons[0].id}')">
                            Review Lessons
                        </button>
                    ` : nextModule ? `
                        <button class="next-module-button" onclick="app.showLesson('${nextModule.id}', '${nextModule.lessons[0].id}')">
                            Start Module ${moduleIndex + 2}: ${nextModule.title} →
                        </button>
                    ` : `
                        <button class="finish-button" onclick="app.showCertificate()">
                            View Certificate
                        </button>
                    `}
                </div>
            </div>
        `;
    }

    showCertificate() {
        const completedModules = courseData.modules.filter(m =>
            this.progress.completedQuizzes.includes(m.quiz?.id)
        ).length;

        const avgScore = Object.values(this.progress.quizScores).reduce((a, b) => a + b, 0) /
                        Object.values(this.progress.quizScores).length;

        const contentArea = document.getElementById('content-area');
        contentArea.innerHTML = `
            <div class="certificate">
                <div class="certificate-border">
                    <h1>Certificate of Completion</h1>
                    <p class="certificate-subtitle">Carz Inc Training Academy</p>
                    <div class="certificate-body">
                        <p>This certifies that</p>
                        <p class="certificate-name">________________</p>
                        <p>has successfully completed the</p>
                        <h2>Wholesale Car Buying Training Course</h2>
                        <p class="certificate-details">
                            Completed ${completedModules} of ${courseData.modules.length} modules<br>
                            Average Quiz Score: ${Math.round(avgScore)}%
                        </p>
                        <p class="certificate-date">Date: ${new Date().toLocaleDateString()}</p>
                    </div>
                </div>
                <button class="print-button" onclick="window.print()">Print Certificate</button>
                <button class="home-button" onclick="app.showWelcome()">Return to Home</button>
            </div>
        `;
    }
}

// Initialize app when page loads
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new TrainingApp();
});

// Mobile menu toggle
function toggleMobileMenu() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    sidebar.classList.toggle('open');
    overlay.classList.toggle('open');
}

// Close mobile menu when a lesson is clicked
document.addEventListener('click', (e) => {
    if (e.target.closest('.nav-lesson') || e.target.closest('.nav-quiz')) {
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.querySelector('.sidebar-overlay');
        if (sidebar.classList.contains('open')) {
            sidebar.classList.remove('open');
            overlay.classList.remove('open');
        }
    }
});
