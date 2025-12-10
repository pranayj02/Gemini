// --- CSV HELPERS & CORE STATE ----------------------------------------------

// Light CSV parser (no quoted commas, simple spreadsheet export). [web:86][web:136]
function parseCSV(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split(",").map(h => h.trim());
  const rows = lines.slice(1);
  return rows.map(line => {
    const cols = line.split(",").map(c => c.trim());
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = cols[i] ?? "";
    });
    return obj;
  });
}

// Convert CSV records into internal question objects
function csvToQuestions(records) {
  return records
    .map(r => {
      const correctIndex = Math.max(
        0,
        Math.min(3, (parseInt(r.correctIndex, 10) || 1) - 1)
      );
      const points = parseInt(r.points, 10) || DEFAULT_POINTS;
      return {
        text: r.question || "",
        options: [r.option1, r.option2, r.option3, r.option4].map(o => o || ""),
        correctIndex,
        points
      };
    })
    .filter(
      q =>
        q.text &&
        q.options.length === 4 &&
        q.options.every(o => o !== "")
    );
}

// Fisher–Yates shuffle (copying the array). [web:65][web:68][web:142][web:147]
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const DEFAULT_POINTS = 10;

let state = {
  questions: [],
  currentIndex: -1,
  teams: [],
  scores: {}, // teamId -> number
  answeredCount: {}, // teamId -> number
  correctCount: {}, // teamId -> number
  selectedOptionIndex: null,
  selectedTeamId: null,
  quizStarted: false
};

// --- DOM ELEMENTS -----------------------------------------------------------

const questionBankStatusEl = document.getElementById("question-bank-status");
const footerStatusEl = document.getElementById("footer-status");

const teamsEditor = document.getElementById("teams-editor");
const addTeamBtn = document.getElementById("add-team-btn");
const startQuizBtn = document.getElementById("start-quiz-btn");
const resetBtn = document.getElementById("reset-btn");

const tabButtons = document.querySelectorAll(".tab-btn");
const tabs = document.querySelectorAll(".tab");

const questionCounterEl = document.getElementById("question-counter");
const roundStatusEl = document.getElementById("round-status");
const questionTextEl = document.getElementById("question-text");
const optionsContainer = document.getElementById("options");

const readQuestionBtn = document.getElementById("read-question-btn");
const nextQuestionBtn = document.getElementById("next-question-btn");

const teamButtonsContainer = document.getElementById("team-buttons");
const currentSelectionEl = document.getElementById("current-selection");
const optionSummaryEl = document.getElementById("option-summary");
const feedbackEl = document.getElementById("feedback");
const submitAnswerBtn = document.getElementById("submit-answer-btn");
const standingsBody = document.getElementById("standings-body");

// --- INITIAL TEAM UI --------------------------------------------------------

function initTeams() {
  const defaultNames = ["Team A", "Team B", "Team C"];
  defaultNames.forEach(addTeamRow);
}

function addTeamRow(name = "") {
  const row = document.createElement("div");
  row.className = "team-row";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Team name";
  input.value = name;

  const removeBtn = document.createElement("button");
  removeBtn.className = "remove-team-btn";
  removeBtn.type = "button";
  removeBtn.textContent = "×";

  removeBtn.addEventListener("click", () => {
    if (teamsEditor.children.length <= 1) return;
    teamsEditor.removeChild(row);
  });

  row.appendChild(input);
  row.appendChild(removeBtn);
  teamsEditor.appendChild(row);
}

addTeamBtn.addEventListener("click", () => addTeamRow(""));

// --- TABS -------------------------------------------------------------------

tabButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    const tabId = btn.dataset.tab;
    tabButtons.forEach(b => b.classList.toggle("active", b === btn));
    tabs.forEach(t => t.classList.toggle("active", t.id === tabId));
  });
});

// --- LOAD QUESTIONS FROM REPO CSV ------------------------------------------

