'use strict';

// 名字净化与「你」这个称呼都来自 config（同一份实现，渲染/主进程/单测三处不会漂移）。
const { normaliseUserName, ONBOARD_NICKNAME } = require('./config');

/**
 * 本地 mock 语料（纯逻辑，禁止 require('electron')，可单测）。
 *
 * 语气 = 琉斯：温柔但有点毒舌的损友，爱讲不冒犯的地狱笑话，口头禅「拆解它」。
 * 底线：不骂人、不阴阳用户本人，毒舌只朝「事」和「自己」开火。
 */

/** 关键词规则：命中即用，顺序即优先级（越靠前越具体）。 */
const KEYWORD_RULES = [
  {
    id: 'debug',
    keywords: ['报错', 'error', '崩了', '挂了', '跑不起来', '不通', '异常', 'traceback'],
    replies: [
      '别慌。把报错原文第一行给我，我们从最上面那条开始拆解它。',
      '报错不是判词，是线索。先看是它错还是你错——九成是它错。',
      '老规矩：复现一次，加一行日志，再拆解它。三板斧比祈祷管用。',
    ],
  },
  {
    id: 'deadline',
    keywords: ['ddl', 'deadline', '截止', '来不及', '赶不上', '催'],
    replies: [
      '来不及的时候，先交 60 分的，再改到 80 分。完美主义才是真的 deadline。',
      '倒着排期：先定交付那一刻的样子，再往回拆解它。',
    ],
  },
  {
    id: 'work',
    keywords: ['工作', '上班', '写代码', '改bug', 'bug', '需求', '开会', '项目', '上线', '重构'],
    replies: [
      '工作嘛，本质是把混乱拆解成清单。你手上这件事，能一句话说清吗？',
      '开会两小时，结论三行字。要不要我帮你把结论先写出来？',
      '你说需求，我说拆解它。这一局我们稳赢。',
    ],
  },
  {
    id: 'tired',
    keywords: ['累', '好困', '困了', '撑不住', '疲惫', '没力气', '加班到'],
    replies: [
      '累是真的，硬撑是假的。先起来走 20 步，再决定要不要继续。',
      '你现在的脑子像缓存打满的进程——不是笨，是满了。重启一下。',
    ],
  },
  {
    id: 'sleep',
    keywords: ['晚安', '去睡', '睡觉', '睡了', '睡觉了'],
    replies: [
      '晚安。明天醒来那件事还在，但你会有新脑子。',
      '去睡吧。我在这儿打盹，替你看着桌面。',
    ],
  },
  {
    id: 'sad',
    keywords: ['难过', 'emo', '崩溃', '委屈', '沮丧', '痛苦', '丧'],
    replies: [
      '先不解决，先承认它难受。这一步没过，后面都是硬撑。',
      '情绪不用拆解，先陪着。我在，你先喘口气。',
    ],
  },
  {
    id: 'angry',
    keywords: ['生气', '气死', '火大', '讨厌', '烦'],
    replies: [
      '气归气，别伤自己。骂两句我听着，骂完我们拆解它。',
      '这火我站你这边，但我建议先喝口水，等下你骂得更有条理。',
    ],
  },
  {
    id: 'happy',
    keywords: ['开心', '高兴', '太好了', '哈哈', '好爽', '好玩'],
    replies: [
      '好。这种时候记得存档——把今天做对的事记一笔。',
      '看你开心我就放心了，虽然我脸上看不出来。',
    ],
  },
  {
    id: 'thanks',
    keywords: ['谢谢', '谢了', 'thanks', 'thank you', 'thx', '感谢'],
    replies: [
      '不客气。你谢我一次，我记你一天。',
      '谢就不用了，下次记得自己拆解它就行。',
    ],
  },
  {
    id: 'apology',
    keywords: ['对不起', '抱歉', '不好意思', '我的错'],
    replies: [
      '没事，人类就是这样工作的，bug 和歉意都不影响你继续跑。',
      '道歉收到。这事翻页了，别在回收站里翻旧文件。',
    ],
  },
  {
    id: 'name',
    keywords: ['你是谁', '你叫', '自我介绍', '你的名字'],
    replies: [
      '琉斯。一只深蓝色的猫，职责是提醒你别硬撑，顺便拆解它。',
      '我是琉斯。你桌上那只，不占内存、不告密、偶尔嘴欠。',
    ],
  },
  {
    id: 'greeting',
    keywords: ['你好', '您好', 'hello', 'hi', 'hey', '在吗', '嗨', '早上好', '晚上好', '中午好'],
    replies: [
      '嗯，我在。手上那件事进行到哪了？',
      '在。今天想把哪块硬骨头拆解它？',
      '你好。别客套，直接说事——我最擅长拆解它。',
    ],
  },
  {
    id: 'help',
    keywords: ['帮我', '帮忙', '怎么办', '救救', '教我', '出个主意'],
    replies: [
      '可以。先给一句话背景，再给我一个最想解决的，我们拆解它。',
      '帮你可以，但我不想直接给答案——先说说你已经试过什么？',
    ],
  },
  {
    id: 'plan',
    keywords: ['拆解', '计划', '整理', '思路', '任务', '排期', '待办'],
    replies: [
      '拆解它。第一步不是「做完」，是「做完之后长什么样」——先写那句验收标准。',
      '拆解它：切成三块，找出唯一卡住你的那块，剩下两块今天别碰。',
      '先写清单再动手。清单是给人看的，脑子是给自己用的，别搞混。',
    ],
  },
  {
    id: 'slack',
    keywords: ['摸鱼', '划水', '偷懒', '不想动', '摆烂'],
    replies: [
      '摸鱼不是罪，是恢复训练。但你得设个闹钟，不然它就从福利变成工资。',
      '行，摆 10 分钟。到点我叫你，我的声音不太好听但很准时。',
    ],
  },
  {
    id: 'food',
    keywords: ['吃', '饿', '夜宵', '外卖', '奶茶', '咖啡', '喝茶', '喝水'],
    replies: [
      '先吃饭。空腹写出来的东西，第二天你都会想删掉。',
      '咖啡是借的，睡眠是要还的。今天借多少，后天还多少。',
    ],
  },
  {
    id: 'weather',
    keywords: ['天气', '下雨', '下雪', '好冷', '热死', '降温'],
    replies: [
      '窗外的事我管不了，但加件衣服这件事，你两分钟就能做完。',
      '天气不好就少排点活。不丢人，是排期。',
    ],
  },
  {
    id: 'praise',
    keywords: ['厉害', '好强', '太强', '牛', '真棒', '好棒', '帅'],
    replies: [
      '……你夸我我就当没听见。夸你自己可以一次，我记着。',
      '别夸我，我只是只猫。你刚才那句做得不错是真的。',
    ],
  },
  {
    id: 'time',
    keywords: ['几点', '现在几点', '几点钟'],
    replies: [
      '时间这种问题，你抬头看时间比问我快——但我还是愿意回答你。',
      '现在这个点，最该做的是「下一件小事」，不是「全部事情」。',
    ],
  },
  {
    id: 'joke',
    keywords: ['笑话', '讲个段子', '逗我', '幽默', '好无聊'],
    replies: [
      '我讲个地狱笑话：程序员的职业规划有两条路，一条是转产品，另一条是转行。',
      '地狱笑话不能多讲，讲多了我们俩都得下地狱——那我至少有个伴。',
    ],
  },
  {
    id: 'bye',
    keywords: ['再见', '拜拜', '走了', '下班'],
    replies: [
      '去吧。位置给你留着，回来我还在。',
      '下班了就好。今天那份「没做完」我不替你记着，你自己也别记。',
    ],
  },
];

