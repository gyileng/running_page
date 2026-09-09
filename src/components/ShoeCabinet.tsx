import { useMemo, useState } from 'react';
import type { Activity } from '../types';
import { formatDistance, formatPace } from '../hooks/useActivities';
import { useLocale } from '../hooks/useLocale';
import { useShoes } from '../hooks/useShoes';
import {
  computeShoeStats,
  DEFAULT_LIFESPAN_KM,
  EMPTY_STATS,
  LIFESPAN_WARN_RATIO,
  type Shoe,
  type ShoeStats,
} from '../core/shoes';
import { TrackThumb } from './TrackThumb';
import { shoeLabel } from './ShoeSelect';

/** 超出寿命时的状态色。与主题无关（深浅色下同样是红），沿用 TracksPage 图例里的 #ef4444 */
const OVER_COLOR = '#ef4444';

/**
 * 轨迹描边色。这里必须是具体颜色而非 CSS 变量 —— TrackThumb 把它写在 SVG 的
 * stroke **属性**上，而 var() 在 SVG 呈现属性里不生效。取值与轨迹墙的跑步图例一致。
 */
const TRACK_COLOR = '#f97316';

/**
 * 本地图片要按站点 base 前缀解析，否则 GitHub Pages 子路径部署
 * (PATH_PREFIX=/repo-name) 下会 404。写法同 src/static/site-metadata.ts。
 */
function resolveImage(src: string): string {
  if (/^https?:\/\//.test(src) || src.startsWith('data:')) return src;
  const base = import.meta.env.BASE_URL;
  const prefix = base === '/' ? '' : base.replace(/\/$/, '');
  return `${prefix}${src.startsWith('/') ? '' : '/'}${src}`;
}

/** ShoeStats.totalSeconds 是秒数，useActivities 的 formatDuration 只吃 "H:MM:SS" 字符串 */
function formatSeconds(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function lifespanColor(ratio: number): string {
  if (ratio >= 1) return OVER_COLOR;
  if (ratio >= LIFESPAN_WARN_RATIO) return 'var(--color-run)';
  return 'var(--color-accent)';
}

function LifespanBar({ km, lifespanKm }: { km: number; lifespanKm: number }) {
  const ratio = lifespanKm > 0 ? km / lifespanKm : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
      <div
        className="h-full rounded-full transition-all"
        style={{
          width: `${Math.min(100, ratio * 100)}%`,
          backgroundColor: lifespanColor(ratio),
        }}
      />
    </div>
  );
}

// ── 鞋卡片 ────────────────────────────────────────────────────────────────

function ShoeCard({
  shoe,
  stats,
  selected,
  onClick,
}: {
  shoe: Shoe;
  stats: ShoeStats;
  selected: boolean;
  onClick: () => void;
}) {
  const { t } = useLocale();
  const km = stats.totalDistance / 1000;
  const ratio = shoe.lifespanKm > 0 ? km / shoe.lifespanKm : 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full cursor-pointer flex-col overflow-hidden rounded-xl border bg-[var(--color-card)] p-0 text-left transition-all hover:border-[var(--color-accent)] ${
        selected
          ? 'border-[var(--color-accent)] ring-1 ring-[var(--color-accent)]'
          : 'border-[var(--color-border)]'
      }`}
    >
      <div className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-[var(--color-bg)]">
        {shoe.image ? (
          <img
            src={resolveImage(shoe.image)}
            alt={shoeLabel(shoe)}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="text-3xl opacity-30">👟</span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium text-[var(--color-text)]">
              {shoeLabel(shoe)}
            </p>
            {shoe.nickname && (
              <p className="truncate text-xs text-[var(--color-muted)]">
                {`${shoe.brand} ${shoe.model}`.trim()}
              </p>
            )}
          </div>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
              shoe.retired
                ? 'bg-[var(--color-border)] text-[var(--color-muted)]'
                : 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
            }`}
          >
            {shoe.retired ? t('retired') : t('inService')}
          </span>
        </div>

        <div className="mt-auto space-y-1.5">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-mono font-medium text-[var(--color-text)]">
              {formatDistance(stats.totalDistance)}
              <span className="ml-0.5 font-normal text-[var(--color-muted)]">
                / {shoe.lifespanKm} km
              </span>
            </span>
            <span
              className="text-[10px]"
              style={{ color: lifespanColor(ratio) }}
            >
              {ratio >= 1
                ? t('overLifespan')
                : ratio >= LIFESPAN_WARN_RATIO
                  ? t('nearingEnd')
                  : `${t('remaining')} ${Math.round(shoe.lifespanKm - km)} km`}
            </span>
          </div>
          <LifespanBar km={km} lifespanKm={shoe.lifespanKm} />
        </div>
      </div>
    </button>
  );
}

