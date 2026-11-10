import { useEffect, useRef, useState } from 'react';
import { useUiText } from '@/features/uiLanguage/UiLanguage';

/** A second editor for story metadata, not a copy of the chapter title. */
export function StoryTitleInput({ title, save, disabled = false }: {
  title: string;
  save(title: string): Promise<void>;
  disabled?: boolean;
}) {
  const _ui = useUiText();
  const [draft, setDraft] = useState<string | null>(null);
  const draftRef = useRef(draft);
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [composing, setComposing] = useState(false);

  function edit(value: string | null) {
    draftRef.current = value;
    setDraft(value);
    setError('');
  }
  async function commit() {
    const value = draftRef.current;
    if (disabled || pending.current || value === null) return;
    const next = value.trim();
    if (!next) { setError(_ui('故事名称不能为空')); return; }
    if (next === title) { edit(null); return; }
    pending.current = true;
    setSaving(true);
    try {
      await save(next);
      // A failed save leaves the user's input available for correction/retry.
      if (draftRef.current === value) edit(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : _ui('故事改名失败'));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => {
    if (draft === null || disabled || saving || composing || error) return;
    const timer = setTimeout(() => void commitRef.current(), 1500);
    return () => clearTimeout(timer);
  }, [draft, disabled, saving, composing, error]);
  return <div>
    <input aria-label={_ui('故事名称')} aria-invalid={Boolean(error)} maxLength={255}
      disabled={disabled} aria-busy={saving} className="w-full border-b bg-transparent py-2 text-3xl outline-none"
      value={draft ?? title} onChange={event => edit(event.target.value)} onBlur={() => void commit()}
      onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter') { event.preventDefault(); void commit(); }
        if (event.key === 'Escape') { event.preventDefault(); edit(null); event.currentTarget.blur(); }
      }} />
    {error && <p role="alert" className="mt-1 text-xs text-destructive">{error}</p>}
  </div>;
}
