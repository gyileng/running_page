import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import {
  BASELINE_SHOE_STATE,
  fingerprint,
  normalizeShoeState,
  toYaml,
  DEFAULT_LIFESPAN_KM,
  type Shoe,
  type ShoeState,
} from '../shoes';

const DRAFT_KEY = 'shoeCabinet:draft';

const BASELINE_PRINT = fingerprint(BASELINE_SHOE_STATE);

/**
 * 草稿以「完整快照」而非增量存储：读回来就是可直接使用的状态，
 * 不需要和基线做三方合并。
 */
function readDraft(): { state: ShoeState | null; storageOk: boolean } {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return { state: null, storageOk: true };
    const parsed = JSON.parse(raw) as unknown;
    // 形状不对就当作没有草稿。否则一个残缺的草稿会以「空鞋柜」的姿态
    // 盖住 shoes.yml，看起来像是数据丢了。
    if (!parsed || !Array.isArray((parsed as ShoeState).shoes)) {
      return { state: null, storageOk: true };
    }
    // 复用 normalize，草稿里的脏数据同样会被清洗掉
    const state = normalizeShoeState({
      shoes: (parsed as ShoeState).shoes.map((s) => ({
        id: s.id,
        brand: s.brand,
        model: s.model,
        nickname: s.nickname,
        image: s.image,
        purchase_date: s.purchaseDate,
        price: s.price,
        lifespan_km: s.lifespanKm,
        retired: s.retired,
        note: s.note,
        run_ids: Object.entries((parsed as ShoeState).assignments ?? {})
          .filter(([, shoeId]) => shoeId === s.id)
          .map(([runId]) => Number(runId)),
      })),
    });
    return { state, storageOk: true };
  } catch {
    // 隐私模式 / 站点数据被禁用时读取本身就会抛异常
    return { state: null, storageOk: false };
  }
}

interface ShoesContextValue {
  shoes: Shoe[];
  /** run_id -> shoe id */
  assignments: Record<number, string>;
  /** 该次跑步穿的鞋，未指定时为 undefined */
  shoeOf: (runId: number) => Shoe | undefined;
  addShoe: (shoe: Omit<Shoe, 'id'> & { id?: string }) => void;
  updateShoe: (id: string, patch: Partial<Omit<Shoe, 'id'>>) => void;
  removeShoe: (id: string) => void;
  /** 传 null 解除绑定 */
  assignShoe: (runId: number, shoeId: string | null) => void;
  /** 当前状态与 shoes.yml 是否有差异 */
  isDirty: boolean;
  /** localStorage 是否可用；不可用时改动只在本次会话内有效 */
  storageOk: boolean;
  /** 生成可直接覆盖 shoes.yml 的文本 */
  exportYaml: () => string;
  /** 丢弃草稿，回到 shoes.yml 的内容 */
  discardDraft: () => void;
}

const ShoesContext = createContext<ShoesContextValue | null>(null);

/** 由 id 猜一个 slug；重名时自动加后缀 */
function makeShoeId(
  shoe: { brand: string; model: string },
  taken: Set<string>
) {
  const base =
    `${shoe.brand}-${shoe.model}`
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'shoe';
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

export function ShoesProvider({ children }: { children: ReactNode }) {
  const [{ state: draft, storageOk }] = useState(readDraft);
  const [state, setState] = useState<ShoeState>(() => {
    // 草稿与 shoes.yml 完全一致，说明用户已经导出并提交过了 —— 直接丢弃，
    // 避免留下一个永久遮蔽文件的陈旧副本
    if (draft && fingerprint(draft) !== BASELINE_PRINT) return draft;
    return BASELINE_SHOE_STATE;
  });

  const isDirty = useMemo(() => fingerprint(state) !== BASELINE_PRINT, [state]);

  useEffect(() => {
    try {
      if (isDirty) {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
      } else {
        localStorage.removeItem(DRAFT_KEY);
      }
    } catch {
      // 存不进去也不影响当前会话，提示条会告诉用户
    }
  }, [state, isDirty]);

  const shoeById = useMemo(
    () => new Map(state.shoes.map((s) => [s.id, s])),
    [state.shoes]
  );

  const shoeOf = useCallback(
    (runId: number) => {
      const id = state.assignments[runId];
      return id ? shoeById.get(id) : undefined;
    },
    [state.assignments, shoeById]
  );

  const addShoe = useCallback((shoe: Omit<Shoe, 'id'> & { id?: string }) => {
    setState((prev) => {
      const taken = new Set(prev.shoes.map((s) => s.id));
      const id = shoe.id?.trim() || makeShoeId(shoe, taken);
      if (taken.has(id)) return prev;
      return {
        ...prev,
        shoes: [
          ...prev.shoes,
          { ...shoe, id, lifespanKm: shoe.lifespanKm || DEFAULT_LIFESPAN_KM },
        ],
      };
    });
  }, []);

  const updateShoe = useCallback(
    (id: string, patch: Partial<Omit<Shoe, 'id'>>) => {
      setState((prev) => ({
        ...prev,
        shoes: prev.shoes.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      }));
    },
    []
  );

  const removeShoe = useCallback((id: string) => {
    setState((prev) => {
      // 连同它的绑定一起清掉，否则会留下指向不存在鞋子的孤儿绑定
      const assignments: Record<number, string> = {};
      for (const [runId, shoeId] of Object.entries(prev.assignments)) {
        if (shoeId !== id) assignments[Number(runId)] = shoeId;
      }
      return { shoes: prev.shoes.filter((s) => s.id !== id), assignments };
    });
  }, []);

  const assignShoe = useCallback((runId: number, shoeId: string | null) => {
    setState((prev) => {
      const assignments = { ...prev.assignments };
      if (shoeId) assignments[runId] = shoeId;
      else delete assignments[runId];
      return { ...prev, assignments };
    });
  }, []);

  const exportYaml = useCallback(() => toYaml(state), [state]);

  const discardDraft = useCallback(() => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // 忽略：状态回退本身不依赖存储
    }
    setState(BASELINE_SHOE_STATE);
  }, []);

  const value = useMemo(
    () => ({
      shoes: state.shoes,
      assignments: state.assignments,
      shoeOf,
      addShoe,
      updateShoe,
      removeShoe,
      assignShoe,
      isDirty,
      storageOk,
      exportYaml,
      discardDraft,
    }),
    [
      state.shoes,
      state.assignments,
      shoeOf,
      addShoe,
      updateShoe,
      removeShoe,
      assignShoe,
      isDirty,
      storageOk,
      exportYaml,
      discardDraft,
    ]
  );

  return (
    <ShoesContext.Provider value={value}>{children}</ShoesContext.Provider>
  );
}

export function useShoes() {
  const ctx = useContext(ShoesContext);
  if (!ctx) throw new Error('useShoes 必须在 <ShoesProvider> 内使用');
  return ctx;
}
