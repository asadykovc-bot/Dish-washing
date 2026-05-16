const STORAGE_KEY = "dishHabitTimer:v1";

const defaults = {
  baseDuration: 300,
  increment: 10,
  maxDuration: 1200,
  level: 0,
  totalDone: 0,
  lastCompletedAt: null
};

const state = {
  settings: loadSettings(),
  running: false,
  remaining: 0,
  duration: 0,
  deadline: 0,
  timerId: null,
  audioContext: null,
  wakeLock: null,
  soundPlaying: false,
  soundNodes: [],
  soundStopTimer: null,
  soundChecked: false
};

const elements = {
  app: document.querySelector(".app"),
  soundGate: document.getElementById("soundGate"),
  gateSoundButton: document.getElementById("gateSoundButton"),
  beginButton: document.getElementById("beginButton"),
  soundBanner: document.getElementById("soundBanner"),
  testSoundButton: document.getElementById("testSoundButton"),
  wakeLockButton: document.getElementById("wakeLockButton"),
  wakeLockStatus: document.getElementById("wakeLockStatus"),
  sessionLabel: document.getElementById("sessionLabel"),
  timerDisplay: document.getElementById("timerDisplay"),
  progressFill: document.getElementById("progressFill"),
  startButton: document.getElementById("startButton"),
  resetTimerButton: document.getElementById("resetTimerButton"),
  decreaseProgressButton: document.getElementById("decreaseProgressButton"),
  increaseProgressButton: document.getElementById("increaseProgressButton"),
  progressLevel: document.getElementById("progressLevel"),
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
  stopCompletionSoundButton: document.getElementById("stopCompletionSoundButton"),
  completeButton: document.getElementById("completeButton")
};

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    const migrated = { ...defaults, ...saved };
    migrated.level = Number.isFinite(saved.level) ? saved.level : (saved.completed || 0);
    migrated.totalDone = Number.isFinite(saved.totalDone) ? saved.totalDone : (saved.completed || 0);
    migrated.lastCompletedDate = saved.lastCompletedDate || dateKeyFromIso(saved.lastCompletedAt);
    delete migrated.completed;
    return applyMissedDayDecay(migrated);
  } catch {
    return { ...defaults };
  }
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateKeyFromIso(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return localDateKey(date);
}

function dateFromKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function daysBetween(startKey, endKey) {
  const start = dateFromKey(startKey);
  const end = dateFromKey(endKey);
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.round((end - start) / millisecondsPerDay);
}

function applyMissedDayDecay(settings) {
  if (!settings.lastCompletedDate) {
    return settings;
  }

  const today = localDateKey();
  const gap = daysBetween(settings.lastCompletedDate, today);
  if (gap <= 1) {
    return settings;
  }

  const missedDays = gap - 1;
  settings.level = Math.max(0, settings.level - missedDays);

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  settings.lastCompletedDate = localDateKey(yesterday);
  saveDeferred(settings);
  return settings;
}

function saveDeferred(settings) {
  window.setTimeout(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, 0);
}

function currentDuration() {
  const effectiveLevel = state.settings.lastCompletedDate === localDateKey()
    ? Math.max(0, state.settings.level - 1)
    : state.settings.level;
  const grown = state.settings.baseDuration + effectiveLevel * state.settings.increment;
  return Math.min(grown, state.settings.maxDuration);
}

function nextActiveDayDuration() {
  const today = localDateKey();
  const nextLevel = state.settings.lastCompletedDate === today
    ? state.settings.level
    : state.settings.level + 1;
  const grown = state.settings.baseDuration + nextLevel * state.settings.increment;
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
  elements.startButton.textContent = "Start cleaning";
  elements.resetTimerButton.hidden = true;
  elements.progressLevel.textContent = String(state.settings.level);
  elements.nextDuration.textContent = formatTime(nextActiveDayDuration());
  elements.totalDone.textContent = String(state.settings.totalDone);
  elements.baseMinutes.value = String(Math.floor(state.settings.baseDuration / 60));
  elements.baseSeconds.value = String(state.settings.baseDuration % 60);
  elements.increment.value = String(state.settings.increment);
  elements.maxDuration.value = String(state.settings.maxDuration);
}

function renderSoundControls() {
  const label = state.soundPlaying ? "Stop signal" : "Play signal";
  elements.gateSoundButton.textContent = label;
  elements.testSoundButton.textContent = label;
  elements.beginButton.disabled = !state.soundChecked;
  elements.stopCompletionSoundButton.hidden = !state.soundPlaying;
}

function renderWakeLockStatus() {
  const supported = "wakeLock" in navigator;
  if (!supported) {
    elements.wakeLockStatus.textContent = "Screen wake lock is not supported.";
    elements.wakeLockButton.textContent = "Not supported";
    elements.wakeLockButton.disabled = true;
    return;
  }

  const active = state.wakeLock !== null;
  elements.wakeLockStatus.textContent = active ? "Screen awake is on." : "Screen awake is off.";
  elements.wakeLockButton.textContent = active ? "Screen on" : "Keep screen on";
  elements.wakeLockButton.disabled = active;
}

function enterApp() {
  stopSound();
  elements.soundGate.hidden = true;
  elements.app.removeAttribute("aria-hidden");
  requestWakeLock();
}

function requireSoundCheck() {
  stopSound();
  state.audioContext = null;
  state.soundChecked = false;
  elements.beginButton.disabled = true;
  elements.soundGate.hidden = false;
  elements.app.setAttribute("aria-hidden", "true");
  renderSoundControls();
}

function renderRunning() {
  elements.timerDisplay.textContent = formatTime(state.remaining);
  const elapsed = state.duration - state.remaining;
  const progress = state.duration === 0 ? 100 : Math.min(100, Math.max(0, (elapsed / state.duration) * 100));
  elements.progressFill.style.width = `${progress}%`;
}

