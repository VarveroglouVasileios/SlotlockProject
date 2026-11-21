<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <div class="sheet">
    <a class="skip" href="#main">Μετάβαση στο περιεχόμενο</a>
    <header class="head">
      <RouterLink to="/" class="logo mono">slotlock<span>/</span>api</RouterLink>
      <nav aria-label="Κύρια πλοήγηση">
        <RouterLink :to="{ name: 'home', hash: '#rules' }">Κανόνες</RouterLink>
        <RouterLink :to="{ name: 'home', hash: '#endpoints' }">Endpoints</RouterLink>
        <RouterLink :to="{ name: 'home', hash: '#stack' }">Στοίβα</RouterLink>
        <span class="tag mono">DEMO CONCEPT</span>
      </nav>
    </header>
    <div id="main" tabindex="-1"><RouterView /></div>
    <footer class="foot">
      <p>Φανταστικό demo. Ο προσομοιωτής τρέχει στον browser σας με τους ίδιους κανόνες του server. Σχεδιασμός και υλοποίηση: Βασίλειος Βαρβέρογλου.</p>
      <p><RouterLink to="/privacy">Απόρρητο και cookies</RouterLink></p>
      <div class="mono block">ΕΡΓΟ: SLOTLOCK<br />ΦΥΛΛΟ: 1/2 · ΕΚΔ. A</div>
    </footer>
  </div>
</template>
