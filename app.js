const STORAGE_KEY = "dishHabitTimer:v1";

const defaults = {
  baseDuration: 300,
  increment: 10,
  maxDuration: 1200,
  completed: 0,
  lastCompletedAt: null
};

const state = {
  settings: loadSettings(),
  running: false,
  remaining: 0,
  duration: 0,
  deadline: 0,
  timerId: null,
  audioContext: null
};

const elements = {
  soundBanner: document.getElementById("soundBanner"),
  testSoundButton: document.getElementById("testSoundButton"),
  sessionLabel: document.getElementById("sessionLabel"),
  timerDisplay: document.getElementById("timerDisplay"),
  progressFill: document.getElementById("progressFill"),
  startButton: document.getElementById("startButton"),
  resetTimerButton: document.getElementById("resetTimerButton"),
  nextDuration: document.getElementById("nextDuration"),
  totalDone: document.getElementById("totalDone"),
  settingsToggle: document.getElementById("settingsToggle"),
  settingsPanel: document.getElementById("settingsPanel"),
  baseMinutes: document.getElementById("baseMinutes"),
  baseSeconds: document.getElementById("baseSeconds"),
  increment: document.getElementById("increment"),
  maxDuration: document.getElementById("maxDuration"),
  resetProgressButton: document.getElementById("resetProgressButton"),
  completionDialog: document.getElementById("completionDialog"),
  completedNextDuration: document.getElementById("completedNextDuration"),
  completeButton: document.getElementById("completeButton")
};

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return { ...defaults, ...saved };
  } catch {
    return { ...defaults };
  }
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
}

function currentDuration() {
  const grown = state.settings.baseDuration + state.settings.completed * state.settings.increment;
  return Math.min(grown, state.settings.maxDuration);
}

function nextDurationAfterCompletion() {
  const grown = state.settings.baseDuration + (state.settings.completed + 1) * state.settings.increment;
  return Math.min(grown, state.settings.maxDuration);
}

