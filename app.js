/* QuizDesk front end. All persistent data and grading are handled by Supabase. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const state = {
    client: null,
    user: null,
    teacherProfile: null,
    activeQuiz: null,
    activeQuestions: [],
    activeAttemptId: null,
    startedAt: null,
    timerHandle: null,
    quizRows: [],
    attempts: [],
    draftQuestionCount: 0,
    editingQuizId: null,
    toastHandle: null
  };

  const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[character]));
  }

  function showToast(message) {
    const toast = $('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    window.clearTimeout(state.toastHandle);
    state.toastHandle = window.setTimeout(() => toast.classList.remove('show'), 3600);
  }

  function setConnection(online, message) {
    $('connection-dot').className = `status-dot ${online ? 'online' : 'offline'}`;
    $('connection-text').textContent = message;
  }

  function setMessage(elementId, message, success = false) {
    const element = $(elementId);
    if (!element) return;
    element.textContent = message || '';
    element.classList.toggle('success', Boolean(success));
  }

  function formatDuration(totalSeconds) {
    const seconds = Math.max(0, Number(totalSeconds) || 0);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return hours > 0
      ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
      : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function showView(viewId = null) {
    $('app-main').classList.toggle('hidden', Boolean(viewId));
    document.querySelectorAll('.page-view').forEach((view) => {
      view.classList.toggle('hidden', view.id !== viewId);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openHome() {
    stopTimer();
    showView(null);
    loadPublicQuizzes();
  }

  function showTeacherLogin(message = '') {
    $('teacher-login-panel').classList.remove('hidden');
    $('teacher-dashboard').classList.add('hidden');
    setMessage('login-message', message);
  }

  async function openTeacherPortal() {
    showView('teacher-view');
    setMessage('login-message', '');
    if (!state.client) {
      showTeacherLogin('Connect this website to Supabase first. Add your project URL and publishable key in config.js.');
      return;
    }
    const { data, error } = await state.client.auth.getSession();
    if (error || !data.session) {
      state.user = null;
      showTeacherLogin();
      return;
    }
    state.user = data.session.user;
    await loadTeacherDashboard();
  }

  function friendlyError(error, fallback = 'Something went wrong. Please try again.') {
    const message = error?.message || fallback;
    if (/Failed to fetch|NetworkError|fetch/i.test(message)) {
      return 'Could not reach Supabase. Check your internet connection and project settings.';
    }
    return message;
  }

  async function loadPublicQuizzes() {
    const container = $('quiz-list');
    if (!state.client) {
      container.innerHTML = '<div class="empty-state"><strong>Website setup required</strong>Add your Supabase project URL and publishable key to <code>config.js</code>, then publish the site again.</div>';
      return;
    }
    container.innerHTML = '<div class="loading-card">Loading available quizzes…</div>';
    const { data, error } = await state.client
      .from('quizzes')
      .select('id,title,description,created_at,current_revision')
      .eq('is_published', true)
      .order('created_at', { ascending: false });

    if (error) {
      container.innerHTML = `<div class="empty-state"><strong>Could not load quizzes</strong>${escapeHtml(friendlyError(error))}</div>`;
      return;
    }

    const quizzes = data || [];
    state.quizRows = quizzes;
    let countByQuiz = {};
    if (quizzes.length) {
      const ids = quizzes.map((quiz) => quiz.id);
      const { data: questionRows, error: questionError } = await state.client
        .from('questions').select('quiz_id,revision').in('quiz_id', ids);
      if (!questionError) {
        countByQuiz = (questionRows || []).reduce((result, row) => {
          const quiz = quizzes.find((item) => item.id === row.quiz_id);
          if (quiz && row.revision === quiz.current_revision) {
            result[row.quiz_id] = (result[row.quiz_id] || 0) + 1;
          }
          return result;
        }, {});
      }
    }

    if (!quizzes.length) {
      container.innerHTML = '<div class="empty-state"><strong>No quizzes published yet</strong>Your teacher has not published a quiz. Check back later.</div>';
      return;
    }

    container.innerHTML = quizzes.map((quiz, index) => {
      const questionCount = countByQuiz[quiz.id] || 0;
      return `
        <article class="quiz-card">
          <div class="quiz-card-top"><span class="quiz-symbol">${['✳', '⌁', '◇'][index % 3]}</span><span class="quiz-meta-pill">Available now</span></div>
          <h3>${escapeHtml(quiz.title)}</h3>
          <p>${escapeHtml(quiz.description || 'A multiple-choice assessment. Read each question carefully and submit when you are ready.')}</p>
          <div class="quiz-card-bottom"><span>${questionCount} question${questionCount === 1 ? '' : 's'}</span><button type="button" data-start-quiz="${escapeHtml(quiz.id)}">View quiz →</button></div>
        </article>`;
    }).join('');
  }

  async function openQuiz(quizId) {
    if (!state.client) return showToast('The website has not been connected to Supabase yet.');
    const quiz = state.quizRows.find((row) => row.id === quizId);
    if (!quiz) return showToast('This quiz is no longer available. Refresh the page.');

    const { data: questions, error } = await state.client
      .from('questions')
      .select('id,question_text,image_url,options,position,revision')
      .eq('quiz_id', quizId)
      .eq('revision', quiz.current_revision)
      .order('position', { ascending: true });

    if (error) return showToast(friendlyError(error));
    if (!questions?.length) return showToast('This quiz does not contain any questions yet.');

    state.activeQuiz = quiz;
    state.activeQuestions = questions;
    state.activeAttemptId = null;
    state.startedAt = null;
    $('quiz-intro').innerHTML = `
      <div class="eyebrow"><span class="eyebrow-line"></span> STUDENT ASSESSMENT</div>
      <h1>${escapeHtml(quiz.title)}</h1>
      <p>${escapeHtml(quiz.description || 'Answer every multiple-choice question. Your teacher will review your submission after you finish.')}</p>`;
    $('student-details-card').classList.remove('hidden');
    $('quiz-taking-area').classList.add('hidden');
    $('student-name').value = '';
    $('student-code').value = '';
    $('student-contact').value = '';
    setMessage('');
    showView('take-quiz-view');
  }

  async function startQuiz(event) {
    event.preventDefault();
    if (!state.client || !state.activeQuiz) return;

    const name = $('student-name').value.trim();
    const studentCode = $('student-code').value.trim();
    const contact = $('student-contact').value.trim();
    const button = event.submitter || $('start-quiz-form').querySelector('button[type="submit"]');
    button.disabled = true;

    const { data, error } = await state.client.rpc('start_quiz', {
      p_quiz_id: state.activeQuiz.id,
      p_quiz_revision: state.activeQuiz.current_revision,
      p_student_name: name,
      p_student_code: studentCode,
      p_contact: contact
    });

    button.disabled = false;
    if (error) return showToast(friendlyError(error));

    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.attempt_id || !result?.started_at) return showToast('The quiz session could not be started. Please try again.');

    state.activeAttemptId = result.attempt_id;
    state.startedAt = new Date(result.started_at).getTime();
    $('student-details-card').classList.add('hidden');
    $('quiz-taking-area').classList.remove('hidden');
    renderStudentQuestions();
    startTimer();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderStudentQuestions() {
    const container = $('student-question-list');
    container.innerHTML = state.activeQuestions.map((question, index) => `
      <article class="student-question-card" data-question-card="${escapeHtml(question.id)}">
        <div class="student-question-top"><span>QUESTION ${index + 1}</span><span>${index + 1} / ${state.activeQuestions.length}</span></div>
        ${question.image_url ? `<img class="question-image student-question-image" src="${escapeHtml(question.image_url)}" alt="Question ${index + 1} image" loading="lazy">` : ''}
        ${question.question_text ? `<h3>${escapeHtml(question.question_text)}</h3>` : ''}
        <div class="student-options">
          ${(question.options || []).map((option, optionIndex) => `
            <label class="student-option">
              <input type="radio" name="question-${escapeHtml(question.id)}" value="${optionIndex}" ${optionIndex === 0 ? 'required' : ''}>
              <span><strong>${LETTERS[optionIndex]}.</strong> ${escapeHtml(option)}</span>
            </label>`).join('')}
        </div>
      </article>`).join('');
    updateQuestionProgress();
  }

  function updateQuestionProgress() {
    const total = state.activeQuestions.length;
    const answered = state.activeQuestions.filter((question) => {
      return document.querySelector(`input[name="question-${CSS.escape(question.id)}"]:checked`);
    }).length;
    $('question-progress-label').textContent = `${answered} of ${total} answered`;
    $('quiz-progress-bar').style.width = `${total ? (answered / total) * 100 : 0}%`;
  }

  function startTimer() {
    stopTimer();
    const tick = () => {
      const elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
      $('quiz-timer').textContent = formatDuration(elapsed);
    };
    tick();
    state.timerHandle = window.setInterval(tick, 1000);
  }

  function stopTimer() {
    if (state.timerHandle) window.clearInterval(state.timerHandle);
    state.timerHandle = null;
  }

  async function submitStudentQuiz(event) {
    event.preventDefault();
    if (!state.client || !state.activeAttemptId) return;
    const answers = state.activeQuestions.map((question) => {
      const selected = document.querySelector(`input[name="question-${CSS.escape(question.id)}"]:checked`);
      return selected ? {
        question_id: question.id,
        selected_option_index: Number(selected.value)
      } : null;
    });

    const unanswered = answers.filter((answer) => answer === null).length;
    if (unanswered) {
      showToast(`Please answer all questions. ${unanswered} remaining.`);
      const firstUnanswered = state.activeQuestions.find((question) => {
        return !document.querySelector(`input[name="question-${CSS.escape(question.id)}"]:checked`);
      });
      document.querySelector(`[data-question-card="${CSS.escape(firstUnanswered.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const button = $('submit-quiz-button');
    button.disabled = true;
    button.textContent = 'Submitting…';
    const { data, error } = await state.client.rpc('submit_quiz', {
      p_attempt_id: state.activeAttemptId,
      p_answers: answers
    });
    button.disabled = false;
    button.innerHTML = 'Submit quiz <span aria-hidden="true">→</span>';

    if (error) return showToast(friendlyError(error));
    if (!data?.submitted) return showToast('The submission could not be confirmed. Please contact your teacher.');

    stopTimer();
    const elapsed = Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000));
    $('submitted-meta').innerHTML = `<span>${escapeHtml($('student-name').value.trim())}</span><span>${state.activeQuestions.length} questions</span><span>${formatDuration(elapsed)} elapsed</span>`;
    showView('submitted-view');
  }

  async function signInTeacher(event) {
    event.preventDefault();
    if (!state.client) return;
    const email = $('teacher-email').value.trim();
    const password = $('teacher-password').value;
    const button = $('teacher-login-form').querySelector('button[type="submit"]');
    button.disabled = true;
    setMessage('login-message', 'Signing in…');

    const { data, error } = await state.client.auth.signInWithPassword({ email, password });
    button.disabled = false;
    if (error) return setMessage('login-message', friendlyError(error));

    state.user = data.user;
    await loadTeacherDashboard();
  }

  async function loadTeacherDashboard() {
    if (!state.client || !state.user) return showTeacherLogin();
    const { data: profile, error: profileError } = await state.client
      .from('teachers').select('user_id,display_name').eq('user_id', state.user.id).maybeSingle();

    if (profileError || !profile) {
      await state.client.auth.signOut();
      state.user = null;
      showTeacherLogin(profileError ? friendlyError(profileError) : 'This account has not been added to the teachers list. Ask the project administrator to grant teacher access.');
      return;
    }

    state.teacherProfile = profile;
    $('teacher-login-panel').classList.add('hidden');
    $('teacher-dashboard').classList.remove('hidden');
    $('teacher-account-label').textContent = `${profile.display_name || 'Teacher'} · ${state.user.email || ''}`;
    await refreshTeacherData();
  }

  async function refreshTeacherData() {
    if (!state.client || !state.user) return;
    $('teacher-quiz-list').innerHTML = '<div class="loading-card">Loading your quizzes…</div>';
    $('teacher-submission-list').innerHTML = '<div class="loading-card">Loading submissions…</div>';

    const [quizResult, attemptResult] = await Promise.all([
      state.client.from('quizzes').select('id,title,description,is_published,created_at,current_revision').eq('created_by', state.user.id).order('created_at', { ascending: false }),
      state.client.from('attempts').select('id,quiz_id,student_name,student_code,contact,submitted_at,elapsed_seconds,score,total_questions').not('submitted_at', 'is', null).order('submitted_at', { ascending: false }).limit(100)
    ]);

    if (quizResult.error) {
      $('teacher-quiz-list').innerHTML = `<div class="empty-state">${escapeHtml(friendlyError(quizResult.error))}</div>`;
      return;
    }
    if (attemptResult.error) {
      $('teacher-submission-list').innerHTML = `<div class="empty-state">${escapeHtml(friendlyError(attemptResult.error))}</div>`;
    }

    state.quizRows = quizResult.data || [];
    state.attempts = attemptResult.data || [];
    const quizMap = new Map(state.quizRows.map((quiz) => [quiz.id, quiz]));

    $('stat-quizzes').textContent = state.quizRows.length;
    $('stat-published').textContent = state.quizRows.filter((quiz) => quiz.is_published).length;
    $('stat-submissions').textContent = state.attempts.length;
    renderTeacherQuizzes();
    renderTeacherSubmissions(quizMap);
  }

  function renderTeacherQuizzes() {
    const container = $('teacher-quiz-list');
    if (!state.quizRows.length) {
      container.innerHTML = '<div class="empty-state"><strong>No quizzes created</strong>Create your first assessment to get started.</div>';
      return;
    }
    container.innerHTML = state.quizRows.map((quiz) => `
      <article class="teacher-quiz-item">
        <div class="teacher-quiz-row">
          <div><h4>${escapeHtml(quiz.title)}</h4><p>Created ${formatDate(quiz.created_at)}</p></div>
          <span class="status-label ${quiz.is_published ? '' : 'draft'}">${quiz.is_published ? 'Published' : 'Draft'}</span>
        </div>
        <div class="item-actions" style="margin-top:10px;justify-content:flex-start">
          <button class="small-action" type="button" data-edit-quiz="${escapeHtml(quiz.id)}">Edit</button>
          <button class="small-action" type="button" data-toggle-quiz="${escapeHtml(quiz.id)}">${quiz.is_published ? 'Unpublish' : 'Publish'}</button>
          <button class="small-action danger" type="button" data-delete-quiz="${escapeHtml(quiz.id)}">Delete</button>
        </div>
      </article>`).join('');
  }

  function renderTeacherSubmissions(quizMap) {
    const container = $('teacher-submission-list');
    if (!state.attempts.length) {
      container.innerHTML = '<div class="empty-state"><strong>No submissions yet</strong>Student attempts will appear here after they submit a quiz.</div>';
      return;
    }
    container.innerHTML = state.attempts.map((attempt) => {
      const quiz = quizMap.get(attempt.quiz_id);
      return `
        <article class="submission-item" role="button" tabindex="0" data-open-submission="${escapeHtml(attempt.id)}">
          <div class="submission-row"><div><h4>${escapeHtml(attempt.student_name)}</h4><p>${escapeHtml(quiz?.title || 'Quiz')} · ID: ${escapeHtml(attempt.student_code)}</p></div><span class="submission-score">${attempt.score}/${attempt.total_questions}</span></div>
          <div class="submission-meta"><span>${formatDate(attempt.submitted_at)}</span><span>${formatDuration(attempt.elapsed_seconds)}</span><span>Review answers →</span></div>
        </article>`;
    }).join('');
  }

  async function toggleQuiz(quizId) {
    const quiz = state.quizRows.find((row) => row.id === quizId);
    if (!quiz) return;
    const { error } = await state.client.from('quizzes')
      .update({ is_published: !quiz.is_published })
      .eq('id', quizId).eq('created_by', state.user.id);
    if (error) return showToast(friendlyError(error));
    showToast(quiz.is_published ? 'Quiz unpublished.' : 'Quiz published for students.');
    await refreshTeacherData();
  }

  async function deleteQuiz(quizId) {
    const quiz = state.quizRows.find((row) => row.id === quizId);
    if (!quiz) return;
    const { count, error: countError } = await state.client
      .from('attempts').select('id', { count: 'exact', head: true }).eq('quiz_id', quizId);
    if (countError) return showToast(friendlyError(countError));
    if ((count || 0) > 0) {
      return showToast('This quiz already has student attempts. Unpublish it instead so the submission records are preserved.');
    }
    if (!window.confirm(`Delete “${quiz.title}”? Its questions and answer keys will also be deleted. This cannot be undone.`)) return;
    const { error } = await state.client.from('quizzes')
      .delete().eq('id', quizId).eq('created_by', state.user.id);
    if (error) return showToast(friendlyError(error));
    showToast('Quiz deleted.');
    await refreshTeacherData();
  }

  function openCreateQuiz() {
    state.editingQuizId = null;
    state.draftQuestionCount = 0;
    $('quiz-title').value = '';
    $('quiz-description').value = '';
    $('quiz-publish').checked = true;
    $('question-builder').innerHTML = '';
    $('quiz-form-title').textContent = 'Build a new quiz.';
    $('quiz-form-subtitle').textContent = 'Add your questions and choose the correct option. Students will not see the answer key.';
    $('save-quiz-button').innerHTML = 'Save quiz <span aria-hidden="true">→</span>';
    addQuestionEditor();
    setMessage('create-quiz-message', '');
    showView('create-quiz-view');
  }

  async function openEditQuiz(quizId) {
    const quiz = state.quizRows.find((row) => row.id === quizId);
    if (!quiz) return showToast('This quiz could not be found. Refresh the dashboard and try again.');

    showView('create-quiz-view');
    $('quiz-form-title').textContent = 'Edit your quiz.';
    $('quiz-form-subtitle').textContent = 'Changes create a new version. Previous student submissions remain attached to the version they attempted.';
    $('save-quiz-button').innerHTML = 'Save changes <span aria-hidden="true">→</span>';
    $('question-builder').innerHTML = '<div class="loading-card">Loading quiz questions…</div>';
    setMessage('create-quiz-message', '');

    const quizResult = await state.client.from('quizzes')
      .select('id,title,description,is_published,current_revision')
      .eq('id', quizId).eq('created_by', state.user.id).maybeSingle();

    if (quizResult.error || !quizResult.data) {
      showView('teacher-view');
      return showToast(friendlyError(quizResult.error, 'Could not load this quiz for editing.'));
    }

    const fullQuiz = quizResult.data;
    const questionResult = await state.client.from('questions')
      .select('id,question_text,image_url,options,position,revision,answer_keys(correct_option_index)')
      .eq('quiz_id', quizId).eq('revision', fullQuiz.current_revision)
      .order('position', { ascending: true });

    if (questionResult.error) {
      showView('teacher-view');
      return showToast(friendlyError(questionResult.error, 'Could not load this quiz for editing.'));
    }
    state.editingQuizId = quizId;
    state.draftQuestionCount = 0;
    $('quiz-title').value = fullQuiz.title || '';
    $('quiz-description').value = fullQuiz.description || '';
    $('quiz-publish').checked = Boolean(fullQuiz.is_published);
    $('question-builder').innerHTML = '';

    (questionResult.data || []).forEach((question) => {
      const keyData = question.answer_keys;
      const correctIndex = Array.isArray(keyData) ? keyData[0]?.correct_option_index : keyData?.correct_option_index;
      addQuestionEditor({
        question_text: question.question_text || '',
        image_url: question.image_url || '',
        options: question.options || [],
        correct_option_index: Number.isInteger(correctIndex) ? correctIndex : 0
      });
    });

    if (!questionResult.data?.length) addQuestionEditor();
    updateQuestionEditorLabels();
  }

  function addQuestionEditor(question = {}) {
    if (document.querySelectorAll('[data-question-editor]').length >= 100) return showToast('A quiz can contain up to 100 questions.');
    const index = state.draftQuestionCount;
    state.draftQuestionCount += 1;
    const editor = document.createElement('div');
    editor.className = 'question-editor';
    editor.dataset.questionEditor = String(index);
    editor.dataset.imageUrl = question.image_url || '';
    const optionValues = Array.from({ length: 4 }, (_, optionIndex) => question.options?.[optionIndex] ?? '');
    editor.innerHTML = `
      <div class="question-editor-head">
        <strong>Question ${index + 1}</strong>
        <div class="question-editor-tools">
          <button type="button" class="move-question" data-move-question="up" aria-label="Move question up" title="Move up">↑</button>
          <button type="button" class="move-question" data-move-question="down" aria-label="Move question down" title="Move down">↓</button>
          <button type="button" class="remove-question" data-remove-question="${index}" ${index === 0 ? 'disabled' : ''}>Remove</button>
        </div>
      </div>
      <label class="question-text-field">Question text <span class="optional-label">Optional when an image is added</span><textarea rows="3" maxlength="2000" data-question-text placeholder="Write your question here…"></textarea></label>
      <div class="question-image-editor">
        <label>Question image <span class="optional-label">Optional · PNG, JPG, WEBP or GIF · Up to 5 MB</span><input type="file" data-question-image accept="image/jpeg,image/png,image/webp,image/gif"></label>
        <p class="image-upload-status" data-image-status role="status"></p>
        <div class="image-preview-wrap ${question.image_url ? '' : 'hidden'}" data-image-preview-wrap>
          <img data-image-preview ${question.image_url ? `src="${escapeHtml(question.image_url)}"` : ''} alt="Question image preview">
          <button type="button" class="small-action danger" data-remove-image>Remove image</button>
        </div>
      </div>
      <div class="options-grid">
        ${LETTERS.slice(0, 4).map((letter, optionIndex) => `<label class="option-editor"><span class="option-letter">${letter}</span><textarea rows="2" maxlength="500" data-option-index="${optionIndex}" required placeholder="Option ${letter}"></textarea></label>`).join('')}
      </div>
      <label class="correct-answer-field">Correct answer<select data-correct-index>${LETTERS.slice(0, 4).map((letter, optionIndex) => `<option value="${optionIndex}">${letter}</option>`).join('')}</select></label>`;

    editor.querySelector('[data-question-text]').value = question.question_text || '';
    editor.querySelectorAll('[data-option-index]').forEach((field) => {
      field.value = optionValues[Number(field.dataset.optionIndex)];
    });
    editor.querySelector('[data-correct-index]').value = String(question.correct_option_index ?? 0);
    $('question-builder').appendChild(editor);
    updateQuestionEditorLabels();
  }

  async function uploadQuestionImage(editor, fileInput) {
    const file = fileInput.files?.[0];
    if (!file) return;
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      fileInput.value = '';
      return showToast('Choose a JPG, PNG, WEBP or GIF image.');
    }
    if (file.size > 5 * 1024 * 1024) {
      fileInput.value = '';
      return showToast('The image must be 5 MB or smaller.');
    }
    if (!state.client || !state.user) return showToast('Sign in as a teacher before uploading images.');

    const status = editor.querySelector('[data-image-status]');
    const previewWrap = editor.querySelector('[data-image-preview-wrap]');
    const preview = editor.querySelector('[data-image-preview]');
    editor.dataset.uploading = 'true';
    status.textContent = 'Uploading image…';
    fileInput.disabled = true;

    const extensionByType = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif'
    };
    const extension = extensionByType[file.type];
    const uniquePart = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const path = `${state.user.id}/${uniquePart}.${extension}`;
    const { error } = await state.client.storage.from('quiz-question-images').upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type
    });

    editor.dataset.uploading = 'false';
    fileInput.disabled = false;
    if (error) {
      status.textContent = '';
      fileInput.value = '';
      return showToast(friendlyError(error, 'The image could not be uploaded. Check the database migration and storage permissions.'));
    }

    const { data } = state.client.storage.from('quiz-question-images').getPublicUrl(path);
    editor.dataset.imageUrl = data.publicUrl;
    preview.src = data.publicUrl;
    previewWrap.classList.remove('hidden');
    status.textContent = 'Image uploaded. It will appear above the question text.';
  }

  function removeQuestionImage(editor) {
    editor.dataset.imageUrl = '';
    const fileInput = editor.querySelector('[data-question-image]');
    if (fileInput) fileInput.value = '';
    editor.querySelector('[data-image-preview]').removeAttribute('src');
    editor.querySelector('[data-image-preview-wrap]').classList.add('hidden');
    editor.querySelector('[data-image-status]').textContent = 'Image removed. Save the quiz to apply this change.';
  }

  function updateQuestionEditorLabels() {
    const editors = [...document.querySelectorAll('[data-question-editor]')];
    editors.forEach((editor, index) => {
      editor.querySelector('.question-editor-head strong').textContent = `Question ${index + 1}`;
      const remove = editor.querySelector('[data-remove-question]');
      remove.disabled = editors.length === 1;
      const moveUp = editor.querySelector('[data-move-question="up"]');
      const moveDown = editor.querySelector('[data-move-question="down"]');
      moveUp.disabled = index === 0;
      moveDown.disabled = index === editors.length - 1;
    });
    $('question-count').textContent = `${editors.length} question${editors.length === 1 ? '' : 's'}`;
  }

  function moveQuestion(editor, direction) {
    const container = $('question-builder');
    if (direction === 'up' && editor.previousElementSibling) {
      container.insertBefore(editor, editor.previousElementSibling);
    } else if (direction === 'down' && editor.nextElementSibling) {
      container.insertBefore(editor.nextElementSibling, editor);
    }
    updateQuestionEditorLabels();
  }

  async function saveQuiz(event) {
    event.preventDefault();
    if (!state.client || !state.user) return;
    const title = $('quiz-title').value.trim();
    const description = $('quiz-description').value;
    const questionEditors = [...document.querySelectorAll('[data-question-editor]')];
    const questions = [];

    for (let index = 0; index < questionEditors.length; index += 1) {
      const editor = questionEditors[index];
      if (editor.dataset.uploading === 'true') {
        setMessage('create-quiz-message', `Please wait for the image upload in Question ${index + 1} to finish.`);
        return;
      }
      // Preserve all intentional spaces and line breaks. Do not trim stored question/options text.
      const questionText = editor.querySelector('[data-question-text]').value.replace(/\r\n?/g, '\n');
      const imageUrl = editor.dataset.imageUrl || '';
      const options = [...editor.querySelectorAll('[data-option-index]')]
        .map((field) => field.value.replace(/\r\n?/g, '\n'));
      if ((!questionText.trim() && !imageUrl) || options.some((option) => !option.trim())) {
        setMessage('create-quiz-message', `Question ${index + 1} needs text or an image, and all four answer options must be completed.`);
        editor.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      questions.push({
        question_text: questionText,
        image_url: imageUrl,
        options,
        correct_option_index: Number(editor.querySelector('[data-correct-index]').value)
      });
    }

    if (!title) {
      setMessage('create-quiz-message', 'Please enter a quiz title.');
      $('quiz-title').focus();
      return;
    }

    const button = $('save-quiz-button');
    button.disabled = true;
    button.textContent = state.editingQuizId ? 'Saving changes…' : 'Saving…';
    setMessage('create-quiz-message', state.editingQuizId ? 'Saving a new version of your quiz…' : 'Saving quiz and answer key…', true);

    const isEditing = Boolean(state.editingQuizId);
    const rpcName = isEditing ? 'update_quiz' : 'create_quiz';
    const rpcArgs = {
      p_title: title,
      p_description: description,
      p_is_published: $('quiz-publish').checked,
      p_questions: questions
    };
    if (isEditing) rpcArgs.p_quiz_id = state.editingQuizId;

    const { error } = await state.client.rpc(rpcName, rpcArgs);
    button.disabled = false;
    button.innerHTML = isEditing ? 'Save changes <span aria-hidden="true">→</span>' : 'Save quiz <span aria-hidden="true">→</span>';
    if (error) return setMessage('create-quiz-message', friendlyError(error));

    state.editingQuizId = null;
    showToast(isEditing
      ? 'Quiz updated. Previous submissions remain unchanged.'
      : ($('quiz-publish').checked ? 'Quiz created and published.' : 'Quiz saved as a draft.'));
    showView('teacher-view');
    await loadTeacherDashboard();
  }

  async function openSubmission(attemptId) {
    showView('submission-detail-view');
    $('submission-detail-content').innerHTML = '<div class="loading-card">Loading submission…</div>';

    const { data: attempt, error: attemptError } = await state.client
      .from('attempts')
      .select('id,quiz_id,quiz_revision,student_name,student_code,contact,started_at,submitted_at,elapsed_seconds,score,total_questions')
      .eq('id', attemptId).maybeSingle();
    if (attemptError || !attempt) {
      $('submission-detail-content').innerHTML = `<div class="empty-state">${escapeHtml(friendlyError(attemptError, 'Submission could not be found.'))}</div>`;
      return;
    }

    const [quizResult, questionResult, answerResult] = await Promise.all([
      state.client.from('quizzes').select('id,title').eq('id', attempt.quiz_id).maybeSingle(),
      state.client.from('questions').select('id,question_text,image_url,options,position,answer_keys(correct_option_index)').eq('quiz_id', attempt.quiz_id).eq('revision', attempt.quiz_revision).order('position'),
      state.client.from('answers').select('question_id,selected_option_index,is_correct').eq('attempt_id', attempt.id)
    ]);

    const error = quizResult.error || questionResult.error || answerResult.error;
    if (error) {
      $('submission-detail-content').innerHTML = `<div class="empty-state">${escapeHtml(friendlyError(error))}</div>`;
      return;
    }

    const answersByQuestion = new Map((answerResult.data || []).map((answer) => [answer.question_id, answer]));
    const questions = questionResult.data || [];
    const answerMarkup = questions.map((question, index) => {
      const submitted = answersByQuestion.get(question.id);
      const keyData = question.answer_keys;
      const correctIndex = Array.isArray(keyData) ? keyData[0]?.correct_option_index : keyData?.correct_option_index;
      return `
        <article class="review-answer">
          <div class="student-question-top"><span>QUESTION ${index + 1}</span><span>${submitted?.is_correct ? 'Correct' : 'Incorrect'}</span></div>
          ${question.image_url ? `<img class="question-image review-question-image" src="${escapeHtml(question.image_url)}" alt="Question ${index + 1} image" loading="lazy">` : ''}
          ${question.question_text ? `<h3>${escapeHtml(question.question_text)}</h3>` : ''}
          ${(question.options || []).map((option, optionIndex) => {
            const isCorrect = optionIndex === correctIndex;
            const isChosen = optionIndex === submitted?.selected_option_index;
            const classes = ['review-choice', isCorrect ? 'correct' : '', isChosen && !isCorrect ? 'chosen-wrong' : ''].filter(Boolean).join(' ');
            let tag = '';
            if (isCorrect) tag = '<span class="choice-tag">Correct answer</span>';
            if (isChosen) tag = `<span class="choice-tag">${isCorrect ? 'Student answer' : 'Student selected'}</span>`;
            return `<div class="${classes}"><strong>${LETTERS[optionIndex]}.</strong><span>${escapeHtml(option)}</span>${tag}</div>`;
          }).join('')}
        </article>`;
    }).join('');

    $('submission-detail-content').innerHTML = `
      <div class="detail-header"><div class="eyebrow"><span class="eyebrow-line"></span> SUBMISSION REVIEW</div><h1>${escapeHtml(attempt.student_name)}</h1><p>${escapeHtml(quizResult.data?.title || 'Quiz')} · Student ID: ${escapeHtml(attempt.student_code)}</p></div>
      <div class="detail-stats">
        <div class="detail-stat"><small>SCORE</small><strong>${attempt.score} / ${attempt.total_questions}</strong></div>
        <div class="detail-stat"><small>TIME TAKEN</small><strong>${formatDuration(attempt.elapsed_seconds)}</strong></div>
        <div class="detail-stat"><small>SUBMITTED</small><strong>${formatDate(attempt.submitted_at)}</strong></div>
        <div class="detail-stat"><small>CONTACT</small><strong style="font-size:11px;overflow-wrap:anywhere">${escapeHtml(attempt.contact || 'Not provided')}</strong></div>
      </div>
      <div class="panel-heading"><div><span class="panel-kicker">ANSWER SHEET</span><h3>Question-by-question review</h3></div></div>
      ${answerMarkup || '<div class="empty-state">No answer records were found.</div>'}`;
  }

  function bindEvents() {
    $('teacher-nav-button').addEventListener('click', openTeacherPortal);
    $('hero-teacher-button').addEventListener('click', openTeacherPortal);
    $('teacher-entry-button').addEventListener('click', openTeacherPortal);
    $('teacher-home-button').addEventListener('click', openHome);
    $('browse-quizzes-button').addEventListener('click', () => $('quiz-section').scrollIntoView({ behavior: 'smooth' }));
    $('refresh-quizzes-button').addEventListener('click', loadPublicQuizzes);
    $('quiz-list').addEventListener('click', (event) => {
      const button = event.target.closest('[data-start-quiz]');
      if (button) openQuiz(button.dataset.startQuiz);
    });
    $('teacher-login-form').addEventListener('submit', signInTeacher);
    $('teacher-logout-button').addEventListener('click', async () => {
      await state.client.auth.signOut();
      state.user = null;
      state.teacherProfile = null;
      showTeacherLogin('You have been signed out.');
    });
    $('open-create-quiz-button').addEventListener('click', openCreateQuiz);
    $('refresh-submissions-button').addEventListener('click', refreshTeacherData);
    $('teacher-quiz-list').addEventListener('click', (event) => {
      const edit = event.target.closest('[data-edit-quiz]');
      const toggle = event.target.closest('[data-toggle-quiz]');
      const remove = event.target.closest('[data-delete-quiz]');
      if (edit) openEditQuiz(edit.dataset.editQuiz);
      if (toggle) toggleQuiz(toggle.dataset.toggleQuiz);
      if (remove) deleteQuiz(remove.dataset.deleteQuiz);
    });
    $('teacher-submission-list').addEventListener('click', (event) => {
      const item = event.target.closest('[data-open-submission]');
      if (item) openSubmission(item.dataset.openSubmission);
    });
    $('teacher-submission-list').addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const item = event.target.closest('[data-open-submission]');
      if (item) {
        event.preventDefault();
        openSubmission(item.dataset.openSubmission);
      }
    });
    $('create-back-button').addEventListener('click', () => showView('teacher-view'));
    $('add-question-button').addEventListener('click', addQuestionEditor);
    $('question-builder').addEventListener('click', (event) => {
      const move = event.target.closest('[data-move-question]');
      const remove = event.target.closest('[data-remove-question]');
      const removeImage = event.target.closest('[data-remove-image]');
      if (move) return moveQuestion(move.closest('[data-question-editor]'), move.dataset.moveQuestion);
      if (removeImage) return removeQuestionImage(removeImage.closest('[data-question-editor]'));
      if (!remove || remove.disabled) return;
      remove.closest('[data-question-editor]').remove();
      updateQuestionEditorLabels();
    });
    $('question-builder').addEventListener('change', (event) => {
      if (!event.target.matches('[data-question-image]')) return;
      uploadQuestionImage(event.target.closest('[data-question-editor]'), event.target);
    });
    $('create-quiz-form').addEventListener('submit', saveQuiz);
    $('quiz-back-button').addEventListener('click', openHome);
    $('start-quiz-form').addEventListener('submit', startQuiz);
    $('student-answer-form').addEventListener('change', (event) => {
      if (event.target.matches('input[type="radio"]')) {
        event.target.closest('.student-options').querySelectorAll('.student-option').forEach((label) => label.classList.remove('selected'));
        event.target.closest('.student-option').classList.add('selected');
        updateQuestionProgress();
      }
    });
    $('student-answer-form').addEventListener('submit', submitStudentQuiz);
    $('detail-back-button').addEventListener('click', () => showView('teacher-view'));
    $('return-home-button').addEventListener('click', openHome);
  }

  async function initialize() {
    $('current-year').textContent = new Date().getFullYear();
    bindEvents();

    const config = window.QUIZDESK_CONFIG || {};
    const hasConfig = config.SUPABASE_URL && config.SUPABASE_ANON_KEY
      && !config.SUPABASE_URL.includes('YOUR-PROJECT-REF')
      && !config.SUPABASE_ANON_KEY.includes('YOUR_SUPABASE');

    if (!hasConfig) {
      setConnection(false, 'Setup required');
      await loadPublicQuizzes();
      return;
    }

    if (!window.supabase?.createClient) {
      setConnection(false, 'Client unavailable');
      $('quiz-list').innerHTML = '<div class="empty-state"><strong>Could not load Supabase client</strong>Check your internet connection and reload the page.</div>';
      return;
    }

    try {
      state.client = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
      const { error } = await state.client.from('quizzes').select('id').eq('is_published', true).limit(1);
      if (error) {
        setConnection(false, 'Connection issue');
        await loadPublicQuizzes();
        return;
      }
      setConnection(true, 'Connected');
      await loadPublicQuizzes();
      const { data } = await state.client.auth.getSession();
      if (data.session) state.user = data.session.user;
    } catch (error) {
      setConnection(false, 'Connection issue');
      $('quiz-list').innerHTML = `<div class="empty-state"><strong>Could not connect</strong>${escapeHtml(friendlyError(error))}</div>`;
    }
  }

  document.addEventListener('DOMContentLoaded', initialize);
})();
