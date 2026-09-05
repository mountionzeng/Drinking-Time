/**
 * WuxingMotifIcon — 五行饮品的"随身小物"。
 *
 * 顶栏 Logo 是当天的饮品本体，这一层是它掉下来的一小片东西：
 * 金 麦穗 · 木 茶叶 · 水 水滴 · 火 火苗 · 土 咖啡豆。
 * 跟 WuxingDrinkIcon 同一套手绘线稿语言（圆线头、笔触 1.2~1.6），
 * 只是缩到 24×24 的坐标系，够小的地方也能认出来。
 */
import type React from "react";
import type { NayinElement } from "@/features/nayin/nayin";
import { WUXING_DRINK_INK } from "@/features/nayin/views/WuxingDrinkIcon";

interface Props {
  element: NayinElement;
  size?: number;
  className?: string;
}

/** 每个小物的浅色填充，取自对应饮品线稿里已有的颜色。 */
const MOTIF_FILL: Record<NayinElement, string> = {
  metal: "#F2D86A",
  wood: "#A9C66B",
  water: "#9AC5D6",
  fire: "#E08775",
  earth: "#B58968",
};

/** 金 · 麦穗：一根秆，两对麦粒加一个尖。 */
function Barley({ fill }: { fill: string }) {
  return (
    <>
      <path d="M12,22 L12,9" strokeWidth="1.5" />
      <path d="M12,20 c-2.5,-0.6 -3.6,-2 -3.8,-4" strokeWidth="1.2" />
      <path d="M12,20 c2.5,-0.6 3.6,-2 3.8,-4" strokeWidth="1.2" />
      <path
        d="M12,15.5 c-2.6,-0.4 -4,-2 -4,-4.4 c2.6,0.3 4,1.9 4,4.4 z"
        fill={fill}
        strokeWidth="1.3"
      />
      <path
        d="M12,15.5 c2.6,-0.4 4,-2 4,-4.4 c-2.6,0.3 -4,1.9 -4,4.4 z"
        fill={fill}
        strokeWidth="1.3"
      />
      <path
        d="M12,10.5 c-2.2,-0.4 -3.4,-1.9 -3.4,-4 c2.2,0.3 3.4,1.7 3.4,4 z"
        fill={fill}
        strokeWidth="1.3"
      />
      <path
        d="M12,10.5 c2.2,-0.4 3.4,-1.9 3.4,-4 c-2.2,0.3 -3.4,1.7 -3.4,4 z"
        fill={fill}
        strokeWidth="1.3"
      />
      <path
        d="M12,6.6 c-1.3,-1 -1.4,-2.6 -0.2,-4.2 c1.4,1.4 1.5,3 0.2,4.2 z"
        fill={fill}
        strokeWidth="1.3"
      />
    </>
  );
}

/** 木 · 茶叶：一片带主脉的叶子，尖朝右上。 */
function TeaLeaf({ fill }: { fill: string }) {
  return (
    <>
      <path
        d="M4,20 C4,11.5 10.5,4.6 20,4 C20.4,13 13.5,20 4,20 Z"
        fill={fill}
        strokeWidth="1.5"
      />
      <path d="M6.6,17.6 C10,14 14,10 18.2,6.4" strokeWidth="1.2" />
      <path
        d="M9.6,14.8 c0.4,1.6 0.3,2.8 -0.4,4"
        strokeWidth="1"
        opacity=".7"
      />
      <path
        d="M13.4,11 c1.5,0.4 2.6,0.3 3.8,-0.4"
        strokeWidth="1"
        opacity=".7"
      />
    </>
  );
}

/** 水 · 水滴：椰子水掉下来的一颗。 */
function Droplet({ fill }: { fill: string }) {
  return (
    <>
      <path
        d="M12,3 C15.6,8 18.5,11 18.5,14.6 C18.5,18.2 15.6,21 12,21 C8.4,21 5.5,18.2 5.5,14.6 C5.5,11 8.4,8 12,3 Z"
        fill={fill}
        strokeWidth="1.5"
      />
      <path d="M9,15.6 c0,-2 0.8,-3.4 2,-4.6" strokeWidth="1.1" opacity=".65" />
    </>
  );
}

/** 火 · 火苗：煮茶壶底下那一簇。 */
function Flame({ fill }: { fill: string }) {
  return (
    <>
      <path
        d="M12,2.6 c3.2,3.4 5.6,5.8 5.6,9.4 c0,3.9 -2.6,6.4 -5.6,6.4 c-3,0 -5.6,-2.5 -5.6,-6.4 c0,-2.2 1,-3.6 2.2,-5.2 c0.6,1.4 1.4,2 2.2,2.2 c0.4,-2.2 0.4,-4.2 1.2,-6.4 z"
        fill={fill}
        strokeWidth="1.5"
      />
      <path
        d="M12,18.4 c-1.6,0 -2.8,-1.3 -2.8,-3.1 c0,-1.5 1,-2.4 1.8,-3.5 c0.6,1.4 1.6,2 2.6,2.8 c0.8,0.7 1.2,1.3 1.2,2.2"
        strokeWidth="1.1"
        opacity=".6"
      />
      <path d="M9,21.4 q3,-1.2 6,0" strokeWidth="1.2" opacity=".45" />
    </>
  );
}

/** 土 · 咖啡豆：一颗带中缝的豆子。 */
function CoffeeBean({ fill }: { fill: string }) {
  return (
    <>
      <ellipse
        cx="12"
        cy="12"
        rx="6.4"
        ry="8.6"
        fill={fill}
        strokeWidth="1.5"
        transform="rotate(-32 12 12)"
      />
      <path
        d="M8.4,16.4 c2.2,-1.4 2.6,-3.2 1.8,-4.8 c-0.8,-1.6 -0.4,-3.4 1.6,-4.6"
        strokeWidth="1.3"
      />
    </>
  );
}

const MOTIF: Record<NayinElement, (p: { fill: string }) => React.JSX.Element> =
  {
    metal: Barley,
    wood: TeaLeaf,
    water: Droplet,
    fire: Flame,
    earth: CoffeeBean,
  };

/** 每个小物的中文名，给 aria-label / title 用。 */
export const WUXING_MOTIF_NAME: Record<NayinElement, string> = {
  metal: "麦穗",
  wood: "茶叶",
  water: "水滴",
  fire: "火苗",
  earth: "咖啡豆",
};

export default function WuxingMotifIcon({
  element,
  size = 16,
  className = "",
}: Props) {
  const Motif = MOTIF[element];
  const ink = WUXING_DRINK_INK[element];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={ink}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      <Motif fill={MOTIF_FILL[element]} />
    </svg>
  );
}