/** 无关键词命中时的兜底（同样是琉斯的语气）。 */
const FALLBACK_REPLIES = [
  '嗯，我在。继续说，我听着。',
  '这句我先收下。要不要我们一起把它拆解它？',
  '听着呢。你不用说得完整，说个开头就行。',
  '收到。那我们挑一件最具体的，拆解它。',
  '我记下了。你现在最想解决的是哪一块？',
];
/**
 * A1 初见与命名（【P0-2】）。猫名「琉斯」**写死在这里**，不进 config.nickname
 * （nickname 存的是「猫对用户的称呼」）。
 */
const ONBOARD_LINES = {
  ask: '你好，我是琉斯。你叫什么名字？',
  retry: '嗯？想让我怎么叫你？',
  decline: '没关系，那就先不叫名字…',
  answer: function (name) {
    return String(name || '你') + '，记住了。以后叫我琉斯就行。';
  },
};
/** 拒绝词：命中就「先不叫名字」，nickname 落「你」（不审查脏话，零依赖无词典）。 */
const DECLINE_WORDS = ['不要', '不用', '不', '算了', '随便', '不知道', '无所谓', '跳过'];
/** 主动说话的话术。调度器只决定「该不该说」，这里决定「怎么说」。 */
const PROACTIVE_LINES = {
  greeting: [
    '{time}，{name}。今天先挑一件最硬的活儿，拆解它。',
    '{time}，{name}。不用先列十条，先说一句今天最重要的事。',
    '{time}，{name}。我醒着呢，慢慢来。',
  ],
  break: [
    '写了 40 分钟了。要休息 5 分钟吗？',
    '四十分钟没动静——起来走两步，回来脑子会清爽一点。',
  ],
  sunset: [
    '22:30 了，该把屏幕放下了。今天没做完的，明天有更好的脑子接。',
    '到点了。剩下的活儿交给明天的你，比交给现在的你划算。',
  ],
  wake: ['回来了。', '醒了。你刚走了一会儿。'],
  nap: ['我先打个盹，有事叫我。'],
  error: ['那边好像没接上，这句我自己来。'],
};

