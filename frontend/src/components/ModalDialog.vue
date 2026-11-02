<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import { t } from '@/lib/i18n';

defineProps<{ title: string; wide?: boolean; locked?: boolean }>();
const emit = defineEmits<{ close: [] }>();

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close');
}

onMounted(() => document.addEventListener('keydown', onKey));
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <Teleport to="body">
    <div class="backdrop" @mousedown.self="!locked && $emit('close')">
      <div class="modal" :class="{ wide }" role="dialog" aria-modal="true" :aria-label="title">
        <div class="modal-head">
          <h2>{{ title }}</h2>
          <button class="link" type="button" :aria-label="t('Close')" @click="$emit('close')">✕</button>
        </div>
        <slot></slot>
      </div>
    </div>
  </Teleport>
</template>
