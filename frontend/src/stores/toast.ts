import { defineStore } from 'pinia';
import { ref } from 'vue';
import { errorMessage } from '@/api/client';

interface Toast {
  id: number;
  kind: 'success' | 'error';
  text: string;
}

export const useToastStore = defineStore('toast', () => {
  const toasts = ref<Toast[]>([]);
  let nextId = 1;

  function push(kind: Toast['kind'], text: string) {
    const id = nextId;
    nextId += 1;
    toasts.value.push({ id, kind, text });
    setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 4000);
  }

  function dismiss(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }

  return {
    toasts,
    dismiss,
    success: (text: string) => push('success', text),
    error: (error: unknown) => push('error', errorMessage(error)),
  };
});
