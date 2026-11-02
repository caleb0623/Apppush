<script setup lang="ts">
import {
  CategoryScale,
  Chart,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from 'chart.js';
import { computed, ref } from 'vue';
import { Line } from 'vue-chartjs';
import type { TrendPoint } from '@/api/types';
import { formatNumber, formatRate } from '@/lib/format';
import { t } from '@/lib/i18n';

Chart.register(CategoryScale, LinearScale, PointElement, LineElement, Legend, Tooltip);

const props = defineProps<{ points: TrendPoint[] }>();
const showTable = ref(false);

// Fixed slot order from the validated palette: colour follows the series, never its rank.
const SERIES = [
  { key: 'sent', label: 'Sent', color: '#2a78d6' },
  { key: 'delivered', label: 'Delivered', color: '#eb6834' },
  { key: 'displayed', label: 'Displayed', color: '#1baf7a' },
  { key: 'clicked', label: 'Clicked', color: '#eda100' },
] as const;

const INK = '#52514e';
const GRID = '#e4e3dc';

const chartData = computed<ChartData<'line'>>(() => ({
  labels: props.points.map((p) => p.bucket),
  datasets: SERIES.map((series) => ({
    label: t(series.label),
    data: props.points.map((p) => p[series.key]),
    borderColor: series.color,
    backgroundColor: series.color,
    borderWidth: 2,
    borderCapStyle: 'round' as const,
    borderJoinStyle: 'round' as const,
    pointRadius: 0,
    pointHoverRadius: 4,
    pointHitRadius: 12,
    pointHoverBorderColor: '#ffffff',
    pointHoverBorderWidth: 2,
    tension: 0,
  })),
}));

const options: ChartOptions<'line'> = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: {
      align: 'start',
      labels: { color: INK, usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8 },
    },
    tooltip: { backgroundColor: '#16161a', padding: 10, usePointStyle: true, boxPadding: 4 },
  },
  scales: {
    x: {
      grid: { display: false },
      border: { color: '#c3c2b7' },
      ticks: { color: INK, maxTicksLimit: 8, maxRotation: 0 },
    },
    y: {
      beginAtZero: true,
      grid: { color: GRID },
      border: { display: false },
      ticks: { color: INK, precision: 0, maxTicksLimit: 6 },
    },
  },
};
</script>

<template>
  <div>
    <div class="actions" style="justify-content: flex-end; margin-bottom: 4px">
      <button class="link small" type="button" @click="showTable = !showTable">
        {{ showTable ? t('Show chart') : t('Show table') }}
      </button>
    </div>
    <div v-if="!showTable" class="chart-box">
      <Line :data="chartData" :options="options" :aria-label="t('Trend of sent, delivered, displayed and clicked messages')" role="img" />
    </div>
    <div v-else class="table-wrap" style="max-height: 280px; overflow-y: auto">
      <table>
        <thead>
          <tr>
            <th>{{ t('Period') }}</th>
            <th class="num">{{ t('Sent') }}</th>
            <th class="num">{{ t('Delivered') }}</th>
            <th class="num">{{ t('Displayed') }}</th>
            <th class="num">{{ t('Clicked') }}</th>
            <th class="num">{{ t('Delivery rate') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="point in points" :key="point.bucket">
            <td class="nowrap">{{ point.bucket }}</td>
            <td class="num">{{ formatNumber(point.sent) }}</td>
            <td class="num">{{ formatNumber(point.delivered) }}</td>
            <td class="num">{{ formatNumber(point.displayed) }}</td>
            <td class="num">{{ formatNumber(point.clicked) }}</td>
            <td class="num">{{ formatRate(point.deliveryRate) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
