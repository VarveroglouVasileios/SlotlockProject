<script setup lang="ts">
import { computed, reactive, ref, shallowRef } from 'vue'
import { Engine, ROOMS, fmtSeconds, race } from '@/lib/engine'
import { API_URL, cancelLive, liveAvailable, liveRace, wake } from '@/lib/live'

interface Row { label: string; at: number; status: number; body: Record<string, unknown>; replayed?: boolean }

const NOW = Date.now()
const tomorrow = new Date(NOW + 86_400_000 * 3).toISOString().slice(0, 10)
const hours = ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '13:00', '14:00', '15:00']
const f = reactive({ room: 'room-3', date: tomorrow, from: '09:00', to: '11:00', gap: 4, key: false })
const mode = ref<'sim' | 'live'>('sim')
const engine = shallowRef(new Engine())
const tick = ref(0)
const stored = computed(() => (tick.value >= 0 ? engine.value.count() : 0))
const rows = ref<Row[]>([])
const err = ref('')
const runs = ref(0)
const busy = ref('')
const cancelled = ref('')
const iso = (h: string): string => `${f.date}T${h}:00Z`
const roomName = computed(() => ROOMS.find((r) => r.id === f.room)?.name ?? '')

const send = async (): Promise<void> => {
  err.value = ''
  cancelled.value = ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return void (err.value = 'Επιλέξτε ημερομηνία.')
  const base = { roomId: f.room, start: iso(f.from), end: iso(f.to) }
  const key = (who: string): string | undefined => (f.key ? `k-${Date.now().toString(36)}-${who}` : undefined)
  const a = { ...base, name: 'Πελάτης Α', key: key('a') }
  const b = { ...base, name: 'Πελάτης Β', key: key('b') }
  if (mode.value === 'sim') {
    rows.value = race(engine.value, a, b, f.gap, NOW).map((r) => ({ label: r.label, at: r.at, status: r.resp.status, body: r.resp.body as unknown as Record<string, unknown>, replayed: r.resp.status === 201 ? r.resp.replayed : false }))
    tick.value++
  } else {
    busy.value = 'Ξυπνάω τον server (δωρεάν πακέτο, μπορεί να πάρει έως ~50 δευτερόλεπτα)…'
    rows.value = []
    if (!(await wake())) {
      busy.value = ''
      return void (err.value = 'Ο server δεν απάντησε. Δοκιμάστε ξανά σε λίγο ή χρησιμοποιήστε την προσομοίωση.')
    }
    busy.value = 'Στέλνω τα δύο αιτήματα στον πραγματικό server…'
    const res = await liveRace(a, b, f.gap)
    rows.value = res.map((r) => ({ label: r.label, at: r.sentAt, status: r.status, body: r.body, replayed: r.replayed })).sort((x, y) => x.at - y.at)
    busy.value = ''
  }
  runs.value++
}
const reset = (): void => {
  engine.value = new Engine()
  tick.value++
  rows.value = []
  err.value = ''
  cancelled.value = ''
}
const winner = computed(() => rows.value.find((r) => r.status === 201))
const loser = computed(() => rows.value.find((r) => r.status !== 201))
const winnerRef = computed(() => String(winner.value?.body.ref ?? ''))
const json = (r: Row | undefined): string => (r ? JSON.stringify(r.body, null, 2) : '')
const code = (r: Row): string => (r.status === 201 ? '201 CREATED' : r.status === 409 ? '409 CONFLICT' : r.status === 0 ? 'NO ANSWER' : `${r.status} ERROR`)
const statusText: Record<number, string> = { 400: 'Bad Request', 404: 'Not Found', 409: 'Conflict', 422: 'Unprocessable Entity', 429: 'Too Many Requests', 503: 'Service Unavailable', 0: 'No Response' }
const httpLine = computed(() => (loser.value ? `HTTP/1.1 ${loser.value.status || '---'} ${statusText[loser.value.status] ?? ''}` : ''))
const cancelWinner = async (): Promise<void> => {
  if (!winnerRef.value) return
  if (mode.value === 'live') cancelled.value = (await cancelLive(winnerRef.value)) ? 'Η κράτηση ακυρώθηκε στον server.' : 'Η ακύρωση δεν πέτυχε.'
  else {
    engine.value.cancel(winnerRef.value)
    tick.value++
    cancelled.value = 'Η κράτηση ακυρώθηκε.'
  }
}
</script>

