import { useShoes } from '../hooks/useShoes';
import { useLocale } from '../hooks/useLocale';
import type { Shoe } from '../core/shoes';

export function shoeLabel(shoe: Shoe): string {
  return shoe.nickname || `${shoe.brand} ${shoe.model}`.trim() || shoe.id;
}

interface ShoeSelectProps {
  runId: number;
  /** 表格行内使用时压缩留白 */
  compact?: boolean;
}

/**
 * 行内指定跑鞋的下拉框。
 *
 * 刻意用原生 <select>：ActivityLog 的表格外层是 overflow-x-auto，自绘的绝对
 * 定位浮层会被裁掉，而原生下拉不受父级 overflow 影响，顺带拿到键盘操作和
 * 移动端的原生选择器。
 */
export function ShoeSelect({ runId, compact = false }: ShoeSelectProps) {
  const { shoes, assignments, assignShoe } = useShoes();
  const { t } = useLocale();

  const active = shoes.filter((s) => !s.retired);
  const retired = shoes.filter((s) => s.retired);
  const current = assignments[runId] ?? '';

  if (shoes.length === 0) {
    return (
      <span
        className="text-[var(--color-muted)] opacity-50"
        title={t('noShoesHint')}
      >
        —
      </span>
    );
  }

  return (
    <select
      value={current}
      // 阻止冒泡，否则会触发 <tr> 上的选中/取消选中
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onChange={(e) => {
        e.stopPropagation();
        assignShoe(runId, e.target.value || null);
      }}
      className={`max-w-[140px] cursor-pointer truncate rounded border border-transparent bg-transparent text-sm transition-colors hover:border-[var(--color-border)] focus:border-[var(--color-accent)] focus:outline-none ${
        compact ? 'px-1 py-0.5' : 'px-2 py-1'
      } ${current ? 'text-[var(--color-text)]' : 'text-[var(--color-muted)]'}`}
    >
      <option value="">—</option>
      {active.map((s) => (
        <option key={s.id} value={s.id}>
          {shoeLabel(s)}
        </option>
      ))}
      {retired.length > 0 && (
        <optgroup label={t('retired')}>
          {retired.map((s) => (
            <option key={s.id} value={s.id}>
              {shoeLabel(s)}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
