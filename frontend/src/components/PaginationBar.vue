<script setup lang="ts">
import type { PageMeta } from '@/api/client';
import { t } from '@/lib/i18n';

defineProps<{ meta: PageMeta | null }>();
const page = defineModel<number>({ required: true });
</script>

<template>
  <div v-if="meta && meta.totalPages > 1" class="pagination">
    <span class="small">{{ t('{total} total, page {page} of {pages}', { total: meta.total.toLocaleString('en-US'), page: meta.page, pages: meta.totalPages }) }}</span>
    <span class="actions">
      <button class="btn small" type="button" :disabled="meta.page <= 1" @click="page = meta.page - 1">{{ t('Previous') }}</button>
      <button class="btn small" type="button" :disabled="meta.page >= meta.totalPages" @click="page = meta.page + 1">{{ t('Next') }}</button>
    </span>
  </div>
</template>
