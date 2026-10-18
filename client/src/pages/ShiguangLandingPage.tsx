import * as Dialog from "@radix-ui/react-dialog";
import React, { useEffect, useRef, useState } from "react";
import WuxingDrinkIcon from "@/features/nayin/views/WuxingDrinkIcon";
import type { NayinElement } from "@/features/nayin/nayin";
import "./ShiguangLandingPage.css";

const MOBILE_MAKER_URL = "https://www.drinkingtime.top/m";
const DESKTOP_MAKER_URL = "https://www.drinkingtime.top/editing";
const NAYIN_ENTRY = "?visualTheme=nayin";
export function makerEntryUrl(baseUrl: string, english: boolean) {
  return english ? `${baseUrl}${NAYIN_ENTRY}` : baseUrl;
}
const ELEMENTS: { key: NayinElement; label: string }[] = [
  { key: "metal", label: "Metal" },
  { key: "wood", label: "Wood" },
  { key: "water", label: "Water" },
  { key: "fire", label: "Fire" },
  { key: "earth", label: "Earth" },
];

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h13M14 7l5 5-5 5" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
      <path d="M10 5h4M11 18.5h2" />
    </svg>
  );
}

function DesktopIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2.5" y="3.5" width="19" height="13" rx="2" />
      <path d="M8 20h8M12 16.5V20" />
    </svg>
  );
}

function ScreenRecording({ kind, english = false }: { kind: "mobile" | "desktop"; english?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const base = `/shiguang/landing/${english ? "nayin-" : ""}${kind}-demo`;
  const label = english
    ? (kind === "mobile" ? "Nayin: open a conversation and capture a feeling" : "Nayin: timeline editing and page layout")
    : (kind === "mobile" ? "点开小忆，随时记录情绪" : "剪辑时间线与图文排版操作演示");

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPlayback = () => {
      if (preference.matches) videoRef.current?.pause();
      else void videoRef.current?.play().catch(() => {});
    };
    syncPlayback();
    preference.addEventListener("change", syncPlayback);
    return () => preference.removeEventListener("change", syncPlayback);
  }, [base]);

  return (
    <div className={`shiguang-recording shiguang-recording--${kind}`}>
      <video key={base} ref={videoRef} controls aria-label={label} muted loop playsInline preload="metadata" poster={`${base}-poster.jpg`}>
        <source src={`${base}.mp4`} type="video/mp4" />
      </video>
      <img src={`${base}-poster.jpg`} alt="" loading="lazy" />
    </div>
  );
}

