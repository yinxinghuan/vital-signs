// Lightweight i18n — zh / en only. Auto-detects navigator.language, override
// via localStorage. Per CLAUDE.md rule: keep medical codes (HR, BPM, SpO₂,
// V-FIB, ASYSTOLE, T.O.D., etc.) hardcoded in components — they're meant to
// read like LCD readouts and shouldn't translate.

export type Locale = 'zh' | 'en';
const LS_KEY = 'vital_signs_locale';

function detect(): Locale {
  try {
    const o = localStorage.getItem(LS_KEY) as Locale | null;
    if (o === 'zh' || o === 'en') return o;
  } catch { /* ignore */ }
  const lang = (typeof navigator !== 'undefined' ? navigator.language : 'en').toLowerCase();
  return lang.startsWith('zh') ? 'zh' : 'en';
}

let _locale: Locale = detect();

const EN = {
  'splash.line1': 'night shift · dream-ER',
  'splash.line2': 'their pulse is in your finger',
  'splash.cta': 'TAP TO BEGIN',
  'splash.demo': 'demo mode · run inside Aigram for real friends',
  'splash.view_ward': 'VIEW THE WARD →',

  'play.hint': 'TAP TO BEAT',
  'play.release': 'RELEASE TO RECOVERY',

  'die.flatline': 'ASYSTOLE · NO PULSE',
  'die.vfib': 'CARDIAC ARREST · V-FIB',

  'cert.head': 'CERTIFICATE OF DEATH · DREAM-ER',
  'cert.head_survived': 'DISCHARGE NOTE · DREAM-ER',
  'cert.developing': 'DEVELOPING…',
  'cert.camera_offline': 'morgue camera offline.',
  'cert.complaint': 'PRESENTING',
  'cert.discharge_time': 'DISCH.',
  'cert.on_waking': 'ON WAKING',
  'cert.discharge_verdict': 'RELEASE NOTE',
  'cert.kept_alive': 'KEPT ALIVE',
  'cert.best_streak': 'BEST STREAK',
  'cert.score': 'SCORE',
  'cert.type': 'TYPE',
  'cert.cause': 'CAUSE',
  'cert.tod': 'T.O.D.',
  'cert.last_words': 'LAST WORDS',
  'cert.verdict': 'VERDICT',
  'cert.drafting': 'drafting…',
  'cert.listening': 'listening…',
  'cert.pondering': 'attending pondering…',
  'cert.btn_wall': 'FATE WALL',
  'cert.btn_new': 'NEW SHIFT',

  'load.connecting': 'CONNECTING TO REGISTRY…',
  'empty.head': 'REGISTRY EMPTY',
  'empty.sub1': 'no patients on the ward tonight',
  'empty.sub2': 'add some friends and check back',

  'wall.title': 'FATE WALL',
  'wall.sub': 'recent shifts · dream-ER',
  'wall.empty1': 'no records yet.',
  'wall.empty2': 'be the first to lose someone.',
  'wall.back': '← back',

  'notify.lost': '{sender_name} let your dream-heart stop on the table tonight.',
  'notify.saved': '{sender_name} pulled you through the night shift.',
  'notify.react.candle': '{sender_name} lit a candle on the wall for you.',
  'notify.react.salute': '{sender_name} saluted your shift.',
  'notify.react.rest': '{sender_name} sat with you on the wall.',
};

const ZH: typeof EN = {
  'splash.line1': '夜班 · 梦境急诊',
  'splash.line2': '他们的脉搏在你指尖',
  'splash.cta': 'TAP TO BEGIN',
  'splash.demo': '演示模式 · 在 Aigram 内打开见真实好友',
  'splash.view_ward': '看病房 →',

  'play.hint': 'TAP TO BEAT',
  'play.release': '放手让他出院',

  'die.flatline': 'ASYSTOLE · 无脉搏',
  'die.vfib': '心脏骤停 · V-FIB',

  'cert.head': '死亡证明 · 梦境急诊',
  'cert.head_survived': '出院记录 · 梦境急诊',
  'cert.developing': '冲洗中…',
  'cert.camera_offline': '太平间相机离线。',
  'cert.complaint': '主诉',
  'cert.discharge_time': '出院',
  'cert.on_waking': '苏醒时',
  'cert.discharge_verdict': '医嘱',
  'cert.kept_alive': 'KEPT ALIVE',
  'cert.best_streak': 'BEST STREAK',
  'cert.score': 'SCORE',
  'cert.type': 'TYPE',
  'cert.cause': 'CAUSE',
  'cert.tod': 'T.O.D.',
  'cert.last_words': 'LAST WORDS',
  'cert.verdict': 'VERDICT',
  'cert.drafting': '起草中…',
  'cert.listening': '聆听中…',
  'cert.pondering': '医生沉思中…',
  'cert.btn_wall': '生死墙',
  'cert.btn_new': '下个班次',

  'load.connecting': '连接病案登记中…',
  'empty.head': '登记为空',
  'empty.sub1': '今夜病房没有病人',
  'empty.sub2': '加点朋友再回来看看',

  'wall.title': '生死墙',
  'wall.sub': '近期班次 · 梦境急诊',
  'wall.empty1': '还没有记录。',
  'wall.empty2': '来做第一个失去病人的医生吧。',
  'wall.back': '← 返回',

  'notify.lost': '{sender_name} 让你的梦心今夜停在了急诊台上。',
  'notify.saved': '{sender_name} 把你从夜班里拉了回来。',
  'notify.react.candle': '{sender_name} 在墙上为你点了一支蜡烛。',
  'notify.react.salute': '{sender_name} 向你的班次敬礼。',
  'notify.react.rest': '{sender_name} 在墙边陪你坐了会儿。',
};

const DICTS: Record<Locale, typeof EN> = { en: EN, zh: ZH };

export type TKey = keyof typeof EN;

export function t(key: TKey): string {
  return DICTS[_locale][key] ?? EN[key] ?? key;
}

export function getLocale(): Locale {
  return _locale;
}

export function setLocale(loc: Locale) {
  _locale = loc;
  try { localStorage.setItem(LS_KEY, loc); } catch { /* ignore */ }
}
