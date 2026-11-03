import React from "react";

/** Mini-program entry belongs inside the device-choice dialog, not the auth UI. */
export function WechatEntry({
  english = false,
  qrSrc,
}: {
  english?: boolean;
  qrSrc?: string;
}) {
  return (
    <section
      className="shiguang-choice-wechat"
      aria-label={english ? "WeChat mini program" : "微信版"}
    >
      <div>
        <strong>{english ? "WeChat" : "微信版"}</strong>
        <p>
          {qrSrc
            ? english
              ? "Scan with WeChat to open the trial mini program"
              : "微信扫一扫，进入体验版"
            : english
              ? "The trial mini program code is being updated."
              : "小程序体验码待更新"}
        </p>
      </div>
      {qrSrc && (
        <figure className="shiguang-choice-wechat-code">
          <div>
            <img
              src={qrSrc}
              width={358}
              height={458}
              alt={
                english
                  ? "拾光家忆 trial mini program code, valid before November 9, 2026"
                  : "拾光家忆体验版二维码，2026年11月9日前有效，使用微信扫一扫"
              }
            />
          </div>
          <figcaption>
            {english
              ? "Trial · valid before Nov 9, 2026"
              : "体验版 · 11 月 9 日前有效"}
          </figcaption>
        </figure>
      )}
    </section>
  );
}
