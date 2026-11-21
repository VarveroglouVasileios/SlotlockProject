<script setup lang="ts">
import { computed, reactive, ref, shallowRef } from 'vue'
import { Engine, ROOMS, fmtSeconds, race, type RaceResult } from '@/lib/engine'

const NOW = Date.now()
const tomorrow = new Date(NOW + 86_400_000 * 3).toISOString().slice(0, 10)
const hours = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '13:00', '14:00']
const f = reactive({ room: 'room-3', date: tomorrow, from: '09:00', to: '11:00', gap: 4, key: false })
const engine = shallowRef(new Engine())
const tick = ref(0)
const stored = computed(() => (tick.value >= 0 ? engine.value.count() : 0))
const results = ref<RaceResult[]>([])
const err = ref('')
const runs = ref(0)
const iso = (h: string): string => `${f.date}T${h}:00Z`
const roomName = computed(() => ROOMS.find((r) => r.id === f.room)?.name ?? '')

const send = (): void => {
  err.value = ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return void (err.value = 'Επιλέξτε ημερομηνία.')
  const base = { roomId: f.room, start: iso(f.from), end: iso(f.to) }
  results.value = race(engine.value, { ...base, name: 'Πελάτης Α', key: f.key ? `k-${runs.value}-a` : undefined }, { ...base, name: 'Πελάτης Β', key: f.key ? `k-${runs.value}-b` : undefined }, f.gap, NOW)
  runs.value++
  tick.value++
}
const reset = (): void => {
  engine.value = new Engine()
  tick.value++
  results.value = []
  err.value = ''
}
const winner = computed(() => results.value.find((r) => r.resp.status === 201))
const winnerRef = computed(() => (winner.value && winner.value.resp.status === 201 ? winner.value.resp.body.ref : ''))
const loser = computed(() => results.value.find((r) => r.resp.status !== 201))
const json = (r: RaceResult | undefined): string => (r ? JSON.stringify(r.resp.body, null, 2) : '')
const code = (r: RaceResult): string => (r.resp.status === 201 ? '201 CREATED' : r.resp.status === 409 ? '409 CONFLICT' : `${r.resp.status} ERROR`)
const httpLine = computed(() => (loser.value ? `HTTP/1.1 ${loser.value.resp.status} ${loser.value.resp.status === 409 ? 'Conflict' : 'Bad Request'}` : ''))
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
          <template v-if="results.length">
            <div v-for="(r, i) in results" :key="`${runs}-${r.label}`" class="bar mono" :class="r.resp.status === 201 ? 'ok' : 'no'" :style="{ animationDelay: `${i * 0.15}s` }">{{ r.label }} · t={{ fmtSeconds(r.at) }} · {{ code(r) }}</div>
            <div v-if="loser" :key="`s${runs}`" class="stamp mono">ΑΠΟΡΡΙΦΘΗΚΕ</div>
          </template>
          <p v-else class="mono empty">Πατήστε «Στείλε και τα δύο» για να δείτε ποιος κερδίζει.</p>
        </div>
        <p class="p">Τα δύο αιτήματα φτάνουν με διαφορά {{ f.gap }} χιλιοστών του δευτερολέπτου. Η βάση δέχεται το πρώτο και αρνείται το δεύτερο, με σαφές μήνυμα.</p>

        <form class="ctl" novalidate @submit.prevent="send">
          <div class="f"><label for="room">Δωμάτιο</label><select id="room" v-model="f.room"><option v-for="r in ROOMS" :key="r.id" :value="r.id">{{ r.name }}</option></select></div>
          <div class="f"><label for="date">Ημέρα</label><input id="date" v-model="f.date" type="date" :min="tomorrow" /></div>
          <div class="f"><label for="from">Από</label><select id="from" v-model="f.from"><option v-for="h in hours" :key="h" :value="h">{{ h }}</option></select></div>
          <div class="f"><label for="to">Έως</label><select id="to" v-model="f.to"><option v-for="h in hours" :key="h" :value="h">{{ h }}</option></select></div>
          <div class="f wide"><label for="gap">Διαφορά άφιξης: {{ f.gap }} ms</label><input id="gap" v-model.number="f.gap" type="range" min="0" max="50" /></div>
          <label class="chk"><input v-model="f.key" type="checkbox" /> Στείλε με Idempotency-Key (διαφορετικό ανά πελάτη)</label>
          <div class="btns"><button type="submit" class="btn">Στείλε και τα δύο</button><button type="button" class="btn ghost" @click="reset">Καθαρισμός βάσης</button></div>
          <p v-if="err" class="err" role="alert">{{ err }}</p>
          <p class="note mono">Κρατήσεις στη βάση: {{ stored }}. Ξαναπατήστε χωρίς «Καθαρισμός» για να δείτε ότι κανείς δεν πιάνει πια το ίδιο διάστημα.</p>
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
