/**
 * 鞋柜数据层。
 *
 * 真源是仓库根目录的 `shoes.yml`，由 Vite 在构建时解析（同 config.yml 的机制）。
 * 该文件不会被任何同步脚本覆盖，因此适合存放用户手工维护的数据。
 *
 * 落盘形态按「每双鞋挂一个 run_ids 列表」组织（diff 可读、按鞋聚合），
 * 内存形态则拆成 shoes + 扁平的 assignments 映射，便于单条查询与改写。
 */
import rawShoes from '@shoes';
import type { Activity } from './types';
import { parseMovingTime } from './hooks/useActivities';

/** 缺省报废阈值（公里） */
export const DEFAULT_LIFESPAN_KM = 800;

/** 寿命进度达到该比例后进入预警状态 */
export const LIFESPAN_WARN_RATIO = 0.8;

export interface Shoe {
  /** 稳定唯一 id，创建后不再改动 —— run_ids 靠它关联 */
  id: string;
  brand: string;
  model: string;
  /** 可选昵称，展示时优先于「品牌 型号」 */
  nickname?: string;
  /** 本地路径（相对站点根）或 http(s) 远程地址 */
  image?: string;
  /** YYYY-MM-DD */
  purchaseDate?: string;
  /** 购入价格，用于计算每公里成本 */
  price?: number;
  /** 报废阈值（公里） */
  lifespanKm: number;
  retired: boolean;
  note?: string;
}

/** run_id -> shoe id */
export type Assignments = Record<number, string>;

export interface ShoeState {
  shoes: Shoe[];
  assignments: Assignments;
}

/** 单双鞋的使用统计，全部基于未经筛选的全量活动计算 */
export interface ShoeStats {
  /** 使用次数 */
  count: number;
  /** 累计距离（米） */
  totalDistance: number;
  /** 累计移动时间（秒） */
  totalSeconds: number;
  /** 加权平均速度（m/s），无数据时为 0 */
  avgSpeed: number;
  /** 最长单次距离（米） */
  longestDistance: number;
  /** 平均心率，无数据时为 null */
  avgHeartrate: number | null;
  /** 首次 / 最后使用日期（start_date_local 原值），无数据时为 null */
  firstUse: string | null;
  lastUse: string | null;
}

export const EMPTY_STATS: ShoeStats = {
  count: 0,
  totalDistance: 0,
  totalSeconds: 0,
  avgSpeed: 0,
  longestDistance: 0,
  avgHeartrate: null,
  firstUse: null,
  lastUse: null,
};

// ── 归一化 ────────────────────────────────────────────────────────────────

const str = (v: unknown): string | undefined => {
  if (typeof v === 'string') return v.trim() || undefined;
  if (typeof v === 'number') return String(v);
  // js-yaml 会把无引号的 YYYY-MM-DD 解析成 Date
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return undefined;
};

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

/**
 * 把 shoes.yml 的原始内容归一化成内存态。
 *
 * 同一个 run_id 被挂在多双鞋下时以先出现者为准，并在控制台告警 —— 手写
 * 文件时很容易出现这种重复。
 */
export function normalizeShoeState(raw: unknown): ShoeState {
  const list = (raw as { shoes?: unknown } | null)?.shoes;
  if (!Array.isArray(list)) return { shoes: [], assignments: {} };

  const shoes: Shoe[] = [];
  const assignments: Assignments = {};
  const seenIds = new Set<string>();

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const id = str(r.id);
    if (!id) {
      console.warn('[shoes] 跳过缺少 id 的条目', item);
      continue;
    }
    if (seenIds.has(id)) {
      console.warn(`[shoes] 跳过重复的鞋 id: ${id}`);
      continue;
    }
    seenIds.add(id);

    shoes.push({
      id,
      brand: str(r.brand) ?? '',
      model: str(r.model) ?? '',
      nickname: str(r.nickname),
      image: str(r.image),
      purchaseDate: str(r.purchase_date),
      price: num(r.price),
      lifespanKm: num(r.lifespan_km) ?? DEFAULT_LIFESPAN_KM,
      retired: r.retired === true,
      note: str(r.note),
    });

    const runIds = Array.isArray(r.run_ids) ? r.run_ids : [];
    for (const rid of runIds) {
      const n = num(rid);
      if (n === undefined) continue;
      if (assignments[n] !== undefined) {
        console.warn(
          `[shoes] run_id ${n} 同时挂在 ${assignments[n]} 和 ${id} 下，采用前者`
        );
        continue;
      }
      assignments[n] = id;
    }
  }

  return { shoes, assignments };
}

/** shoes.yml 的内容，作为草稿的对比基线 */
export const BASELINE_SHOE_STATE: ShoeState = normalizeShoeState(rawShoes);

