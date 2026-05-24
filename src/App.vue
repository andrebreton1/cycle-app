<script setup>
import { ref, computed, onMounted } from 'vue'
import { supabase } from '@/lib/supabase.js'

// ─── Auth ────────────────────────────────────────────────────────────────────
const session = ref(null)
const authEmail = ref('')
const authPassword = ref('')
const authError = ref('')
const authLoading = ref(false)

async function signIn() {
  authError.value = ''
  authLoading.value = true
  const { data, error } = await supabase.auth.signInWithPassword({
    email: authEmail.value.trim(),
    password: authPassword.value,
  })
  authLoading.value = false
  if (error) {
    authError.value = 'Invalid email or password.'
  } else {
    session.value = data.session
    await loadCycles()
  }
}

async function signOut() {
  await supabase.auth.signOut()
  session.value = null
  cycles.value = []
  showSettings.value = false
}

// ─── Constants ───────────────────────────────────────────────────────────────
const CYCLE_MIN = 23
const CYCLE_MAX = 40
const CYCLE_DEFAULT = 28
const PERIOD_LENGTH = 5
const OVULATION_LENGTH = 3
const LUTEAL_LENGTH = 14
const FIXED_PHASE_DAYS = PERIOD_LENGTH + OVULATION_LENGTH + LUTEAL_LENGTH
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

const PHASES = [
  {
    id: 'period',
    emoji: '🩸',
    name: 'Period',
    color: '#FFD6D6',
    textColor: '#B84A4A',
    description: 'Your body is working hard, remember you deserve comfort and to rest a lot. Drink this water!',
  },
  {
    id: 'follicular',
    emoji: '🌱',
    name: 'Follicular phase',
    color: '#FFF3CC',
    textColor: '#8B6F1F',
    description: "It's spring, feel your energy rising up!",
  },
  {
    id: 'ovulation',
    emoji: '✨',
    name: 'Ovulation',
    color: '#D6F5E3',
    textColor: '#2E7A52',
    description: "You're shining 🔥 Peak libido, stay hydrated",
  },
  {
    id: 'luteal',
    emoji: '🌙',
    name: 'Luteal phase',
    color: '#EDE0FF',
    textColor: '#6B4D96',
    description: "It's fall, trust your intuitions and take care of your mind. Yoga might help!",
  },
]

// ─── State ───────────────────────────────────────────────────────────────────
const showSettings = ref(false)
const cycles = ref([])
const cycleLength = ref(CYCLE_DEFAULT)
const currentMonth = ref(new Date().getMonth())
const currentYear = ref(new Date().getFullYear())
const loading = ref(true)
const saving = ref(false)
const savingDuration = ref(false)
const deletingId = ref(null)
const dialogMode = ref(null)
const deleteTargetId = ref(null)
const popover = ref(null)
const toast = ref('')

const today = new Date()
const todayStr = toDateStr(today)

// ─── Computed ─────────────────────────────────────────────────────────────────
const latestCycle = computed(() => cycles.value[0] ?? null)

const monthLabel = computed(() =>
  new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(
    new Date(currentYear.value, currentMonth.value, 1),
  ),
)

const historyEntries = computed(() =>
  cycles.value.map((entry, index) => ({
    ...entry,
    dateFormatted: formatDateEn(entry.date_debut),
    observedDuration:
      index === 0 ? null : daysBetween(entry.date_debut, cycles.value[index - 1].date_debut),
  })),
)

const calendarDays = computed(() => {
  const year = currentYear.value
  const month = currentMonth.value
  const first = new Date(year, month, 1)
  const last = new Date(year, month + 1, 0)
  const padStart = (first.getDay() + 6) % 7
  const days = []
  for (let i = padStart; i > 0; i--) {
    days.push(buildCell(new Date(year, month, 1 - i), false))
  }
  for (let d = 1; d <= last.getDate(); d++) {
    days.push(buildCell(new Date(year, month, d), true))
  }
  const remaining = (7 - (days.length % 7)) % 7
  for (let i = 1; i <= remaining; i++) {
    days.push(buildCell(new Date(year, month + 1, i), false))
  }
  return days
})