// Automatically read questions.csv using fetch on GitHub Pages. [web:86][web:122][web:127]
async function loadQuestionsFromRepo() {
  try {
    const response = await fetch("questions.csv");
    if (!response.ok) {
      console.error("Failed to load questions.csv", response.status);
      questionBankStatusEl.textContent = "Could not load questions.csv from repo.";
      return;
    }

    const text = await response.text();
    const parsed = parseCSV(text);
    const questions = csvToQuestions(parsed);

    if (!questions.length) {
      console.error("No valid questions parsed from CSV.");
      questionBankStatusEl.textContent = "No valid questions in questions.csv.";
      return;
    }

    state.questions = shuffleArray(questions);
    state.currentIndex = -1;

    questionBankStatusEl.textContent = `Loaded ${state.questions.length} questions (shuffled) from repo CSV.`;
    questionTextEl.textContent = "Question bank ready. Click Start quiz when ready.";
    questionCounterEl.textContent = "Ready.";
    roundStatusEl.textContent = "";
    clearOptionsUI();
  } catch (err) {
    console.error("Error loading CSV from repo:", err);
    questionBankStatusEl.textContent = "Error loading questions.csv.";
  }
}

// --- QUIZ CONTROL -----------------------------------------------------------

startQuizBtn.addEventListener("click", () => {
  const names = Array.from(teamsEditor.querySelectorAll("input"))
    .map(i => i.value.trim())
    .filter(Boolean);

  if (!names.length) {
    alert("Please add at least one team name.");
    return;
  }
  if (!state.questions.length) {
    alert("No questions loaded from questions.csv.");
    return;
  }

  state.teams = names.map((name, index) => ({
    id: `team-${index}`,
    name
  }));

  state.scores = {};
  state.answeredCount = {};
  state.correctCount = {};
  state.teams.forEach(t => {
    state.scores[t.id] = 0;
    state.answeredCount[t.id] = 0;
    state.correctCount[t.id] = 0;
  });

  state.quizStarted = true;
  footerStatusEl.textContent = "Quiz started.";
  state.currentIndex = -1;
  goToNextQuestion();
  buildTeamButtons();
  renderStandings();
});

resetBtn.addEventListener("click", () => {
  if (!confirm("Reset quiz, scores, and question position?")) return;
  state.currentIndex = -1;
  state.selectedOptionIndex = null;
  state.selectedTeamId = null;
  state.quizStarted = false;

  questionTextEl.textContent = "Question bank ready. Click Start quiz when ready.";
  roundStatusEl.textContent = "";
  questionCounterEl.textContent = "Ready.";
  clearOptionsUI();
  feedbackEl.textContent = "";
  currentSelectionEl.textContent = "None";
  optionSummaryEl.textContent = "None selected.";
  standingsBody.innerHTML = "";
  footerStatusEl.textContent = "Reset complete.";
});

// --- QUESTION FLOW ----------------------------------------------------------

nextQuestionBtn.addEventListener("click", () => {
  goToNextQuestion();
});

readQuestionBtn.addEventListener("click", () => {
  readCurrentQuestion();
});

function goToNextQuestion() {
  if (!state.quizStarted || !state.questions.length) return;

  const nextIndex = state.currentIndex + 1;
  
  // Check if we reached the end
  if (nextIndex >= state.questions.length) {
    endQuiz();
    return;
  }

  // Update indices and reset state
  state.currentIndex = nextIndex;
  state.selectedOptionIndex = null;
  state.selectedTeamId = null;

  // Clear text feedback
  feedbackEl.textContent = "";
  currentSelectionEl.textContent = "None";
  optionSummaryEl.textContent = "None selected.";

  // --- NEW: Reset the submit button to disabled ---
  submitAnswerBtn.disabled = true;

  // --- NEW: Visually clear the previous team selection ---
  updateTeamSelectionUI();

  // Render the new question options
  renderQuestion();
}

  state.currentIndex = nextIndex;
  state.selectedOptionIndex = null;
  state.selectedTeamId = null;

  feedbackEl.textContent = "";
  currentSelectionEl.textContent = "None";
  optionSummaryEl.textContent = "None selected.";

  renderQuestion();
}

function renderQuestion() {
  const q = state.questions[state.currentIndex];
  questionTextEl.textContent = q.text;
  questionCounterEl.textContent = `Question ${state.currentIndex + 1} of ${state.questions.length}`;
  roundStatusEl.textContent = `${q.points || DEFAULT_POINTS} points`;
  renderOptions(q);
}

function clearOptionsUI() {
  optionsContainer.innerHTML = "";
}

