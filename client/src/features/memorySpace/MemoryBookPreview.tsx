import React from "react";
import { Info, Clock3, Users, ArrowUpRight } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { MemoryBook, MemoryShelfView } from "@shared/memorySpace";

export function editingTime(ms: number | null | undefined) {
  if (ms == null) return "未记录";
  if (ms < 60_000) return "不足 1 分钟";
  const minutes = Math.floor(ms / 60_000);
  return minutes < 60
    ? `${minutes} 分钟`
    : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}
export function bookUpdate(book: MemoryBook) {
  return book.pending > 0
    ? "朋友分享回来"
    : book.unread
      ? book.isNew
        ? "新故事"
        : "有更新"
      : null;
}
export function BookOverview({ book }: { book: MemoryBook }) {
  const update = bookUpdate(book);
  return (
    <div className="memory-book-overview">
      <p className="memory-overview-eyebrow">这本故事的近况</p>
      <h3>{book.title}</h3>
      {update && (
        <p className="memory-overview-update">
          <span />
          {update}
          {book.pending > 0 ? ` · ${book.pending} 份待确认` : ""}
        </p>
      )}
      <div className="memory-overview-metrics">
        <div>
          <strong>
            {(book.wordCount ?? 0).toLocaleString()}
            <small> 字</small>
          </strong>
          <span>{book.wordCountLabel ?? "正文"} · 不含空白</span>
        </div>
        <div>
          <strong>{editingTime(book.activeEditingMs)}</strong>
          <span>
            <Clock3 size={12} />
            我的活跃编辑时长
          </span>
        </div>
      </div>
      <h4>
        <Users size={14} />
        参与编辑
      </h4>
      <div className="memory-overview-editor">
        <span className="memory-editor-avatar">我</span>
        <div>
          <strong>我</strong>
          <small>故事作者</small>
        </div>
        <span>{editingTime(book.activeEditingMs)}</span>
      </div>
      {(book.editors ?? []).map((person, index) => (
        <div className="memory-overview-editor" key={index}>
          <span className="memory-editor-avatar">{[...person.name][0]}</span>
          <div>
            <strong>{person.name}</strong>
            <small>
              {person.wordCount == null
                ? "参与排版"
                : `最近提交 ${person.wordCount.toLocaleString()} 字`}
            </small>
          </div>
          <span>{editingTime(person.activeEditingMs)}</span>
        </div>
      ))}
      {!book.editors?.length && (
        <p className="memory-overview-note">还没有朋友提交的编辑记录。</p>
      )}
      <p className="memory-overview-note">
        时长从本次上线起记录，超过 30
        秒无操作暂停计时。朋友的数据截至分享回来时；提交字数不代表净新增字数。
      </p>
      {book.updatedAt && (
        <p className="memory-overview-date">
          最近内容更新 ·{" "}
          {new Date(book.updatedAt).toLocaleString("zh-CN", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      )}
    </div>
  );
}
export function MemoryBookCover({
  book,
  onRead,
  onViewChange,
}: {
  book: MemoryBook;
  onRead: () => void;
  onViewChange: (view: MemoryShelfView | null) => void;
}) {
  const update = bookUpdate(book);
  return (
    <>
      <Tooltip delayDuration={180}>
        <TooltipTrigger asChild>
          <button
            className="memory-book"
            onClick={onRead}
            aria-label={`阅读${book.title}${update ? `，${update}` : ""}`}
          >
            {book.coverUrl && <img src={book.coverUrl} alt="" loading="lazy" />}
            <span className="memory-book-paper">
              <span className="memory-book-edition" aria-hidden="true">
                拾光 · 私人藏书
              </span>
              <span className="memory-book-title">{book.title}</span>
              <span className="memory-book-footer">
                {book.hasText
                  ? `${(book.wordCount ?? 0).toLocaleString()} 字`
                  : "尚未成文"}
              </span>
            </span>
            {update && <span className="memory-book-ribbon">{update}</span>}
          </button>
        </TooltipTrigger>
        <TooltipContent
          className="memory-book-preview"
          side="top"
          sideOffset={12}
          collisionPadding={12}
        >
          <BookOverview book={book} />
        </TooltipContent>
      </Tooltip>
      <Popover>
        <PopoverTrigger asChild>
          <button
            className="memory-book-info"
            aria-label={`查看${book.title}的编辑概览`}
          >
            <Info size={13} />
            <span>概览</span>
            {update && <i aria-hidden="true" />}
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="memory-book-preview"
          side="top"
          sideOffset={8}
          collisionPadding={12}
        >
          <BookOverview book={book} />
          <label className="memory-book-orientation">
            这本书的摆放
            <select
              aria-label={`调整${book.title}的摆放方式`}
              value={book.view ?? ""}
              onChange={e =>
                onViewChange((e.target.value || null) as MemoryShelfView | null)
              }
            >
              <option value="">跟随书架</option>
              <option value="horizontal">横向书脊</option>
              <option value="vertical">纵向书脊</option>
              <option value="album">封面画册</option>
            </select>
          </label>
          <button className="memory-preview-read" onClick={onRead}>
            翻开故事
            <ArrowUpRight size={16} />
          </button>
        </PopoverContent>
      </Popover>
    </>
  );
}