// ─── Lifecycle ────────────────────────────────────────────────────────────────
onMounted(async () => {
  const { data } = await supabase.auth.getSession()
  session.value = data.session ?? null
  if (session.value) await loadCycles()

  supabase.auth.onAuthStateChange((_event, s) => {
    session.value = s
    if (s) loadCycles()
  })

  // Temps réel
  supabase
    .channel('cycles-changes')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'cycles' },
      () => { loadCycles() }
    )
    .subscribe()
})

// ─── Helpers ─────────────────────────────────────────────────────────────────
function clampCycleLength(value) {
  const n = Number(value)
  if (Number.isNaN(n)) return CYCLE_DEFAULT
  return Math.min(CYCLE_MAX, Math.max(CYCLE_MIN, Math.round(n)))
}

function toDateStr(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function parseDateStr(str) {
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function formatDateEn(dateStr) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  }).format(parseDateStr(dateStr))
}

function daysBetween(startStr, endStr) {
  const ms = parseDateStr(endStr).getTime() - parseDateStr(startStr).getTime()
  return Math.round(ms / 86_400_000)
}

function syncCycleLengthFromLatest() {
  const latest = latestCycle.value
  if (latest?.duree_cycle != null) {
    cycleLength.value = clampCycleLength(latest.duree_cycle)
  } else if (!latest) {
    cycleLength.value = CYCLE_DEFAULT
  }
}

// ─── Data ─────────────────────────────────────────────────────────────────────
async function loadCycles() {
  loading.value = true
  const { data, error } = await supabase
    .from('cycles')
    .select('id, user_id, date_debut, duree_cycle')
    .order('date_debut', { ascending: false })
  cycles.value = !error && data ? data : []
  syncCycleLengthFromLatest()
  loading.value = false
}

// ─── Calendar logic ───────────────────────────────────────────────────────────
function getCycleDay(dateStr) {
  const debut = latestCycle.value?.date_debut
  if (!debut) return null
  const diff = daysBetween(debut, dateStr)
  if (diff < 0) return null
  return (diff % cycleLength.value) + 1
}

function getPhaseBoundaries(cycleLen = cycleLength.value) {
  const follicularDuration = cycleLen - FIXED_PHASE_DAYS
  const periodEnd = PERIOD_LENGTH
  const follicularEnd = periodEnd + follicularDuration
  const ovulationEnd = follicularEnd + OVULATION_LENGTH
  return { periodEnd, follicularEnd, ovulationEnd, lutealEnd: cycleLen }
}

function getPhase(cycleDay) {
  if (!cycleDay || cycleDay < 1) return null
  const { periodEnd, follicularEnd, ovulationEnd, lutealEnd } = getPhaseBoundaries()
  if (cycleDay > lutealEnd) return null
  if (cycleDay <= periodEnd) return PHASES[0]
  if (cycleDay <= follicularEnd) return PHASES[1]
  if (cycleDay <= ovulationEnd) return PHASES[2]
  if (cycleDay <= lutealEnd) return PHASES[3]
  return null
}

