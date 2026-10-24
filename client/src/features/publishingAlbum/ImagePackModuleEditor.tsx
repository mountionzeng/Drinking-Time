import { ArchiveArtworkButton } from "./ArchiveArtworkButton";
import {
  useEffect,
  useRef,
  useState,
  useMemo,
  useImperativeHandle,
  type Ref,
  type ReactNode,
  type PointerEvent,
  type KeyboardEvent,
} from "react";
import type {
  ImagePackOptions,
  ImagePackResult,
  PackAsset,
} from "./imagePackComposition";
import { downloadPublishingAlbumBlob } from "./publishingAlbumExport";
import { ImagePackCopyDialog } from "./ImagePackCopyDialog";
import { imagePackCopyText } from "./imagePackCopy";
import { moduleCompanionContext, type ModuleLineSource } from "./moduleCompanionContext";
import { ModuleCompanionContext } from "./ModuleSelectionBridge";
import { selectionContentFingerprint } from "@shared/selectionContext";
import { useLayoutOperationMemory } from "./useLayoutOperationMemory";
import type { LayoutAction } from "./layoutOperationMemory";
import { ModuleContextMenu, PageContextMenu } from "./ModuleContextMenu";
import { MobileSheet } from "@/features/mobileWorkspace/MobileSheet";
import {
  MobileModuleTools,
  MobilePageTools,
  MobileModuleTextEditor,
} from "./MobileModuleTools";
import {
  createModuleRenderer,
  renderModulePack,
  type ModuleRenderer,
} from "./imagePackModuleRenderer";
import {
  editModuleText,
  moduleStorageKey,
  readModuleDocument,
  replaceModule,
  moveModuleToPage,
  insertModulePage,
  deleteModulePage,
  transformModule,
  newTextModule,
  newImageModule,
  insertModule,
  flowModulePage,
  modulesOverlap,
  modulePaintOrder,
  type ImagePackModule,
  type ModuleDocument,
  type ModuleHandle,
  type TextModule,
} from "./imagePackModules";

const button =
  "rounded px-2 py-1.5 text-xs hover:bg-[var(--nayin-surface)] focus-visible:outline-2 focus-visible:outline-[var(--nayin-accent)] disabled:opacity-40";
const corners = {
  nw: "-left-1 -top-1 cursor-nwse-resize",
  ne: "-right-1 -top-1 cursor-nesw-resize",
  sw: "-left-1 -bottom-1 cursor-nesw-resize",
  se: "-right-1 -bottom-1 cursor-nwse-resize",
} as const;
const edges = {
  left: "-left-1 top-2 bottom-2 w-2 cursor-ew-resize",
  right: "-right-1 top-2 bottom-2 w-2 cursor-ew-resize",
  top: "-top-1 left-2 right-2 h-2 cursor-ns-resize",
  bottom: "-bottom-1 left-2 right-2 h-2 cursor-ns-resize",
} as const;
const labels = {
  nw: "左上角缩放",
  ne: "右上角缩放",
  sw: "左下角缩放",
  se: "右下角缩放",
  left: "裁切左边",
  right: "裁切右边",
  top: "裁切上边",
  bottom: "裁切下边",
};
const touchCorners = {
  nw: "-left-5 -top-5",
  ne: "-right-5 -top-5",
  sw: "-left-5 -bottom-5",
  se: "-right-5 -bottom-5",
};
const touchEdges = {
  left: "-left-5 top-1/2 -translate-y-1/2",
  right: "-right-5 top-1/2 -translate-y-1/2",
  top: "-top-5 left-1/2 -translate-x-1/2",
  bottom: "-bottom-5 left-1/2 -translate-x-1/2",
};

export type ImagePackModuleEditorHandle = { prepare(): Promise<boolean> };

function ImageLibrarySurface({
  mobile,
  open,
  onOpenChange,
  children,
}: {
  mobile: boolean;
  open: boolean;
  onOpenChange(open: boolean): void;
  children: ReactNode;
}) {
  return mobile ? (
    <MobileSheet open={open} onOpenChange={onOpenChange} title="添加图片">
      {children}
    </MobileSheet>
  ) : (
    <aside
      aria-label="排版可用图片"
      className="sticky top-16 max-h-[70vh] overflow-y-auto"
    >
      {children}
    </aside>
  );
}

function PageCanvas({
  renderer,
  page,
  small = false,
}: {
  renderer: ModuleRenderer;
  page: ModuleDocument["pages"][number];
  small?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drawError, setDrawError] = useState("");
  useEffect(() => {
    try {
      if (canvas.current) renderer.draw(page, canvas.current);
      setDrawError("");
    } catch (cause) {
      setDrawError(cause instanceof Error ? cause.message : "预览暂不可用");
    }
  }, [renderer, page]);
  return (
    <>
      <canvas
        ref={canvas}
        width={small ? 180 : 1800}
        height={small ? 240 : 2400}
        className="block h-auto w-full"
        aria-label={small ? `缩略图：${page.label}` : `模块画布：${page.label}`}
      />
      {drawError && !small && (
        <p role="alert" className="text-xs text-destructive">
          {drawError}
        </p>
      )}
    </>
  );
}