// ── 新增 / 编辑表单 ────────────────────────────────────────────────────────

const EMPTY_FORM = {
  brand: '',
  model: '',
  nickname: '',
  image: '',
  purchaseDate: '',
  price: '',
  lifespanKm: String(DEFAULT_LIFESPAN_KM),
  retired: false,
  note: '',
};

type FormValues = typeof EMPTY_FORM;

function toForm(shoe: Shoe): FormValues {
  return {
    brand: shoe.brand,
    model: shoe.model,
    nickname: shoe.nickname ?? '',
    image: shoe.image ?? '',
    purchaseDate: shoe.purchaseDate ?? '',
    price: shoe.price === undefined ? '' : String(shoe.price),
    lifespanKm: String(shoe.lifespanKm),
    retired: shoe.retired,
    note: shoe.note ?? '',
  };
}

function ShoeForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: Shoe;
  onSubmit: (values: Omit<Shoe, 'id'>) => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  const [values, setValues] = useState<FormValues>(() =>
    initial ? toForm(initial) : EMPTY_FORM
  );

  const set = <K extends keyof FormValues>(key: K, v: FormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: v }));

  const canSubmit = values.brand.trim() !== '' || values.model.trim() !== '';

  const field =
    'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none';
  const labelCls = 'mb-1 block text-xs text-[var(--color-muted)]';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-lg font-bold text-[var(--color-text)]">
          {initial ? t('editShoe') : t('addShoe')}
        </h3>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{t('brand')}</label>
              <input
                className={field}
                value={values.brand}
                onChange={(e) => set('brand', e.target.value)}
                placeholder="Nike"
              />
            </div>
            <div>
              <label className={labelCls}>{t('model')}</label>
              <input
                className={field}
                value={values.model}
                onChange={(e) => set('model', e.target.value)}
                placeholder="Vaporfly 3"
              />
            </div>
          </div>

          <div>
            <label className={labelCls}>{t('nickname')}</label>
            <input
              className={field}
              value={values.nickname}
              onChange={(e) => set('nickname', e.target.value)}
            />
          </div>

          <div>
            <label className={labelCls}>{t('shoeImage')}</label>
            <input
              className={field}
              value={values.image}
              onChange={(e) => set('image', e.target.value)}
              placeholder="/images/shoes/xxx.jpg"
            />
            <p className="mt-1 text-[10px] text-[var(--color-muted)]">
              {t('shoeImageHint')}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>{t('purchaseDate')}</label>
              <input
                type="date"
                className={field}
                value={values.purchaseDate}
                onChange={(e) => set('purchaseDate', e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>{t('price')}</label>
              <input
                type="number"
                min="0"
                className={field}
                value={values.price}
                onChange={(e) => set('price', e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>{t('lifespanKm')}</label>
              <input
                type="number"
                min="1"
                className={field}
                value={values.lifespanKm}
                onChange={(e) => set('lifespanKm', e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className={labelCls}>{t('note')}</label>
            <input
              className={field}
              value={values.note}
              onChange={(e) => set('note', e.target.value)}
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-text)]">
            <input
              type="checkbox"
              checked={values.retired}
              onChange={(e) => set('retired', e.target.checked)}
            />
            {t('markRetired')}
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => {
              const price = Number(values.price);
              const lifespan = Number(values.lifespanKm);
              onSubmit({
                brand: values.brand.trim(),
                model: values.model.trim(),
                nickname: values.nickname.trim() || undefined,
                image: values.image.trim() || undefined,
                purchaseDate: values.purchaseDate || undefined,
                price:
                  values.price !== '' && Number.isFinite(price)
                    ? price
                    : undefined,
                lifespanKm:
                  Number.isFinite(lifespan) && lifespan > 0
                    ? lifespan
                    : DEFAULT_LIFESPAN_KM,
                retired: values.retired,
                note: values.note.trim() || undefined,
              });
            }}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {t('save')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 详情面板 ──────────────────────────────────────────────────────────────

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] tracking-wide text-[var(--color-muted)] uppercase">
        {label}
      </p>
      <p className="font-mono text-sm font-medium text-[var(--color-text)]">
        {value}
      </p>
    </div>
  );
}

function ShoeDetail({
  shoe,
  stats,
  runs,
  onEdit,
  onDelete,
}: {
  shoe: Shoe;
  stats: ShoeStats;
  runs: Activity[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useLocale();
  const { assignShoe } = useShoes();
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);

  const km = stats.totalDistance / 1000;
  const withPolyline = runs.filter(
    (a) => a.summary_polyline && a.summary_polyline.length > 20
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-bold text-[var(--color-text)]">
              {shoeLabel(shoe)}
            </h3>
            <p className="truncate text-xs text-[var(--color-muted)]">
              {[
                `${shoe.brand} ${shoe.model}`.trim(),
                shoe.purchaseDate,
                shoe.price !== undefined ? `¥${shoe.price}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={onEdit}
              className="rounded px-2 py-1 text-xs text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
            >
              {t('editShoe')}
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="rounded px-2 py-1 text-xs text-[var(--color-muted)] transition-colors hover:text-[var(--color-run)]"
            >
              {t('deleteShoe')}
            </button>
          </div>
        </div>

        {/* 寿命 */}
        <div className="mb-4 space-y-1.5">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-[var(--color-muted)]">{t('mileage')}</span>
            <span className="font-mono text-[var(--color-text)]">
              {km.toFixed(1)} / {shoe.lifespanKm} km
            </span>
          </div>
          <LifespanBar km={km} lifespanKm={shoe.lifespanKm} />
        </div>

        {/* 统计 */}
        <div className="grid grid-cols-3 gap-y-4">
          <StatCell label={t('timesUsed')} value={String(stats.count)} />
          <StatCell
            label={t('duration')}
            value={formatSeconds(stats.totalSeconds)}
          />
          <StatCell label={t('avgPace')} value={formatPace(stats.avgSpeed)} />
          <StatCell
            label={t('longestRun')}
            value={`${(stats.longestDistance / 1000).toFixed(1)} km`}
          />
          <StatCell
            label={t('avgHr')}
            value={
              stats.avgHeartrate ? String(Math.round(stats.avgHeartrate)) : '--'
            }
          />
          <StatCell
            label={t('costPerKm')}
            value={
              shoe.price !== undefined && km > 0
                ? `¥${(shoe.price / km).toFixed(2)}`
                : '--'
            }
          />
          <StatCell
            label={t('firstUse')}
            value={stats.firstUse ? stats.firstUse.slice(0, 10) : '--'}
          />
          <StatCell
            label={t('lastUse')}
            value={stats.lastUse ? stats.lastUse.slice(0, 10) : '--'}
          />
        </div>

        {shoe.note && (
          <p className="mt-4 border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-muted)]">
            {shoe.note}
          </p>
        )}
      </div>

      {/* 轨迹 */}
      {withPolyline.length > 0 && (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
          <h4 className="mb-3 text-sm font-medium text-[var(--color-text)]">
            {t('shoeTracks')}
          </h4>
          <div className="flex flex-wrap gap-1">
            {withPolyline.map((a) => (
              <TrackThumb
                key={a.run_id}
                activity={a}
                color={TRACK_COLOR}
                selected={selectedRunId === a.run_id}
                onClick={() =>
                  setSelectedRunId(selectedRunId === a.run_id ? null : a.run_id)
                }
              />
            ))}
          </div>
        </div>
      )}

      {/* 记录列表 */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
        <h4 className="mb-3 text-sm font-medium text-[var(--color-text)]">
          {t('shoeRecords')}
        </h4>
        {runs.length === 0 ? (
          <p className="py-4 text-center text-sm text-[var(--color-muted)]">
            {t('noRunsForShoe')}
          </p>
        ) : (
          <div className="max-h-[320px] overflow-y-auto">
            <table className="w-full text-sm">
              <tbody>
                {runs.map((a) => (
                  <tr
                    key={a.run_id}
                    onClick={() =>
                      setSelectedRunId(
                        selectedRunId === a.run_id ? null : a.run_id
                      )
                    }
                    className={`cursor-pointer border-b border-[var(--color-border)]/30 transition-colors ${
                      selectedRunId === a.run_id
                        ? 'bg-[var(--color-accent)]/10'
                        : 'hover:bg-[var(--color-bg)]'
                    }`}
                  >
                    <td className="py-2 text-xs text-[var(--color-muted)]">
                      {a.start_date_local.slice(0, 10)}
                    </td>
                    <td className="py-2 font-mono text-xs">
                      {(a.distance / 1000).toFixed(1)} km
                    </td>
                    <td className="py-2 text-xs text-[var(--color-muted)]">
                      {formatPace(a.average_speed)}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          assignShoe(a.run_id, null);
                        }}
                        className="text-xs text-[var(--color-muted)] transition-colors hover:text-[var(--color-run)]"
                      >
                        {t('unbind')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 页面 ──────────────────────────────────────────────────────────────────

interface ShoeCabinetProps {
  /** 必须是未经筛选的全量活动，否则累计里程会偏小 */
  activities: Activity[];
}

export function ShoeCabinet({ activities }: ShoeCabinetProps) {
  const { t } = useLocale();
  const {
    shoes,
    assignments,
    addShoe,
    updateShoe,
    removeShoe,
    isDirty,
    storageOk,
    exportYaml,
    discardDraft,
  } = useShoes();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Shoe | null>(null);
  const [adding, setAdding] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const statsMap = useMemo(
    () => computeShoeStats(activities, assignments),
    [activities, assignments]
  );

  const selected = shoes.find((s) => s.id === selectedId) ?? null;

  const selectedRuns = useMemo(() => {
    if (!selected) return [];
    return activities
      .filter((a) => assignments[a.run_id] === selected.id)
      .sort(
        (a, b) =>
          new Date(b.start_date_local).getTime() -
          new Date(a.start_date_local).getTime()
      );
  }, [activities, assignments, selected]);

  const yaml = exportOpen ? exportYaml() : '';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(yaml);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 非安全上下文下剪贴板不可用，用户可以直接从下方文本框手动复制
    }
  };

  const handleDownload = () => {
    const blob = new Blob([yaml], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = 'shoes.yml';
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="mx-auto max-w-[1400px] px-6 py-6">
      {/* 标题栏 */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-[var(--color-text)]">
          {t('shoeCabinet')}
          <span className="ml-2 text-sm font-normal text-[var(--color-muted)]">
            {shoes.length}
          </span>
        </h2>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          + {t('addShoe')}
        </button>
      </div>

      {!storageOk && (
        <div className="mb-4 rounded-lg border border-[var(--color-run)]/40 bg-[var(--color-run)]/10 px-4 py-2 text-xs text-[var(--color-text)]">
          {t('storageUnavailable')}
        </div>
      )}

      {/* 未提交草稿提示 */}
      {isDirty && (
        <div className="mb-4 rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-[var(--color-text)]">
              {t('unsavedChanges')}
            </span>
            <button
              type="button"
              onClick={() => setExportOpen((v) => !v)}
              className="rounded px-2 py-0.5 text-xs font-medium text-[var(--color-accent)] transition-opacity hover:opacity-80"
            >
              {t('exportYaml')}
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(t('confirmDiscard'))) {
                  discardDraft();
                  setExportOpen(false);
                }
              }}
              className="ml-auto rounded px-2 py-0.5 text-xs text-[var(--color-muted)] transition-colors hover:text-[var(--color-run)]"
            >
              {t('discardDraft')}
            </button>
          </div>

          {exportOpen && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-[var(--color-muted)]">
                {t('exportHint')}
              </p>
              <textarea
                readOnly
                value={yaml}
                onFocus={(e) => e.currentTarget.select()}
                className="h-40 w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3 font-mono text-xs text-[var(--color-text)] focus:outline-none"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="rounded-lg border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-text)] transition-colors hover:border-[var(--color-accent)]"
                >
                  {copied ? t('copied') : t('copyYaml')}
                </button>
                <button
                  type="button"
                  onClick={handleDownload}
                  className="rounded-lg border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-text)] transition-colors hover:border-[var(--color-accent)]"
                >
                  {t('downloadYaml')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {shoes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--color-border)] py-16 text-center">
          <p className="text-4xl opacity-20">👟</p>
          <p className="mt-3 text-sm text-[var(--color-text)]">
            {t('noShoesYet')}
          </p>
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            {t('noShoesHint')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_400px]">
          {/* 鞋墙 */}
          <div className="grid min-w-0 grid-cols-2 gap-4 sm:grid-cols-3">
            {shoes.map((shoe) => (
              <ShoeCard
                key={shoe.id}
                shoe={shoe}
                stats={statsMap.get(shoe.id) ?? EMPTY_STATS}
                selected={selectedId === shoe.id}
                onClick={() =>
                  setSelectedId(selectedId === shoe.id ? null : shoe.id)
                }
              />
            ))}
          </div>

          {/* 详情 */}
          <div className="min-w-0">
            {selected ? (
              <ShoeDetail
                shoe={selected}
                stats={statsMap.get(selected.id) ?? EMPTY_STATS}
                runs={selectedRuns}
                onEdit={() => setEditing(selected)}
                onDelete={() => {
                  if (window.confirm(t('confirmDeleteShoe'))) {
                    removeShoe(selected.id);
                    setSelectedId(null);
                  }
                }}
              />
            ) : (
              <div className="rounded-xl border border-dashed border-[var(--color-border)] py-16 text-center text-sm text-[var(--color-muted)]">
                {t('selectShoeHint')}
              </div>
            )}
          </div>
        </div>
      )}

      {(adding || editing) && (
        <ShoeForm
          initial={editing ?? undefined}
          onCancel={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSubmit={(values) => {
            if (editing) updateShoe(editing.id, values);
            else addShoe(values);
            setAdding(false);
            setEditing(null);
          }}
        />
      )}
    </main>
  );
}