function formatTime(totalSeconds) {
  const seconds = Math.max(0, Math.ceil(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function renderIdle() {
  const duration = currentDuration();
  state.duration = duration;
  state.remaining = duration;
  elements.sessionLabel.textContent = "Today";
  elements.timerDisplay.textContent = formatTime(duration);
  elements.progressFill.style.width = "0%";
  elements.startButton.textContent = "Start washing dishes";
  elements.resetTimerButton.hidden = true;
  elements.nextDuration.textContent = formatTime(nextDurationAfterCompletion());
  elements.totalDone.textContent = String(state.settings.completed);
  elements.baseMinutes.value = String(Math.floor(state.settings.baseDuration / 60));
  elements.baseSeconds.value = String(state.settings.baseDuration % 60);
  elements.increment.value = String(state.settings.increment);
  elements.maxDuration.value = String(state.settings.maxDuration);
}

function renderRunning() {
  elements.timerDisplay.textContent = formatTime(state.remaining);
  const elapsed = state.duration - state.remaining;
  const progress = state.duration === 0 ? 100 : Math.min(100, Math.max(0, (elapsed / state.duration) * 100));
  elements.progressFill.style.width = `${progress}%`;
}

function startTimer() {
  unlockAudio();
  state.running = true;
  state.duration = currentDuration();
  state.remaining = state.duration;
  state.deadline = Date.now() + state.duration * 1000;
  elements.sessionLabel.textContent = "Washing dishes";
  elements.startButton.textContent = "Pause";
  elements.resetTimerButton.hidden = false;
  tick();
  state.timerId = window.setInterval(tick, 250);
}

function pauseTimer() {
  state.running = false;
  window.clearInterval(state.timerId);
  state.timerId = null;
  elements.sessionLabel.textContent = "Paused";
  elements.startButton.textContent = "Continue";
}

function resumeTimer() {
  unlockAudio();
  state.running = true;
  state.deadline = Date.now() + state.remaining * 1000;
  elements.sessionLabel.textContent = "Washing dishes";
  elements.startButton.textContent = "Pause";
  tick();
  state.timerId = window.setInterval(tick, 250);
}

function resetTimer() {
  window.clearInterval(state.timerId);
  state.timerId = null;
  state.running = false;
  renderIdle();
}

function tick() {
  state.remaining = Math.max(0, (state.deadline - Date.now()) / 1000);
  renderRunning();

  if (state.remaining <= 0) {
    finishTimer();
  }
}

function finishTimer() {
  window.clearInterval(state.timerId);
  state.timerId = null;
  state.running = false;
  state.remaining = 0;
  renderRunning();
  notifyDone();
  state.settings.completed += 1;
  state.settings.lastCompletedAt = new Date().toISOString();
  saveSettings();
  elements.completedNextDuration.textContent = formatTime(currentDuration());
  elements.completionDialog.hidden = false;
  elements.completeButton.focus();
}

async function unlockAudio() {
  if (!state.audioContext) {
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  if (state.audioContext.state === "suspended") {
    await state.audioContext.resume();
  }
}

async function notifyDone() {
  if ("vibrate" in navigator) {
    navigator.vibrate([250, 120, 250]);
  }

  await playDoneSound();
}

async function playDoneSound() {
  try {
    await unlockAudio();
  } catch {
    return;
  }

  const context = state.audioContext;
  const now = context.currentTime + 0.04;
  [523, 659, 784, 1047].forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = now + index * 0.2;
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.35, start + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.2);
  });
}

function normalizeBaseDuration() {
  const minutes = Math.max(0, Number.parseInt(elements.baseMinutes.value, 10) || 0);
  const seconds = Math.min(59, Math.max(0, Number.parseInt(elements.baseSeconds.value, 10) || 0));
  return minutes * 60 + seconds;
}

function updateBaseDuration() {
  state.settings.baseDuration = Math.max(1, normalizeBaseDuration());

  if (state.settings.baseDuration > state.settings.maxDuration) {
    state.settings.maxDuration = state.settings.baseDuration;
  }

  saveSettings();
  if (!state.running && state.timerId === null) {
    renderIdle();
  }
}

function updateSetting(key, value) {
  state.settings[key] = Number(value);

  if (state.settings.baseDuration > state.settings.maxDuration) {
    state.settings.maxDuration = state.settings.baseDuration;
  }

  saveSettings();
  if (!state.running && state.timerId === null) {
    renderIdle();
  }
}

elements.startButton.addEventListener("click", () => {
  if (state.running) {
    pauseTimer();
  } else if (state.timerId === null && state.remaining === currentDuration()) {
    startTimer();
  } else {
    resumeTimer();
  }
});

elements.testSoundButton.addEventListener("click", notifyDone);

elements.resetTimerButton.addEventListener("click", resetTimer);

elements.completeButton.addEventListener("click", () => {
  elements.completionDialog.hidden = true;
  renderIdle();
});

elements.settingsToggle.addEventListener("click", () => {
  const willOpen = elements.settingsPanel.hidden;
  elements.settingsPanel.hidden = !willOpen;
  elements.settingsToggle.setAttribute("aria-expanded", String(willOpen));
});

elements.baseMinutes.addEventListener("change", updateBaseDuration);
elements.baseSeconds.addEventListener("change", updateBaseDuration);
elements.increment.addEventListener("change", (event) => updateSetting("increment", event.target.value));
elements.maxDuration.addEventListener("change", (event) => updateSetting("maxDuration", event.target.value));
elements.resetProgressButton.addEventListener("click", () => {
  const confirmed = window.confirm("Reset completed sessions and return the timer to the starting time?");
  if (!confirmed) {
    return;
  }

  state.settings.completed = 0;
  state.settings.lastCompletedAt = null;
  saveSettings();
  resetTimer();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js");
  });
}

renderIdle();