function renderOptions(q) {
  optionsContainer.innerHTML = "";
  const labels = ["A", "B", "C", "D"];

  q.options.forEach((opt, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "option-btn";
    btn.dataset.index = String(i);

    const labelSpan = document.createElement("span");
    labelSpan.className = "option-label";
    labelSpan.textContent = labels[i];

    const textSpan = document.createElement("span");
    textSpan.className = "option-text";
    textSpan.textContent = opt;

    btn.appendChild(labelSpan);
    btn.appendChild(textSpan);

   btn.addEventListener("click", () => {
      if (!state.quizStarted) return;
      state.selectedOptionIndex = i;
      updateOptionSelectionUI();
      updateCurrentSelectionLabel();
      optionSummaryEl.textContent = `${labels[i]}. ${opt}`;
      
      // OLD CODE: maybeScore(); 
      // NEW CODE: Check if we can enable the submit button
      checkSubmitButtonState(); 
    });

    optionsContainer.appendChild(btn);
  });
}

function updateOptionSelectionUI() {
  const buttons = optionsContainer.querySelectorAll(".option-btn");
  buttons.forEach(btn => {
    const i = Number(btn.dataset.index);
    btn.classList.toggle("selected", i === state.selectedOptionIndex);
    btn.classList.remove("correct", "wrong");
  });
}

// --- TEAM ANSWERS & SCORING -------------------------------------------------

function buildTeamButtons() {
  teamButtonsContainer.innerHTML = "";
  state.teams.forEach(team => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "team-btn";
    btn.dataset.teamId = team.id;
    btn.textContent = team.name;

    // Inside buildTeamButtons() ...
    btn.addEventListener("click", () => {
      state.selectedTeamId = team.id;
      updateTeamSelectionUI();
      updateCurrentSelectionLabel();
      
      // OLD CODE: maybeScore();
      // NEW CODE: Check if we can enable the submit button
      checkSubmitButtonState();
    });
// ... rest of function

    teamButtonsContainer.appendChild(btn);
  });
}

function updateTeamSelectionUI() {
  const buttons = teamButtonsContainer.querySelectorAll(".team-btn");
  buttons.forEach(btn => {
    btn.classList.toggle("selected", btn.dataset.teamId === state.selectedTeamId);
  });
}

function updateCurrentSelectionLabel() {
  let label = "";
  const labels = ["A", "B", "C", "D"];

  if (state.selectedOptionIndex != null) {
    label += `Option ${labels[state.selectedOptionIndex]}`;
  }
  if (state.selectedTeamId) {
    const t = state.teams.find(x => x.id === state.selectedTeamId);
    if (t) {
      label += label ? ` · ${t.name}` : t.name;
    }
  }
  currentSelectionEl.textContent = label || "None";
}

function maybeScore() {
  if (state.selectedOptionIndex == null || !state.selectedTeamId) {
    return;
  }

  const q = state.questions[state.currentIndex];
  const isCorrect = state.selectedOptionIndex === q.correctIndex;
  const team = state.teams.find(t => t.id === state.selectedTeamId);
  const teamId = team.id;

  state.answeredCount[teamId] = (state.answeredCount[teamId] || 0) + 1;

  const optionButtons = optionsContainer.querySelectorAll(".option-btn");

  if (isCorrect) {
    state.scores[teamId] += q.points || DEFAULT_POINTS;
    state.correctCount[teamId] = (state.correctCount[teamId] || 0) + 1;
    feedbackEl.textContent = `${team.name} is correct! +${q.points || DEFAULT_POINTS} points.`;
    speakText(`${team.name} is correct!`);
    optionButtons.forEach(btn => {
      const i = Number(btn.dataset.index);
      if (i === state.selectedOptionIndex) btn.classList.add("correct");
    });
  } else {
    const correctText = q.options[q.correctIndex];
    feedbackEl.textContent = `${team.name} is wrong. Correct answer: ${correctText}.`;
    speakText(`${team.name} is wrong. The correct answer is ${correctText}.`);
    optionButtons.forEach(btn => {
      const i = Number(btn.dataset.index);
      if (i === state.selectedOptionIndex) btn.classList.add("wrong");
      if (i === q.correctIndex) btn.classList.add("correct");
    });
  }

  // Lock options for this question
  optionButtons.forEach(btn => {
    btn.disabled = true;
  });

  renderStandings();
}

// --- STANDINGS TABLE --------------------------------------------------------