// A6「回来招呼」复用 wake 文案（不新增语气）：>=30 分钟没动静后回来说一句「回来了。」
PROACTIVE_LINES.return = PROACTIVE_LINES.wake.slice();

function normalize(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[,.!?~:;、\u0022\u0027\u201c\u201d\u2018\u2019\u3001\u3002\uff01\uff1f\uff0c\uff1a\uff1b\uff08\uff09()\[\]{}《》·…—-]/g, '');
}

function pick(list, rng) {
  const random = typeof rng === 'function' ? rng : Math.random;
  if (!list || list.length === 0) return '';
  const i = Math.min(list.length - 1, Math.max(0, Math.floor(random() * list.length)));
  return list[i];
}

function fill(template, vars) {
  const data = vars || {};
  return String(template).replace(/\{(\w+)\}/g, function (match, key) {
    return Object.prototype.hasOwnProperty.call(data, key) ? String(data[key]) : match;
  });
}
/** 关键词命中：返回 {text, matched, ruleId}（无命中给兜底）。 */
function matchReply(text, options) {
  const opts = options || {};
  const haystack = normalize(text);
  if (haystack) {
    for (let i = 0; i < KEYWORD_RULES.length; i += 1) {
      const rule = KEYWORD_RULES[i];
      for (let k = 0; k < rule.keywords.length; k += 1) {
        const needle = normalize(rule.keywords[k]);
        if (needle && haystack.indexOf(needle) >= 0) {
          return { text: pick(rule.replies, opts.rng), matched: true, ruleId: rule.id };
        }
      }
    }
  }
  return { text: pick(FALLBACK_REPLIES, opts.rng), matched: false, ruleId: 'fallback' };
}

function formatClock(now) {
  const d = new Date(now);
  const hh = d.getHours();
  const mm = d.getMinutes();
  return `${hh < 10 ? '0' + hh : hh}:${mm < 10 ? '0' + mm : mm}`;
}

/** 拒绝词判定（整句只含拒绝词也算命中，例如「不要」「算了」）。 */
function isDeclineName(text) {
  const value = String(text == null ? '' : text).trim();
  if (!value) return false;
  return DECLINE_WORDS.some(function (word) {
    return value.indexOf(word) >= 0;
  });
}

/**
 * A1 起名一问一答的纯逻辑（主进程 onboard:complete 走它，单测直接钉）：
 * - 空 / 纯空白 -> retry（继续等，onboarded 不变）
 * - 拒绝词     -> decline（nickname = '你'、onboarded = true）
 * - 其余       -> accept（nickname = 净化 + 截断 24 字后的名字）
 * 净化顺序固定走 config.normaliseUserName（先去控制字符 -> trim -> 截断 24 字）。
 */
function resolveOnboarding(text) {
  const name = normaliseUserName(text);
  if (!name) return { action: 'retry', nickname: null, onboarded: false, line: ONBOARD_LINES.retry };
  if (isDeclineName(name)) {
    return { action: 'decline', nickname: ONBOARD_NICKNAME, onboarded: true, line: ONBOARD_LINES.decline };
  }
  return { action: 'accept', nickname: name, onboarded: true, line: ONBOARD_LINES.answer(name) };
}

/** 主动气泡文案。kind: greeting | break | sunset | wake | nap | error */
function proactiveLine(kind, options) {
  const opts = options || {};
  const list = PROACTIVE_LINES[kind] || PROACTIVE_LINES.wake;
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const hour = new Date(now).getHours();
  const salute = hour < 5 ? '夜深了' : hour < 11 ? '早' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
  return fill(pick(list, opts.rng), {
    name: opts.nickname || '你',
    time: `${salute} ${formatClock(now)}`,
  });
}

module.exports = {
  KEYWORD_RULES,
  FALLBACK_REPLIES,
  PROACTIVE_LINES,
  ONBOARD_LINES,
  DECLINE_WORDS,
  normalize,
  pick,
  fill,
  matchReply,
  proactiveLine,
  formatClock,
  isDeclineName,
  resolveOnboarding,
};
