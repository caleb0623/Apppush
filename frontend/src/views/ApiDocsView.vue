<script setup lang="ts">
import { t } from '@/lib/i18n';

const SAMPLE = `curl -u "$APP_KEY:$MASTER_SECRET" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: demo-1" \\
  -d '{"type":"NOTIFICATION","title":"Hi","body":"Hello","platforms":["ANDROID"],"audience":{"type":"ALL"},"strategy":"fcm_mtpush"}' \\
  http://localhost:4000/api/v1/open/messages`;
</script>

<template>
  <div class="page-header">
    <div>
      <h1>{{ t('API documentation') }}</h1>
      <p>{{ t('Interactive OpenAPI reference. Requests made here run against your local server.') }}</p>
    </div>
    <div class="actions">
      <a class="btn" href="/api/docs.json" target="_blank" rel="noopener">OpenAPI JSON</a>
      <a class="btn primary" href="/api/docs/" target="_blank" rel="noopener">{{ t('Open in a new tab') }}</a>
    </div>
  </div>

  <div class="card">
    <h2>{{ t('Send a push with API credentials') }}</h2>
    <pre class="json">{{ SAMPLE }}</pre>
    <p class="muted small" style="margin-top: 8px">{{ t('Testing environments allow 10 requests per second across the console and API clients.') }}</p>
  </div>

  <iframe class="card docs-frame" style="padding: 0" src="/api/docs/" title="Swagger UI"></iframe>
</template>