// ── 序列化 ────────────────────────────────────────────────────────────────

/** 只有安全的裸标量才免引号，其余一律单引号包裹 */
function yamlScalar(value: string): string {
  if (/^[A-Za-z0-9][A-Za-z0-9 _./+-]*$/.test(value)) return value;
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * 把内存态序列化回 shoes.yml 文本。
 *
 * run_ids 升序输出，保证同样的数据每次生成的文本一致（diff 稳定）。
 */
export function toYaml(state: ShoeState): string {
  const byShoe = new Map<string, number[]>();
  for (const shoe of state.shoes) byShoe.set(shoe.id, []);
  for (const [runId, shoeId] of Object.entries(state.assignments)) {
    byShoe.get(shoeId)?.push(Number(runId));
  }

  const header =
    '# 鞋柜数据 — Shoe cabinet data\n' +
    '# 由「鞋柜」页面导出，可直接覆盖仓库根目录的 shoes.yml 后提交。\n\n';

  if (state.shoes.length === 0) return `${header}shoes: []\n`;

  const blocks = state.shoes.map((shoe) => {
    const lines = [`  - id: ${yamlScalar(shoe.id)}`];
    lines.push(`    brand: ${yamlScalar(shoe.brand)}`);
    lines.push(`    model: ${yamlScalar(shoe.model)}`);
    if (shoe.nickname) lines.push(`    nickname: ${yamlScalar(shoe.nickname)}`);
    if (shoe.image) lines.push(`    image: ${yamlScalar(shoe.image)}`);
    if (shoe.purchaseDate)
      lines.push(`    purchase_date: ${yamlScalar(shoe.purchaseDate)}`);
    if (shoe.price !== undefined) lines.push(`    price: ${shoe.price}`);
    lines.push(`    lifespan_km: ${shoe.lifespanKm}`);
    lines.push(`    retired: ${shoe.retired}`);
    if (shoe.note) lines.push(`    note: ${yamlScalar(shoe.note)}`);
    const runIds = (byShoe.get(shoe.id) ?? []).sort((a, b) => a - b);
    lines.push(`    run_ids: [${runIds.join(', ')}]`);
    return lines.join('\n');
  });

  return `${header}shoes:\n${blocks.join('\n')}\n`;
}

// ── 比较 ──────────────────────────────────────────────────────────────────

/** 归一化成与键序无关的稳定字符串，用于草稿 / 基线的深比较 */
export function fingerprint(state: ShoeState): string {
  const shoes = [...state.shoes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((s) => [
      s.id,
      s.brand,
      s.model,
      s.nickname ?? '',
      s.image ?? '',
      s.purchaseDate ?? '',
      s.price ?? '',
      s.lifespanKm,
      s.retired,
      s.note ?? '',
    ]);
  const assignments = Object.entries(state.assignments)
    .map(([runId, shoeId]) => [Number(runId), shoeId] as const)
    .sort((a, b) => a[0] - b[0]);
  return JSON.stringify({ shoes, assignments });
}

// ── 统计 ──────────────────────────────────────────────────────────────────

/**
 * 一次遍历算出每双鞋的使用统计。
 *
 * 遍历的是活动而非绑定表，所以指向已删除活动的孤儿绑定会被自然忽略。
 * 传入的活动列表必须是**未经年份/距离筛选的全量数据**，否则累计里程会偏小。
 */
export function computeShoeStats(
  activities: Activity[],
  assignments: Assignments
): Map<string, ShoeStats> {
  const acc = new Map<string, ShoeStats & { hrSum: number; hrCount: number }>();

  for (const a of activities) {
    const shoeId = assignments[a.run_id];
    if (!shoeId) continue;

    let s = acc.get(shoeId);
    if (!s) {
      s = { ...EMPTY_STATS, hrSum: 0, hrCount: 0 };
      acc.set(shoeId, s);
    }

    s.count += 1;
    s.totalDistance += a.distance;
    s.totalSeconds += parseMovingTime(a.moving_time);
    if (a.distance > s.longestDistance) s.longestDistance = a.distance;
    if (a.average_heartrate) {
      s.hrSum += a.average_heartrate;
      s.hrCount += 1;
    }
    const date = a.start_date_local;
    if (!s.firstUse || date < s.firstUse) s.firstUse = date;
    if (!s.lastUse || date > s.lastUse) s.lastUse = date;
  }

  const out = new Map<string, ShoeStats>();
  for (const [shoeId, s] of acc) {
    const { hrSum, hrCount, ...rest } = s;
    out.set(shoeId, {
      ...rest,
      avgSpeed: s.totalSeconds > 0 ? s.totalDistance / s.totalSeconds : 0,
      avgHeartrate: hrCount > 0 ? hrSum / hrCount : null,
    });
  }
  return out;
}