export function ImagePackModuleEditor({
  options,
  scope,
  initial,
  sourceChanged,
  onApply,
  onClose,
  assets = [],
  onUpload,
  generationControls,
  mobile = false,
  ref,
  onPreview,
  companion,
  insertRequest,
  onInsertHandled,
  onDocumentChange,
  lineSource,
}: {
  lineSource?: ModuleLineSource;
  insertRequest?: { id: string; asset: PackAsset } | null;
  onInsertHandled?(): void;
  onDocumentChange?(document: ModuleDocument): void;
  options: ImagePackOptions;
  scope: string;
  initial: ModuleDocument | null;
  sourceChanged: boolean;
  onApply(
    document: ModuleDocument,
    pages: ImagePackResult[],
    pageIndex: number
  ): void;
  onClose(): void;
  assets?: PackAsset[];
  onUpload?(file: File): Promise<PackAsset>;
  generationControls?: ReactNode;
  mobile?: boolean;
  ref?: Ref<ImagePackModuleEditorHandle>;
  onPreview?(): void;
  companion?: { storyId: number; accountId?: number | null; active: boolean };
}) {
  const control = `${button} ${mobile ? "min-h-11 px-3 text-sm" : ""}`;
  const basis = JSON.stringify(options);
  const draftKey = `${moduleStorageKey(scope, basis)}:draft`;
  const companionScope = `${scope}:${selectionContentFingerprint(moduleStorageKey(scope, basis))}`;
  const operationMemory = useLayoutOperationMemory(
    companion?.accountId,
    companion?.storyId,
    companionScope
  );
  const [renderer, setRenderer] = useState<ModuleRenderer | null>(null);
  const [history, setHistory] = useState<{
    past: ModuleDocument[];
    present: ModuleDocument;
    future: ModuleDocument[];
  } | null>(null);
  const historyRef = useRef(history);
  historyRef.current = history;
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImagePackModule | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string; cursor?: number } | null>(
    null
  );
  const [error, setError] = useState("");
  const [storageWarning, setStorageWarning] = useState("");
  const [busy, setBusy] = useState(false);
  const savingText = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const availableAssets = useRef(assets);
  availableAssets.current = assets;
  const [dropActive, setDropActive] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<
    "module" | "page" | "images" | null
  >(null);
  const [cropMode, setCropMode] = useState(false);
  const finishing = useRef(false);
  const drag = useRef<{
    pointerId: number;
    module: ImagePackModule;
    handle: ModuleHandle;
    x: number;
    y: number;
    scale: number;
    next: ImagePackModule;
  } | null>(null);
  useEffect(() => {
    setCropMode(false);
  }, [selectedId, pageIndex]);
  useImperativeHandle(ref, () => ({ prepare: () => finish("preview") }));
  const handledInsert = useRef<string | null>(null);
  useEffect(() => {
    if (history?.present) onDocumentChange?.(history.present);
  }, [history?.present, onDocumentChange]);
  useEffect(() => {
    if (!insertRequest || handledInsert.current === insertRequest.id || !renderer || !history || busy) return;
    handledInsert.current = insertRequest.id;
    if (editing || sourceChanged) {
      setError(editing ? "请先完成当前文字编辑，再从图片列表加入图片。" : "文案已变化，请先更新排版，再加入图片。");
    } else {
      void addImage(insertRequest.asset);
    }
    onInsertHandled?.();
  }, [insertRequest, renderer, history, busy, editing, sourceChanged, onInsertHandled]);
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    let resource: ModuleRenderer | undefined;
    void createModuleRenderer(options, abort.signal)
      .then(async value => {
        resource = value;
        if (abort.signal.aborted) {
          value.dispose();
          return;
        }
        let restored: ModuleDocument | null = null;
        try {
          restored = readModuleDocument(
            localStorage.getItem(draftKey),
            options,
            availableAssets.current.map(asset => asset.imageUrl)
          );
        } catch {
          /* Session editing still works. */
        }
        const document = restored ?? initial ?? value.createDocument();
        await value.validate(document);
        if (!abort.signal.aborted) {
          setRenderer(value);
          setHistory({ past: [], present: document, future: [] });
          try {
            const pending = JSON.parse(
              localStorage.getItem(`${draftKey}:text`) ?? "null"
            );
            if (
              pending &&
              Number.isInteger(pending.page) &&
              typeof pending.text === "string" &&
              pending.text.length <= 12000 &&
              document.pages[pending.page]?.modules.some(
                module => module.kind === "text" && module.id === pending.id
              )
            ) {
              setPageIndex(pending.page);
              setSelectedId(pending.id);
              setEditing({ id: pending.id, text: pending.text });
            }
          } catch {
            /* Invalid temporary text does not prevent opening the saved layout. */
          }
        }
      })
      .catch(cause => {
        if (!abort.signal.aborted)
          setError(cause instanceof Error ? cause.message : "编辑器打开失败");
      });
    return () => {
      abort.abort();
      resource?.dispose();
    };
    // The parent mounts a session with a fixed source snapshot.
  }, [options, initial, draftKey]);

  function store(document: ModuleDocument) {
    try {
      localStorage.setItem(draftKey, JSON.stringify(document));
      setStorageWarning("");
    } catch {
      setStorageWarning("浏览器无法保存草稿，当前修改仅在本次打开期间保留。");
    }
  }
  function cancelText() {
    try {
      localStorage.removeItem(`${draftKey}:text`);
    } catch {
      /* Editing can still close. */
    }
    setEditing(null);
  }
  function changeText(text: string) {
    if (!editing) return;
    const next = { ...editing, text };
    setEditing(next);
    setError("");
    try {
      localStorage.setItem(
        `${draftKey}:text`,
        JSON.stringify({ ...next, page: pageIndex })
      );
    } catch {
      setStorageWarning("浏览器无法保存输入，请及时下载成品。");
    }
  }
  function arrangePage() {
    const current = historyRef.current?.present;
    if (!current || busy || editing) return;
    try {
      commit(
        flowModulePage(
          current,
          pageIndex,
          current.pages[pageIndex].modules.map(module => ({
            ...module,
            positioned: false,
          }))
        ),
        { kind: "arrange", page: pageIndex }
      );
      setMobilePanel(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "整理失败");
    }
  }
  function commit(document: ModuleDocument, action: LayoutAction) {
    const current = historyRef.current;
    if (!current || document === current.present) return;
    operationMemory.record(current.present, document, action);
    const next = {
      past: [...current.past.slice(-29), current.present],
      present: document,
      future: [],
    };
    historyRef.current = next;
    setHistory(next);
    store(document);
    setError("");
  }
  function undo() {
    const current = historyRef.current;
    if (!current?.past.length) return;
    const present = current.past.at(-1)!;
    operationMemory.travel(current.present, present, true);
    const next = {
      past: current.past.slice(0, -1),
      present,
      future: [current.present, ...current.future],
    };
    historyRef.current = next;
    setHistory(next);
    followSelection(present);
    store(present);
  }
  function redo() {
    const current = historyRef.current;
    if (!current?.future.length) return;
    const present = current.future[0];
    operationMemory.travel(current.present, present, false);
    const next = {
      past: [...current.past, current.present],
      present,
      future: current.future.slice(1),
    };
    historyRef.current = next;
    setHistory(next);
    followSelection(present);
    store(present);
  }
  function followSelection(present: ModuleDocument) {
    const target = present.pages.findIndex(page =>
      page.modules.some(module => module.id === selectedId)
    );
    setPageIndex(index =>
      target >= 0 ? target : Math.min(index, present.pages.length - 1)
    );
    if (target < 0) setSelectedId(null);
  }
  const document = history?.present;
  const page = document?.pages[pageIndex];
  const selected = page?.modules.find(module => module.id === selectedId);
  const editingPreview = useMemo(() => {
    if (!document || !editing || !renderer || selected?.kind !== "text")
      return null;
    try {
      const edited = editModuleText(selected, editing.text, renderer.measure);
      if (!selected.positioned) {
        edited.rect.width = selected.rect.width;
        edited.rect.height =
          edited.contentHeight * (selected.rect.width / selected.contentWidth);
      }
      const replaced = replaceModule(document, pageIndex, edited);
      return selected.positioned
        ? replaced
        : flowModulePage(
            replaced,
            pageIndex,
            replaced.pages[pageIndex].modules
          );
    } catch {
      return null;
    }
  }, [document, editing, renderer, selected, pageIndex]);
  const displayDocument = editingPreview ?? document;
  const displayPageIndex =
    editingPreview && editing
      ? editingPreview.pages.findIndex(page =>
          page.modules.some(module => module.id === editing.id)
        )
      : pageIndex;
  const visiblePage =
    page && preview
      ? {
          ...page,
          modules: page.modules.map(module =>
            module.id === preview.id ? preview : module
          ),
        }
      : displayDocument?.pages[displayPageIndex];
  const companionContext = useMemo(() => {
    if (!companion?.active || sourceChanged || !displayDocument || !renderer)
      return null;
    return moduleCompanionContext({
      storyId: companion.storyId,
      scope: companionScope,
      document: displayDocument,
      pageIndex: displayPageIndex,
      selectedId,
      editing,
      lineSource,
      renderer,
    });
  }, [
    companion?.active,
    companion?.storyId,
    sourceChanged,
    displayDocument,
    renderer,
    companionScope,
    displayPageIndex,
    selectedId,
    editing,
    lineSource,
  ]);
  const overlaps = visiblePage?.modules.some((a, index) =>
    visiblePage.modules
      .slice(index + 1)
      .some(b => a.kind === b.kind && modulesOverlap(a.rect, b.rect))
  );

  function changeTextStyle(
    id: string,
    change: Partial<Pick<TextModule, "emphasis" | "backdrop">>
  ) {
    const current = historyRef.current?.present;
    const module = current?.pages[pageIndex]?.modules.find(
      item => item.id === id
    );
    if (!current || module?.kind !== "text" || busy || editing) return;
    if (
      Object.entries(change).every(
        ([key, value]) => module[key as keyof TextModule] === value
      )
    )
      return;
    commit(replaceModule(current, pageIndex, { ...module, ...change }), {
      kind: "style",
      moduleId: id,
      page: pageIndex,
    });
  }
  function deleteModule(id: string) {
    const current = historyRef.current?.present;
    if (
      !current ||
      busy ||
      editing ||
      !current.pages[pageIndex]?.modules.some(item => item.id === id)
    )
      return;
    commit(
      {
        ...current,
        pages: current.pages.map((page, index) =>
          index === pageIndex
            ? { ...page, modules: page.modules.filter(item => item.id !== id) }
            : page
        ),
      },
      { kind: "delete-module", moduleId: id, page: pageIndex }
    );
    setSelectedId(null);
    setMobilePanel(null);
  }
  function moveToPage(id: string, target: number) {
    const current = historyRef.current?.present;
    if (!current || busy || editing || drag.current) return;
    try {
      const next = moveModuleToPage(current, pageIndex, id, target);
      commit(next, { kind: "move-page", moduleId: id, page: pageIndex });
      setMenuOpen(false);
      setPageIndex(target);
      setSelectedId(id);
      setMobilePanel(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "移动失败");
    }
  }
  function changePage(index: number, action: "before" | "after" | "delete") {
    const current = historyRef.current?.present;
    if (!current || busy || editing || drag.current) return;
    try {
      const target = action === "after" ? index + 1 : index;
      const next =
        action === "delete"
          ? deleteModulePage(current, index)
          : insertModulePage(current, target);
      commit(next, {
        kind: action === "delete" ? "delete-page" : "insert-page",
        page: target,
      });
      setMenuOpen(false);
      setSelectedId(null);
      setPageIndex(Math.min(target, next.pages.length - 1));
      setMobilePanel(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "页面修改失败");
    }
  }

  async function addImage(asset: PackAsset, point?: { x: number; y: number }) {
    if (!renderer || !document || busy || editing) return;
    setBusy(true);
    setError("");
    try {
      const size = await renderer.loadImage(asset.imageUrl);
      if (controller.current?.signal.aborted) return;
      const module = newImageModule(crypto.randomUUID(), asset.imageUrl, size);
      let next: ModuleDocument;
      if (point) {
        module.positioned = true;
        module.rect.x = Math.max(
          0,
          Math.min(900 - module.rect.width, point.x - module.rect.width / 2)
        );
        module.rect.y = Math.max(
          0,
          Math.min(1200 - module.rect.height, point.y - module.rect.height / 2)
        );
        next = {
          ...document,
          pages: document.pages.map((page, index) =>
            index === pageIndex
              ? { ...page, modules: [...page.modules, module] }
              : page
          ),
        };
      } else next = insertModule(document, pageIndex, module, selectedId);
      commit(next, { kind: "add-image", moduleId: module.id, page: pageIndex });
      setPageIndex(
        next.pages.findIndex(page =>
          page.modules.some(item => item.id === module.id)
        )
      );
      setSelectedId(module.id);
      setMobilePanel(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "添加图片失败");
    } finally {
      setBusy(false);
    }
  }
  function addText() {
    if (!renderer || !document || busy || editing) return;
    try {
      const module = newTextModule(crypto.randomUUID(), "", renderer.measure);
      const next = insertModule(document, pageIndex, module, selectedId);
      commit(next, { kind: "add-text", moduleId: module.id, page: pageIndex });
      setPageIndex(
        next.pages.findIndex(page =>
          page.modules.some(item => item.id === module.id)
        )
      );
      setSelectedId(module.id);
      setEditing({ id: module.id, text: module.text });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "添加文字失败");
    }
  }
  function start(
    event: PointerEvent<HTMLDivElement | HTMLButtonElement>,
    module: ImagePackModule,
    handle: ModuleHandle
  ) {
    if (busy || editing || drag.current || event.button !== 0 || !stage.current)
      return;
    if (mobile && (selectedId !== module.id || (cropMode && handle === "move")))
      return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedId(module.id);
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      module,
      handle,
      x: event.clientX,
      y: event.clientY,
      scale: 900 / stage.current.getBoundingClientRect().width,
      next: module,
    };
  }
  function move(event: PointerEvent) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.x,
      dy = event.clientY - current.y;
    if (Math.hypot(dx, dy) < 2 && current.next === current.module) return;
    current.next = transformModule(
      current.module,
      current.handle,
      dx * current.scale,
      dy * current.scale
    );
    setPreview(current.next);
  }
  function end(event: PointerEvent, cancel = false) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    setPreview(null);
    if (!cancel && document && current.next !== current.module)
      commit(replaceModule(document, pageIndex, current.next), {
        kind:
          current.handle === "move"
            ? "move"
            : ["left", "right", "top", "bottom"].includes(current.handle)
              ? "crop"
              : "resize",
        moduleId: current.module.id,
        page: pageIndex,
      });
  }
  function keyboard(
    event: KeyboardEvent,
    module: ImagePackModule,
    handle: ModuleHandle
  ) {
    if (
      editing ||
      busy ||
      !document ||
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 10 : 1;
    const dx =
      event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy =
      event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    commit(
      replaceModule(
        document,
        pageIndex,
        transformModule(module, handle, dx, dy)
      ),
      {
        kind:
          handle === "move"
            ? "move"
            : ["left", "right", "top", "bottom"].includes(handle)
              ? "crop"
              : "resize",
        moduleId: module.id,
        page: pageIndex,
      }
    );
  }
  async function saveText(): Promise<boolean> {
    if (!document || !renderer || selected?.kind !== "text" || !editing)
      return false;
    if (savingText.current) return false;
    if (editing.text === selected.text) {
      cancelText();
      return true;
    }
    savingText.current = true;
    setBusy(true);
    try {
      if (!editingPreview)
        throw new Error("这段内容超过一页，请拆成几段添加。");
      const next = editingPreview;
      await renderer.validate(next);
      if (!controller.current?.signal.aborted) {
        commit(next, { kind: "text", moduleId: editing.id, page: pageIndex });
        setPageIndex(
          next.pages.findIndex(page =>
            page.modules.some(module => module.id === editing.id)
          )
        );
        cancelText();
        return true;
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "文字修改失败");
    } finally {
      savingText.current = false;
      setBusy(false);
    }
    return false;
  }
  async function finish(
    action: "current" | "all" | "share" | "preview"
  ): Promise<boolean> {
    if (
      !document ||
      !renderer ||
      !controller.current ||
      sourceChanged ||
      busy ||
      finishing.current ||
      drag.current
    )
      return false;
    finishing.current = true;
    if (editing && !(await saveText())) {
      finishing.current = false;
      return false;
    }
    const currentDocument = historyRef.current!.present;
    const editedPageIndex = editing
      ? currentDocument.pages.findIndex(page =>
          page.modules.some(module => module.id === editing.id)
        )
      : -1;
    const currentPageIndex = Math.min(
      editedPageIndex >= 0 ? editedPageIndex : pageIndex,
      currentDocument.pages.length - 1
    );
    setBusy(true);
    setError("");
    try {
      const pages = await renderModulePack(
        renderer,
        currentDocument,
        controller.current.signal
      );
      if (!controller.current.signal.aborted) {
        onApply(currentDocument, pages, currentPageIndex);
        const current = pages[currentPageIndex];
        if (action === "share") {
          const files = pages.map(
            page => new File([page.blob], page.filename, { type: "image/png" })
          );
          if (!navigator.canShare?.({ files }))
            throw new Error("此浏览器不支持分享图片，请下载后分享。");
          await navigator.share({ files });
        } else if (action !== "preview") {
          for (const page of action === "all" ? pages : [current])
            downloadPublishingAlbumBlob(page.blob, page.filename);
        }
        return true;
      }
    } catch (cause) {
      if (!controller.current.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : "生成图片失败，请重试"
        );
    } finally {
      finishing.current = false;
      setBusy(false);
    }
    return false;
  }
  return (
    <section
      aria-label="模块编辑"
      data-stage-swipe="ignore"
      className={`space-y-3 ${mobile ? "min-w-0" : ""}`}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          drag.current = null;
          setPreview(null);
          if (!busy) cancelText();
        }
      }}
    >
      {companion?.active &&
        !sourceChanged &&
        (companionContext || operationMemory.context) && (
          <ModuleCompanionContext
            context={companionContext}
            memory={operationMemory.context}
            mobile={mobile}
          />
        )}
      {operationMemory.warning && (
        <p role="status" className="text-xs text-muted-foreground">
          {operationMemory.warning}
        </p>
      )}
      <div className="sticky top-0 z-30 flex flex-wrap items-center gap-2 bg-[var(--background)]/95 py-2 backdrop-blur">
        <button
          type="button"
          className={control}
          disabled={busy || !!editing || !renderer}
          onClick={addText}
        >
          ＋ 加文字
        </button>
        {mobile && (
          <button
            type="button"
            className={control}
            disabled={busy || !!editing || !renderer}
            onClick={() => setMobilePanel("images")}
          >
            ＋ 图片
          </button>
        )}
        <span
          className={`${mobile ? "order-last w-full" : "mr-auto"} text-[11px] text-muted-foreground`}
        >
          {displayDocument?.pages.length ?? ""} 页 · 自动存本机 · 原文不变
        </span>
        <button
          type="button"
          className={control}
          disabled={busy || !!editing || !history?.past.length}
          onClick={undo}
        >
          撤销
        </button>
        <button
          type="button"
          className={control}
          disabled={busy || !!editing || !history?.future.length}
          onClick={redo}
        >
          重做
        </button>
        {mobile && (
          <button
            type="button"
            className={`${control} ml-auto text-primary`}
            disabled={busy || !renderer || sourceChanged}
            onClick={onPreview}
          >
            {busy ? "处理中…" : "预览 / 导出"}
          </button>
        )}
        {!mobile && (
          <>
            {companion && <ArchiveArtworkButton
              storyId={companion.storyId} title={options.title} className={control}
              disabled={busy || !!editing || !renderer || sourceChanged}
              loadPages={async () => {
                const current = historyRef.current?.present;
                if (!renderer || !current || sourceChanged) throw new Error("请等待排版完成后重试");
                return renderModulePack(renderer, current, new AbortController().signal);
              }}
            />}
            <ImagePackCopyDialog
              className={control}
              disabled={busy || !!editing || !renderer || sourceChanged}
              text={document ? imagePackCopyText(document) : ""}
              currentPageIndex={pageIndex}
              loadPages={signal => {
                const current = historyRef.current?.present;
                if (!renderer || !current || sourceChanged)
                  return Promise.reject(new Error("请等待排版完成后重试"));
                return renderModulePack(renderer, current, signal);
              }}
            />
            {typeof navigator !== "undefined" &&
              typeof navigator.share === "function" && (
                <button
                  type="button"
                  className={control}
                  disabled={busy || !!editing || !renderer || sourceChanged}
                  onClick={() => void finish("share")}
                >
                  分享图片
                </button>
              )}
            <button
              type="button"
              className={control}
              disabled={busy || !!editing || !renderer || sourceChanged}
              onClick={() => void finish("current")}
            >
              下载当前页
            </button>
            <button
              type="button"
              className={`${control} text-[var(--nayin-accent)]`}
              disabled={busy || !!editing || !renderer || sourceChanged}
              onClick={() => void finish("all")}
            >
              {busy ? "正在处理…" : "下载整套"}
            </button>
          </>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {mobile
          ? cropMode
            ? "拖动图片四边的短线裁切，再点完成裁切。"
            : "轻点选中，再拖动移动；四角缩放，更多功能在模块操作里。"
          : "双击改字 · 右键设置或移页 · 拖动移动 · 四角缩放 · 图片边缘裁切"}
      </p>
      {sourceChanged && (
        <p role="alert" className="text-xs text-destructive">
          正文或排版设置已变化，当前草稿仍保留。
          <button type="button" className="ml-2 underline" onClick={onClose}>
            使用更新后的内容
          </button>
        </p>
      )}
      {storageWarning && (
        <p role="status" className="text-xs text-destructive">
          {storageWarning}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {!renderer && !error && (
        <p className="text-xs text-muted-foreground">正在准备模块…</p>
      )}
      {renderer && document && visiblePage && (
        <>
          {mobile && (
            <div className="flex items-center justify-between text-sm">
              <span>
                第 {displayPageIndex + 1} / {displayDocument!.pages.length} 页
              </span>
              <button
                type="button"
                className={control}
                disabled={busy || !!editing || !!preview}
                onClick={() => setMobilePanel("page")}
              >
                页面操作 ···
              </button>
            </div>
          )}
          <div
            className={
              mobile
                ? "min-w-0 space-y-5"
                : "grid grid-cols-[4.5rem_minmax(0,1fr)_clamp(9rem,20%,15rem)] items-start gap-4"
            }
            data-testid={mobile ? "layout-mobile" : "layout-three-columns"}
          >
            <nav
              aria-label="模块页面"
              className={
                mobile
                  ? "flex gap-2 overflow-x-auto p-1 [touch-action:pan-x_pan-y]"
                  : "sticky top-16 flex max-h-[70vh] flex-col gap-3 overflow-y-auto p-1"
              }
            >
              {displayDocument!.pages.map((item, index) => (
                <PageContextMenu
                  key={index}
                  pageIndex={index}
                  pageCount={document.pages.length}
                  disabled={mobile || busy || !!editing || !!preview}
                  onOpenChange={open => {
                    setMenuOpen(open);
                    if (open) {
                      setPageIndex(index);
                      setSelectedId(null);
                    }
                  }}
                  onInsert={position => changePage(index, position)}
                  onDelete={() => changePage(index, "delete")}
                >
                  <button
                    type="button"
                    disabled={busy || !!editing}
                    title={mobile ? "轻点切换页面" : "右键插入或删除页面"}
                    aria-label={`编辑第 ${index + 1} 页：${item.label}`}
                    aria-pressed={displayPageIndex === index}
                    className={`${mobile ? "w-16" : ""} shrink-0 border-2 p-1 focus-visible:outline-2 focus-visible:outline-[var(--nayin-accent)] ${displayPageIndex === index ? "border-[var(--nayin-accent)]" : "border-transparent"}`}
                    onPointerEnter={event => {
                      if (
                        !mobile &&
                        event.pointerType === "mouse" &&
                        !editing &&
                        !busy &&
                        !menuOpen &&
                        !drag.current
                      ) {
                        setPageIndex(index);
                        setSelectedId(null);
                      }
                    }}
                    onClick={() => {
                      setPageIndex(index);
                      setSelectedId(null);
                    }}
                  >
                    <PageCanvas renderer={renderer} page={item} small />
                    <span className="text-[10px]">
                      {index + 1} · {item.label}
                    </span>
                  </button>
                </PageContextMenu>
              ))}
            </nav>
            <div className="min-w-0">
              <div
                ref={stage}
                className={`relative mx-auto ${mobile ? "w-[calc(100%-1rem)] select-none [-webkit-touch-callout:none]" : "w-full"} max-w-[48rem] outline outline-1 [container-type:inline-size] ${dropActive ? "outline-2 outline-[var(--nayin-accent)]" : "outline-[var(--panel-border)]"}`}
                onDragOver={event => {
                  if (
                    busy ||
                    editing ||
                    !event.dataTransfer.types.includes(
                      "application/x-layout-image"
                    )
                  )
                    return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                  setDropActive(true);
                }}
                onDragLeave={event => {
                  if (
                    !event.currentTarget.contains(event.relatedTarget as Node)
                  )
                    setDropActive(false);
                }}
                onDrop={event => {
                  event.preventDefault();
                  setDropActive(false);
                  const asset = assets.find(
                    item =>
                      String(item.id) ===
                      event.dataTransfer.getData("application/x-layout-image")
                  );
                  if (!asset) return;
                  const bounds = event.currentTarget.getBoundingClientRect();
                  void addImage(asset, {
                    x: ((event.clientX - bounds.left) / bounds.width) * 900,
                    y: ((event.clientY - bounds.top) / bounds.height) * 1200,
                  });
                }}
                onPointerDown={event => {
                  if (event.target === event.currentTarget && !editing)
                    setSelectedId(null);
                }}
              >
                <div className="pointer-events-none">
                  <PageCanvas renderer={renderer} page={visiblePage} />
                </div>
                {modulePaintOrder(visiblePage.modules).map(module => (
                  <ModuleContextMenu
                    key={module.id}
                    module={module}
                    pages={document.pages}
                    pageIndex={pageIndex}
                    disabled={mobile || busy || !!editing}
                    onOpenChange={open => {
                      setMenuOpen(open);
                      if (open) setSelectedId(module.id);
                    }}
                    onChange={change => changeTextStyle(module.id, change)}
                    onDelete={() => deleteModule(module.id)}
                    onMove={target => moveToPage(module.id, target)}
                  >
                    <div
                      role="group"
                      tabIndex={busy || editing ? -1 : 0}
                      aria-label={`${module.kind === "text" ? "文字" : "图片"}模块 ${visiblePage.modules.indexOf(module) + 1}`}
                      data-module-id={module.id}
                      className={`group absolute cursor-move border focus-visible:outline-2 focus-visible:outline-[var(--nayin-accent)] ${selectedId === module.id ? "border-[var(--nayin-accent)]" : "border-transparent hover:border-[var(--nayin-accent)]"}`}
                      style={{
                        touchAction:
                          !mobile || selectedId === module.id
                            ? "none"
                            : "pan-y pinch-zoom",
                        left: `${module.rect.x / 9}%`,
                        top: `${module.rect.y / 12}%`,
                        width: `${module.rect.width / 9}%`,
                        height: `${module.rect.height / 12}%`,
                      }}
                      onFocus={() => {
                        if (!mobile && !editing) setSelectedId(module.id);
                      }}
                      onClick={() => {
                        if (mobile && !busy && !editing)
                          setSelectedId(module.id);
                      }}
                      onPointerDown={event => start(event, module, "move")}
                      onPointerMove={move}
                      onPointerUp={event => end(event)}
                      onPointerCancel={event => end(event, true)}
                      onLostPointerCapture={event => end(event, true)}
                      onKeyDown={event => {
                        if (
                          mobile &&
                          event.key === "Enter" &&
                          event.target === event.currentTarget
                        )
                          setSelectedId(module.id);
                        if (event.target === event.currentTarget)
                          keyboard(event, module, "move");
                      }}
                      onDoubleClick={() => {
                        if (!busy && module.kind === "text") {
                          setSelectedId(module.id);
                          setEditing({ id: module.id, text: module.text });
                        }
                      }}
                    >
                      {!mobile && editing?.id === module.id && (
                        <textarea
                          autoFocus
                          aria-label="文字模块内容"
                          placeholder="写一句话…"
                          value={editing.text}
                          maxLength={12000}
                          disabled={busy}
                          rows={2}
                          className="absolute inset-0 z-30 h-full w-full resize-none bg-[var(--background)]/95 px-[5.5%] py-[3%] text-foreground outline outline-1 outline-[var(--nayin-accent)]"
                          style={{
                            fontSize:
                              module.kind === "text"
                                ? `${(module.fontSize * module.rect.width) / module.contentWidth / 9}cqw`
                                : undefined,
                            lineHeight: 1.6,
                          }}
                          onPointerDown={event => event.stopPropagation()}
                          onBlur={() => {
                            if (!busy) void saveText();
                          }}
                          onSelect={event => {
                            const cursor = event.currentTarget.selectionStart;
                            setEditing(current => current ? { ...current, cursor } : null);
                          }}
                          onChange={event => changeText(event.target.value)}
                        />
                      )}
                      {!editing &&
                        !busy &&
                        (!mobile || selectedId === module.id) && (
                          <>
                            {module.kind === "image" &&
                              (!mobile || cropMode) &&
                              Object.entries(edges).map(
                                ([handle, position]) => (
                                  <button
                                    key={handle}
                                    type="button"
                                    aria-label={
                                      labels[handle as keyof typeof edges]
                                    }
                                    title={labels[handle as keyof typeof edges]}
                                    className={`absolute z-10 touch-none ${mobile ? `grid size-11 place-items-center ${touchEdges[handle as keyof typeof touchEdges]}` : position}`}
                                    onPointerDown={event =>
                                      start(
                                        event,
                                        module,
                                        handle as ModuleHandle
                                      )
                                    }
                                    onKeyDown={event =>
                                      keyboard(
                                        event,
                                        module,
                                        handle as ModuleHandle
                                      )
                                    }
                                  >
                                    {mobile && (
                                      <span
                                        className={`${handle === "left" || handle === "right" ? "h-6 w-1" : "h-1 w-6"} rounded bg-primary ring-1 ring-white`}
                                      />
                                    )}
                                  </button>
                                )
                              )}
                            {(!mobile || !cropMode) &&
                              Object.entries(corners).map(
                                ([handle, position]) => (
                                  <button
                                    key={handle}
                                    type="button"
                                    aria-label={
                                      labels[handle as keyof typeof corners]
                                    }
                                    title={
                                      labels[handle as keyof typeof corners]
                                    }
                                    className={`absolute z-20 touch-none ${mobile ? `grid size-11 place-items-center ${touchCorners[handle as keyof typeof touchCorners]}` : `h-2.5 w-2.5 rounded-sm border border-[var(--nayin-accent)] bg-white ${position}`} ${selectedId === module.id ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100"}`}
                                    onPointerDown={event =>
                                      start(
                                        event,
                                        module,
                                        handle as ModuleHandle
                                      )
                                    }
                                    onKeyDown={event =>
                                      keyboard(
                                        event,
                                        module,
                                        handle as ModuleHandle
                                      )
                                    }
                                  >
                                    {mobile && (
                                      <span className="size-3 rounded-sm border border-primary bg-white" />
                                    )}
                                  </button>
                                )
                              )}
                          </>
                        )}
                    </div>
                  </ModuleContextMenu>
                ))}
              </div>
              {mobile && selected && !editing && (
                <div
                  className="sticky bottom-0 z-30 mt-4 flex flex-wrap items-center gap-1 bg-background/95 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur"
                  aria-label="选中模块工具"
                >
                  {cropMode ? (
                    <button
                      type="button"
                      className={`${control} text-primary`}
                      disabled={busy}
                      onClick={() => setCropMode(false)}
                    >
                      完成裁切
                    </button>
                  ) : (
                    <>
                      {selected.kind === "text" && (
                        <button
                          type="button"
                          className={control}
                          disabled={busy}
                          onClick={() => {
                            setError("");
                            setEditing({
                              id: selected.id,
                              text: selected.text,
                            });
                          }}
                        >
                          编辑文字
                        </button>
                      )}
                      <button
                        type="button"
                        className={`${control} text-primary`}
                        disabled={busy}
                        onClick={() => setMobilePanel("module")}
                      >
                        模块操作 ···
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className={`${control} ml-auto`}
                    disabled={busy}
                    onClick={() => setSelectedId(null)}
                  >
                    取消选择
                  </button>
                </div>
              )}
              <div
                className={`${mobile ? "hidden" : "mt-3 flex flex-wrap items-center gap-2"}`}
              >
                {editing ? (
                  <>
                    <span className="text-xs text-muted-foreground">
                      点击画布外完成输入
                    </span>
                    <button
                      type="button"
                      className={control}
                      onPointerDown={event => event.preventDefault()}
                      onClick={cancelText}
                    >
                      取消改字
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className={control}
                      disabled={busy}
                      onClick={addText}
                    >
                      ＋ {selected ? "在后面加文字" : "加文字"}
                    </button>
                    {selected && (
                      <button
                        type="button"
                        className={control}
                        disabled={busy}
                        onClick={() => deleteModule(selected.id)}
                      >
                        删除选中内容
                      </button>
                    )}
                    <button
                      type="button"
                      className={control}
                      disabled={busy}
                      onClick={arrangePage}
                    >
                      整理这一页
                    </button>
                  </>
                )}
              </div>
              {overlaps && (
                <p className="mt-2 text-xs text-amber-700">
                  有内容重叠，可以拖开或「整理这一页」。
                </p>
              )}
            </div>
            <ImageLibrarySurface
              mobile={mobile}
              open={mobilePanel === "images"}
              onOpenChange={open => {
                if (!busy) setMobilePanel(open ? "images" : null);
              }}
            >
              {mobile && error && (
                <p role="alert" className="mb-3 text-sm text-destructive">
                  {error}
                </p>
              )}
              <div className="mb-3 flex flex-wrap items-center gap-1">
                <span className="mr-auto text-xs font-medium">图片</span>
                {onUpload && (
                  <button
                    type="button"
                    className={control}
                    disabled={busy || !!editing}
                    onClick={() => uploadInput.current?.click()}
                  >
                    上传
                  </button>
                )}
                {generationControls}
              </div>
              <input
                ref={uploadInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-label="上传排版图片"
                className="hidden"
                onChange={async event => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file || !onUpload) return;
                  setBusy(true);
                  try {
                    const asset = await onUpload(file);
                    if (!controller.current?.signal.aborted)
                      await addImage(asset);
                  } catch (cause) {
                    setError(
                      cause instanceof Error ? cause.message : "上传失败"
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              />
              <p className="mb-3 text-[11px] text-muted-foreground">
                {mobile
                  ? "轻点图片加入，再在纸上调整位置。"
                  : "点击加入 · 拖到纸上自由摆放"}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {assets.map(asset => (
                  <button
                    key={asset.id}
                    type="button"
                    draggable={!mobile && !busy && !editing}
                    aria-label={`加入图片：${asset.label}`}
                    disabled={busy || !!editing}
                    className="self-start overflow-hidden text-left outline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--nayin-accent)] disabled:opacity-50"
                    onDragStart={event => {
                      event.dataTransfer.setData(
                        "application/x-layout-image",
                        String(asset.id)
                      );
                      event.dataTransfer.effectAllowed = "copy";
                    }}
                    onDragEnd={() => setDropActive(false)}
                    onClick={() => void addImage(asset)}
                  >
                    <img
                      src={asset.imageUrl}
                      alt={asset.label}
                      draggable={false}
                      className="w-full"
                      loading="lazy"
                    />
                    {asset.warning && (
                      <span className="text-[10px] text-amber-700">
                        {asset.warning}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {!assets.length && (
                <p className="text-xs text-muted-foreground">
                  上传或生成一张图片，就可以放进作品。
                </p>
              )}
            </ImageLibrarySurface>
          </div>
          {mobile && selected && (
            <MobileModuleTools
              open={mobilePanel === "module"}
              onOpenChange={open => setMobilePanel(open ? "module" : null)}
              module={selected}
              pages={document.pages}
              pageIndex={pageIndex}
              disabled={busy || !!editing}
              onEdit={() => {
                if (selected.kind === "text") {
                  setError("");
                  setMobilePanel(null);
                  setEditing({ id: selected.id, text: selected.text });
                }
              }}
              onCrop={() => {
                setMobilePanel(null);
                setCropMode(true);
              }}
              onChange={change => changeTextStyle(selected.id, change)}
              onMove={target => moveToPage(selected.id, target)}
              onDelete={() => deleteModule(selected.id)}
            />
          )}
          {mobile && (
            <MobilePageTools
              open={mobilePanel === "page"}
              onOpenChange={open => setMobilePanel(open ? "page" : null)}
              pageIndex={pageIndex}
              pageCount={document.pages.length}
              disabled={busy || !!editing}
              onInsert={position => changePage(pageIndex, position)}
              onDelete={() => changePage(pageIndex, "delete")}
              onArrange={arrangePage}
            />
          )}
          {mobile && editing && (
            <MobileModuleTextEditor
              text={editing.text}
              error={error}
              disabled={busy}
              onChange={changeText}
              onSelect={cursor => setEditing(current => current ? { ...current, cursor } : null)}
              onSave={() => void saveText()}
              onCancel={cancelText}
            />
          )}
        </>
      )}
    </section>
  );
}