function buildCell(date, inMonth) {
  const dateStr = toDateStr(date)
  const cycleDay = getCycleDay(dateStr)
  const phase = getPhase(cycleDay)
  return {
    dateStr, day: date.getDate(), inMonth,
    isToday: dateStr === todayStr, cycleDay, phase,
  }
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function prevMonth() {
  if (currentMonth.value === 0) { currentMonth.value = 11; currentYear.value -= 1 }
  else { currentMonth.value -= 1 }
  closePopover()
}

function nextMonth() {
  if (currentMonth.value === 11) { currentMonth.value = 0; currentYear.value += 1 }
  else { currentMonth.value += 1 }
  closePopover()
}

function openDay(cell) {
  if (!cell.inMonth || !cell.phase) return
  popover.value = { dateStr: cell.dateStr, cycleDay: cell.cycleDay, phase: cell.phase }
}

function closePopover() { popover.value = null }
function openSettings() { closePopover(); closeDialog(); showSettings.value = true }
function backToCalendar() { closePopover(); closeDialog(); showSettings.value = false }
function openPeriodDialog() { dialogMode.value = 'period' }
function openDeleteDialog(id) { deleteTargetId.value = id; dialogMode.value = 'delete' }
function closeDialog() { dialogMode.value = null; deleteTargetId.value = null }

// ─── Actions ──────────────────────────────────────────────────────────────────
async function saveCycleDuration(value) {
  const clamped = clampCycleLength(value)
  cycleLength.value = clamped
  const latestId = latestCycle.value?.id
  if (!latestId) return
  savingDuration.value = true
  const { error } = await supabase.from('cycles').update({ duree_cycle: clamped }).eq('id', latestId)
  savingDuration.value = false
  if (error) { showToast(`Error: ${error.message}`); return }
  if (cycles.value[0]) cycles.value[0] = { ...cycles.value[0], duree_cycle: clamped }
}

function onCycleLengthInput(event) { saveCycleDuration(event.target.value) }

async function confirmPeriodStart() {
  saving.value = true
  const payload = { date_debut: todayStr, duree_cycle: cycleLength.value }
  const { error } = await supabase.from('cycles').insert(payload)
  saving.value = false
  closeDialog()
  if (error) { showToast(`Error: ${error.message}`); return }
  await loadCycles()
  showToast('Period saved for today.')
  closePopover()
}

async function confirmDelete() {
  const id = deleteTargetId.value
  if (!id) return
  deletingId.value = id
  const { error } = await supabase.from('cycles').delete().eq('id', id)
  deletingId.value = null
  closeDialog()
  if (error) { showToast(`Error: ${error.message}`); return }
  await loadCycles()
  showToast('Entry deleted.')
}

function showToast(message) {
  toast.value = message
  setTimeout(() => { toast.value = '' }, 3500)
}
</script>

<template>
  <div class="app" :class="{ 'app--settings': showSettings }">

    <!-- ── Login screen ─────────────────────────────────────────────────── -->
    <template v-if="!session">
      <div class="login-view">
        <p class="logo" aria-label="moon bloom">
          m<span class="logo__accent">oo</span>n bl<span class="logo__accent">oo</span>m
        </p>
        <p class="login-subtitle">Sign in to continue</p>

        <div class="login-form">
          <input
            v-model="authEmail"
            type="email"
            placeholder="Email"
            class="login-input"
            autocomplete="email"
            @keyup.enter="signIn"
          />
          <input
            v-model="authPassword"
            type="password"
            placeholder="Password"
            class="login-input"
            autocomplete="current-password"
            @keyup.enter="signIn"
          />
          <p v-if="authError" class="login-error">{{ authError }}</p>
          <button type="button" class="btn btn--primary login-btn" :disabled="authLoading" @click="signIn">
            {{ authLoading ? 'Signing in…' : 'Sign in' }}
          </button>
        </div>
      </div>
    </template>

    <!-- ── App (authenticated) ──────────────────────────────────────────── -->
    <template v-else>

      <!-- Calendar view -->
      <template v-if="!showSettings">
        <div class="calendar-view">
          <header class="header-top">
  <div class="header-top__text">
    <p class="logo" aria-label="moon bloom">
      m<span class="logo__accent">oo</span>n bl<span class="logo__accent">oo</span>m
    </p>
    <p class="logo-sub">cycle tracker</p>
  </div>
  <button type="button" class="icon-btn" aria-label="Settings" @click="openSettings">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" stroke-width="1.75"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" stroke="currentColor" stroke-width="1.75"/>
    </svg>
  </button>
</header>

        

          <section class="calendar card" aria-label="Monthly calendar">
            <div class="month-nav">
              <button type="button" class="nav-btn" aria-label="Previous month" @click="prevMonth">‹</button>
              <h2 class="month-nav__label">{{ monthLabel }}</h2>
              <button type="button" class="nav-btn" aria-label="Next month" @click="nextMonth">›</button>
            </div>

            <div class="weekdays">
              <span v-for="(label, i) in WEEKDAYS" :key="i" class="weekday">{{ label }}</span>
            </div>

            <div class="grid">
              <button
                v-for="cell in calendarDays"
                :key="cell.dateStr + String(cell.inMonth)"
                type="button"
                class="day"
                :class="{
                  'day--outside': !cell.inMonth,
                  'day--today': cell.isToday && cell.inMonth,
                  'day--empty': cell.inMonth && !cell.phase,
                }"
                :style="cell.phase && cell.inMonth ? { backgroundColor: cell.phase.color, color: cell.phase.textColor } : undefined"
                :disabled="!cell.inMonth || !cell.phase"
                @click.stop="openDay(cell)"
              >
                <span class="day__num">{{ cell.day }}</span>
                <span v-if="cell.phase && cell.inMonth" class="day__emoji" aria-hidden="true">{{ cell.phase.emoji }}</span>
              </button>
            </div>
          </section>

          <button type="button" class="fab" @click="openPeriodDialog">
            My period started today
          </button>

          <div v-if="popover" class="popover card" role="dialog" aria-labelledby="popover-title" @click.stop>
            <button type="button" class="popover__close" aria-label="Close" @click="closePopover">×</button>
            <h3 id="popover-title" class="popover__title">{{ popover.phase.name }}</h3>
            <p class="popover__meta">Day {{ popover.cycleDay }} of {{ cycleLength }} days</p>
            <p class="popover__desc">{{ popover.phase.description }}</p>
          </div>
        </div>
      </template>

      <!-- Settings view -->
      <template v-else>
        <header class="header card">
          <button type="button" class="icon-btn" aria-label="Back to calendar" @click="backToCalendar">‹</button>
          <h1 class="header__title header__title--center">Settings</h1>
          <span class="header__spacer" aria-hidden="true" />
        </header>

        <section class="settings-panel card">
          <label class="settings-panel__label" for="cycle-range">Cycle length</label>
          <div class="cycle-display">
            <span class="cycle-display__value">{{ cycleLength }}</span>
            <span class="cycle-display__unit">days</span>
          </div>
          <div class="slider-block">
            <input
              id="cycle-range"
              type="range"
              class="cycle-range"
              :min="CYCLE_MIN"
              :max="CYCLE_MAX"
              :value="cycleLength"
              :disabled="!latestCycle"
              :style="{ '--pct': ((cycleLength - CYCLE_MIN) / (CYCLE_MAX - CYCLE_MIN)) * 100 + '%' }"
              @input="onCycleLengthInput"
            />
            <div class="slider-block__ticks">
              <span>{{ CYCLE_MIN }}</span>
              <span>{{ CYCLE_MAX }}</span>
            </div>
          </div>
          <p v-if="!latestCycle" class="settings-note">Log a period first to adjust length.</p>
          <p v-else-if="savingDuration" class="settings-note">Saving…</p>
        </section>

        <section class="history card">
          <h2 class="history__title">History of cycles</h2>
          <p v-if="!loading && historyEntries.length === 0" class="history__empty">No entries yet.</p>
          <ul v-else class="history__list">
            <li v-for="entry in historyEntries" :key="entry.id" class="history__item">
              <div class="history__info">
                <span class="history__date">{{ entry.dateFormatted }}</span>
                <span v-if="entry.observedDuration != null" class="history__duration">{{ entry.observedDuration }} days</span>
                <span v-else class="history__duration history__duration--active">In progress</span>
              </div>
              <button type="button" class="history__delete" aria-label="Delete entry" :disabled="deletingId === entry.id" @click="openDeleteDialog(entry.id)">🗑️</button>
            </li>
          </ul>
        </section>

        <!-- Sign out -->
        <p class="love-note">for eli from lucas, with love </p>
        <button type="button" class="signout-btn" @click="signOut">Sign out</button>
      </template>

    </template>

    <!-- ── Global overlays ──────────────────────────────────────────────── -->
    <p v-if="toast" class="toast" role="status">{{ toast }}</p>

    <div v-if="dialogMode" class="dialog-backdrop" @click.self="closeDialog">
      <div v-if="dialogMode === 'period'" class="dialog card" role="alertdialog" @click.stop>
        <h3>Are you sure?</h3>
        <p>Save today ({{ todayStr }}) as the start of your period?</p>
        <div class="dialog__actions">
          <button type="button" class="btn btn--ghost" :disabled="saving" @click="closeDialog">Cancel</button>
          <button type="button" class="btn btn--primary" :disabled="saving" @click="confirmPeriodStart">{{ saving ? 'Saving…' : 'Confirm' }}</button>
        </div>
      </div>
      <div v-else-if="dialogMode === 'delete'" class="dialog card" role="alertdialog" @click.stop>
        <h3>Delete this entry?</h3>
        <p>This action cannot be undone.</p>
        <div class="dialog__actions">
          <button type="button" class="btn btn--ghost" :disabled="!!deletingId" @click="closeDialog">Cancel</button>
          <button type="button" class="btn btn--primary" :disabled="!!deletingId" @click="confirmDelete">{{ deletingId ? 'Deleting…' : 'Confirm' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app {
  --bg: #faf7f2;
  --surface: #ffffff;
  --text: #4a4a5a;
  --muted: #8e8e9a;
  --accent: #f48fb1;
  --accent-dark: #e5738a;
  --shadow: 0 2px 12px rgb(0 0 0 / 6%);
  --day-h: 52px;
  --fab-h: 3.25rem;
  --fab-gap: 24px;
  --safe-b: env(safe-area-inset-bottom, 0px);
  --safe-t: env(safe-area-inset-top, 0px);

  max-width: 430px;
  margin: 0 auto;
  height: 100dvh;
  max-height: 100dvh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 0.5rem 0.75rem;
  padding-top: calc(0.5rem + var(--safe-t));
  padding-bottom: calc(var(--fab-h) + var(--fab-gap) + var(--safe-b) + 0.5rem);
  background: var(--bg);
  font-family: 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif;
  color: var(--text);
  box-sizing: border-box;
}

.love-note {
  text-align: right;
  font-size: 0.75rem;
  color: #c9a8c0;
  font-style: italic;
  margin: 0.5rem 0;
  letter-spacing: 0.03em;
}

.header-top {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 0.5rem 0.25rem 2.5rem;
  flex-shrink: 0;
  position: relative;
}

.header-top__text {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.logo-sub {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 400;
  letter-spacing: 10px;
  color: #3d3d4a;
  text-transform: uppercase;
  text-align: center;
  padding-left: 6px;
}


.app--settings {
  overflow-y: auto;
  padding-top: calc(2rem + var(--safe-t));
  padding-bottom: calc(3rem + var(--safe-b));
}

*, *::before, *::after { box-sizing: border-box; }

.card {
  background: var(--surface);
  border-radius: 14px;
  box-shadow: var(--shadow);
}

/* ── Login ── */
.login-view {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: 0.5rem;
  padding: 2rem 0;
}

.login-subtitle {
  margin: 0 0 1.5rem;
  font-size: 0.9rem;
  color: var(--muted);
}

.login-form {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.login-input {
  width: 100%;
  padding: 0.85rem 1rem;
  border: 1.5px solid #e8e0ee;
  border-radius: 12px;
  font-size: 1rem;
  background: var(--surface);
  color: var(--text);
  outline: none;
  transition: border-color 0.15s;
}

.login-input:focus { border-color: var(--accent); }

.login-error {
  margin: 0;
  font-size: 0.85rem;
  color: #c0392b;
  text-align: center;
}

.login-btn {
  width: 100%;
  padding: 0.9rem;
  font-size: 1rem;
  margin-top: 0.25rem;
}

/* ── Calendar view ── */
.calendar-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding-top: 32px;
}

.logo {
  margin: 0.5rem 0 0.25rem;
  text-align: center;
  font-family: Georgia, 'Times New Roman', Times, serif;
  font-size: 2.8rem;
  font-weight: 400;
  letter-spacing: 0.04em;
  line-height: 1.15;
  color: #3d3d3d;
  flex-shrink: 0;
}

.logo__accent { color: #e8a0a0; }

.header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  flex-shrink: 0;
  margin-bottom: 0.5rem;
}

.header__title {
  flex: 1;
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
  color: #3d3d4a;
}

.header__title--sub { font-size: 0.85rem; font-weight: 500; color: var(--muted); }
.header__title--center { text-align: center; }
.header__spacer { width: 2.5rem; flex-shrink: 0; }

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  flex-shrink: 0;
  border: none;
  border-radius: 50%;
  background: #f5f0f8;
  color: #8b6b9e;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.icon-btn:first-child { font-size: 1.5rem; font-weight: 300; line-height: 1; }

.header-top .icon-btn {
  position: absolute;
  right: 0.25rem;
  top: -1.75rem;
  transform: none;
}

.status { margin: 0 0 0.5rem; padding: 0 0.25rem; font-size: 0.8rem; color: var(--muted); flex-shrink: 0; }
.status--hint { color: #b08bb8; }

.calendar { height: auto; display: flex; flex-direction: column; padding: 16px; }

.month-nav {
  display: grid;
  grid-template-columns: 2.75rem 1fr 2.75rem;
  align-items: center;
  flex-shrink: 0;
  margin-bottom: 0.5rem;
}

.month-nav__label { margin: 0; font-size: 1rem; font-weight: 600; text-align: center; color: #3d3d4a; }

.nav-btn {
  width: 2.75rem;
  height: 2.75rem;
  border: none;
  border-radius: 50%;
  background: var(--bg);
  color: var(--accent-dark);
  font-size: 1.75rem;
  font-weight: 300;
  line-height: 1;
  cursor: pointer;
  box-shadow: 0 1px 3px rgb(0 0 0 / 8%);
}

.weekdays { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; flex-shrink: 0; margin-bottom: 4px; }
.weekday { text-align: center; font-size: 0.65rem; font-weight: 600; color: var(--muted); }

.grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  grid-template-rows: repeat(6, var(--day-h));
  gap: 4px;
  flex-shrink: 0;
}

.day {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  height: var(--day-h);
  min-height: var(--day-h);
  max-height: var(--day-h);
  padding: 0;
  border: 2px solid transparent;
  border-radius: 10px;
  background: #f0f0f4;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.day:disabled { cursor: default; opacity: 0.28; }
.day--outside { visibility: hidden; pointer-events: none; }
.day--empty { background: #f0f0f4; color: #b0b0bc; }
.day--today { box-shadow: inset 0 0 0 2px rgb(244 143 177 / 65%); }
.day__num { font-size: 0.78rem; font-weight: 600; line-height: 1; }
.day__emoji { font-size: 0.95rem; line-height: 1; }

.popover {
  position: fixed;
  left: 0.75rem;
  right: 0.75rem;
  max-width: 406px;
  margin: 0 auto;
  bottom: calc(var(--fab-h) + var(--fab-gap) + var(--safe-b) + 0.5rem);
  z-index: 20;
  padding: 1rem;
  border-left: 4px solid var(--accent);
}

.popover__close { position: absolute; top: 0.5rem; right: 0.65rem; border: none; background: none; font-size: 1.35rem; color: var(--muted); cursor: pointer; padding: 0.2rem; }
.popover__title { margin: 0 1.5rem 0.35rem 0; font-size: 1.05rem; font-weight: 600; color: #3d3d4a; }
.popover__meta { margin: 0 0 0.4rem; font-size: 0.8rem; color: var(--muted); }
.popover__desc { margin: 0; font-size: 0.88rem; line-height: 1.45; }

.fab {
  width: 100%;
  height: var(--fab-h);
  margin-top: 24px;
  margin-bottom: 32px;
  padding: 0 1rem;
  border: none;
  border-radius: 24px;
  background: var(--accent);
  color: #fff;
  font-size: 0.95rem;
  font-weight: 600;
  box-shadow: 0 4px 20px rgb(244 143 177 / 40%);
  cursor: pointer;
  flex-shrink: 0;
  -webkit-tap-highlight-color: transparent;
}

.fab:active { background: var(--accent-dark); }

/* ── Settings ── */
.settings-panel { padding: 1.25rem 1rem; margin-bottom: 0.75rem; flex-shrink: 0; }
.settings-panel__label { display: block; font-weight: 600; font-size: 0.95rem; margin-bottom: 1rem; color: #3d3d4a; }
.cycle-display { display: flex; align-items: baseline; justify-content: center; gap: 0.35rem; margin-bottom: 1.5rem; }
.cycle-display__value { font-size: 2.75rem; font-weight: 700; color: var(--accent-dark); line-height: 1; }
.cycle-display__unit { font-size: 1rem; color: #b08bb8; font-weight: 500; }
.slider-block { padding: 0 0.25rem; }

.cycle-range {
  --pct: 50%;
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 8px;
  border-radius: 999px;
  background: linear-gradient(to right, var(--accent) 0%, var(--accent) var(--pct), #e8e8ee var(--pct), #e8e8ee 100%);
  outline: none;
  cursor: pointer;
}

.cycle-range:disabled { opacity: 0.45; cursor: not-allowed; }
.cycle-range::-webkit-slider-thumb { -webkit-appearance: none; width: 26px; height: 26px; border-radius: 50%; background: var(--surface); border: 3px solid var(--accent); box-shadow: 0 2px 8px rgb(244 143 177 / 40%); cursor: pointer; }
.cycle-range::-moz-range-thumb { width: 26px; height: 26px; border: 3px solid var(--accent); border-radius: 50%; background: var(--surface); cursor: pointer; }
.slider-block__ticks { display: flex; justify-content: space-between; margin-top: 0.5rem; font-size: 0.75rem; color: var(--muted); }
.settings-note { margin: 1rem 0 0; text-align: center; font-size: 0.8rem; color: #b08bb8; }

.history { padding: 1rem; flex: 1; margin-bottom: 0.75rem; }
.history__title { margin: 0 0 0.85rem; font-size: 1rem; font-weight: 600; color: #3d3d4a; }
.history__empty { margin: 0; font-size: 0.85rem; color: var(--muted); }
.history__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.history__item { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 0.85rem; background: var(--bg); border-radius: 12px; }
.history__info { display: flex; flex-direction: column; gap: 0.15rem; }
.history__date { font-weight: 600; font-size: 0.95rem; color: #3d3d4a; }
.history__duration { font-size: 0.8rem; color: var(--muted); }
.history__duration--active { color: var(--accent-dark); font-weight: 500; }
.history__delete { width: 2.5rem; height: 2.5rem; border: none; border-radius: 50%; background: #ffe8ec; font-size: 1.1rem; cursor: pointer; flex-shrink: 0; }
.history__delete:disabled { opacity: 0.5; }

.signout-btn {
  width: 100%;
  padding: 0.85rem;
  border: 1.5px solid #e8e0ee;
  border-radius: 12px;
  background: transparent;
  color: var(--muted);
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  margin-bottom: 1rem;
}

.signout-btn:hover { background: #f5f0f8; }

/* ── Global ── */
.toast {
  position: fixed;
  left: 50%;
  bottom: calc(var(--fab-h) + var(--fab-gap) + 1rem + var(--safe-b));
  transform: translateX(-50%);
  max-width: calc(100% - 2rem);
  padding: 0.65rem 1.1rem;
  background: #5a9a7a;
  color: #fff;
  font-size: 0.85rem;
  border-radius: 999px;
  box-shadow: var(--shadow);
  z-index: 40;
  margin: 0;
}

.app--settings .toast { bottom: calc(1rem + var(--safe-b)); }

.dialog-backdrop { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; padding: 1rem; background: rgb(60 60 70 / 40%); z-index: 50; }
.dialog { width: 100%; max-width: 340px; padding: 1.35rem; }
.dialog h3 { margin: 0 0 0.5rem; font-size: 1.15rem; font-weight: 600; color: #3d3d4a; }
.dialog p { margin: 0 0 1.25rem; font-size: 0.9rem; color: var(--muted); line-height: 1.45; }
.dialog__actions { display: flex; gap: 0.65rem; justify-content: flex-end; }

.btn { padding: 0.7rem 1.2rem; border-radius: 999px; font-size: 0.9rem; font-weight: 600; border: none; cursor: pointer; }
.btn--ghost { background: #f0f0f4; color: var(--text); }
.btn--primary { background: var(--accent); color: #fff; }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
