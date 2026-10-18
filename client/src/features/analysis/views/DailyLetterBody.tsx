import React from "react";
import { useUiLanguage } from "@/features/uiLanguage/UiLanguage";
import { trpc } from "@/lib/trpc";
import { dailyLetterParagraphs } from "../dailyLetterFormat";

// Cache identity only: never put the private letter itself in a query URL.
function sourceKey(text: string) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `${text.length}-${hash >>> 0}`;
}

export function DailyLetterBody({ summary, date, className = "text-sm leading-7 text-foreground" }: { summary: string; date: string; className?: string }) {
  const { language } = useUiLanguage();
  if (language === "zh") return <LetterParagraphs text={summary} className={className} />;
  return <TranslatedLetter summary={summary} date={date} language={language} className={className} />;
}

function LetterParagraphs({ text, className }: { text: string; className: string }) {
  return <>{dailyLetterParagraphs(text).map(paragraph => <p key={paragraph} className={className}>{paragraph}</p>)}</>;
}

function TranslatedLetter({ summary, date, language, className }: { summary: string; date: string; language: "en" | "fr"; className: string }) {
  const translation = trpc.emotionAnalysis.translatedDailyLetter.useQuery(
    { letterDate: date, language: language === "fr" ? "fr" : "en", sourceKey: sourceKey(summary) },
    { enabled: Boolean(summary && date), retry: false, staleTime: 60 * 60 * 1000, refetchOnWindowFocus: false },
  );
  const text = translation.data?.sourceSummary === summary ? translation.data.summary : null;
  if (text === null) {
    const french = language === "fr";
    return <div role="status" className="text-sm leading-7 text-muted-foreground">
      {translation.isError || (translation.isSuccess && !text) ? <>
        <p>{french ? "La traduction est indisponible pour le moment." : "The translated letter is unavailable right now."}</p>
        <button type="button" className="underline underline-offset-4" onClick={() => void translation.refetch()}>{french ? "Réessayer" : "Try again"}</button>
      </> : <p>{french ? "Préparation de votre lettre en français…" : "Preparing your letter in English…"}</p>}
    </div>;
  }
  return <LetterParagraphs text={text} className={className} />;
}
