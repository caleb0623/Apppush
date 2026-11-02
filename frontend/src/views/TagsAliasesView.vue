<script setup lang="ts">
import { ref } from 'vue';
import { api, errorMessage, query } from '@/api/client';
import type { Alias, Tag } from '@/api/types';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import ModalDialog from '@/components/ModalDialog.vue';
import PaginationBar from '@/components/PaginationBar.vue';
import StateBlock from '@/components/StateBlock.vue';
import { useResource } from '@/composables/useResource';
import { splitList } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import { useWorkspaceStore } from '@/stores/workspace';

const auth = useAuthStore();
const toast = useToastStore();
const workspace = useWorkspaceStore();

const tagPage = ref(1);
const aliasPage = ref(1);
const tags = useResource(() => api.get<Tag[]>(`${workspace.envUrl}/tags${query({ page: tagPage.value })}`), [tagPage]);
const aliases = useResource(
  () => api.get<Alias[]>(`${workspace.envUrl}/aliases${query({ page: aliasPage.value })}`),
  [aliasPage],
);

const newTag = ref('');
const tagError = ref<string | null>(null);
const busy = ref(false);

async function createTag() {
  busy.value = true;
  tagError.value = null;
  try {
    await api.post(`${workspace.envUrl}/tags`, { name: newTag.value.trim() });
    newTag.value = '';
    toast.success(t('Tag created'));
    await tags.reload();
  } catch (error) {
    tagError.value = errorMessage(error);
  } finally {
    busy.value = false;
  }
}

const managing = ref<Tag | null>(null);
const addDevices = ref('');
const removeDevices = ref('');
const manageError = ref<string | null>(null);

function openManage(tag: Tag) {
  managing.value = tag;
  addDevices.value = '';
  removeDevices.value = '';
  manageError.value = null;
}

async function saveManage() {
  if (!managing.value) return;
  busy.value = true;
  manageError.value = null;
  try {
    await api.post(`${workspace.envUrl}/tags/${encodeURIComponent(managing.value.name)}/devices`, {
      add: splitList(addDevices.value),
      remove: splitList(removeDevices.value),
    });
    managing.value = null;
    toast.success(t('Tag assignments updated'));
    await tags.reload();
  } catch (error) {
    manageError.value = errorMessage(error);
  } finally {
    busy.value = false;
  }
}

const deleting = ref<{ kind: 'tag' | 'alias'; name: string } | null>(null);

async function remove() {
  if (!deleting.value) return;
  const { kind, name } = deleting.value;
  busy.value = true;
  try {
    await api.delete(`${workspace.envUrl}/${kind === 'tag' ? 'tags' : 'aliases'}/${encodeURIComponent(name)}`);
    deleting.value = null;
    toast.success(kind === 'tag' ? t('Tag deleted') : t('Alias deleted'));
    await (kind === 'tag' ? tags.reload() : aliases.reload());
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
      <h1>{{ t('Tags and aliases') }}</h1>
      <p>{{ t('Assign tags and aliases per device on the Devices page, or manage tags here.') }}</p>
    </div>
  </div>

  <div class="grid cols-2">
    <div class="card">
      <h2>{{ t('Tags') }}</h2>
      <form v-if="auth.isAdmin" class="filters" @submit.prevent="createTag">
        <input v-model="newTag" required maxlength="64" :placeholder="t('New tag name')" :aria-label="t('New tag name')" style="flex: 1" />
        <button class="btn primary" type="submit" :disabled="busy">{{ t('Create tag') }}</button>
      </form>
      <div v-if="tagError" class="notice bad" role="alert">{{ tagError }}</div>
      <StateBlock
        :loading="tags.loading.value"
        :error="tags.error.value"
        :has-data="!!tags.data.value"
        :empty="tags.data.value?.length === 0"
        :empty-title="t('No tags yet')"
        @retry="tags.reload"
      >
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{{ t('Tag') }}</th>
                <th class="num">{{ t('Devices') }}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="tag in tags.data.value" :key="tag.id">
                <td>{{ tag.name }}</td>
                <td class="num">{{ tag.deviceCount }}</td>
                <td class="num nowrap">
                  <template v-if="auth.isAdmin">
                    <button class="btn small" type="button" @click="openManage(tag)">{{ t('Devices') }}</button>
                    {{ ' ' }}<button class="btn small danger" type="button" @click="deleting = { kind: 'tag', name: tag.name }">{{ t('Delete') }}</button>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <PaginationBar v-model="tagPage" :meta="tags.meta.value" />
      </StateBlock>
    </div>

    <div class="card">
      <h2>{{ t('Aliases') }}</h2>
      <StateBlock
        :loading="aliases.loading.value"
        :error="aliases.error.value"
        :has-data="!!aliases.data.value"
        :empty="aliases.data.value?.length === 0"
        :empty-title="t('No aliases yet')"
        :empty-text="t('Set an alias on a device to create one.')"
        @retry="aliases.reload"
      >
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{{ t('Alias') }}</th>
                <th>{{ t('Devices') }}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="alias in aliases.data.value" :key="alias.id">
                <td>{{ alias.name }}</td>
                <td>
                  <code v-for="device in alias.devices" :key="device.registrationId" style="display: block">{{ device.registrationId }}</code>
                  <span v-if="alias.devices.length === 0" class="muted">{{ t('None') }}</span>
                </td>
                <td class="num">
                  <button v-if="auth.isAdmin" class="btn small danger" type="button" @click="deleting = { kind: 'alias', name: alias.name }">{{ t('Delete') }}</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <PaginationBar v-model="aliasPage" :meta="aliases.meta.value" />
      </StateBlock>
    </div>
  </div>

  <ModalDialog v-if="managing" :title="t('Devices on {name}', { name: managing.name })" @close="managing = null">
    <form @submit.prevent="saveManage">
      <div v-if="manageError" class="notice bad" role="alert">{{ manageError }}</div>
      <div class="field">
        <label for="tag-add">{{ t('Add registration IDs') }}</label>
        <textarea id="tag-add" v-model="addDevices"></textarea>
      </div>
      <div class="field">
        <label for="tag-remove">{{ t('Remove registration IDs') }}</label>
        <textarea id="tag-remove" v-model="removeDevices"></textarea>
      </div>
      <div class="modal-foot">
        <button class="btn" type="button" @click="managing = null">{{ t('Cancel') }}</button>
        <button class="btn primary" type="submit" :disabled="busy">{{ t('Save') }}</button>
      </div>
    </form>
  </ModalDialog>

  <ConfirmDialog
    v-if="deleting"
    :title="deleting.kind === 'tag' ? t('Delete tag') : t('Delete alias')"
    :text="t(deleting.kind === 'tag' ? 'Delete “{name}”? Devices keep working but lose this tag.' : 'Delete “{name}”? Devices keep working but lose this alias.', { name: deleting.name })"
    :confirm-label="t('Delete')"
    :busy="busy"
    @confirm="remove"
    @cancel="deleting = null"
  />
</template>
