<script setup lang="ts">
import ModalDialog from './ModalDialog.vue';
import { t } from '@/lib/i18n';

withDefaults(
  defineProps<{ title: string; text: string; confirmLabel?: string; busy?: boolean; danger?: boolean }>(),
  { confirmLabel: undefined, busy: false, danger: true },
);
defineEmits<{ confirm: []; cancel: [] }>();
</script>

<template>
  <ModalDialog :title="title" @close="$emit('cancel')">
    <p>{{ text }}</p>
    <div class="modal-foot" style="margin-top: 16px">
      <button class="btn" type="button" @click="$emit('cancel')">{{ t('Cancel') }}</button>
      <button class="btn" :class="danger ? 'danger' : 'primary'" type="button" :disabled="busy" @click="$emit('confirm')">
        {{ busy ? t('Working…') : (confirmLabel ?? t('Confirm')) }}
      </button>
    </div>
  </ModalDialog>
</template>