<template>
  <main>
    <section class="hero">
      <p class="mono kick">POST /bookings · ΤΑΥΤΟΧΡΟΝΑ ΑΙΤΗΜΑΤΑ</p>
      <h1>Δύο πελάτες πατάνε «Κράτηση» την ίδια στιγμή.<br /><span class="red">Ένας κερδίζει.</span></h1>
      <p class="lead">Ένα API κρατήσεων που δεν επιτρέπει διπλοκράτηση, ούτε όταν τα αιτήματα φτάνουν μαζί. Το κλείδωμα γίνεται μέσα στη βάση, όχι στον κώδικα.</p>
    </section>

    <section class="row2" aria-label="Προσομοιωτής">
      <div class="cell">
        <p class="mono k">ΓΡΑΜΜΗ ΧΡΟΝΟΥ · {{ roomName.toUpperCase() }} · {{ f.from }}–{{ f.to }}</p>
        <div class="line" aria-live="polite">
          <div class="scale mono" aria-hidden="true"><span>09:00</span><span>09:30</span><span>10:00</span><span>10:30</span><span>11:00</span></div>
          <p v-if="busy" class="mono empty" role="status">{{ busy }}</p>
          <template v-else-if="rows.length">
            <div v-for="(r, i) in rows" :key="`${runs}-${r.label}`" class="bar mono" :class="r.status === 201 ? 'ok' : 'no'" :style="{ animationDelay: `${i * 0.15}s` }">{{ r.label }} · t={{ fmtSeconds(r.at) }} · {{ code(r) }}{{ r.replayed ? ' · replay' : '' }}</div>
            <div v-if="loser" :key="`s${runs}`" class="stamp mono">ΑΠΟΡΡΙΦΘΗΚΕ</div>
          </template>
          <p v-else class="mono empty">Πατήστε «Στείλε και τα δύο» για να δείτε ποιος κερδίζει.</p>
        </div>
        <p class="p">Τα δύο αιτήματα φτάνουν με διαφορά {{ f.gap }} χιλιοστών του δευτερολέπτου. Η βάση δέχεται το πρώτο και αρνείται το δεύτερο, με σαφές μήνυμα.<template v-if="mode === 'live'"> Στον πραγματικό server το δίκτυο προσθέτει τυχαία καθυστέρηση, οπότε ο νικητής μπορεί να αλλάζει.</template></p>

        <form class="ctl" novalidate @submit.prevent="send">
          <fieldset v-if="liveAvailable" class="mode">
            <legend>Πού τρέχει;</legend>
            <label><input v-model="mode" type="radio" value="sim" /> Προσομοίωση στον browser</label>
            <label><input v-model="mode" type="radio" value="live" /> Πραγματικός server (Render + PostgreSQL στη Neon)</label>
          </fieldset>
          <div class="f"><label for="room">Δωμάτιο</label><select id="room" v-model="f.room"><option v-for="r in ROOMS" :key="r.id" :value="r.id">{{ r.name }}</option></select></div>
          <div class="f"><label for="date">Ημέρα</label><input id="date" v-model="f.date" type="date" :min="tomorrow" /></div>
          <div class="f"><label for="from">Από</label><select id="from" v-model="f.from"><option v-for="h in hours" :key="h" :value="h">{{ h }}</option></select></div>
          <div class="f"><label for="to">Έως</label><select id="to" v-model="f.to"><option v-for="h in hours" :key="h" :value="h">{{ h }}</option></select></div>
          <div class="f wide"><label for="gap">Διαφορά άφιξης: {{ f.gap }} ms</label><input id="gap" v-model.number="f.gap" type="range" min="0" max="50" /></div>
          <label class="chk"><input v-model="f.key" type="checkbox" /> Στείλε με Idempotency-Key (διαφορετικό ανά πελάτη)</label>
          <div class="btns"><button type="submit" class="btn" :disabled="!!busy">Στείλε και τα δύο</button><button v-if="mode === 'sim'" type="button" class="btn ghost" @click="reset">Καθαρισμός βάσης</button><button v-if="winnerRef" type="button" class="btn ghost" @click="cancelWinner">Ακύρωση της κράτησης {{ winnerRef }}</button></div>
          <p v-if="cancelled" class="note" role="status">{{ cancelled }}</p>
          <p v-if="err" class="err" role="alert">{{ err }}</p>
          <p v-if="mode === 'sim'" class="note mono">Κρατήσεις στη βάση της προσομοίωσης: {{ stored }}. Ξαναπατήστε χωρίς «Καθαρισμός» για να δείτε ότι κανείς δεν πιάνει πια το ίδιο διάστημα.</p>
          <p v-else class="note mono">Οι κρατήσεις αποθηκεύονται στον πραγματικό server ({{ API_URL.replace('https://', '') }}) με το όνομα «Πελάτης Α/Β» και καθαρίζονται αυτόματα.</p>
        </form>
      </div>
      <div class="cell grey">
        <p class="mono k">ΑΠΑΝΤΗΣΗ ΣΤΟΝ ΠΕΛΑΤΗ {{ loser?.label ?? 'Β' }}</p>
        <pre v-if="loser" class="mono"><b class="red">{{ httpLine }}</b>
{{ json(loser) }}<span class="cur" /></pre>
        <pre v-else class="mono">HTTP/1.1 <b class="red">409 Conflict</b>
{
  "error": "slot_taken",
  "message": "Το δωμάτιο 3 είναι κλεισμένο
              στο διάστημα που ζητήσατε.",
  "alternatives": [
    { "from": "11:00", "to": "13:00" },
    { "from": "09:00", "room": "room-4" }
  ]
}<span class="cur" /></pre>
        <p v-if="winner" class="mono note">Ο πελάτης {{ winner.label }} πήρε την κράτηση {{ winnerRef }}.</p>
      </div>
    </section>

    <section id="rules" class="rules">
      <h2>Τρεις κανόνες που δεν σπάνε</h2>
      <div class="tbl top"><b class="mono red">01</b><b>Transaction</b><span>Ο έλεγχος διαθεσιμότητας και η εγγραφή γίνονται μαζί. Κανένα αίτημα δεν βλέπει ημιτελή κατάσταση.</span></div>
      <div class="tbl"><b class="mono red">02</b><b>Περιορισμός στη βάση</b><span>Μοναδικός περιορισμός ανά δωμάτιο και διάστημα. Ακόμα κι αν ο κώδικας έχει λάθος, η βάση δεν δέχεται επικάλυψη.</span></div>
      <div class="tbl last"><b class="mono red">03</b><b>Idempotency key</b><span>Αν ο πελάτης ξαναστείλει το ίδιο αίτημα επειδή έπεσε το δίκτυο, παίρνει την ίδια απάντηση και όχι δεύτερη κράτηση.</span></div>
    </section>

    <section class="row2 bordered">
      <div id="endpoints" class="cell">
        <h2>Endpoints</h2>
        <div class="mono eps"><div><b class="red">GET</b>&nbsp; /rooms/:id/availability</div><div><b class="red">POST</b> /bookings</div><div><b class="red">GET</b>&nbsp; /bookings/:ref</div><div><b class="red">PATCH</b> /bookings/:ref/cancel</div></div>
      </div>
      <div id="stack" class="cell">
        <h2>Στοίβα</h2>
        <p class="mono eps">Node.js · Express · TypeScript<br />Sequelize · PostgreSQL (SQLite στα tests)<br />Vitest · supertest · tests ταυτοχρονισμού<br />Vue 3 στο μπροστινό μέρος</p>
        <p class="note">Ο κώδικας του server είναι στον φάκελο <code>server/</code> και τα tests ταυτοχρονισμού (25 αιτήματα μαζί, ένα κερδίζει) τρέχουν με <code>yarn test</code>.</p>
      </div>
    </section>
  </main>
</template>
