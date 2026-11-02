<script setup lang="ts">
import { ref } from 'vue';
import type { Credentials } from '@/api/types';
import ModalDialog from './ModalDialog.vue';
import { t, translate } from '@/lib/i18n';

const props = defineProps<{ credentials: Credentials }>();
const emit = defineEmits<{ close: [] }>();

const stored = ref(false);
const copied = ref(false);

async function copy() {
  await navigator.clipboard.writeText(props.credentials.masterSecret);
  copied.value = true;
}
</script>

<template>
  <ModalDialog :title="t('Save your Master Secret')" locked @close="stored && emit('close')">
    <div class="notice warn">{{ translate(credentials.notice) }}</div>
    <div class="field">
      <span class="label">AppKey</span>
      <div class="secret-box"><code>{{ credentials.appKey }}</code></div>
    </div>
    <div class="field">
      <span class="label">Master Secret</span>
      <div class="secret-box">
        <code data-testid="master-secret">{{ credentials.masterSecret }}</code>
        <button class="btn small" type="button" @click="copy">{{ copied ? t('Copied') : t('Copy') }}</button>
      </div>
    </div>
    <div class="checks" style="margin-bottom: 8px">
      <label><input v-model="stored" type="checkbox" /> {{ t('I have stored this secret') }}</label>
    </div>
    <div class="modal-foot">
      <button class="btn primary" type="button" :disabled="!stored" @click="emit('close')">{{ t('Close') }}</button>
    </div>
  </ModalDialog>
</template>
