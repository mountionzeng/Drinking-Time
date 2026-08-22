import { Loader2, Sparkles, UserRoundCog, X } from "lucide-react";
import { assetKindLabel } from "../assetSwapIntent";
import type { AssetSwapController } from "../useAssetSwapProposal";

/**
 * 「把这张图里的人换成素材里的那个人物」的提案卡。
 *
 * 和普通改图卡的区别：这一步除了花钱，还会**改变这一镜以后每次出图的依据**
 * （把资产绑上去）。所以卡上必须把绑定说在前面，不能只显示价格。
 */
export default function AssetSwapProposalCard({
  swap,
}: {
  swap: AssetSwapController;
}) {
  const { status, proposal, proposalText, candidates, result, error } = swap;
  if (status === "idle" && !result && !error) return null;

  return (
    <div className="mt-2.5 min-w-0" data-testid="asset-swap-proposal">
      {status === "ambiguous" && candidates.length > 0 ? (
        <article
          className="rounded-md border border-[var(--nayin-accent)] bg-[var(--nayin-glow)] px-2.5 py-2"
          aria-label="选择要用的资产"
        >
          <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
            <UserRoundCog className="h-3 w-3" />
            <span>
              素材库里有 {candidates.length} 个
              {assetKindLabel(candidates[0]!.kind)}资产
            </span>
          </div>
          <p className="mt-1 text-[11px] text-foreground">用哪一个？</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {candidates.map(candidate => (
              <button
                key={candidate.assetId}
                type="button"
                onClick={() => swap.chooseCandidate(candidate.assetId)}
                className="rounded border border-border px-2 py-1 text-[10px] transition-colors hover:border-primary hover:text-primary"
              >
                {candidate.assetName} · {candidate.versionLabel}
              </button>
            ))}
            <button
              type="button"
              onClick={swap.cancel}
              className="rounded px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
            >
              取消
            </button>
          </div>
        </article>
      ) : null}

      {proposal && status === "confirming" ? (
        <article
          className="rounded-md border border-[var(--nayin-accent)] bg-[var(--nayin-glow)] px-2.5 py-2"
          aria-label="确认换成素材资产"
        >
          <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
            <UserRoundCog className="h-3 w-3" />
            <span>
              {proposal.shotLabel} · 换成素材{assetKindLabel(proposal.kind)}
            </span>
          </div>
          <p className="mt-1 whitespace-pre-line text-[11px] leading-relaxed text-foreground/90">
            {proposalText}
          </p>
          <div className="mt-1.5 flex gap-1.5">
            <button
              type="button"
              onClick={() => void swap.confirm()}
              className="rounded bg-[var(--nayin-accent)] px-2 py-1 text-[10px] font-medium text-white transition-opacity hover:opacity-90"
            >
              {proposal.alreadyBound ? "确认并重画" : "确认绑定并重画"}
            </button>
            <button
              type="button"
              onClick={swap.cancel}
              className="rounded border border-border px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
            >
              取消
            </button>
          </div>
        </article>
      ) : null}

      {status === "binding" || status === "rendering" ? (
        <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          {status === "binding"
            ? "正在把资产绑到这一镜…"
            : "资产已绑定，正在重画这一镜…别重复提交，这一单已经在跑了。"}
        </p>
      ) : null}

      {result && status === "done" ? (
        <article
          className="flex items-start gap-2 rounded-md border border-border bg-background px-2.5 py-2"
          aria-label="换人结果"
        >
          <img
            src={result.imageUrl}
            alt={`${result.shotLabel} 新候选`}
            className="h-16 w-16 shrink-0 rounded object-cover"
            data-testid="asset-swap-result"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
              <Sparkles className="h-3 w-3" />
              <span>
                {result.shotLabel} 新候选 #{result.imageId}
              </span>
            </div>
            <p className="mt-0.5 text-[9.5px] leading-relaxed text-muted-foreground">
              已存进素材仓库，还没替换当前画面。到故事版上点这张的「已选」，
              时间轴和镜头设计表会同时换过来。
            </p>
          </div>
          <button
            type="button"
            onClick={swap.cancel}
            className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="收起结果"
          >
            <X className="h-3 w-3" />
          </button>
        </article>
      ) : null}

      {error && status === "error" ? (
        <p className="text-[10px] leading-relaxed text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
