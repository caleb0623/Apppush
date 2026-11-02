<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { api, ApiRequestError, errorMessage, query } from '@/api/client';
import type { Device, Environment } from '@/api/types';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import ModalDialog from '@/components/ModalDialog.vue';
import PaginationBar from '@/components/PaginationBar.vue';
import StateBlock from '@/components/StateBlock.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { useResource } from '@/composables/useResource';
import { environmentName, formatDateTime, formatNumber, splitList } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import { useWorkspaceStore } from '@/stores/workspace';

const auth = useAuthStore();
const toast = useToastStore();
const workspace = useWorkspaceStore();

const filters = reactive({ search: '', platform: '', status: '', online: '', tag: '', alias: '' });
const page = ref(1);
watch(filters, () => {
  page.value = 1;
});

const devices = useResource(
  () => api.get<Device[]>(`${workspace.envUrl}/devices${query({ page: page.value, ...filters })}`),
  [page, () => ({ ...filters })],
);
const environment = useResource(() => api.get<Environment>(workspace.envUrl));

const capacity = computed(() => {
  const env = environment.data.value;
  if (!env?.limits || !env.usage) return null;
  const used = env.usage.devices;
  const max = env.limits.maxDevices;
  return { used, max, share: Math.min(100, (used / max) * 100) };
});

async function refreshAll() {
  await Promise.all([devices.reload(), environment.reload()]);
}

// --- Register ---
const registering = ref(false);
const registerForm = reactive({ registrationId: '', platform: 'ANDROID', vendor: '', osVersion: '', appVersion: '1.0.0', online: true });
const registerError = ref<string | null>(null);
const registerErrors = ref<Record<string, string>>({});
const busy = ref(false);

function openRegister() {
  Object.assign(registerForm, { registrationId: '', platform: 'ANDROID', vendor: '', osVersion: '', appVersion: '1.0.0', online: true });
  registerError.value = null;
  registerErrors.value = {};
  registering.value = true;
}

async function register() {
  busy.value = true;
  registerError.value = null;
  registerErrors.value = {};
  try {
    await api.post(`${workspace.envUrl}/devices`, {
      platform: registerForm.platform,
      appVersion: registerForm.appVersion,
      online: registerForm.online,
      ...(registerForm.registrationId ? { registrationId: registerForm.registrationId } : {}),
      ...(registerForm.vendor ? { vendor: registerForm.vendor } : {}),
      ...(registerForm.osVersion ? { osVersion: registerForm.osVersion } : {}),
    });
    registering.value = false;
    toast.success(t('Device registered'));
    await refreshAll();
  } catch (error) {
    if (error instanceof ApiRequestError) registerErrors.value = error.fieldErrors;
    registerError.value = errorMessage(error);
  } finally {
    busy.value = false;
  }
}

// --- Edit ---
const editing = ref<Device | null>(null);
const editForm = reactive({ appVersion: '', status: 'ACTIVE', online: false, alias: '', tags: '' });
const editError = ref<string | null>(null);

function openEdit(device: Device) {
  editing.value = device;
  editError.value = null;
  Object.assign(editForm, {
    appVersion: device.appVersion,
    status: device.status,
    online: device.online,
    alias: device.alias ?? '',
    tags: device.tags.join(', '),
  });
}

async function saveEdit() {
  const device = editing.value;
  if (!device) return;
  const url = `${workspace.envUrl}/devices/${device.registrationId}`;
  const wanted = splitList(editForm.tags);
  busy.value = true;
  editError.value = null;
  try {
    await api.patch(url, { appVersion: editForm.appVersion, status: editForm.status, online: editForm.online });
    const add = wanted.filter((tag) => !device.tags.includes(tag));
    const remove = device.tags.filter((tag) => !wanted.includes(tag));
    if (add.length > 0 || remove.length > 0) await api.put(`${url}/tags`, { add, remove });
    if ((device.alias ?? '') !== editForm.alias.trim()) {
      await api.put(`${url}/alias`, { alias: editForm.alias.trim() || null });
    }
    editing.value = null;
    toast.success(t('Device updated'));
    await refreshAll();
  } catch (error) {
    editError.value = errorMessage(error);
    await devices.reload();
  } finally {
    busy.value = false;
  }
}

// --- Delete ---
const deleting = ref<Device | null>(null);

async function remove() {
  if (!deleting.value) return;
  busy.value = true;
  try {
    await api.delete(`${workspace.envUrl}/devices/${deleting.value.registrationId}`);
    deleting.value = null;
    toast.success(t('Device deleted'));
    await refreshAll();
  } catch (error) {
    toast.error(error);
  } finally {
    busy.value = false;
  }
}

// --- Cleanup ---
const cleaning = ref(false);
const inactiveDays = ref(30);
const preview = ref<number | null>(null);

function openCleanup() {
  preview.value = null;
  cleaning.value = true;
}