function renderStandings() {
  const rows = state.teams
    .map(t => {
      const id = t.id;
      return {
        id,
        name: t.name,
        score: state.scores[id] || 0,
        answered: state.answeredCount[id] || 0,
        correct: state.correctCount[id] || 0
      };
    })
    .sort((a, b) => b.score - a.score);

  standingsBody.innerHTML = "";
  rows.forEach((row, index) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>${row.name}</td>
      <td>${row.score}</td>
      <td>${row.answered}</td>
      <td>${row.correct}</td>
    `;
    standingsBody.appendChild(tr);
  });
}

// --- END QUIZ ---------------------------------------------------------------

function endQuiz() {
  questionTextEl.textContent = "Quiz finished!";
  questionCounterEl.textContent = "All questions completed.";
  roundStatusEl.textContent = "";
  clearOptionsUI();
  feedbackEl.textContent = "You can reset to play again with the same question bank.";
  speakText("The quiz is finished. Thanks for playing!");
  footerStatusEl.textContent = "Quiz finished.";
}

// --- TTS (Web Speech API) ---------------------------------------------------
// Uses native browser speechSynthesis. [web:140][web:148][web:25][web:143]

function readCurrentQuestion() {
  if (state.currentIndex < 0 || !state.questions.length) return;
  const q = state.questions[state.currentIndex];
  const base = `Question ${state.currentIndex + 1}. ${q.text}`;
  const labels = ["A", "B", "C", "D"];
  const optionsText = q.options
    .map((opt, i) => `Option ${labels[i]}: ${opt}.`)
    .join(" ");
  speakText(`${base}. ${optionsText}`);
}

function speakText(text) {
  if (!("speechSynthesis" in window)) {
    console.warn("Web Speech API not supported.");
    return;
  }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1;
  u.pitch = 1;
  window.speechSynthesis.speak(u);
}

// --- BOOTSTRAP --------------------------------------------------------------

initTeams();
footerStatusEl.textContent = "Loading questions from repo CSV...";
loadQuestionsFromRepo().then(() => {
  footerStatusEl.textContent = "Ready. Configure teams and start quiz.";
});

// --- NEW SUBMIT LOGIC -------------------------------------

function checkSubmitButtonState() {
  // Only enable button if both an Option AND a Team are selected
  if (state.selectedOptionIndex !== null && state.selectedTeamId) {
    submitAnswerBtn.disabled = false;
    submitAnswerBtn.classList.remove("ghost-btn"); // Optional visual tweak
  } else {
    submitAnswerBtn.disabled = true;
  }
}

// The click listener for the new button
submitAnswerBtn.addEventListener("click", () => {
  confirmScore();
});

// Renamed from maybeScore to confirmScore to reflect it's manual now
function confirmScore() {
  if (state.selectedOptionIndex == null || !state.selectedTeamId) return;

  const q = state.questions[state.currentIndex];
  const isCorrect = state.selectedOptionIndex === q.correctIndex;
  const team = state.teams.find(t => t.id === state.selectedTeamId);
  const teamId = team.id;

  // 1. Record stats
  state.answeredCount[teamId] = (state.answeredCount[teamId] || 0) + 1;

  const optionButtons = optionsContainer.querySelectorAll(".option-btn");

  // 2. Handle Correct/Wrong Logic
  if (isCorrect) {
    state.scores[teamId] += q.points || DEFAULT_POINTS;
    state.correctCount[teamId] = (state.correctCount[teamId] || 0) + 1;
    feedbackEl.textContent = `${team.name} is correct! +${q.points || DEFAULT_POINTS} points.`;
    speakText(`${team.name} is correct!`);
    
    // Highlight correct button Green
    optionButtons.forEach(btn => {
      const i = Number(btn.dataset.index);
      if (i === state.selectedOptionIndex) btn.classList.add("correct");
    });
  } else {
    const correctText = q.options[q.correctIndex];
    feedbackEl.textContent = `${team.name} is wrong. Correct answer: ${correctText}.`;
    speakText(`${team.name} is wrong. The correct answer is ${correctText}.`);
    
    // Highlight wrong button Red, Correct button Green
    optionButtons.forEach(btn => {
      const i = Number(btn.dataset.index);
      if (i === state.selectedOptionIndex) btn.classList.add("wrong");
      if (i === q.correctIndex) btn.classList.add("correct");
    });
  }

  // 3. Disable controls so they can't submit twice for the same question
  optionButtons.forEach(btn => btn.disabled = true);
  submitAnswerBtn.disabled = true; // Disable submit button after use

  renderStandings();
}
