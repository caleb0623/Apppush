import { onMounted, ref, shallowRef, watch, type WatchSource } from 'vue';
import { errorMessage, type ApiResult, type PageMeta } from '@/api/client';

/** Loads data, tracks its state, and ignores responses that a newer request has replaced. */
export function useResource<T>(fetcher: () => Promise<ApiResult<T>>, sources: WatchSource[] = []) {
  const data = shallowRef<T | null>(null);
  const meta = shallowRef<PageMeta | null>(null);
  const loading = ref(true);
  const error = ref<string | null>(null);
  let latest = 0;

  /** A silent reload, used for polling, updates in place without dimming the page. */
  async function reload(silent = false) {
    const id = (latest += 1);
    if (!silent) loading.value = true;
    error.value = null;
    try {
      const result = await fetcher();
      if (id !== latest) return;
      data.value = result.data;
      meta.value = result.meta ?? null;
    } catch (caught) {
      if (id === latest) error.value = errorMessage(caught);
    } finally {
      if (id === latest) loading.value = false;
    }
  }

  onMounted(() => reload());
  if (sources.length > 0) watch(sources, () => reload());

  return { data, meta, loading, error, reload };
}