export default function ShiguangLandingPage() {
  const english = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("lang") === "en";
  const [makerChoiceOpen, setMakerChoiceOpen] = useState(false);
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null);

  const openMakerChoice = (event: React.MouseEvent<HTMLButtonElement>) => {
    lastTriggerRef.current = event.currentTarget;
    setMakerChoiceOpen(true);
  };

  useEffect(() => {
    const previousTitle = document.title;
    document.title = english
      ? "Drinking Time | Nature changes. So do we."
      : "拾光｜让细微的情绪，成为自己的小短篇";
    return () => {
      document.title = previousTitle;
    };
  }, [english]);

  return (
    <Dialog.Root open={makerChoiceOpen} onOpenChange={setMakerChoiceOpen}>
    <div className={`shiguang-landing${english ? " shiguang-landing--en" : ""}`} lang={english ? "en" : "zh-CN"}>
      <header className="shiguang-nav">
        <a className="shiguang-wordmark" href="#top" aria-label={english ? "Drinking Time home" : "拾光首页"}>
          <span>{english ? "Drinking Time" : "拾光"}</span>
        </a>
        <nav aria-label={english ? "Page navigation" : "页面导航"}>
          <a href="#story">{english ? "Our idea" : "我们的想法"}</a>
          <a href="#flow">{english ? "How it works" : "怎么使用"}</a>
          <div className="shiguang-language-switch" role="group" aria-label={english ? "Page language" : "页面语言"}>
            <a className={!english ? "shiguang-language-current" : ""} href="/shiguang" lang="zh-CN" aria-current={!english ? "page" : undefined}>中文</a>
            <a className={english ? "shiguang-language-current" : ""} href="/shiguang?lang=en" lang="en" aria-current={english ? "page" : undefined}>EN</a>
          </div>
        </nav>
      </header>

      <main id="top">
        <section className="shiguang-hero" aria-labelledby="shiguang-title">
          <div className="shiguang-hero-copy">
            <p className="shiguang-kicker">{english ? "AN ANCIENT LANGUAGE FOR CHANGE" : "把日常里一闪而过的感受，轻轻留下来"}</p>
            <h1 id="shiguang-title">
              {english ? "Nature changes." : "有些事说不清楚，"}
              <span>{english ? "So do we." : "但值得被留下来。"}</span>
            </h1>
            <p className="shiguang-intro">
              {english
                ? "Rooted in the ancient Chinese philosophy of Nayin and the Five Elements, five visual worlds invite you to notice the seasons around you and the feelings within. They won’t tell you who you are. They offer a gentler way to see what is changing."
                : "从一次聊天、一个念头，或某个还没说清楚的小情绪开始。拾光陪你把它慢慢写成故事，再做成只属于你的私人影像。"}
            </p>
            <div className="shiguang-actions">
              <button className="shiguang-primary" type="button" aria-haspopup="dialog" onClick={openMakerChoice}>
                {english ? "Start creating" : "开始制作"} <ArrowIcon />
              </button>
              <a className="shiguang-secondary" href="#flow">{english ? "See how it works" : "先看看怎么用"}</a>
            </div>
            <p className="shiguang-entry-note">{english ? "No labels. No right way to feel." : "不必先想好主题，也不需要会写故事或剪片。"}</p>
          </div>
          {english && (
            <div className="shiguang-elements" aria-hidden="true">
              <p>THE FIVE ELEMENTS</p>
              <div>{ELEMENTS.map(({ key, label }) => <span key={key}><WuxingDrinkIcon element={key} size={58} /><small>{label}</small></span>)}</div>
            </div>
          )}
        </section>

        <section className="shiguang-manifesto" id="story" aria-labelledby="manifesto-title">
          <p className="shiguang-section-number">{english ? "01 · A WAY TO NOTICE" : "01 · 为什么做拾光"}</p>
          <h2 id="manifesto-title">
            {english ? "A season outside." : "当你觉得自己的感受被淹没，"}
            <span>{english ? "A feeling within." : "来拾光坐一会儿。"}</span>
          </h2>
          <p>
            {english
              ? "In ancient Chinese thought, the Five Elements offer a language for the way nature moves and changes. We bring that language into five visual spaces—not to define your feelings, but to help you make room for them."
              : "她会陪你走进一个更辽阔、更安静的世界。在那里，人类文明积累下来的所有艺术，都可以回应你此刻细微的情绪。以此为起点，创作属于自己的小短篇。轻松一点，快乐一点，也日常一点。"}
          </p>
        </section>

        <section className="shiguang-flow" id="flow" aria-labelledby="flow-title">
          <div className="shiguang-flow-heading">
            <p className="shiguang-section-number">{english ? "02 · FROM FEELING TO FILM" : "02 · 从思绪到影像"}</p>
            <h2 id="flow-title">{english ? "Catch the moment on your phone." : "在手机上开头，"}<br />{english ? "Shape it on your computer." : "在电脑上继续。"}</h2>
          </div>

          <div className="shiguang-flow-visual">
            <div className="shiguang-device shiguang-device-mobile">
              <div className="shiguang-device-label"><PhoneIcon /> {english ? "ON YOUR PHONE" : "手机端"}</div>
              <h3>{english ? "A place for your feelings, whenever they arrive" : "接住你和家人的所有思绪"}</h3>
              <p>{english ? "A passing thought, a shift in mood, or something you cannot yet put into words—leave it here when it happens." : "随时聊一句、记下一段回忆，或邀请家人补上同一件往事。"}</p>
              <ScreenRecording kind="mobile" english={english} />
            </div>

            <div className="shiguang-device shiguang-device-desktop">
              <div className="shiguang-device-label"><DesktopIcon /> {english ? "ON YOUR COMPUTER" : "电脑端"}</div>
              <h3>{english ? "Turn what you kept into a film of your own" : "最快捷地生成美丽的私人影像"}</h3>
              <p>{english ? "Shape those moments into scenes, images, and an edit—even if you have never made a film." : "把收下的故事整理成镜头、画面与剪辑，不会剪片也能完成。"}</p>
              <ScreenRecording kind="desktop" english={english} />
            </div>
          </div>
        </section>

        <section className="shiguang-everyday" aria-labelledby="everyday-title">
          <div className="shiguang-everyday-copy">
            <p className="shiguang-section-number">{english ? "03 · START SMALL" : "03 · 从一件小事开始"}</p>
            <h2 id="everyday-title">{english ? "What would you like to keep today?" : "今天想留下什么？"}</h2>
            <div className="shiguang-prompts" aria-label={english ? "Ideas to begin with" : "可以开始记录的话题"}>
              <span>{english ? "Someone on your mind" : "最近总想起的一个人"}</span>
              <span>{english ? "A phrase you keep replaying" : "家里常说的一句话"}</span>
              <span>{english ? "A story left unfinished" : "一段没来得及讲完的往事"}</span>
              <span>{english ? "A feeling you cannot name yet" : "今天忽然有的一点感觉"}</span>
            </div>
            <p>{english ? "There is no right answer. Start talking, and the story will find its shape." : "没有标准答案。先说出来，故事会自己找到它的形状。"}</p>
          </div>
        </section>

        <section className="shiguang-final" aria-labelledby="final-title">
          <span className="shiguang-final-wash" aria-hidden="true" />
          <p className="shiguang-section-number">{english ? "NOW, YOUR STORY" : "现在，轮到你的故事"}</p>
          <h2 id="final-title">{english ? "Let a small feeling" : "让一份细微的情绪，"}<br />{english ? "become your own little story." : "成为自己的小短篇。"}</h2>
          <button className="shiguang-primary" type="button" aria-haspopup="dialog" onClick={openMakerChoice}>
            {english ? "Enter the studio" : "进入拾光制作网页"} <ArrowIcon />
          </button>
          <p>{english ? "Already creating? Sign in to continue your story." : "已在使用拾光？进入后登录即可继续之前的故事。"}</p>
        </section>
      </main>

      <footer className="shiguang-footer">
        <a className="shiguang-wordmark" href="#top">
          <span>{english ? "Drinking Time" : "拾光"}</span>
        </a>
        <span>{english ? "Stories of what matters" : "Drinking Time"}</span>
      </footer>
    </div>
    <Dialog.Portal>
      <Dialog.Overlay className="shiguang-choice-overlay" />
      <Dialog.Content
        className={`shiguang-choice-dialog${english ? " shiguang-choice-dialog--en" : ""}`}
        onCloseAutoFocus={event => {
          event.preventDefault();
          lastTriggerRef.current?.focus();
        }}
      >
        <Dialog.Close className="shiguang-choice-close" aria-label={english ? "Close choices" : "关闭选择界面"}>×</Dialog.Close>
        <Dialog.Title className="shiguang-choice-title">{english ? "Start where you are." : "从哪里开始？"}</Dialog.Title>
        <Dialog.Description className="shiguang-choice-description">
          {english ? "A feeling now. A story when you're ready." : "在手机上留下思绪，在电脑上把故事做成影像。"}
        </Dialog.Description>
        <div className="shiguang-choice-links">
          <a href={makerEntryUrl(MOBILE_MAKER_URL, english)}>
            <PhoneIcon />
            <span><strong>{english ? "Phone" : "手机版"}</strong><small>{english ? "Catch a feeling, whenever it comes." : "记录你和家人的思绪"}</small></span>
            <ArrowIcon />
          </a>
          <a href={makerEntryUrl(DESKTOP_MAKER_URL, english)}>
            <DesktopIcon />
            <span><strong>{english ? "Computer" : "电脑版"}</strong><small>{english ? "Turn what you kept into a personal film." : "制作美丽的私人影像"}</small></span>
            <ArrowIcon />
          </a>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
    </Dialog.Root>
  );
}
