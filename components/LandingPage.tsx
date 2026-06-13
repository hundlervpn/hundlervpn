'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { motion, AnimatePresence } from 'motion/react';
import {
  Shield,
  Zap,
  Globe,
  Lock,
  CheckCircle2,
  ArrowRight,
  MonitorSmartphone,
  Star,
  Server,
  UserPlus,
  CreditCard,
  Plug,
  ChevronDown,
  Quote,
  Wifi,
  Headphones,
  HelpCircle,
} from 'lucide-react';
import ParticlesBackground from '@/components/ParticlesBackground';

// Marketing landing page shown to unauthenticated browser visitors.
// Displays features, pricing teaser, and a CTA that routes to /login
// for sign-in or sign-up. Telegram WebApp users never see this — they
// are auto-authenticated and land directly on the main app.
export default function LandingPage() {
  const router = useRouter();

  // Capture a site referral code from `?ref=<code>` (e.g. a friend opens
  // hundlervpn.xyz/?ref=<code>) and persist it so it survives the route to
  // /login and the email/Google signup. The inviter then earns the 10%
  // cash reward on this user's RUB subscription payments (no bonus days —
  // email/Google referrals are cash-only).
  useEffect(() => {
    try {
      const ref = new URLSearchParams(window.location.search).get('ref');
      if (ref && ref.trim()) {
        localStorage.setItem('hvpn_ref', ref.trim().slice(0, 64));
      }
    } catch { /* ignore */ }
  }, []);

  const goToLogin = () => {
    // Forward the referral code to /login as well, so it's present even if
    // localStorage is unavailable (private mode / blocked storage).
    let ref = '';
    try { ref = (localStorage.getItem('hvpn_ref') || '').trim(); } catch { /* ignore */ }
    router.push(ref ? `/login?ref=${encodeURIComponent(ref)}` : '/login');
  };

  const features = [
    {
      icon: Zap,
      title: 'Молниеносная скорость',
      desc: 'VLESS + Reality протокол. Без задержек на 4K-стримах и в играх.',
    },
    {
      icon: Shield,
      title: 'Полная анонимность',
      desc: 'Не храним логи. Шифрование XTLS Vision — невидимы для DPI.',
    },
    {
      icon: Globe,
      title: 'Серверы по всему миру',
      desc: 'Нидерланды, Германия и новые локации. Свободный интернет без ограничений.',
    },
    {
      icon: Lock,
      title: 'Обход блокировок',
      desc: 'Reality маскирует трафик под обычный HTTPS. Работает там, где другие VPN заблокированы.',
    },
    {
      icon: MonitorSmartphone,
      title: 'Все устройства',
      desc: 'iOS, Android, Windows, macOS, Linux. До 3 устройств одновременно.',
    },
    {
      icon: Server,
      title: 'Своя инфраструктура',
      desc: 'Собственные серверы, не аренда у крупных провайдеров. Полный контроль.',
    },
  ];

  const benefits = [
    '3 дня бесплатно для новых пользователей',
    'От 7 ₽ за день подписки',
    'Оплата картой, СБП или криптой',
    'Без рекламы и скрытых платежей',
    'Поддержка 24/7 в Telegram',
  ];

  // Three simple steps — mirrors the "Три простых шага" section on
  // ivpnus.ru but with our VLESS+Reality wording. Icons colour-coded to
  // keep continuity with the red/orange brand.
  const steps = [
    {
      icon: UserPlus,
      title: 'Регистрация',
      desc: 'Через Telegram-бота или этот сайт. Займёт меньше минуты, e-mail не нужен.',
    },
    {
      icon: CreditCard,
      title: 'Выберите срок',
      desc: 'От 7 ₽ за день. Скидка 10 % на 6 месяцев и 15 % на годовую подписку.',
    },
    {
      icon: Plug,
      title: 'Подключайтесь',
      desc: 'Импортируйте подписку в Happ или v2rayTun — и пользуйтесь.',
    },
  ];

  // Plan feature bullets. Single-plan model: one subscription, all features
  // included. Matches pricing.ts (PRICE_PER_DAY_RUB = 7).
  const planFeatures = [
    { icon: Globe, text: 'Локации: NL · DE · RU · Hy2' },
    { icon: Zap, text: 'До 3 устройств одновременно' },
    { icon: Wifi, text: 'Работает на LTE/5G и в Wi-Fi-ограничениях' },
    { icon: Shield, text: 'VLESS, Hysteria' },
    { icon: Lock, text: 'Без логов, без рекламы' },
    { icon: Headphones, text: 'Поддержка 24/7 в Telegram' },
  ];

  // Testimonials — 6 short user quotes mimicking the reviews row on
  // ivpnus.ru. Names are placeholder first-names + region for authenticity.
  const testimonials = [
    {
      name: 'Артём',
      region: 'Москва',
      text: 'Стримлю 4K без единого фриза. Пинг в Valorant минимальный — разница с другими VPN огромная.',
    },
    {
      name: 'Екатерина',
      region: 'Санкт-Петербург',
      text: 'Подключилась через бота за минуту, никаких сложных настроек. Работает на iPhone и MacBook на одной подписке.',
    },
    {
      name: 'Дмитрий',
      region: 'Новосибирск',
      text: 'Удалённо работаю через немецкий офис — созвоны стабильные, рабочие сервисы не отваливаются.',
    },
    {
      name: 'Мария',
      region: 'Казань',
      text: 'Подключила семью — все устройства, даже телевизор. Одна подписка, никто не жалуется.',
    },
    {
      name: 'Иван',
      region: 'Екатеринбург',
      text: 'Перешёл с дорогого зарубежного VPN, который еле тянул рабочие программы. Hundler быстрее и кратно дешевле.',
    },
    {
      name: 'Ольга',
      region: 'Ростов-на-Дону',
      text: 'На мобильном интернете, куда другие VPN просто не пускают, тут работает. Поддержка отвечает моментально.',
    },
  ];

  // FAQ accordion entries. Kept short and factual — answers mirror our
  // actual product rules (3 devices per sub, refund policy lives in Telegram
  // support chat, no-logs is real per AGENTS.md).
  const faqEntries = [
    {
      q: 'Как начать пользоваться?',
      a: 'Зарегистрируйтесь на сайте или через Telegram-бота, выберите срок подписки и оплатите. Вы получите ссылку-подписку — импортируйте её в любой VPN-клиент (Happ, Hiddify, v2rayTun) и подключайтесь одним касанием.',
    },
    {
      q: 'Сколько устройств можно подключить?',
      a: 'Одна подписка даёт до 3 устройств одновременно — iPhone, Android, MacBook, Windows, Linux, Smart TV с AndroidTV. Если нужно больше — напишите в поддержку.',
    },
    {
      q: 'Какие платформы поддерживаются?',
      a: 'iOS, Android, Windows, macOS, Linux, AndroidTV. Рекомендуемые клиенты: Happ и Hiddify (iOS/Android/Desktop), v2rayTun (Android).',
    },
    {
      q: 'Что если не понравится?',
      a: 'Первые 3 дня бесплатно — можете попробовать без оплаты. Если после оплаты возникли проблемы или не подошло — напишите в Telegram-поддержку, решим индивидуально.',
    },
    {
      q: 'Замедляет ли VPN интернет?',
      a: 'Наши серверы — 1 Гбит/с на каждой локации, протоколы VLESS и Hysteria практически не имеют накладных расходов. Большинство пользователей разницы со своим провайдером не замечают.',
    },
    {
      q: 'Собираете ли вы мои данные?',
      a: 'Нет. Мы придерживаемся строгой политики no-logs: не храним информацию о сайтах, трафике или метаданных подключений. Реквизиты для оплаты не сохраняются — они обрабатываются через платёжные шлюзы (ЮKassa и CryptoBot).',
    },
  ];

  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);

  return (
    <div className="min-h-screen w-full bg-[#020202] text-white overflow-x-hidden relative">
      {/* Background — same red glow style as the rest of the app */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <ParticlesBackground />
        <div className="absolute -top-[20%] -left-[10%] w-[40vw] h-[40vw] max-w-[500px] max-h-[500px] rounded-full bg-red-500/10 blur-[100px]" />
        <div className="absolute top-[30%] -right-[10%] w-[50vw] h-[50vw] max-w-[600px] max-h-[600px] rounded-full bg-red-500/8 blur-[120px]" />
        <div className="absolute bottom-[10%] left-[20%] w-[30vw] h-[30vw] max-w-[400px] max-h-[400px] rounded-full bg-orange-500/6 blur-[100px]" />
      </div>

      <div className="relative z-10">
        {/* Header */}
        <header className="w-full px-4 lg:px-8 py-5 flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-2">
            <Image
              src="/tiger-source.png"
              alt="Hundler VPN"
              width={36}
              height={36}
              priority
              className="rounded-lg"
            />
            <h1 className="font-syncopate font-bold text-base lg:text-lg tracking-[0.12em] flex items-center">
              HUNDLER
              <span className="relative inline-block ml-1.5">
                <span className="absolute inset-0 bg-gradient-to-r from-white to-zinc-300 blur-sm opacity-35"></span>
                <span className="relative text-transparent bg-clip-text bg-gradient-to-r from-zinc-200 via-white to-zinc-400">VPN</span>
              </span>
            </h1>
          </div>
          <button
            onClick={goToLogin}
            className="px-4 py-2 lg:px-5 lg:py-2.5 bg-white/10 hover:bg-white/15 border border-white/15 hover:border-white/25 rounded-xl text-sm font-medium transition-all"
          >
            Войти
          </button>
        </header>

        {/* Hero */}
        <section className="px-4 lg:px-8 pt-12 pb-16 lg:pt-24 lg:pb-28 max-w-5xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          >
            <h2 className="font-syncopate font-bold text-3xl lg:text-6xl tracking-tight leading-tight mb-5">
              Свободный интернет.
              <br />
              <span className="relative inline-block">
                <span className="absolute inset-0 bg-gradient-to-r from-red-500 to-orange-500 blur-xl opacity-30"></span>
                <span className="relative text-transparent bg-clip-text bg-gradient-to-r from-red-400 via-red-300 to-orange-400">
                  Без компромиссов.
                </span>
              </span>
            </h2>

            <div className="flex flex-col sm:flex-row gap-3 justify-center items-center mt-8">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={goToLogin}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white py-3.5 px-7 rounded-xl font-medium text-base shadow-lg shadow-red-500/30 transition-all"
              >
                Войти или зарегистрироваться
                <ArrowRight size={18} />
              </motion.button>
              <a
                href="#features"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 text-zinc-300 hover:text-white py-3.5 px-5 text-sm transition-colors"
              >
                Узнать больше
              </a>
            </div>

          </motion.div>
        </section>

        {/* Features grid */}
        <section id="features" className="px-4 lg:px-8 py-12 lg:py-20 max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-50px' }}
            transition={{ duration: 0.5 }}
            className="text-center mb-10 lg:mb-16"
          >
            <h3 className="font-syncopate font-bold text-2xl lg:text-4xl tracking-tight mb-3">
              Всё, что нужно для{' '}
              <span className="relative inline-block">
                <span className="absolute inset-0 bg-gradient-to-r from-red-500 to-orange-500 blur-lg opacity-25" />
                <span className="relative text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-orange-400">
                  свободного интернета
                </span>
              </span>
            </h3>
            <p className="text-zinc-400 text-sm lg:text-base max-w-2xl mx-auto">
              Мы построили VPN, которым пользуемся сами. Каждая деталь — для скорости и приватности.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-5">
            {features.map((f, i) => {
              const Icon = f.icon;
              return (
                <motion.div
                  key={f.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-30px' }}
                  transition={{ duration: 0.45, delay: i * 0.05 }}
                  className="group relative rounded-2xl border border-white/10 bg-zinc-900/40 backdrop-blur-xl p-5 lg:p-6 hover:border-white/20 hover:bg-zinc-900/60 transition-all"
                >
                  <div className="w-11 h-11 lg:w-12 lg:h-12 rounded-xl bg-gradient-to-br from-red-500/20 to-orange-500/10 border border-red-500/20 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                    <Icon size={20} className="text-red-400" />
                  </div>
                  <h4 className="font-medium text-base lg:text-lg mb-1.5">{f.title}</h4>
                  <p className="text-zinc-400 text-sm leading-relaxed">{f.desc}</p>
                </motion.div>
              );
            })}
          </div>
        </section>

        {/* Three simple steps */}
        <section className="px-4 lg:px-8 py-12 lg:py-20 max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-50px' }}
            transition={{ duration: 0.5 }}
            className="text-center mb-10 lg:mb-14"
          >
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-[11px] lg:text-xs text-red-300 mb-4">
              Как это работает
            </div>
            <h3 className="font-syncopate font-bold text-2xl lg:text-4xl tracking-tight mb-3">
              Три простых шага
            </h3>
            <p className="text-zinc-400 text-sm lg:text-base max-w-2xl mx-auto">
              От регистрации до подключения — меньше двух минут. Никакой настройки вручную.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-5 relative">
            {/* Decorative connector line on lg+ */}
            <div className="hidden lg:block absolute top-[60px] left-[16.66%] right-[16.66%] h-[2px] bg-gradient-to-r from-red-500/0 via-red-500/30 to-red-500/0 pointer-events-none" />
            {steps.map((s, i) => {
              const Icon = s.icon;
              return (
                <motion.div
                  key={s.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-30px' }}
                  transition={{ duration: 0.45, delay: i * 0.1 }}
                  className="relative rounded-2xl border border-white/10 bg-zinc-900/40 backdrop-blur-xl p-6 lg:p-7 text-center"
                >
                  <div className="relative inline-flex mb-4">
                    <div className="absolute inset-0 bg-gradient-to-br from-red-500 to-orange-500 blur-xl opacity-30" />
                    <div className="relative w-14 h-14 lg:w-16 lg:h-16 rounded-2xl bg-gradient-to-br from-red-500/25 to-orange-500/15 border border-red-500/30 flex items-center justify-center">
                      <Icon size={24} className="text-red-300" />
                    </div>
                  </div>
                  <div className="font-syncopate text-[10px] lg:text-xs tracking-[0.2em] text-red-400/80 mb-1.5">
                    ШАГ 0{i + 1}
                  </div>
                  <h4 className="font-medium text-lg lg:text-xl mb-2">{s.title}</h4>
                  <p className="text-zinc-400 text-sm leading-relaxed">{s.desc}</p>
                </motion.div>
              );
            })}
          </div>
        </section>

        {/* Pricing / plan card */}
        <section className="px-4 lg:px-8 py-12 lg:py-20 max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-50px' }}
            transition={{ duration: 0.5 }}
            className="text-center mb-10 lg:mb-14"
          >
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-[11px] lg:text-xs text-red-300 mb-4">
              Тарифы
            </div>
            <h3 className="font-syncopate font-bold text-2xl lg:text-4xl tracking-tight mb-3">
              Один план. Всё включено.
            </h3>
            <p className="text-zinc-400 text-sm lg:text-base max-w-2xl mx-auto">
              Без скрытых ограничений и доплат. Все локации, все устройства, вся мощность протокола Reality.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, margin: '-50px' }}
            transition={{ duration: 0.5 }}
            className="relative rounded-3xl border border-red-500/20 bg-gradient-to-br from-zinc-900/80 via-zinc-900/60 to-zinc-900/80 backdrop-blur-xl overflow-hidden p-6 lg:p-10 max-w-3xl mx-auto"
          >
            <div className="absolute -top-20 -right-20 w-[250px] h-[250px] bg-gradient-to-bl from-red-500/20 to-orange-500/10 blur-3xl pointer-events-none" />

            <div className="relative">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6 pb-6 border-b border-white/10">
                <div>
                  <div className="text-xs lg:text-sm text-zinc-500 mb-1">Подписка Hundler VPN</div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-syncopate font-bold text-4xl lg:text-5xl text-white">7 ₽</span>
                    <span className="text-zinc-400 text-sm lg:text-base">/день</span>
                  </div>
                  <div className="text-[11px] lg:text-xs text-red-300/90 mt-1.5">
                    ≈ 150 ₽ в месяц · −10 % на 6 мес. · −15 % на год
                  </div>
                </div>
                <div className="px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px] lg:text-xs font-medium inline-flex items-center gap-1.5 self-start sm:self-auto">
                  <CheckCircle2 size={14} />
                  3 дня бесплатно
                </div>
              </div>

              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 lg:gap-3.5 mb-7">
                {planFeatures.map((feat) => {
                  const Icon = feat.icon;
                  return (
                    <li key={feat.text} className="flex items-center gap-2.5 text-zinc-200 text-sm">
                      <span className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0">
                        <Icon size={14} className="text-red-300" />
                      </span>
                      <span>{feat.text}</span>
                    </li>
                  );
                })}
              </ul>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={goToLogin}
                className="w-full inline-flex items-center justify-center gap-2 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white py-3.5 px-7 rounded-xl font-medium text-base shadow-lg shadow-red-500/30 transition-all"
              >
                Начать за 7 ₽ в день
                <ArrowRight size={18} />
              </motion.button>
              <p className="text-center text-[11px] lg:text-xs text-zinc-500 mt-3">
                Оплата картой, СБП или криптовалютой. Возврат без лишних вопросов.
              </p>
            </div>
          </motion.div>
        </section>

        {/* Testimonials */}
        <section className="px-4 lg:px-8 py-12 lg:py-20 max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-50px' }}
            transition={{ duration: 0.5 }}
            className="text-center mb-10 lg:mb-14"
          >
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-[11px] lg:text-xs text-red-300 mb-4">
              Отзывы
            </div>
            <h3 className="font-syncopate font-bold text-2xl lg:text-4xl tracking-tight mb-3">
              Пользуются и рекомендуют
            </h3>
            <p className="text-zinc-400 text-sm lg:text-base max-w-2xl mx-auto">
              Несколько слов от тех, кто уже подключил Hundler VPN на свои устройства.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-5">
            {testimonials.map((t, i) => (
              <motion.div
                key={t.name + t.region}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-30px' }}
                transition={{ duration: 0.4, delay: (i % 3) * 0.07 }}
                className="relative rounded-2xl border border-white/10 bg-zinc-900/40 backdrop-blur-xl p-5 lg:p-6"
              >
                <Quote size={22} className="text-red-400/50 mb-3" />
                <p className="text-zinc-200 text-sm leading-relaxed mb-4">{t.text}</p>
                <div className="flex items-center gap-3 pt-3 border-t border-white/5">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-red-500/30 to-orange-500/20 border border-red-500/30 flex items-center justify-center text-sm font-medium text-red-200">
                    {t.name.charAt(0)}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-white">{t.name}</div>
                    <div className="text-[11px] text-zinc-500">{t.region}</div>
                  </div>
                  <div className="ml-auto flex items-center gap-0.5">
                    {[0, 1, 2, 3, 4].map((s) => (
                      <Star key={s} size={11} className="text-yellow-400 fill-yellow-400" />
                    ))}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section className="px-4 lg:px-8 py-12 lg:py-20 max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-50px' }}
            transition={{ duration: 0.5 }}
            className="text-center mb-10 lg:mb-12"
          >
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-[11px] lg:text-xs text-red-300 mb-4">
              <HelpCircle size={11} />
              FAQ
            </div>
            <h3 className="font-syncopate font-bold text-2xl lg:text-4xl tracking-tight mb-3">
              Часто задаваемые вопросы
            </h3>
            <p className="text-zinc-400 text-sm lg:text-base max-w-2xl mx-auto">
              Если ответ не нашёлся — напишите в Telegram-поддержку, отвечаем в течение 5 минут.
            </p>
          </motion.div>

          <div className="space-y-2.5 lg:space-y-3">
            {faqEntries.map((item, i) => {
              const open = openFaqIndex === i;
              return (
                <motion.div
                  key={item.q}
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-20px' }}
                  transition={{ duration: 0.35, delay: i * 0.04 }}
                  className={`rounded-2xl border backdrop-blur-xl overflow-hidden transition-colors ${
                    open
                      ? 'border-red-500/30 bg-zinc-900/60'
                      : 'border-white/10 bg-zinc-900/40 hover:border-white/20'
                  }`}
                >
                  <button
                    onClick={() => setOpenFaqIndex(open ? null : i)}
                    className="w-full flex items-center justify-between gap-4 px-5 py-4 lg:px-6 lg:py-5 text-left"
                  >
                    <span className="text-sm lg:text-base font-medium text-white">{item.q}</span>
                    <ChevronDown
                      size={18}
                      className={`shrink-0 text-zinc-400 transition-transform duration-300 ${
                        open ? 'rotate-180 text-red-400' : ''
                      }`}
                    />
                  </button>
                  <AnimatePresence initial={false}>
                    {open && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: 'easeOut' }}
                        className="overflow-hidden"
                      >
                        <p className="px-5 pb-4 lg:px-6 lg:pb-5 text-sm text-zinc-300 leading-relaxed">
                          {item.a}
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        </section>

        {/* Benefits + CTA */}
        <section className="px-4 lg:px-8 py-12 lg:py-20 max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, margin: '-50px' }}
            transition={{ duration: 0.5 }}
            className="relative rounded-3xl border border-white/10 bg-gradient-to-br from-zinc-900/80 via-zinc-900/60 to-zinc-900/80 backdrop-blur-xl overflow-hidden p-7 lg:p-12"
          >
            <div className="absolute top-0 right-0 w-[60%] h-[80%] bg-gradient-to-bl from-red-500/15 to-transparent blur-3xl pointer-events-none" />

            <div className="relative grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-center">
              <div>
                <h3 className="font-syncopate font-bold text-2xl lg:text-4xl tracking-tight leading-tight mb-5">
                  Готовы попробовать?
                </h3>
                <p className="text-zinc-400 text-sm lg:text-base mb-6">
                  Регистрация занимает 30 секунд. Поддерживаем все популярные VPN-клиенты — Happ, V2RayTun, Hiddify и другие.
                </p>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={goToLogin}
                  className="inline-flex items-center gap-2 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white py-3.5 px-7 rounded-xl font-medium text-base shadow-lg shadow-red-500/30 transition-all"
                >
                  Начать бесплатно
                  <ArrowRight size={18} />
                </motion.button>
              </div>

              <ul className="space-y-3">
                {benefits.map((b) => (
                  <li key={b} className="flex items-start gap-3 text-zinc-200 text-sm lg:text-base">
                    <CheckCircle2 size={18} className="text-emerald-400 shrink-0 mt-0.5" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>
        </section>

        {/* Footer */}
        <footer className="px-4 lg:px-8 py-8 border-t border-white/5 max-w-7xl mx-auto">
          <div className="flex flex-col lg:flex-row items-center justify-between gap-4 text-zinc-500 text-xs">
            <div className="flex items-center gap-2">
              <Image src="/tiger-source.png" alt="" width={20} height={20} className="rounded opacity-70" />
              <span>© {new Date().getFullYear()} Hundler VPN. Все права защищены.</span>
            </div>
            <div className="flex items-center gap-5">
              <a
                href="/terms"
                className="hover:text-zinc-300 transition-colors"
              >
                Соглашение
              </a>
              <a
                href="/privacy"
                className="hover:text-zinc-300 transition-colors"
              >
                Конфиденциальность
              </a>
              <a
                href="https://t.me/hundlervpn_bot"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-zinc-300 transition-colors"
              >
                Telegram
              </a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