async function runCleanup(dryRun: boolean) {
  busy.value = true;
  try {
    const { data } = await api.post<{ matched?: number; deleted?: number }>(`${workspace.envUrl}/devices/cleanup`, {
      inactiveDays: inactiveDays.value,
      dryRun,
    });
    if (dryRun) {
      preview.value = data.matched ?? 0;
    } else {
      cleaning.value = false;
      toast.success(t('Removed {count} stale devices', { count: data.deleted ?? 0 }));
      await refreshAll();
    }
  } catch (error) {
    toast.error(error);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="page-header">
    <div>
      <h1>{{ t('Devices') }}</h1>
      <p>{{ t('Registered devices in the {environment} environment.', { environment: environmentName(workspace.environment?.type) }) }}</p>
    </div>
    <div v-if="auth.isAdmin" class="actions">
      <button class="btn" type="button" @click="openCleanup">{{ t('Clean up stale') }}</button>
      <button class="btn primary" type="button" @click="openRegister">{{ t('Register device') }}</button>
    </div>
  </div>

  <div v-if="capacity" class="card" style="margin-bottom: 14px">
    <div class="small">{{ t('Testing environment capacity: {used} of {max} devices', { used: formatNumber(capacity.used), max: formatNumber(capacity.max) }) }}</div>
    <div class="meter" :class="{ full: capacity.used >= capacity.max }"><div :style="{ width: `${capacity.share}%` }"></div></div>
  </div>

  <div class="card">
    <div class="filters">
      <input v-model.lazy="filters.search" type="search" :placeholder="t('Registration ID')" :aria-label="t('Registration ID')" />
      <select v-model="filters.platform" :aria-label="t('Platform')">
        <option value="">{{ t('All platforms') }}</option>
        <option value="ANDROID">Android</option>
        <option value="IOS">iOS</option>
        <option value="HARMONYOS">HarmonyOS</option>
      </select>
      <select v-model="filters.status" :aria-label="t('Status')">
        <option value="">{{ t('All statuses') }}</option>
        <option value="ACTIVE">{{ t('Active') }}</option>
        <option value="INACTIVE">{{ t('Inactive') }}</option>
      </select>
      <select v-model="filters.online" :aria-label="t('Online state')">
        <option value="">{{ t('Online and offline') }}</option>
        <option value="true">{{ t('Online') }}</option>
        <option value="false">{{ t('Offline') }}</option>
      </select>
      <input v-model.lazy="filters.tag" :placeholder="t('Tag')" :aria-label="t('Tag')" />
      <input v-model.lazy="filters.alias" :placeholder="t('Alias')" :aria-label="t('Alias')" />
    </div>

    <StateBlock
      :loading="devices.loading.value"
      :error="devices.error.value"
      :has-data="!!devices.data.value"
      :empty="devices.data.value?.length === 0"
      :empty-title="t('No devices found')"
      :empty-text="t('Register a device, or change the filters.')"
      @retry="devices.reload"
    >
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{{ t('Registration ID') }}</th>
              <th>{{ t('Platform') }}</th>
              <th>{{ t('Vendor') }}</th>
              <th>{{ t('App version') }}</th>
              <th>{{ t('Delivery') }}</th>
              <th>{{ t('Status') }}</th>
              <th>{{ t('Activity') }}</th>
              <th>{{ t('Alias') }}</th>
              <th>{{ t('Tags') }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="device in devices.data.value" :key="device.id">
              <td><code>{{ device.registrationId }}</code></td>
              <td>{{ device.platform }}</td>
              <td>{{ device.vendor ?? '—' }}</td>
              <td>{{ device.appVersion }}</td>
              <td class="nowrap">
                <span class="badge" :class="device.deliveryMode === 'REAL' ? 'good' : ''">{{ device.deliveryMode === 'REAL' ? t('Real phone') : t('Simulated') }}</span>
                <div v-if="device.pushTokenStatus === 'INVALID'" class="error small">{{ t('Token invalid') }}</div>
              </td>
              <td><StatusBadge :status="device.status" /></td>
              <td class="nowrap">
                <span class="badge" :class="device.online ? 'good' : ''">{{ device.online ? t('Online') : t('Offline') }}</span>
                <div class="muted small">{{ formatDateTime(device.lastActiveAt, workspace.timezone) }}</div>
              </td>
              <td>{{ device.alias ?? '—' }}</td>
              <td><span v-for="tag in device.tags" :key="tag" class="tag">{{ tag }}</span></td>
              <td class="num nowrap">
                <template v-if="auth.isAdmin">
                  <button class="btn small" type="button" @click="openEdit(device)">{{ t('Edit') }}</button>
                  {{ ' ' }}
                  <button class="btn small danger" type="button" @click="deleting = device">{{ t('Delete') }}</button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <PaginationBar v-model="page" :meta="devices.meta.value" />
    </StateBlock>
  </div>

  <ModalDialog v-if="registering" :title="t('Register device')" @close="registering = false">
    <form @submit.prevent="register">
      <div class="notice info">{{ t('This creates a simulated record. A real phone registers itself from the Android app.') }}</div>
      <div v-if="registerError" class="notice bad" role="alert">{{ registerError }}</div>
      <div class="field">
        <label for="rid">{{ t('Registration ID') }}</label>
        <input id="rid" v-model="registerForm.registrationId" :placeholder="t('Generated if left empty')" :class="{ invalid: registerErrors.registrationId }" />
        <span class="help">{{ t('6 to 64 letters, numbers, dashes or underscores.') }}</span>
        <span v-if="registerErrors.registrationId" class="error">{{ registerErrors.registrationId }}</span>
      </div>
      <div class="field">
        <label for="device-platform">{{ t('Platform') }}</label>
        <select id="device-platform" v-model="registerForm.platform">
          <option value="ANDROID">Android</option>
          <option value="IOS">iOS</option>
          <option value="HARMONYOS">HarmonyOS</option>
        </select>
      </div>
      <div class="field">
        <label for="device-vendor">{{ t('Vendor') }}</label>
        <input id="device-vendor" v-model="registerForm.vendor" placeholder="xiaomi, huawei, honor, meizu, oppo, vivo" />
        <span class="help">{{ t('Selects the manufacturer channel on Android.') }}</span>
      </div>
      <div class="field">
        <label for="device-os">{{ t('OS version') }}</label>
        <input id="device-os" v-model="registerForm.osVersion" />
      </div>
      <div class="field">
        <label for="device-version">{{ t('App version') }}</label>
        <input id="device-version" v-model="registerForm.appVersion" required :class="{ invalid: registerErrors.appVersion }" />
      </div>
      <div class="checks field"><label><input v-model="registerForm.online" type="checkbox" /> {{ t('Online') }}</label></div>
      <div class="modal-foot">
        <button class="btn" type="button" @click="registering = false">{{ t('Cancel') }}</button>
        <button class="btn primary" type="submit" :disabled="busy">{{ t('Register') }}</button>
      </div>
    </form>
  </ModalDialog>

  <ModalDialog v-if="editing" :title="t('Edit {id}', { id: editing.registrationId })" @close="editing = null">
    <form @submit.prevent="saveEdit">
      <div v-if="editError" class="notice bad" role="alert">{{ editError }}</div>
      <div class="field">
        <label for="edit-version">{{ t('App version') }}</label>
        <input id="edit-version" v-model="editForm.appVersion" required />
      </div>
      <div class="field">
        <label for="edit-status">{{ t('Status') }}</label>
        <select id="edit-status" v-model="editForm.status">
          <option value="ACTIVE">{{ t('Active') }}</option>
          <option value="INACTIVE">{{ t('Inactive') }}</option>
        </select>
        <span class="help">{{ t('Inactive devices are excluded from valid targets.') }}</span>
      </div>
      <div class="checks field"><label><input v-model="editForm.online" type="checkbox" /> {{ t('Online') }}</label></div>
      <div class="field">
        <label for="edit-alias">{{ t('Alias') }}</label>
        <input id="edit-alias" v-model="editForm.alias" />
      </div>
      <div class="field">
        <label for="edit-tags">{{ t('Tags') }}</label>
        <input id="edit-tags" v-model="editForm.tags" />
        <span class="help">{{ t('Separate with commas. New tags are created.') }}</span>
      </div>
      <div class="modal-foot">
        <button class="btn" type="button" @click="editing = null">{{ t('Cancel') }}</button>
        <button class="btn primary" type="submit" :disabled="busy">{{ t('Save') }}</button>
      </div>
    </form>
  </ModalDialog>

  <ConfirmDialog
    v-if="deleting"
    :title="t('Delete device')"
    :text="t('Delete {id}? Its message history is kept.', { id: deleting.registrationId })"
    :confirm-label="t('Delete')"
    :busy="busy"
    @confirm="remove"
    @cancel="deleting = null"
  />

  <ModalDialog v-if="cleaning" :title="t('Clean up stale devices')" @close="cleaning = false">
    <div class="field">
      <label for="cleanup-days">{{ t('Delete devices inactive for at least (days)') }}</label>
      <input id="cleanup-days" v-model.number="inactiveDays" type="number" min="1" max="3650" @input="preview = null" />
    </div>
    <div v-if="preview !== null" class="notice info">{{ preview === 1 ? t('1 device would be deleted.') : t('{count} devices would be deleted.', { count: formatNumber(preview) }) }}</div>
    <div class="modal-foot">
      <button class="btn" type="button" :disabled="busy" @click="runCleanup(true)">{{ t('Preview') }}</button>
      <button class="btn danger" type="button" :disabled="busy || !preview" @click="runCleanup(false)">{{ t('Delete') }}</button>
    </div>
  </ModalDialog>
</template>
