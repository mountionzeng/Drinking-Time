export type PublicDailyLetter = {
  date: string;
  attention: string;
  paragraphs: readonly string[];
};

const PUBLIC_DAILY_LETTERS: readonly Omit<PublicDailyLetter, "date">[] = [
  {
    attention: "别急着把整周一次想完，先照顾眼前这一小段。",
    paragraphs: [
      "早上好。新的一周刚开始，不必现在就知道它最后会走到哪里。今天只需要把眼前这一小段过清楚。",
      "如果事情很多，先选一件做完后会让其他事情更容易的事。给它二十分钟，结束后再重新看一眼手里的清单。",
      "没有完成的部分可以留到明天。一天不需要装下所有答案。",
    ],
  },
  {
    attention: "把最重要的一件事做小，小到现在就能开始。",
    paragraphs: [
      "今天给你留一句很简单的话：重要的事，不一定要用很大的动作开始。",
      "把它缩小成一个能在十分钟里完成的步骤。写下第一行、发出第一条消息，或者只把需要的东西放到桌面上。",
      "开始以后，下一步通常会比想象中清楚一点。",
    ],
  },
  {
    attention: "走到一半的时候，可以停下来重新选择轻重。",
    paragraphs: [
      "一周走到中间，手上的事情可能已经和最初想的不太一样。今天允许你重新排一次顺序。",
      "看看哪些事情真的在向前走，哪些只是因为已经开始了，所以还被你带在身上。暂时放下一件，也是一种决定。",
      "把力气留给仍然重要的部分。",
    ],
  },
  {
    attention: "今天可以少解释一点，把时间留给真正要做的事。",
    paragraphs: [
      "有些日子，我们花了很多时间说明自己，却没有更靠近真正想做的事。",
      "今天可以少解释一点。先完成一个属于你的动作，让结果替你说一部分话。",
      "不必让每个人同时理解你，事情仍然可以慢慢长出来。",
    ],
  },
  {
    attention: "把今天收好，不必把所有未完成都带进晚上。",
    paragraphs: [
      "这一周也许已经装了很多东西。今天结束前，给自己留几分钟，把完成的和没完成的分开放好。",
      "完成的事可以承认，没完成的事写下下一步就够了。它们不需要整晚待在脑子里提醒你。",
      "把工作留在工作结束的地方，晚上还可以属于生活。",
    ],
  },
  {
    attention: "留一点不为结果服务的时间。",
    paragraphs: [
      "今天不必把每一段时间都变成成果。可以去走一小段路，慢慢吃一顿饭，或者只是把窗打开一会儿。",
      "这些看起来没有产出的片刻，会把一天重新还给你。",
      "休息不是把生活暂停，而是生活本来就有的一部分。",
    ],
  },
  {
    attention: "不急着总结这一周，先看看有什么值得带到明天。",
    paragraphs: [
      "一周结束时，很容易急着给它一个评价：做得够不够多，走得够不够远。今天先不评分。",
      "只挑一件你愿意继续带着的事，也挑一件可以留在这一周的事。这样就已经是在整理生活。",
      "明天开始时，你不需要从所有事情重新出发。",
    ],
  },
];

const ENGLISH_DAILY_LETTERS: readonly Omit<PublicDailyLetter, "date">[] = [
  {
    "attention": "There is no need to plan the whole week at once. Take care of the next small part.",
    "paragraphs": [
      "Good morning. A new week is beginning, and you do not need to know where it will end. For today, it is enough to live this small part with care.",
      "If there is a lot to do, choose one thing that would make the rest easier. Give it twenty minutes, then look at your list again.",
      "What remains unfinished can wait until tomorrow. One day does not have to hold every answer."
    ]
  },
  {
    "attention": "Make the most important thing small enough to begin now.",
    "paragraphs": [
      "A simple thought for today: important things do not always need a grand beginning.",
      "Make it a step you can finish in ten minutes. Write the first line, send the first message, or simply put what you need on the table.",
      "Once you begin, the next step often becomes a little clearer."
    ]
  },
  {
    "attention": "Halfway through, you can pause and reconsider what matters.",
    "paragraphs": [
      "By the middle of the week, things may look different from what you expected. You can put them in a different order today.",
      "Notice what is truly moving forward and what you are carrying simply because you started it. Setting something aside for now is also a decision.",
      "Save your energy for what still matters."
    ]
  },
  {
    "attention": "You can explain a little less today and leave time for what you want to do.",
    "paragraphs": [
      "Some days we spend a lot of time explaining ourselves without getting closer to what we want to do.",
      "Today, you can explain a little less. Take one step of your own and let the result speak for part of it.",
      "Not everyone needs to understand you at once for things to keep growing."
    ]
  },
  {
    "attention": "Let the day end without carrying everything unfinished into the evening.",
    "paragraphs": [
      "This week may already have held a lot. Before today ends, take a few minutes to separate what is done from what is not.",
      "You can acknowledge what you finished. For the rest, writing down the next step is enough; it does not need to stay in your mind all evening.",
      "Leave work where work ends. The evening can still belong to your life."
    ]
  },
  {
    "attention": "Leave a little time that does not need to produce a result.",
    "paragraphs": [
      "Not every moment today needs to become an achievement. Take a short walk, enjoy a meal slowly, or simply open a window for a while.",
      "These seemingly unproductive moments can give the day back to you.",
      "Rest is not a pause in life. It is part of life itself."
    ]
  },
  {
    "attention": "Before summing up the week, notice what is worth taking into tomorrow.",
    "paragraphs": [
      "As a week ends, it is easy to judge it: did you do enough, did you get far enough? Today, leave it ungraded.",
      "Choose one thing you would like to carry forward and one you can leave in this week. That is already a way of putting life in order.",
      "When tomorrow begins, you do not have to start again from everything."
    ]
  }
];

function dayIndex(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return 0;
  const day = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  ).getUTCDay();
  return day === 0 ? 6 : day - 1;
}

export function publicDailyLetterForDate(date: string, language: string = "zh"): PublicDailyLetter {
  return {
    date,
    ...(language === "en" ? ENGLISH_DAILY_LETTERS : PUBLIC_DAILY_LETTERS)[dayIndex(date)],
  };
}
