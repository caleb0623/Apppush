<script setup lang="ts">
import { locale, t, toggleLocale } from '@/lib/i18n';
</script>

<template>
  <button class="btn small" type="button" :title="t('Switch language')" @click="toggleLocale">
    {{ locale === 'zh' ? 'English' : '中文' }}
  </button>
</template>