function startTimer() {
  unlockAudio();
  requestWakeLock();
  state.running = true;
  state.duration = currentDuration();
  state.remaining = state.duration;
  state.deadline = Date.now() + state.duration * 1000;
  elements.sessionLabel.textContent = "Cleaning kitchen";
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
  elements.sessionLabel.textContent = "Cleaning kitchen";
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
  const today = localDateKey();
  if (state.settings.lastCompletedDate !== today) {
    state.settings.level += 1;
  }
  state.settings.totalDone += 1;
  state.settings.lastCompletedDate = today;
  state.settings.lastCompletedAt = new Date().toISOString();
  saveSettings();
  elements.completedNextDuration.textContent = formatTime(nextActiveDayDuration());
  elements.completionDialog.hidden = false;
  renderSoundControls();
  elements.stopCompletionSoundButton.focus();
}

async function unlockAudio() {
  state.audioContext = null;

  if (!state.audioContext) {
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  if (state.audioContext.state === "suspended") {
    await state.audioContext.resume();
  }
}

async function notifyDone() {
  stopSound();

  if ("vibrate" in navigator) {
    navigator.vibrate([500, 180, 500, 180, 700, 250, 900]);
  }

  await playDoneSound();
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator) || state.wakeLock) {
    renderWakeLockStatus();
    return;
  }

  try {
    state.wakeLock = await navigator.wakeLock.request("screen");
    state.wakeLock.addEventListener("release", () => {
      state.wakeLock = null;
      renderWakeLockStatus();
    }, { once: true });
  } catch {
    state.wakeLock = null;
  }

  renderWakeLockStatus();
}

async function playDoneSound() {
  try {
    await unlockAudio();
  } catch {
    return;
  }

  const context = state.audioContext;
  const now = context.currentTime + 0.04;
  const masterGain = context.createGain();
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.setValueAtTime(-24, now);
  compressor.knee.setValueAtTime(18, now);
  compressor.ratio.setValueAtTime(8, now);
  compressor.attack.setValueAtTime(0.003, now);
  compressor.release.setValueAtTime(0.2, now);
  masterGain.gain.setValueAtTime(0.0001, now);
  masterGain.gain.exponentialRampToValueAtTime(0.95, now + 0.04);
  masterGain.gain.setValueAtTime(0.95, now + 5.8);
  masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 6.2);
  masterGain.connect(compressor).connect(context.destination);
  state.soundPlaying = true;
  state.soundNodes = [masterGain, compressor];
  state.soundChecked = true;
  renderSoundControls();

  const pattern = [
    1568, 1175, 1568, 1175,
    1760, 1319, 1760, 1319,
    1976, 1480, 1976, 1480,
    2093, 1568, 2093, 1568,
    1976, 1480, 1976, 1480,
    1760, 1319, 1760, 1319
  ];

  pattern.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = now + index * 0.24;
    oscillator.type = index % 2 === 0 ? "square" : "sawtooth";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.6, start + 0.015);
    gain.gain.setValueAtTime(0.6, start + 0.16);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
    oscillator.connect(gain).connect(masterGain);
    state.soundNodes.push(oscillator, gain);
    oscillator.start(start);
    oscillator.stop(start + 0.24);
  });

  state.soundStopTimer = window.setTimeout(() => {
    state.soundPlaying = false;
    state.soundNodes = [];
    state.soundStopTimer = null;
    renderSoundControls();
  }, 6300);
}

function stopSound() {
  if ("vibrate" in navigator) {
    navigator.vibrate(0);
  }

  if (state.soundStopTimer !== null) {
    window.clearTimeout(state.soundStopTimer);
    state.soundStopTimer = null;
  }

  state.soundNodes.forEach((node) => {
    try {
      if (typeof node.stop === "function") {
        node.stop();
      }
      if (typeof node.disconnect === "function") {
        node.disconnect();
      }
    } catch {
      // Already stopped or disconnected.
    }
  });

  state.soundNodes = [];
  state.soundPlaying = false;
  renderSoundControls();
}

function toggleSound() {
  if (state.soundPlaying) {
    stopSound();
  } else {
    notifyDone();
  }
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

function adjustProgressLevel(delta) {
  state.settings.level = Math.max(0, state.settings.level + delta);
  state.settings.lastCompletedAt = null;
  state.settings.lastCompletedDate = null;
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

elements.gateSoundButton.addEventListener("click", toggleSound);
elements.beginButton.addEventListener("click", enterApp);
elements.testSoundButton.addEventListener("click", toggleSound);
elements.wakeLockButton.addEventListener("click", requestWakeLock);
elements.decreaseProgressButton.addEventListener("click", () => adjustProgressLevel(-1));
elements.increaseProgressButton.addEventListener("click", () => adjustProgressLevel(1));

elements.resetTimerButton.addEventListener("click", resetTimer);

elements.completeButton.addEventListener("click", () => {
  stopSound();
  elements.completionDialog.hidden = true;
  renderIdle();
});

elements.stopCompletionSoundButton.addEventListener("click", stopSound);

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
  const confirmed = window.confirm("Reset progress and return the timer to the starting time?");
  if (!confirmed) {
    return;
  }

  state.settings.level = 0;
  state.settings.totalDone = 0;
  state.settings.lastCompletedAt = null;
  state.settings.lastCompletedDate = null;
  saveSettings();
  resetTimer();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js");
  });
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    requestWakeLock();
    requireSoundCheck();
  }
});

window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    requestWakeLock();
    requireSoundCheck();
  }
});

elements.app.setAttribute("aria-hidden", "true");
renderIdle();
renderSoundControls();
renderWakeLockStatus();
