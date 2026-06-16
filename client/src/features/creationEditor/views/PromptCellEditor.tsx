import { useEffect, useState } from 'react';
import { Loader2, RefreshCw, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PromptOverride, PromptRow } from '../promptTable/types';

type PromptCellEditorProps = {
  row: PromptRow;
  disabled?: boolean;
  rerendering?: boolean;
  onApply: (override: PromptOverride) => Promise<void> | void;
  onRerender: (override: PromptOverride) => Promise<void> | void;
};

export default function PromptCellEditor({
  row,
  disabled = false,
  rerendering = false,
  onApply,
  onRerender,
}: PromptCellEditorProps) {
  const [value, setValue] = useState(row.value);
  const [weight, setWeight] = useState(row.weight);
  const [isApplying, setIsApplying] = useState(false);

  useEffect(() => {
    setValue(row.value);
    setWeight(row.weight);
  }, [row.dimension, row.value, row.weight]);

  const override = { value, weight };

  return (
    <div className="flex min-w-[240px] flex-col gap-2">
      <textarea
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
        disabled={disabled || isApplying}
        className="min-h-[72px] w-full resize-y rounded-md border border-input bg-background px-2.5 py-2 text-sm leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        aria-label={`${row.label} 提示词`}
      />
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="w-10 tabular-nums">{Math.round(weight * 100)}%</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={weight}
          disabled={disabled || isApplying}
          onChange={(event) => setWeight(Number(event.currentTarget.value))}
          className="flex-1 accent-[var(--primary)]"
          aria-label={`${row.label} 权重`}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || isApplying}
          onClick={async () => {
            setIsApplying(true);
            try {
              await onApply(override);
            } finally {
              setIsApplying(false);
            }
          }}
        >
          {isApplying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          应用
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={disabled || rerendering}
          onClick={() => onRerender(override)}
        >
          {rerendering ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          重渲本镜
        </Button>
      </div>
    </div>
  );
}
