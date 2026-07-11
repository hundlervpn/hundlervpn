'use client';

import { useState, memo, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import Link from 'next/link';
import { Shield, CreditCard, User, Zap, Check, ChevronRight, ChevronLeft, ChevronDown, HelpCircle, Star, Bitcoin, Wallet, Calendar, Smartphone, Settings, Gift, MonitorSmartphone, Globe, X, Monitor, FileText, Lock, Download, ArrowRight, ArrowUp, CheckCircle2, Laptop, Smartphone as SmartphoneIcon, ShieldAlert, Users, Ban, Tag, Search, Plus, Trash2, Copy, ClipboardCheck, Key, Mail, Send, Pencil, LogOut, RefreshCw, AlertCircle, Link2, Home, Crown, MessageCircle, Server, Package, Sparkles, Flame, Trophy, Clock, Paperclip, Image as ImageIcon, Reply, MoreHorizontal, Smile } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ParticlesBackground from '@/components/ParticlesBackground';
import SparkEffect from '@/components/SparkEffect';
import { haptic, hapticNotification } from '@/lib/haptic';
import { PRICE_PER_DAY_RUB, calculatePricing, getDurationDiscountPercent } from '@/lib/pricing';
import HappIcon from '@/components/HappIcon';
import V2RayTunIcon from '@/components/V2RayTunIcon';
import TigerNetworkLogo from '@/components/TigerNetworkLogo';
import LandingPage from '@/components/LandingPage';
import ReferralModal from '@/components/ReferralModal';
import AdminWithdrawalsView from '@/components/AdminWithdrawalsView';
import SparkyButton from '@/components/SparkyButton';
import { SbpIcon, CryptoBotIcon } from '@/components/PaymentIcons';
import MatrixRain, { type MatrixRainHandle } from '@/components/MatrixRain';
import { useTelegramBackButton, isInTelegramMiniApp } from '@/lib/use-telegram-back-button';

// Telegram WebApp types
interface TelegramWebApp {
  initDataUnsafe: {
    start_param?: string;
    user?: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
      photo_url?: string;
    };
  };
  close: () => void;
  openInvoice: (url: string) => Promise<{ status: 'paid' | 'cancelled' | 'failed' | 'pending' }>;
  openLink: (url: string) => void;
  // Open a Telegram t.me/... link inside the Telegram app (preferred for
  // share / deep links). Optional because older clients may not expose it.
  openTelegramLink?: (url: string) => void;
  expand: () => void;
  requestFullscreen?: () => void;
  ready: () => void;
  version: string;
  platform: string;
  isFullscreen?: boolean;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
      Login?: {
        auth: (options: { client_id: string; request_access: string[]; lang?: string }, callback: (data: { id_token?: string; user?: any; error?: string }) => void) => void;
        open: (callback?: (data: { id_token?: string; user?: any; error?: string }) => void) => void;
        init: (options: { client_id: string; request_access?: string[]; lang?: string }, callback: (data: { id_token?: string; user?: any; error?: string }) => void) => void;
      };
    };
  }
}

const translations = {
  ru: {
    navVpn: 'Главная', navPremium: 'Оплата', navSupport: 'Поддержка', navProfile: 'Профиль',
    mainBadge: 'Основная',
    planName: 'Подписка',
    until: 'до',
    date: '12.04.2026',
    devices: 'Устройства',
    extend: 'Продлить',
    install: 'Установить и настроить VPN',
    installShort: 'Установить VPN',
    promo: 'Промокоды',
    myDevices: 'Мои устройства',
    months: 'мес.', perMonth: 'в мес.', total: 'Итого:', daysLabel: 'дн.', perDay: '/день',
    payCrypto: 'Крипто', paySbp: 'СБП',
    subscribe: 'Оплатить',
    featTitle: 'Преимущества', f1: 'До 3 устройств', f2: 'Безлимитный трафик', f3: 'Минимальные задержки',
    user: 'Пользователь', daysLeft: 'Осталось 23 дня',
    app: 'Приложение', lang: 'Язык', support: 'Поддержка', referral: 'Реферальная система', payments: 'Платежи', userAgreement: 'Пользовательское соглашение', privacyPolicy: 'Политика конфиденциальности',
    connected: 'ПОДКЛЮЧЕНО', disconnected: 'ОТКЛЮЧЕНО', location: 'Германия', ping: '120 мс',
    setupTitle: 'Настройка VPN',
    setupCurrent: 'Настроить это устройство',
    setupOther: 'Другое устройство',
    setupLinkCopied: 'Ссылка скопирована!',
    setupCopyLink: 'Скопировать ссылку с ключом',
    setupDetecting: 'Определение устройства...',
    setupDetected: 'Обнаружено устройство:',
    setupWindows: 'Windows',
    setupMacos: 'macOS',
    setupLinux: 'Linux',
    setupAndroid: 'Android',
    setupIos: 'iPhone/iPad',
    setupUnknown: 'Устройство',
    setupFor: 'Настройка на',
    setupStepsHint: '3 шага для завершения настройки',
    setupStart: 'Начать настройку',
    setupOtherDevice: 'Другое устройство',
    setupChooseDevice: 'Выберите устройство',
    setupInstallTitle: 'Установка клиента',
    setupInstallDesc: 'Сначала установите приложение клиента на устройство.',
    setupInstallButton: 'Установить клиент',
    setupHundlerWinTitle: 'Скачать HundlerVPN для Windows',
    setupHundlerWinDesc: 'Наше приложение для Windows — подписка подключается автоматически, ничего настраивать вручную не нужно.',
    setupHundlerAndroidTitle: 'Скачать HundlerVPN для Android',
    setupHundlerAndroidDesc: 'Наше приложение для Android — подписка подключается автоматически, обновления прилетают прямо в приложение.',
    setupChooseClient: 'Выберите клиент',
    setupClientRecommended: 'Рекомендуется',
    setupClientHiddifyDesc: 'Проще в использовании',
    setupClientHappDesc: 'Альтернативный клиент',
    setupClientHappTitle: 'Happ',
    setupClientHappSubtitle: 'VPN Client',
    setupClientV2RayTunTitle: 'v2rayTun',
    setupClientV2RayTunSubtitle: 'Альтернативный клиент',
    setupClientHundlerTitle: 'HundlerVPN',
    setupClientHundlerSubtitle: 'Наше приложение',
    setupAddTitle: 'Добавление подписки',
    setupAddDesc: 'Скопируйте ключ и вставьте его в VPN-приложение.',
    setupAddButton: 'Скопировать ключ',
    setupKeyCopied: 'Ключ скопирован!',
    setupNoKey: 'У вас нет активного ключа. Оформите подписку.',
    setupKeyLoading: 'Загрузка ключа...',
    setupCopyForOther: 'Скопировать ключ для устройства',
    setupNext: 'Далее',
    setupFinish: 'Завершить',
    setupStepOf: 'из',
    setupRegion: 'Регион',
    setupGlobal: 'Global',
    setupRussia: 'Russia',
    setupNoStore: 'Для этого устройства ссылка на магазин пока не задана.'
    ,paymentsHistoryTitle: 'История платежей',
    backToProfile: 'Назад в профиль',
    noPaymentsYet: 'Платежей пока нет',
    referralCopied: 'Скопировано',
    referralTitle: 'Реферальная система',
    referralSubtitle: 'Приглашай друзей — получай дни',
    referralHowItWorks: 'Как это работает',
    referralHowItWorksDesc: 'Поделись ссылкой. +3 дня — сразу за регистрацию друга. Дальше за каждую его оплату от месяца и выше тебе автоматически начисляется бонус.',
    referralSignupTitle: 'За регистрацию',
    referralSignupDesc: '+3 дня за каждого друга, зарегистрировавшегося по твоей ссылке.',
    referralTiersTitle: 'За каждую оплату друга',
    referralTier7: '1 месяц — +7 дней',
    referralTier14: '6 месяцев — +14 дней',
    referralTier21: '1 год — +21 день',
    referralYourLink: 'Твоя ссылка',
    referralCopyBtn: 'Скопировать',
    referralShareBtn: 'Поделиться',
    referralCloseBtn: 'Закрыть',
    referralNoteTitle: 'Условия',
    referralNoteDesc: 'Регистрационный бонус — один раз за друга. Бонус за оплату начисляется на каждую покупку подписки от 30 дней. Подписки короче 30 дней в программе не участвуют.',
    referralInviteesTitle: 'Твои друзья',
    referralInviteesButton: 'Посмотреть друзей',
    referralInviteesSummary: '{count} друзей • +{days} дней',
    referralInviteesSummaryOne: '{count} друг • +{days} дней',
    referralInviteesSummaryFew: '{count} друга • +{days} дней',
    referralInviteesBack: 'Назад',
    referralInviteesEmpty: 'Пока пусто. Поделись ссылкой — и получай дни за каждого друга.',
    referralInviteesEmptyCta: 'Поделись ссылкой, чтобы получать дни',
    referralInviteesAnonymous: 'Без имени',
    referralInviteesPending: 'Ждём оплату',
    referralInviteesPaymentsOne: '{count} оплата',
    referralInviteesPaymentsFew: '{count} оплаты',
    referralInviteesPaymentsMany: '{count} оплат',
    referralDaysSuffix: 'дн.',
    referralStatsEarned: 'Накоплено',
    referralStatsFriends: 'Друзей',
    referralDetailsToggle: 'Правила и бонусы',
    adminPanel: 'Админ панель',
    adminStats: 'Статистика',
    adminUsers: 'Пользователи',
    adminPromos: 'Промокоды',
    adminTickets: 'Обращения',
    adminBroadcasts: 'Рассылки',
    adminBroadcastTitle: 'Заголовок (опционально)',
    adminBroadcastMessage: 'Текст сообщения',
    adminBroadcastImage: 'URL картинки (опционально)',
    adminBroadcastImageUpload: 'Загрузить фото',
    adminBroadcastImageOrUrl: 'или вставьте ссылку на картинку',
    adminBroadcastImageRemove: 'Убрать фото',
    adminBroadcastImageTooBig: 'Файл слишком большой (макс. 5 МБ)',
    adminBroadcastImageBadType: 'Можно загружать только изображения',
    adminBroadcastButton: 'Текст кнопки',
    adminBroadcastButtonUrl: 'URL кнопки',
    adminBroadcastTargetId: 'Telegram ID (если указан — игнорирует фильтр аудитории)',
    adminBroadcastAudience: 'Кому отправить:',
    adminBroadcastAudienceAll: 'Всем',
    adminBroadcastAudienceActive: 'С активной подпиской',
    adminBroadcastAudienceNoSub: 'Без подписки',
    adminBroadcastAudienceActiveNoDevices: 'Не настроил VPN',
    adminBroadcastButtonKind: 'Тип кнопки:',
    adminBroadcastButtonKindUrl: 'Ссылка',
    adminBroadcastButtonKindApp: 'Открыть приложение',
    adminBroadcastButtonKindPromo: 'Промокод',
    adminBroadcastButtonPromoCode: 'Код промокода (например SUMMER2026)',
    adminBroadcastSend: 'Отправить рассылку',
    adminBroadcastSending: 'Отправка...',
    adminBroadcastSent: 'Отправлено',
    adminBroadcastPending: 'Ожидает',
    adminBroadcastFailed: 'Ошибка',
    adminNoBroadcasts: 'Рассылок пока нет',
    adminTotalUsers: 'Всего',
    adminTodayUsers: 'Сегодня',
    adminBannedUsers: 'Забанено',
    adminRevenue: 'Доход (всего)',
    adminRevenueMonth: 'Доход за месяц',
    adminRevenueByMonth: 'Доход по месяцам',
    adminTraffic: 'Трафик (всего)',
    adminTrafficByMonth: 'Трафик по месяцам',
    adminActiveSubs: 'Активных подписок',
    adminPaidPayments: 'Оплаченных',
    adminSearchUsers: 'Поиск по имени или ID...',
    adminBan: 'Бан',
    adminBanLogin: 'Бан входа',
    adminBanSubscription: 'Бан подписки',
    adminUnban: 'Разбан',
    adminBanTypeLogin: 'вход',
    adminBanTypeSub: 'подписка',
    adminCreatePromo: 'Создать промокод',
    adminPromoCode: 'Код',
    adminPromoDays: 'Дней подписки',
    adminPromoMaxUses: 'Макс. использований',
    adminPromoCreate: 'Создать',
    adminPromoFilterAll: 'Все',
    adminPromoFilterMine: 'Мои',
    adminPromoFilterBoxes: 'Из боксов',
    adminBackToProfile: 'Назад в профиль',
    adminNoUsers: 'Пользователей не найдено',
    adminNoPromos: 'Промокодов пока нет',
    adminTicketsSearch: 'Поиск по теме, имени или Telegram ID...',
    adminTicketsOpenOnly: 'Открытые',
    adminTicketsAll: 'Все',
    adminNoTickets: 'Обращений пока нет',
    adminTicketOpen: 'Открыт',
    adminTicketClosed: 'Закрыт',
    adminTicketSubjectEmpty: 'Без темы',
    adminTicketBack: 'Назад к списку',
    adminTicketMessages: 'Сообщения',
    adminTicketReplyPlaceholder: 'Введите ответ пользователю...',
    adminTicketSendReply: 'Отправить ответ',
    adminTicketSendingReply: 'Отправка...',
    adminTicketClose: 'Закрыть обращение',
    adminTicketReopen: 'Переоткрыть',
    adminTicketLoadError: 'Не удалось загрузить обращения',
    adminTicketActionError: 'Не удалось выполнить действие',
    adminTicketNoMessages: 'Сообщений пока нет',
    adminTicketSenderUser: 'Пользователь',
    adminTicketSenderAdmin: 'Админ',
    adminTicketSenderSystem: 'Система',
    adminTicketDeleteTicket: 'Удалить обращение',
    adminTicketDeleteMessage: 'Удалить сообщение',
    adminTicketDeleteConfirm: 'Удалить обращение и всю переписку без возможности восстановления?',
    adminTicketDeleteMessageConfirm: 'Удалить это сообщение без возможности восстановления?',
    adminTicketDeleting: 'Удаление...',
    promoPlaceholder: 'Введите промокод',
    promoApply: 'Активировать',
    promoApplySuccess: 'Промокод применён',
    devicesConnected: 'Подключено устройств',
    deviceLimitReached: 'Достигнут лимит устройств. Удалите одно из устройств, чтобы добавить новое.',
    deleteDevice: 'Удалить',
    deleteDeviceConfirm: 'Удалить это устройство? VPN на нём перестанет работать.',
    deviceDeleted: 'Устройство удалено',
    serversTitle: 'Статус серверов',
    serverActive: 'Активен',
    serverInactive: 'Неактивен',
    noServers: 'Серверов пока нет',
    supportNewTicket: 'Новое обращение',
    supportNoTicketsTitle: 'У вас пока нет обращений в поддержку',
    supportNoTicketsHint: 'Нажмите "Новое обращение", чтобы связаться с нами',
    supportFaqTitle: 'Часто задаваемые вопросы',
    supportFaqHint: 'Возможно, вы найдёте ответ на свой вопрос здесь',
    supportCreateTitle: 'Создать обращение',
    supportSubject: 'Тема',
    supportSubjectHint: 'Необязательно, но поможет быстрее разобраться',
    supportSubjectPlaceholder: 'Кратко опишите проблему',
    supportMessage: 'Сообщение',
    supportMessagePlaceholder: 'Опишите вашу проблему или вопрос подробно...',
    supportSend: 'Отправить',
    supportSending: 'Отправка...',
    supportLoading: 'Загрузка обращений...',
    supportOpenStatus: 'Открыт',
    supportClosedStatus: 'Закрыт',
    supportLastUpdate: 'Обновлено',
    supportMessagesCount: 'сообщений',
    supportNoSubject: 'Без темы',
    supportCreateError: 'Не удалось создать обращение',
    supportLoadError: 'Не удалось загрузить обращения',
    supportBackToList: 'Назад к обращениям',
    supportMessageRequired: 'Введите сообщение',
    supportTicketMessages: 'Сообщения',
    supportReplyPlaceholder: 'Введите сообщение...',
    supportAttachPhoto: 'Прикрепить фото',
    supportCloseTicket: 'Закрыть обращение',
    supportReopenTicket: 'Переоткрыть обращение',
    supportTicketActionError: 'Не удалось выполнить действие',
    supportTicketNoMessages: 'Сообщений пока нет',
    supportSenderUser: 'Вы',
    supportSenderAdmin: 'Поддержка',
    supportSenderSystem: 'Система',
    tgStoreTitle: 'Telegram Магазин',
    tgStoreStars: 'Telegram Stars',
    tgStorePremium: 'Telegram Premium',
    tgStoreSelectProduct: 'Выберите товар',
    tgStoreSelectPeriod: 'Выберите период',
    tgStoreSelectAmount: 'Выберите количество',
    tgStore3Months: '3 месяца',
    tgStore6Months: '6 месяцев',
    tgStore12Months: '12 месяцев',
    tgStoreStarsAmount: 'Количество звёзд',
    tgStorePay: 'Оплатить через СБП',
    tgStorePrice: 'Цена',
    tgStoreOldPrice: 'Было',
    tgStoreDiscount: 'Скидка',
    tgStoreNoPrices: 'Цены пока не установлены',
    tgStoreLoading: 'Загрузка...',
    tgStoreBackToProfile: 'Назад в профиль',
    tgStoreUsername: 'Telegram username для отправки',
    tgStoreUsernamePlaceholder: '@username',
    servicesTitle: 'Оплата зарубежных сервисов',
    servicesDesc: 'Оплатим любой зарубежный сервис за вас',
    servicesNewRequest: 'Новая заявка',
    servicesServiceName: 'Название сервиса',
    servicesServiceNamePlaceholder: 'Netflix, Spotify, YouTube Premium...',
    servicesDescription: 'Описание',
    servicesDescriptionPlaceholder: 'Опишите что нужно оплатить, на какой аккаунт...',
    servicesSend: 'Отправить заявку',
    servicesSending: 'Отправка...',
    servicesNoRequests: 'У вас пока нет заявок',
    servicesNoRequestsHint: 'Нажмите "Новая заявка", чтобы заказать оплату',
    servicesStatusNew: 'Новая',
    servicesStatusAwaiting: 'Ожидает оплаты',
    servicesStatusPaid: 'Оплачено',
    servicesStatusProcessing: 'В обработке',
    servicesStatusCompleted: 'Выполнено',
    servicesStatusCancelled: 'Отменено',
    servicesPay: 'Оплатить',
    servicesBackToList: 'Назад к заявкам',
    servicesBackToProfile: 'Назад в профиль',
    servicesReplyPlaceholder: 'Введите сообщение...',
    servicesAmount: 'Сумма к оплате',
    adminServices: 'Услуги',
    accountTitle: 'Вход в систему',
    accountLinkedAccounts: 'Привязанные аккаунты',
    accountTelegram: 'Telegram',
    accountEmail: 'Почта',
    accountLinked: 'Привязан',
    accountNotLinked: 'Не привязан',
    accountVerified: 'Подтверждена',
    accountNotVerified: 'Не подтверждена',
    accountLinkEmail: 'Привязать почту',
    accountUnlinkEmail: 'Отвязать почту',
    accountUnlinkTelegram: 'Отвязать Telegram',
    accountEnterEmail: 'Введите email',
    accountLink: 'Привязать',
    accountLinking: 'Привязка...',
    accountEmailTaken: 'Эта почта уже привязана к другому аккаунту',
    accountTelegramTaken: 'Этот Telegram уже привязан к другому аккаунту',
    accountSuccess: 'Успешно',
    accountError: 'Ошибка',
    accountCannotUnlink: 'Нельзя отвязать единственный способ входа',
    accountVerifyEmail: 'Подтвердить почту',
    accountVerifyCode: 'Введите код из письма',
    accountVerify: 'Подтвердить',
    accountSendCode: 'Отправить код',
    accountCodeSent: 'Код отправлен на почту',
    accountRegisteredVia: 'Зарегистрирован через',
    accountCreatedAt: 'Дата регистрации',
    accountBackToProfile: 'Назад в профиль',
    accountGoogle: 'Google',
    accountLinkGoogle: 'Привязать Google',
    accountGoogleLinking: 'Переход к Google…',
    accountGoogleHint: 'Один email = один аккаунт. Если ваш Google-адрес уже используется в системе, аккаунты автоматически объединятся.',
    accountSectionTitle: 'Способы входа',
    accountSectionSubtitle: 'Привяжите несколько способов, чтобы не потерять доступ',
    accountDangerTitle: 'Опасная зона',
    accountDeleteTitle: 'Удалить аккаунт',
    accountDeleteDescription: 'Безвозвратно удалит ваш аккаунт и все связанные данные: подписки, ключи, историю платежей, обращения в поддержку и устройства. Восстановить будет нельзя.',
    accountDeleteButton: 'Удалить аккаунт',
    accountDeleting: 'Удаляем…',
    accountDeleteConfirmPrompt: 'Это действие необратимо. Будут удалены все ваши данные. Введите УДАЛИТЬ заглавными буквами для подтверждения:',
    accountDeleteConfirmWord: 'УДАЛИТЬ',
    accountDeleteCancelled: 'Удаление отменено',
    accountDeleteSuccess: 'Аккаунт удалён',
    accountDeleteError: 'Не удалось удалить аккаунт',

    // Boxes
    navBoxes: 'Боксы',
    boxesTitle: 'Ежедневные боксы',
    boxesSubtitle: 'Заходи каждый день, открывай бокс и копи стрик. Каждый 7-й бокс — SUPER с шансом на крупную награду.',
    boxesAdminBadge: 'Бета · только админы',
    boxesStreakLabel: 'Текущий стрик',
    boxesStreakDays: 'дн.',
    boxesTotalLabel: 'Всего открыто',
    boxesUpcomingDaily: 'Следующий — Daily',
    boxesUpcomingSuper: 'Следующий — SUPER ✨',
    boxesOpenButton: 'Открыть бокс',
    boxesOpening: 'Открываем…',
    boxesCooldownPrefix: 'Доступно через',
    boxesCooldownReady: 'Готово к открытию!',
    boxesProgressLabel: 'Прогресс до супер-бокса',
    boxesSuperReady: 'Супер-бокс ждёт!',
    boxesRewardTitle: 'Награда',
    boxesHistoryTitle: 'История наград',
    boxesHistoryEmpty: 'Открой первый бокс — он появится здесь.',
    boxesRarityCommon: 'Обычная',
    boxesRarityUncommon: 'Необычная',
    boxesRarityRare: 'Редкая',
    boxesRarityEpic: 'Эпическая',
    boxesRarityLegendary: 'ЛЕГЕНДАРНАЯ',
    boxesBoxDaily: 'Daily',
    boxesBoxSuper: 'SUPER',
    boxesError: 'Не удалось открыть бокс',
    boxesNotAdmin: 'Эта вкладка пока в бета-режиме. Доступна только админам.',
    boxesTelegramRequiredTitle: 'Привяжите Telegram',
    boxesTelegramRequiredDesc: 'Боксы доступны только пользователям с привязанным Telegram — чтобы мы могли присылать уведомления о новых наградах и сроке действия промокодов.',
    boxesLinkTelegramButton: 'Привязать Telegram',
    boxesLinkTelegramNoSession: 'Войдите в аккаунт, чтобы привязать Telegram',
    boxesClaimed: 'Награда зачислена ✓',
    boxesWhatCanDrop: 'Что можно выбить',
    boxesWhatCanDropTitle: 'Что можно выбить',
    boxesWhatCanDropDailyHint: 'Daily бокс чаще всего даёт скидочный промокод, иногда — часы подписки или редкие крупные дропы.',
    boxesWhatCanDropSuperHint: 'SUPER бокс падает каждый 7-й день стрика и даёт сильно увеличенные награды, включая редкие крупные дропы.',
    boxesWhatCanDropFooter: 'Шансы независимые. Каждое открытие — новый розыгрыш.',
    boxesHoursSubHint: 'часы подписки',
    boxesCouponSubHint: 'промокод-скидка, действует 24ч',
    boxesAdminReset: 'Сбросить кулдаун',
    // Coupon rewards
    boxesCouponPrefix: 'Скидка ',
    boxesCouponRevealHint: 'Промокод действует 24 часа. Используй на странице оплаты.',
    boxesCouponSaved: 'Промокод сохранён ✓',
    boxesCouponExpiresAt: 'Истекает',
    boxesCouponExpired: 'Истёк',
    boxesCopy: 'Копировать',
    boxesCopied: 'Скопировано',
    // History screen
    boxesHistoryButtonHint: 'Все награды и активные промокоды',
    boxesHistoryBack: 'Назад к боксам',
    boxesHistoryTotalSuffix: 'наград всего',
    boxesHistoryLoadMore: 'Загрузить ещё',
    boxesHistoryLoading: 'Загрузка…',
    boxesHistoryClear: 'Очистить',
    boxesHistoryClearConfirm: 'Очистить историю наград? Стрик и кулдаун сохранятся, выданные промокоды останутся валидны — только записи в этом списке будут удалены.',
    boxesHistoryCleared: 'История очищена',
  },
  en: {
    navVpn: 'Home', navPremium: 'Payment', navSupport: 'Support', navProfile: 'Profile',
    mainBadge: 'Main',
    planName: 'Subscription',
    until: 'until',
    date: '12.04.2026',
    devices: 'Devices',
    extend: 'Extend',
    install: 'Install & Setup VPN',
    installShort: 'Install VPN',
    promo: 'Promo codes',
    myDevices: 'My devices',
    months: 'mo.', perMonth: '/mo', total: 'Total:', daysLabel: 'd.', perDay: '/day',
    payCrypto: 'Crypto', paySbp: 'SBP',
    subscribe: 'Subscribe Now',
    featTitle: 'Premium Features', f1: 'Up to 3 devices', f2: 'Unlimited bandwidth', f3: 'Minimal latency',
    user: 'User', daysLeft: '23 days left',
    app: 'App', lang: 'Language', support: 'Support', referral: 'Referral system', payments: 'Payments', userAgreement: 'User agreement', privacyPolicy: 'Privacy policy',
    connected: 'CONNECTED', disconnected: 'DISCONNECTED', location: 'Germany', ping: '120 ms',
    setupTitle: 'VPN Setup',
    setupCurrent: 'Setup this device',
    setupOther: 'Other device',
    setupLinkCopied: 'Link copied!',
    setupCopyLink: 'Copy link with key',
    setupDetecting: 'Detecting device...',
    setupDetected: 'Detected device:',
    setupWindows: 'Windows',
    setupMacos: 'macOS',
    setupLinux: 'Linux',
    setupAndroid: 'Android',
    setupIos: 'iPhone/iPad',
    setupUnknown: 'Device',
    setupFor: 'Setup for',
    setupStepsHint: '3 steps to complete setup',
    setupStart: 'Start setup',
    setupOtherDevice: 'Other device',
    setupChooseDevice: 'Choose device',
    setupInstallTitle: 'Install client',
    setupInstallDesc: 'First, install the client application on your device.',
    setupInstallButton: 'Install client',
    setupHundlerWinTitle: 'Download HundlerVPN for Windows',
    setupHundlerWinDesc: 'Our native Windows app — your subscription connects automatically, no manual setup needed.',
    setupHundlerAndroidTitle: 'Download HundlerVPN for Android',
    setupHundlerAndroidDesc: 'Our native Android app — your subscription connects automatically and updates arrive right inside the app.',
    setupChooseClient: 'Choose client',
    setupClientRecommended: 'Recommended',
    setupClientHiddifyDesc: 'Easiest to use',
    setupClientHappDesc: 'Alternative client',
    setupClientHappTitle: 'Happ',
    setupClientHappSubtitle: 'VPN Client',
    setupClientV2RayTunTitle: 'v2rayTun',
    setupClientV2RayTunSubtitle: 'Alternative client',
    setupClientHundlerTitle: 'HundlerVPN',
    setupClientHundlerSubtitle: 'Our native app',
    setupAddTitle: 'Add subscription key',
    setupAddDesc: 'Copy the key and paste it into your VPN app.',
    setupAddButton: 'Copy key',
    setupKeyCopied: 'Key copied!',
    setupNoKey: 'No active key. Please subscribe first.',
    setupKeyLoading: 'Loading key...',
    setupCopyForOther: 'Copy key for device',
    setupNext: 'Next',
    setupFinish: 'Finish',
    setupStepOf: 'of',
    setupRegion: 'Region',
    setupGlobal: 'Global',
    setupRussia: 'Russia',
    setupNoStore: 'No store link configured for this device yet.'
    ,paymentsHistoryTitle: 'Payments history',
    backToProfile: 'Back to profile',
    noPaymentsYet: 'No payments yet',
    referralCopied: 'Copied',
    referralTitle: 'Referral program',
    referralSubtitle: 'Invite a friend — get bonus days',
    referralHowItWorks: 'How it works',
    referralHowItWorksDesc: 'Share your link. +3 days the moment a friend registers. Then every paid plan they buy from 1 month on adds more days to your subscription — automatically.',
    referralSignupTitle: 'For signup',
    referralSignupDesc: '+3 days for every friend who registers via your link.',
    referralTiersTitle: 'For every friend\'s payment',
    referralTier7: '1 month — +7 days',
    referralTier14: '6 months — +14 days',
    referralTier21: '1 year — +21 days',
    referralYourLink: 'Your link',
    referralCopyBtn: 'Copy',
    referralShareBtn: 'Share',
    referralCloseBtn: 'Close',
    referralNoteTitle: 'Conditions',
    referralNoteDesc: 'Signup bonus counts once per friend. Payment bonus fires on every paid plan of 30+ days. Shorter plans don\'t qualify.',
    referralInviteesTitle: 'Your friends',
    referralInviteesButton: 'View friends',
    referralInviteesSummary: '{count} friends • +{days} days',
    referralInviteesSummaryOne: '{count} friend • +{days} days',
    referralInviteesSummaryFew: '{count} friends • +{days} days',
    referralInviteesBack: 'Back',
    referralInviteesEmpty: 'No one yet. Share your link and start earning days.',
    referralInviteesEmptyCta: 'Share the link to start earning',
    referralInviteesAnonymous: 'Unnamed user',
    referralInviteesPending: 'Pending activation',
    referralInviteesPaymentsOne: '{count} payment',
    referralInviteesPaymentsFew: '{count} payments',
    referralInviteesPaymentsMany: '{count} payments',
    referralDaysSuffix: 'd',
    referralStatsEarned: 'Earned',
    referralStatsFriends: 'Friends',
    referralDetailsToggle: 'Rules & bonuses',
    adminPanel: 'Admin Panel',
    adminStats: 'Statistics',
    adminUsers: 'Users',
    adminPromos: 'Promo Codes',
    adminTickets: 'Tickets',
    adminBroadcasts: 'Broadcasts',
    adminBroadcastTitle: 'Title (optional)',
    adminBroadcastMessage: 'Message text',
    adminBroadcastImage: 'Image URL (optional)',
    adminBroadcastImageUpload: 'Upload photo',
    adminBroadcastImageOrUrl: 'or paste an image URL',
    adminBroadcastImageRemove: 'Remove photo',
    adminBroadcastImageTooBig: 'File is too large (max 5 MB)',
    adminBroadcastImageBadType: 'Only image files are allowed',
    adminBroadcastButton: 'Button text',
    adminBroadcastButtonUrl: 'Button URL',
    adminBroadcastTargetId: 'Telegram ID (if set — overrides audience filter)',
    adminBroadcastAudience: 'Send to:',
    adminBroadcastAudienceAll: 'Everyone',
    adminBroadcastAudienceActive: 'Active subscribers',
    adminBroadcastAudienceNoSub: 'No subscription',
    adminBroadcastAudienceActiveNoDevices: 'Paid, no VPN setup',
    adminBroadcastButtonKind: 'Button kind:',
    adminBroadcastButtonKindUrl: 'URL',
    adminBroadcastButtonKindApp: 'Open app',
    adminBroadcastButtonKindPromo: 'Promo code',
    adminBroadcastButtonPromoCode: 'Promo code (e.g. SUMMER2026)',
    adminBroadcastSend: 'Send broadcast',
    adminBroadcastSending: 'Sending...',
    adminBroadcastSent: 'Sent',
    adminBroadcastPending: 'Pending',
    adminBroadcastFailed: 'Failed',
    adminNoBroadcasts: 'No broadcasts yet',
    adminTotalUsers: 'Total',
    adminTodayUsers: 'Today',
    adminBannedUsers: 'Banned',
    adminRevenue: 'Revenue (total)',
    adminRevenueMonth: 'Revenue this month',
    adminRevenueByMonth: 'Revenue by month',
    adminTraffic: 'Traffic (total)',
    adminTrafficByMonth: 'Traffic by month',
    adminActiveSubs: 'Active subs',
    adminPaidPayments: 'Paid',
    adminSearchUsers: 'Search by name or ID...',
    adminBan: 'Ban',
    adminBanLogin: 'Ban login',
    adminBanSubscription: 'Ban sub',
    adminUnban: 'Unban',
    adminBanTypeLogin: 'login',
    adminBanTypeSub: 'subscription',
    adminCreatePromo: 'Create promo code',
    adminPromoCode: 'Code',
    adminPromoDays: 'Subscription days',
    adminPromoMaxUses: 'Max uses',
    adminPromoCreate: 'Create',
    adminPromoFilterAll: 'All',
    adminPromoFilterMine: 'Mine',
    adminPromoFilterBoxes: 'From boxes',
    adminBackToProfile: 'Back to profile',
    adminNoUsers: 'No users found',
    adminNoPromos: 'No promo codes yet',
    adminTicketsSearch: 'Search by subject, name, or Telegram ID...',
    adminTicketsOpenOnly: 'Open',
    adminTicketsAll: 'All',
    adminNoTickets: 'No tickets yet',
    adminTicketOpen: 'Open',
    adminTicketClosed: 'Closed',
    adminTicketSubjectEmpty: 'No subject',
    adminTicketBack: 'Back to list',
    adminTicketMessages: 'Messages',
    adminTicketReplyPlaceholder: 'Type your reply to the user...',
    adminTicketSendReply: 'Send reply',
    adminTicketSendingReply: 'Sending...',
    adminTicketClose: 'Close ticket',
    adminTicketReopen: 'Reopen ticket',
    adminTicketLoadError: 'Failed to load tickets',
    adminTicketActionError: 'Failed to complete action',
    adminTicketNoMessages: 'No messages yet',
    adminTicketSenderUser: 'User',
    adminTicketSenderAdmin: 'Admin',
    adminTicketSenderSystem: 'System',
    adminTicketDeleteTicket: 'Delete ticket',
    adminTicketDeleteMessage: 'Delete message',
    adminTicketDeleteConfirm: 'Delete this ticket and all messages permanently?',
    adminTicketDeleteMessageConfirm: 'Delete this message permanently?',
    adminTicketDeleting: 'Deleting...',
    promoPlaceholder: 'Enter promo code',
    promoApply: 'Activate',
    promoApplySuccess: 'Promo code applied',
    devicesConnected: 'Devices connected',
    deviceLimitReached: 'Device limit reached. Remove a device to add a new one.',
    deleteDevice: 'Delete',
    deleteDeviceConfirm: 'Delete this device? VPN will stop working on it.',
    deviceDeleted: 'Device deleted',
    serversTitle: 'Server status',
    serverActive: 'Active',
    serverInactive: 'Inactive',
    noServers: 'No servers yet',
    supportNewTicket: 'New ticket',
    supportNoTicketsTitle: 'You do not have support tickets yet',
    supportNoTicketsHint: 'Tap "New ticket" to contact us',
    supportFaqTitle: 'Frequently asked questions',
    supportFaqHint: 'You may find an answer to your question here',
    supportCreateTitle: 'Create ticket',
    supportSubject: 'Subject',
    supportSubjectHint: 'Optional, but helps us resolve faster',
    supportSubjectPlaceholder: 'Briefly describe the issue',
    supportMessage: 'Message',
    supportMessagePlaceholder: 'Describe your issue or question in detail...',
    supportSend: 'Send',
    supportSending: 'Sending...',
    supportLoading: 'Loading tickets...',
    supportOpenStatus: 'Open',
    supportClosedStatus: 'Closed',
    supportLastUpdate: 'Updated',
    supportMessagesCount: 'messages',
    supportNoSubject: 'No subject',
    supportCreateError: 'Failed to create ticket',
    supportLoadError: 'Failed to load tickets',
    supportBackToList: 'Back to tickets',
    supportMessageRequired: 'Message is required',
    supportTicketMessages: 'Messages',
    supportReplyPlaceholder: 'Type your message...',
    supportAttachPhoto: 'Attach photo',
    supportCloseTicket: 'Close ticket',
    supportReopenTicket: 'Reopen ticket',
    supportTicketActionError: 'Failed to complete action',
    supportTicketNoMessages: 'No messages yet',
    supportSenderUser: 'You',
    supportSenderAdmin: 'Support',
    supportSenderSystem: 'System',
    tgStoreTitle: 'Telegram Store',
    tgStoreStars: 'Telegram Stars',
    tgStorePremium: 'Telegram Premium',
    tgStoreSelectProduct: 'Select product',
    tgStoreSelectPeriod: 'Select period',
    tgStoreSelectAmount: 'Select amount',
    tgStore3Months: '3 months',
    tgStore6Months: '6 months',
    tgStore12Months: '12 months',
    tgStoreStarsAmount: 'Stars amount',
    tgStorePay: 'Pay via SBP',
    tgStorePrice: 'Price',
    tgStoreOldPrice: 'Was',
    tgStoreDiscount: 'Discount',
    tgStoreNoPrices: 'Prices not set yet',
    tgStoreLoading: 'Loading...',
    tgStoreBackToProfile: 'Back to profile',
    tgStoreUsername: 'Telegram username for delivery',
    tgStoreUsernamePlaceholder: '@username',
    servicesTitle: 'Foreign Services Payment',
    servicesDesc: 'We pay for any foreign service for you',
    servicesNewRequest: 'New Request',
    servicesServiceName: 'Service name',
    servicesServiceNamePlaceholder: 'Netflix, Spotify, YouTube Premium...',
    servicesDescription: 'Description',
    servicesDescriptionPlaceholder: 'Describe what needs to be paid, which account...',
    servicesSend: 'Submit request',
    servicesSending: 'Sending...',
    servicesNoRequests: 'No requests yet',
    servicesNoRequestsHint: 'Click "New Request" to order a payment',
    servicesStatusNew: 'New',
    servicesStatusAwaiting: 'Awaiting payment',
    servicesStatusPaid: 'Paid',
    servicesStatusProcessing: 'Processing',
    servicesStatusCompleted: 'Completed',
    servicesStatusCancelled: 'Cancelled',
    servicesPay: 'Pay',
    servicesBackToList: 'Back to requests',
    servicesBackToProfile: 'Back to profile',
    servicesReplyPlaceholder: 'Type a message...',
    servicesAmount: 'Amount to pay',
    adminServices: 'Services',
    accountTitle: 'Login & Security',
    accountLinkedAccounts: 'Linked accounts',
    accountTelegram: 'Telegram',
    accountEmail: 'Email',
    accountLinked: 'Linked',
    accountNotLinked: 'Not linked',
    accountVerified: 'Verified',
    accountNotVerified: 'Not verified',
    accountLinkEmail: 'Link email',
    accountUnlinkEmail: 'Unlink email',
    accountUnlinkTelegram: 'Unlink Telegram',
    accountEnterEmail: 'Enter email',
    accountLink: 'Link',
    accountLinking: 'Linking...',
    accountEmailTaken: 'This email is already linked to another account',
    accountTelegramTaken: 'This Telegram is already linked to another account',
    accountSuccess: 'Success',
    accountError: 'Error',
    accountCannotUnlink: 'Cannot unlink the only login method',
    accountVerifyEmail: 'Verify email',
    accountVerifyCode: 'Enter code from email',
    accountVerify: 'Verify',
    accountSendCode: 'Send code',
    accountCodeSent: 'Code sent to email',
    accountRegisteredVia: 'Registered via',
    accountCreatedAt: 'Registration date',
    accountBackToProfile: 'Back to profile',
    accountGoogle: 'Google',
    accountLinkGoogle: 'Link Google',
    accountGoogleLinking: 'Redirecting to Google…',
    accountGoogleHint: 'One email = one account. If your Google address is already in our system, accounts will be merged automatically.',
    accountSectionTitle: 'Sign-in methods',
    accountSectionSubtitle: 'Link multiple methods to never lose access',
    accountDangerTitle: 'Danger zone',
    accountDeleteTitle: 'Delete account',
    accountDeleteDescription: 'Permanently deletes your account and all associated data: subscriptions, keys, payment history, support tickets and devices. This cannot be undone.',
    accountDeleteButton: 'Delete account',
    accountDeleting: 'Deleting…',
    accountDeleteConfirmPrompt: 'This action is irreversible. All your data will be erased. Type DELETE in uppercase to confirm:',
    accountDeleteConfirmWord: 'DELETE',
    accountDeleteCancelled: 'Deletion cancelled',
    accountDeleteSuccess: 'Account deleted',
    accountDeleteError: 'Failed to delete account',

    // Boxes
    navBoxes: 'Boxes',
    boxesTitle: 'Daily Boxes',
    boxesSubtitle: 'Come back every day, open a box and build a streak. Every 7th box is a SUPER box with a chance for huge rewards.',
    boxesAdminBadge: 'Beta · admins only',
    boxesStreakLabel: 'Current streak',
    boxesStreakDays: 'd',
    boxesTotalLabel: 'Total opened',
    boxesUpcomingDaily: 'Next — Daily',
    boxesUpcomingSuper: 'Next — SUPER ✨',
    boxesOpenButton: 'Open box',
    boxesOpening: 'Opening…',
    boxesCooldownPrefix: 'Available in',
    boxesCooldownReady: 'Ready to open!',
    boxesProgressLabel: 'Progress to super box',
    boxesSuperReady: 'Super box ready!',
    boxesRewardTitle: 'Reward',
    boxesHistoryTitle: 'Reward history',
    boxesHistoryEmpty: 'Open your first box — it will show up here.',
    boxesRarityCommon: 'Common',
    boxesRarityUncommon: 'Uncommon',
    boxesRarityRare: 'Rare',
    boxesRarityEpic: 'Epic',
    boxesRarityLegendary: 'LEGENDARY',
    boxesBoxDaily: 'Daily',
    boxesBoxSuper: 'SUPER',
    boxesError: 'Failed to open box',
    boxesNotAdmin: 'This tab is in beta. Available to admins only.',
    boxesTelegramRequiredTitle: 'Link Telegram first',
    boxesTelegramRequiredDesc: 'Boxes are available only to users with a linked Telegram account — so we can notify you about new rewards and coupon expiration.',
    boxesLinkTelegramButton: 'Link Telegram',
    boxesLinkTelegramNoSession: 'Sign in first to link Telegram',
    boxesClaimed: 'Reward claimed ✓',
    boxesWhatCanDrop: 'What can drop?',
    boxesWhatCanDropTitle: 'What can drop?',
    boxesWhatCanDropDailyHint: 'Daily box usually drops a discount coupon, occasionally — subscription hours or a rare big prize.',
    boxesWhatCanDropSuperHint: 'SUPER box drops every 7th day of your streak with heavily boosted rewards, including rare massive drops.',
    boxesWhatCanDropFooter: 'Chances are independent. Each open is a fresh roll.',
    boxesHoursSubHint: 'subscription hours',
    boxesCouponSubHint: 'discount coupon, valid 24h',
    boxesAdminReset: 'Reset cooldown',
    // Coupon rewards
    boxesCouponPrefix: 'Discount ',
    boxesCouponRevealHint: 'Coupon valid for 24 hours. Use it on the checkout page.',
    boxesCouponSaved: 'Coupon saved ✓',
    boxesCouponExpiresAt: 'Expires',
    boxesCouponExpired: 'Expired',
    boxesCopy: 'Copy',
    boxesCopied: 'Copied',
    // History screen
    boxesHistoryButtonHint: 'All rewards and active coupons',
    boxesHistoryBack: 'Back to boxes',
    boxesHistoryTotalSuffix: 'rewards total',
    boxesHistoryLoadMore: 'Load more',
    boxesHistoryLoading: 'Loading…',
    boxesHistoryClear: 'Clear',
    boxesHistoryClearConfirm: 'Clear reward history? Streak and cooldown will be kept, issued coupons stay valid — only the entries on this list will be removed.',
    boxesHistoryCleared: 'History cleared',
  }
};

const ADMIN_TELEGRAM_IDS = [2029065770, 1483598839];

const tabs = ['home', 'support', 'profile', 'account', 'payment', 'payments', 'admin', 'servers', 'tgstore', 'services', 'boxes', 'boxes-history'] as const;
type Tab = typeof tabs[number];

const pageVariants = {
  initial: (direction: number) => ({
    opacity: 0,
    x: direction > 0 ? 20 : -20
  }),
  animate: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.25, ease: [0, 0, 0.2, 1] as const }
  },
  exit: (direction: number) => ({
    opacity: 0,
    x: direction < 0 ? 20 : -20,
    transition: { duration: 0.2, ease: [0.4, 0, 1, 1] as const }
  })
};

const listVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.1 }
  }
};

const itemVariants = {
  hidden: { opacity: 0, x: -10 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.3 } }
};

type AuthMode = 'telegram' | 'email' | 'none';
type UserIdentifier = { type: 'telegram'; telegramId: number } | { type: 'email'; userId: number };

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [direction, setDirection] = useState(0);
  const [lang, setLang] = useState<'ru' | 'en'>('ru');
  const [tgUser, setTgUser] = useState<{ id: number; name: string; photo: string; username?: string } | null>(null);
  const [subscriptionState, setSubscriptionState] = useState<{ endDate: string | null; daysLeft: number; status: string; subscriptionUrl: string | null; isBanned?: boolean; banReason?: string | null; banType?: string | null; unreadSupportCount?: number; referralCode?: string | null } | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>('none');
  const [authLoading, setAuthLoading] = useState(true);
  const [userIdentifier, setUserIdentifier] = useState<UserIdentifier | null>(null);
  const [pendingPromo, setPendingPromo] = useState<{ code: string; discountPercent: number; promoId: number } | null>(null);
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [hideNav, setHideNav] = useState(false);
  const [accountBanner, setAccountBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  // Single source of truth for the referral modal so the desktop sidebar,
  // the home-screen CTA and the profile menu button can all open the same
  // instance regardless of which tab is currently mounted. The previous
  // setup duplicated the modal inside HomeView and ProfileView, which
  // meant the sidebar entry on desktop had no way to trigger it (and the
  // entry was rendered as a non-interactive <div>, which is why clicks
  // were dead before this refactor).
  const [referralModalOpen, setReferralModalOpen] = useState(false);

  // 2026-05-13: extra UI password gate on top of `isAdmin(telegramId)`.
  // Backend admin endpoints stay protected by telegram-id whitelist (see
  // `lib/admin.ts`), but the panel itself only renders after the user
  // types this password once per browser session. This is intentionally
  // *not* a security boundary — it just hides the admin UI from anyone
  // who happens to glance at a logged-in admin's screen.
  // Stored in sessionStorage so a hard refresh keeps the unlock; closing
  // the tab clears it.
  const ADMIN_UI_PASSWORD = '8778';
  const [adminUnlocked, setAdminUnlocked] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try { return window.sessionStorage.getItem('hundler_admin_unlocked') === '1'; } catch { return false; }
  });
  const unlockAdmin = () => {
    setAdminUnlocked(true);
    try { window.sessionStorage.setItem('hundler_admin_unlocked', '1'); } catch { /* ignore */ }
  };
  const lockAdmin = () => {
    setAdminUnlocked(false);
    try { window.sessionStorage.removeItem('hundler_admin_unlocked'); } catch { /* ignore */ }
  };

  const buildStateQuery = (ident: UserIdentifier | null) => {
    if (!ident) return '';
    return ident.type === 'telegram'
      ? `telegramId=${encodeURIComponent(String(ident.telegramId))}`
      : `userId=${encodeURIComponent(String(ident.userId))}`;
  };

  const refreshSubscriptionState = async (identOrTgId?: number | UserIdentifier) => {
    let query = '';
    if (typeof identOrTgId === 'number') {
      query = `telegramId=${encodeURIComponent(String(identOrTgId))}`;
    } else if (identOrTgId) {
      query = buildStateQuery(identOrTgId);
    } else {
      query = buildStateQuery(userIdentifier);
    }
    if (!query) return;
    const stateResponse = await fetch(`/api/users/state?${query}`);
    if (stateResponse.ok) {
      const statePayload = await stateResponse.json();
      setSubscriptionState(statePayload.profile ?? { endDate: null, daysLeft: 0, status: 'none', subscriptionUrl: null, isBanned: false, banReason: null, banType: null });
      return;
    }
    setSubscriptionState({ endDate: null, daysLeft: 0, status: 'none', subscriptionUrl: null, isBanned: false, banReason: null, banType: null });
  };

  const handleEmailLogin = (user: { id: number; email: string; name: string }, sessionToken: string) => {
    localStorage.setItem('hvpn_session', sessionToken);
    const ident: UserIdentifier = { type: 'email', userId: user.id };
    setTgUser({ id: user.id, name: user.name, photo: '', username: user.email });
    setUserIdentifier(ident);
    setAuthMode('email');
    refreshSubscriptionState(ident);
  };

  const handleEmailLogout = () => {
    localStorage.removeItem('hvpn_session');
    setTgUser(null);
    setUserIdentifier(null);
    setAuthMode('none');
    setSubscriptionState(null);
  };

  // Get Telegram user data on mount or restore email session
  useEffect(() => {
    // Hard safety net: if for any reason init hangs (blocked telegram.org,
    // DB down, slow network) we still release the UI from the "three dots"
    // loading state after 6 s so users can at least see the login screen.
    const safetyTimer = setTimeout(() => {
      setAuthLoading((prev) => (prev ? false : prev));
    }, 6000);

    const waitForTelegramSdk = async () => {
      if (typeof window === 'undefined') return;
      // Only wait when we actually look like a Telegram Mini App context.
      const inTelegram = window.Telegram?.WebApp
        || window.location.hash.includes('tgWebAppData')
        || window.location.search.includes('tgWebAppStartParam');
      if (!inTelegram) return;
      for (let i = 0; i < 15; i++) {
        if (window.Telegram?.WebApp) return;
        await new Promise((r) => setTimeout(r, 200));
      }
    };

    const init = async () => {
      await waitForTelegramSdk();

      // Try Telegram WebApp first
      if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
        const tg = window.Telegram.WebApp;
        tg.ready();
        tg.expand();
        try { tg.requestFullscreen?.(); } catch (_) {}
        
        console.log('Telegram WebApp initialized:', tg.initDataUnsafe);
        
        const user = tg.initDataUnsafe?.user;
        if (user) {
          console.log('User data:', user);
          const normalizedName = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'User';
          const ident: UserIdentifier = { type: 'telegram', telegramId: user.id };

          setTgUser({
            id: user.id,
            name: normalizedName,
            photo: user.photo_url || '',
            username: user.username,
          });
          setUserIdentifier(ident);
          setAuthMode('telegram');

          const urlStartParam = typeof window !== 'undefined'
            ? new URLSearchParams(window.location.search).get('startapp') || new URLSearchParams(window.location.search).get('start')
            : null;

          // Handle return from Google OAuth link flow:
          // callback redirects to t.me/<bot>/app?startapp=<code>
          // which Telegram forwards into WebApp.initDataUnsafe.start_param.
          // Codes: gl_ok / gl_err_email / gl_err_google / gl_err_cancel / gl_err_token /
          //        gl_err_state / gl_err_unverified / gl_err_other.
          const sp = tg.initDataUnsafe?.start_param ?? urlStartParam ?? '';
          if (sp === 'gl_ok' || sp === 'gl_success') {
            setActiveTab('account');
            // Fetch the freshly-linked Google email so we can show it in the banner
            // ("Google-аккаунт привязан (user@gmail.com)") — lets the user verify
            // which account actually got linked.
            (async () => {
              let msg = lang === 'ru' ? 'Google-аккаунт привязан' : 'Google account linked';
              try {
                const r = await fetch(`/api/auth/account?telegramId=${user.id}`);
                const d = await r.json();
                if (d.ok && d.account?.email) msg += ` (${d.account.email})`;
              } catch { /* ignore */ }
              setAccountBanner({ type: 'success', message: msg });
            })();
          } else if (sp.startsWith('gl_err_') || sp === 'gl_error') {
            const errMap: Record<string, { ru: string; en: string }> = {
              gl_err_google:     { ru: 'Этот Google-аккаунт уже привязан к другому пользователю',          en: 'This Google account is already linked to another user' },
              gl_err_email:      { ru: 'Email этого Google-аккаунта уже подтверждён в другом аккаунте',     en: 'Email of this Google account is already verified on another user' },
              gl_err_cancel:     { ru: 'Вы отменили вход через Google',                                      en: 'You cancelled Google sign-in' },
              gl_err_token:      { ru: 'Google вернул некорректный токен. Попробуйте ещё раз',               en: 'Google returned an invalid token. Please try again' },
              gl_err_state:      { ru: 'Сессия OAuth истекла. Нажмите «Привязать Google» ещё раз',           en: 'OAuth session expired. Tap "Link Google" again' },
              gl_err_unverified: { ru: 'Email в Google не подтверждён. Подтвердите его в Google и повторите', en: 'Email is not verified in Google. Please verify it and try again' },
              gl_err_other:      { ru: 'Не удалось привязать Google. Попробуйте позже',                     en: 'Failed to link Google. Please try again later' },
              gl_error:          { ru: 'Не удалось привязать Google',                                        en: 'Failed to link Google' },
            };
            const msg = errMap[sp] || errMap.gl_err_other;
            setAccountBanner({ type: 'error', message: lang === 'ru' ? msg.ru : msg.en });
            setActiveTab('account');
          } else if (sp === 'payment' || sp === 'pay') {
            // 2026-05-05: deep-link used by the /api/cron/remind-expiring
            // cron (24h-before-expiry reminder DM) and any other bot button
            // that wants to drop the user straight onto the payment tab.
            // 'open' is the generic "just open the app" marker used by
            // broadcast buttons of kind='app' — we intentionally do nothing
            // for that case so the user lands on the home tab.
            setActiveTab('payment');
          }

          try {
            const syncResponse = await fetch('/api/users/sync', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                telegramId: user.id,
                username: user.username,
                firstName: user.first_name,
                lastName: user.last_name,
                photoUrl: user.photo_url,
                startParam: tg.initDataUnsafe?.start_param ?? urlStartParam ?? undefined,
              }),
            });

            if (!syncResponse.ok) {
              const syncPayload = await syncResponse.json().catch(() => ({ error: 'Sync failed' }));
              throw new Error(syncPayload.error || 'Sync failed');
            }

            await refreshSubscriptionState(user.id);

            // 2026-05-05: handle `promo_<CODE>` start_param emitted by
            // broadcast inline buttons of kind 'promo'. Calls /api/promos/apply
            // and either:
            //   - discount → set pending promo state + navigate to payment tab
            //     so the user lands on the form with the coupon already applied
            //   - days     → state already refreshed above; nothing extra to do
            //   - error    → silently swallowed; user lands in the app normally
            //                (we don't want to scare them with an alert before
            //                they've even seen the home screen).
            // The check happens AFTER /api/users/sync so the user row is
            // guaranteed to exist (apply requires it). `gl_*` and `ref_*`
            // prefixes are not promos and fall through untouched.
            if (sp.startsWith('promo_')) {
              const promoFromStart = sp.slice('promo_'.length).toUpperCase();
              if (promoFromStart) {
                try {
                  const promoRes = await fetch('/api/promos/apply', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      telegramId: user.id,
                      username: user.username,
                      firstName: user.first_name,
                      lastName: user.last_name,
                      photoUrl: user.photo_url,
                      code: promoFromStart,
                    }),
                  });
                  const promoData = await promoRes.json().catch(() => null);
                  if (promoRes.ok && promoData?.ok) {
                    if (promoData.type === 'discount' && promoData.discountPercent > 0) {
                      setPendingPromo({
                        code: promoData.promoCode,
                        discountPercent: promoData.discountPercent,
                        promoId: promoData.promoId,
                      });
                      setActiveTab('payment');
                    } else {
                      // Days-style promo — refresh state to show the new days.
                      await refreshSubscriptionState(user.id);
                    }
                  }
                } catch (e) {
                  console.error('Promo from start_param failed:', e);
                }
              }
            }
          } catch (error) {
            setSubscriptionState({ endDate: null, daysLeft: 0, status: 'none', subscriptionUrl: null, isBanned: false, banReason: null, banType: null });
            console.error('Failed to sync telegram user:', error);
          }
          setAuthLoading(false);
          return;
        }
      }

      // Try restoring email session
      if (typeof window !== 'undefined') {
        const savedToken = localStorage.getItem('hvpn_session');
        if (savedToken) {
          try {
            const res = await fetch(`/api/auth/session?token=${encodeURIComponent(savedToken)}`);
            if (res.ok) {
              const data = await res.json();
              if (data.ok && data.user) {
                const ident: UserIdentifier = { type: 'email', userId: data.user.id };
                setTgUser({ id: data.user.id, name: data.user.name, photo: '', username: data.user.email });
                setUserIdentifier(ident);
                setAuthMode('email');
                await refreshSubscriptionState(ident);
                setAuthLoading(false);
                return;
              }
            }
            localStorage.removeItem('hvpn_session');
          } catch { /* ignore */ }
        }
      }

      setAuthMode('none');
      setAuthLoading(false);
    };
    
    const timer = setTimeout(init, 100);
    return () => {
      clearTimeout(timer);
      clearTimeout(safetyTimer);
    };
  }, []);

  const t = translations[lang];
  const hasActiveSubscription = subscriptionState?.status === 'active';
  const subscriptionEndDateLabel = subscriptionState?.endDate
    ? new Date(subscriptionState.endDate).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB')
    : (lang === 'ru' ? 'Нет подписки' : 'No subscription');
  const subscriptionDaysLabel = hasActiveSubscription
    ? (lang === 'ru'
        ? `Осталось ${subscriptionState?.daysLeft ?? 0} дн.`
        : `${subscriptionState?.daysLeft ?? 0} days left`)
    : (lang === 'ru' ? 'Нет активной подписки' : 'No active subscription');

  const navigate = (newTab: Tab) => {
    if (newTab === activeTab) return;
    const currentIndex = tabs.indexOf(activeTab);
    const newIndex = tabs.indexOf(newTab);
    setDirection(newIndex > currentIndex ? 1 : -1);
    setActiveTab(newTab);
    haptic('medium');
  };


  // Check maintenance mode
  useEffect(() => {
    const checkMaintenance = async () => {
      try {
        const res = await fetch('/api/maintenance');
        if (res.ok) {
          const data = await res.json();
          setMaintenanceMode(data.enabled);
        }
      } catch { /* ignore */ }
    };
    checkMaintenance();
  }, []);

  // Periodic refresh of user state (unread support count, subscription days
  // remaining, etc.) so the red badge appears within ~30 s of the admin
  // sending a message — without needing websockets.
  useEffect(() => {
    if (!userIdentifier) return;
    const id = setInterval(() => {
      void refreshSubscriptionState(userIdentifier);
    }, 30_000);
    const onFocus = () => void refreshSubscriptionState(userIdentifier);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userIdentifier?.type === 'telegram' ? userIdentifier.telegramId : userIdentifier?.userId]);

  // Handle result of Google OAuth link flow (redirect back from callback)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const success = params.get('account_success');
    const error = params.get('account_error');
    if (!success && !error) return;

    if (success) setAccountBanner({ type: 'success', message: success });
    else if (error) setAccountBanner({ type: 'error', message: error });

    // Switch to account tab so the user sees the result
    setActiveTab('account');

    // Clean up URL so refresh doesn't re-trigger the banner
    const url = new URL(window.location.href);
    url.searchParams.delete('account_success');
    url.searchParams.delete('account_error');
    window.history.replaceState({}, '', url.pathname + url.search);
  }, []);

  const isAdmin = tgUser && ADMIN_TELEGRAM_IDS.includes(tgUser.id);

  // Show loading
  if (authLoading) {
    return (
      <div className="min-h-screen w-full bg-[#020202] flex items-center justify-center">
        <div className="text-zinc-500 text-sm">...</div>
      </div>
    );
  }

  // Show maintenance screen for non-admins
  if (maintenanceMode && !isAdmin) {
    return (
      <div className="min-h-screen w-full bg-[#020202] flex items-center justify-center px-4 overflow-hidden select-none">
        <div className="fixed inset-0 z-0 pointer-events-none">
          <div className="absolute -top-[20%] -left-[10%] w-[40vw] h-[40vw] max-w-[300px] max-h-[300px] rounded-full bg-red-500/15 blur-[55px]" />
          <div className="absolute top-[40%] -right-[10%] w-[50vw] h-[50vw] max-w-[400px] max-h-[400px] rounded-full bg-red-600/10 blur-[65px]" />
          <div className="absolute bottom-[20%] left-[30%] w-[30vw] h-[30vw] max-w-[200px] max-h-[200px] rounded-full bg-orange-500/8 blur-[50px]" />
        </div>
        <div className="relative z-10 w-full max-w-sm text-center">
          <div className="bg-zinc-900/70 border border-red-500/30 rounded-2xl p-6 backdrop-blur-xl shadow-[0_0_60px_rgba(239,68,68,0.15)] relative overflow-hidden">
            {/* Sparks effect */}
            <div className="absolute inset-0 z-0">
              <SparkEffect />
            </div>
            {/* Gear icon */}
            <div className="relative z-10 w-20 h-20 mx-auto mb-4">
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-16 h-16 rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center shadow-[0_0_30px_rgba(239,68,68,0.4)]">
                  <Settings size={32} className="text-red-400 animate-spin" style={{ animationDuration: '3s' }} />
                </div>
              </div>
            </div>
            <h2 className="relative z-10 text-white text-xl font-bold mb-2">
              {lang === 'ru' ? 'Технические работы' : 'Maintenance'}
            </h2>
            <p className="relative z-10 text-zinc-400 text-sm mb-3">
              {lang === 'ru'
                ? 'Мы проводим плановые технические работы. Пожалуйста, попробуйте позже.'
                : 'We are performing scheduled maintenance. Please try again later.'}
            </p>
            <p className="relative z-10 text-zinc-500 text-xs">
              {lang === 'ru' ? 'Приносим извинения за неудобства' : 'We apologize for any inconvenience'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Show ban screen only if user is banned with login ban (ban_type === 'login')
  if (subscriptionState?.isBanned && subscriptionState?.banType === 'login') {
    return (
      <div className="min-h-screen w-full bg-[#020202] flex items-center justify-center px-4">
        <div className="fixed inset-0 z-0 pointer-events-none">
          <div className="absolute -top-[20%] -left-[10%] w-[40vw] h-[40vw] max-w-[300px] max-h-[300px] rounded-full bg-red-500/10 blur-[55px]" />
          <div className="absolute top-[40%] -right-[10%] w-[50vw] h-[50vw] max-w-[400px] max-h-[400px] rounded-full bg-red-500/5 blur-[65px]" />
        </div>
        <div className="relative z-10 w-full max-w-sm text-center">
          <div className="bg-zinc-900/60 border border-red-500/20 rounded-2xl p-6 backdrop-blur-xl shadow-[0_0_40px_rgba(239,68,68,0.08)]">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
              <Ban size={28} className="text-red-400" />
            </div>
            <h2 className="text-white text-lg font-bold mb-2">
              {lang === 'ru' ? 'Аккаунт заблокирован' : 'Account Banned'}
            </h2>
            {subscriptionState.banReason && (
              <p className="text-zinc-400 text-sm mb-3">
                {lang === 'ru' ? 'Причина:' : 'Reason:'} {subscriptionState.banReason}
              </p>
            )}
            <p className="text-zinc-500 text-xs mb-5">
              {lang === 'ru'
                ? 'Ваш аккаунт заблокирован. Если вы считаете, что это ошибка, обратитесь в поддержку.'
                : 'Your account has been banned. If you believe this is a mistake, please contact support.'}
            </p>
            <a
              href="https://t.me/hundlervpn"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-white/10 border border-white/15 text-white px-5 py-2.5 rounded-xl text-sm hover:bg-white/15 transition-colors"
            >
              <HelpCircle size={16} />
              {lang === 'ru' ? 'Написать в поддержку' : 'Contact Support'}
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Show marketing landing page to unauthenticated browser visitors.
  // Telegram WebApp users never reach this branch — they auto-authenticate
  // via initDataUnsafe.user during the boot effect, so authMode is set to
  // 'telegram' before render. The landing has its own "Войти" CTA that
  // routes to /login for sign-in / sign-up.
  if (authMode === 'none') {
    return <LandingPage />;
  }

  return (
    // 2026-05-24: `overflow-x-hidden` на root убивал `position: sticky`
    // в DesktopSidebar — любой overflow:* у ancestor превращает sticky
    // в position:relative относительно этого ancestor, а так как
    // контейнер тянется на всю высоту контента, sidebar уезжал вверх
    // вместе с прокруткой. На lg+ оставляем overflow-x: visible — там
    // горизонтального переполнения нет (max-w-[1280px] на main),
    // а на mobile/tablet оставляем как было, иначе вылезают блюр-пятна
    // и частицы фона.
    <div className="min-h-screen w-full bg-[#020202] overflow-x-hidden lg:overflow-x-visible relative font-sans">
      {/* Animated Particles Background.
          2026-05-22: на вкладке "Боксы" фон полностью отключён — на
          телефонах подлагивало (тяжёлые SVG-анимации сундука +
          канвас-частицы одновременно). Чёрный bg-[#020202] от родителя
          остаётся, так что страница выглядит как у нас задумано — просто
          темнее и без подсветок. */}
      {activeTab !== 'boxes' && (
        <div className="fixed inset-0 z-0 pointer-events-none">
          <ParticlesBackground />
          <div className="absolute -top-[20%] -left-[10%] w-[40vw] h-[40vw] max-w-[300px] max-h-[300px] rounded-full bg-red-500/8 blur-[80px]" />
          <div className="absolute top-[40%] -right-[10%] w-[50vw] h-[50vw] max-w-[400px] max-h-[400px] rounded-full bg-red-500/5 blur-[100px]" />
          <div className="absolute bottom-[10%] left-[20%] w-[30vw] h-[30vw] max-w-[250px] max-h-[250px] rounded-full bg-orange-500/5 blur-[70px]" />
        </div>
      )}

      {/* Layout strategy 2026-05-13:
          - On mobile: single column, bottom nav.
          - On desktop (lg+): a fixed sidebar pinned to the left edge of
            the viewport, full-height; main content area takes the rest
            of the width with a generous max-width and centered. The
            sidebar uses `lg:sticky` instead of `lg:fixed` so it lives
            inside the document flow and respects scrollbars correctly,
            while still appearing pinned. */}
      <div className="relative z-10 min-h-screen lg:flex lg:items-start">
        <DesktopSidebar t={t} activeTab={activeTab} navigate={navigate} authMode={authMode} unreadSupportCount={subscriptionState?.unreadSupportCount ?? 0} onOpenReferral={subscriptionState?.referralCode ? () => setReferralModalOpen(true) : undefined} isAdmin={!!isAdmin} />

        <main 
          className="w-full min-h-screen pb-24 px-4 flex flex-col lg:min-h-screen lg:flex-1 lg:pb-10 lg:px-10 lg:min-w-0"
        >
          <header className="flex items-center justify-center py-6 shrink-0 lg:justify-start lg:py-6" style={{ paddingTop: 'calc(var(--sat) + 2.5rem)' }}>
            <h1 className="font-syncopate font-bold text-base tracking-[0.12em] text-white flex items-center lg:text-lg">
              HUNDLER
              <span className="relative inline-block ml-1.5">
                <span className="absolute inset-0 bg-gradient-to-r from-white to-zinc-300 blur-sm opacity-35"></span>
                <span className="relative text-transparent bg-clip-text bg-gradient-to-r from-zinc-200 via-white to-zinc-400">
                  VPN
                </span>
              </span>
            </h1>
          </header>

          <div className="w-full max-w-6xl mx-auto lg:flex-1 lg:flex lg:flex-col lg:items-stretch lg:justify-start lg:max-w-[1280px]">
            <AnimatePresence mode="wait" custom={direction}>
              {activeTab === 'home' && <HomeView key="home" t={t} direction={direction} subscriptionEndDateLabel={subscriptionEndDateLabel} subscriptionDaysLabel={subscriptionDaysLabel} daysLeft={subscriptionState?.daysLeft ?? 0} hasActiveSubscription={hasActiveSubscription} subscriptionUrl={subscriptionState?.subscriptionUrl ?? null} tgUser={tgUser} onSubscriptionChange={refreshSubscriptionState} userIdentifier={userIdentifier} navigate={navigate} onSetPendingPromo={setPendingPromo} referralCode={subscriptionState?.referralCode ?? null} lang={lang} onOpenReferral={() => setReferralModalOpen(true)} onHideNav={setHideNav} />}
              {activeTab === 'support' && <SupportView key="support" t={t} direction={direction} userIdentifier={userIdentifier} lang={lang} onHideNav={setHideNav} onMarkRead={() => userIdentifier && void refreshSubscriptionState(userIdentifier)} />}
              {activeTab === 'payment' && <PaymentView key="payment" t={t} direction={direction} tgUser={tgUser} onSubscriptionChange={refreshSubscriptionState} userIdentifier={userIdentifier} pendingPromo={pendingPromo} onClearPendingPromo={() => setPendingPromo(null)} />}
              {activeTab === 'profile' && <ProfileView key="profile" t={t} lang={lang} setLang={setLang} direction={direction} tgUser={tgUser} subscriptionDaysLabel={subscriptionDaysLabel} navigate={navigate} authMode={authMode} onLogout={handleEmailLogout} referralCode={subscriptionState?.referralCode ?? null} userIdentifier={userIdentifier} onOpenReferral={() => setReferralModalOpen(true)} />}
              {activeTab === 'account' && <AccountView key="account" t={t} direction={direction} tgUser={tgUser} navigate={navigate} lang={lang} authMode={authMode} userIdentifier={userIdentifier} accountBanner={accountBanner} setAccountBanner={setAccountBanner} />}
              {activeTab === 'payments' && <PaymentsHistoryView key="payments" t={t} direction={direction} tgUser={tgUser} navigate={navigate} lang={lang} />}
              {activeTab === 'admin' && (
                adminUnlocked
                  ? <AdminView key="admin" t={t} direction={direction} tgUser={tgUser} navigate={navigate} lang={lang} onHideNav={setHideNav} onLockAdmin={lockAdmin} />
                  : <AdminPasswordGate key="admin-gate" lang={lang} expected={ADMIN_UI_PASSWORD} onUnlock={unlockAdmin} onCancel={() => navigate('profile')} />
              )}
              {activeTab === 'servers' && <ServersView key="servers" t={t} direction={direction} navigate={navigate} />}
              {activeTab === 'tgstore' && <TgStoreView key="tgstore" t={t} direction={direction} tgUser={tgUser} navigate={navigate} lang={lang} />}
              {activeTab === 'services' && <ServicesView key="services" t={t} direction={direction} tgUser={tgUser} navigate={navigate} lang={lang} onHideNav={setHideNav} />}
              {activeTab === 'boxes' && (
                <BoxesView
                  key="boxes"
                  t={t}
                  direction={direction}
                  lang={lang}
                  tgUser={tgUser}
                  userIdentifier={userIdentifier}
                  isAdmin={!!isAdmin}
                  navigate={navigate}
                  onSubscriptionChange={refreshSubscriptionState}
                />
              )}
              {activeTab === 'boxes-history' && (
                <BoxesHistoryView
                  key="boxes-history"
                  t={t}
                  direction={direction}
                  lang={lang}
                  tgUser={tgUser}
                  userIdentifier={userIdentifier}
                  navigate={navigate}
                />
              )}
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* Bottom Navigation */}
      <nav className={`fixed bottom-0 left-0 right-0 bg-zinc-950/95 backdrop-blur-xl border-t border-white/5 pt-2 px-4 flex justify-around items-center z-20 lg:hidden transition-transform duration-300 ${hideNav ? 'translate-y-full' : 'translate-y-0'}`} style={{ paddingBottom: 'max(0.75rem, var(--sab))' }}>
        <NavItem 
          icon={<Shield size={20} strokeWidth={1.5} />} 
          label={t.navVpn} 
          isActive={activeTab === 'home'} 
          onClick={() => navigate('home')} 
        />
        <NavItem 
          icon={<HelpCircle size={20} strokeWidth={1.5} />} 
          label={t.navSupport} 
          isActive={activeTab === 'support'} 
          onClick={() => navigate('support')} 
          badge={subscriptionState?.unreadSupportCount ?? 0}
        />
        {/* Boxes — открыто всем юзерам (2026-05-22). Раньше тут стоял
            isAdmin-гейт, но фича вышла из беты. Backend /api/boxes/*
            теперь требует только наличие telegramId / userId, без
            isAdmin-проверки. */}
        <NavItem
          icon={<Package size={20} strokeWidth={1.5} />}
          label={t.navBoxes}
          isActive={activeTab === 'boxes'}
          onClick={() => navigate('boxes')}
        />
        <NavItem 
          icon={<User size={20} strokeWidth={1.5} />} 
          label={t.navProfile} 
          isActive={activeTab === 'profile'} 
          onClick={() => navigate('profile')} 
        />
      </nav>

      {/* Single shared ReferralModal — opened by HomeView CTA, ProfileView
          menu entry, and DesktopSidebar's "Реферальная система" button.
          Lives at the App root so it survives tab switches and is not
          tied to any specific view's mount lifecycle. */}
      <ReferralModal
        open={referralModalOpen}
        onClose={() => setReferralModalOpen(false)}
        referralCode={subscriptionState?.referralCode ?? null}
        t={t}
        lang={lang}
        userIdentifier={userIdentifier}
      />
    </div>
  );
}

function DesktopSidebar({ t, activeTab, navigate, authMode, unreadSupportCount, onOpenReferral, isAdmin }: { t: any; activeTab: Tab; navigate: (tab: Tab) => void; authMode?: AuthMode; unreadSupportCount?: number; onOpenReferral?: () => void; isAdmin?: boolean }) {
  // 2026-05-13: sidebar items get a leading icon (lucide). The icon
  // colour follows the active state — white when active, zinc-400 idle
  // — so the colour shifts match the existing pill background gradient.
  // `menuItem()` returns the inner JSX so we keep one source of truth
  // for icon + label spacing across all rows.
  const menuBtnClass = (isActive: boolean) => `group w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all ${isActive ? 'bg-gradient-to-r from-white/20 to-white/5 text-white border border-white/30 shadow-[0_0_0_1px_rgba(255,255,255,0.12)]' : 'text-zinc-300 hover:bg-white/5 hover:border-white/10 border border-transparent'}`;
  const iconCls = (isActive: boolean) => `shrink-0 ${isActive ? 'text-white' : 'text-zinc-400 group-hover:text-zinc-200'}`;
  // Same minimal pill style as the menu items above, just without the
  // active-tab gradient — used for actions that don't correspond to a
  // routed tab (e.g. referral modal opener).
  const linkBtnClass = 'group flex items-center gap-2.5 w-full text-left px-3 py-2 rounded-lg text-sm text-zinc-300 hover:bg-white/5 hover:text-white transition-colors active:scale-[0.98]';
  const supportUnread = unreadSupportCount ?? 0;

  return (
    /* DesktopSidebar 2026-05-13:
       - Pinned to the LEFT edge of the viewport (no margin / no rounded
         corners on the outer border — flush with the window).
       - `lg:sticky lg:top-0 lg:h-screen` keeps it visible while the main
         content scrolls. `lg:overflow-y-auto` so a tall menu can scroll
         independently if it ever exceeds the viewport.
       - Width 256 px (`lg:w-64`) — feels like the Volna VPN PC layout,
         but more compact than the previous 288 px so the main content
         gets more room. */
    <aside className="hidden lg:sticky lg:top-0 lg:h-screen lg:flex lg:w-64 lg:shrink-0 lg:flex-col lg:overflow-y-auto lg:border-r lg:border-white/10 lg:bg-gradient-to-b lg:from-[#0d0d0d] lg:via-[#080808] lg:to-[#020202] lg:p-4 lg:backdrop-blur-xl">
      <div className="mb-6 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <p className="text-zinc-400 text-[11px] uppercase tracking-[0.16em] mb-2.5">Главная</p>
        <div className="space-y-1">
          <button onClick={() => navigate('home')} className={menuBtnClass(activeTab === 'home')}>
            <span className="inline-flex items-center gap-2.5">
              <Home size={16} strokeWidth={1.75} className={iconCls(activeTab === 'home')} />
              {t.navVpn}
            </span>
          </button>
          <button onClick={() => navigate('support')} className={menuBtnClass(activeTab === 'support')}>
            <span className="inline-flex items-center gap-2.5">
              <MessageCircle size={16} strokeWidth={1.75} className={iconCls(activeTab === 'support')} />
              {t.navSupport}
              {supportUnread > 0 && (
                <span className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-red-500 text-[10px] font-bold text-white flex items-center justify-center shadow-[0_0_8px_rgba(239,68,68,0.6)]">
                  {supportUnread > 99 ? '99+' : supportUnread}
                </span>
              )}
            </span>
          </button>
          <button onClick={() => navigate('payment')} className={menuBtnClass(activeTab === 'payment')}>
            <span className="inline-flex items-center gap-2.5">
              <Crown size={16} strokeWidth={1.75} className={iconCls(activeTab === 'payment')} />
              {t.navPremium}
            </span>
          </button>
          <button onClick={() => navigate('profile')} className={menuBtnClass(activeTab === 'profile')}>
            <span className="inline-flex items-center gap-2.5">
              <User size={16} strokeWidth={1.75} className={iconCls(activeTab === 'profile')} />
              {t.navProfile}
            </span>
          </button>
          <button onClick={() => navigate('account')} className={menuBtnClass(activeTab === 'account')}>
            <span className="inline-flex items-center gap-2.5">
              <Settings size={16} strokeWidth={1.75} className={iconCls(activeTab === 'account')} />
              {t.accountTitle}
            </span>
          </button>
          {/* Boxes — открыто всем (2026-05-22, см. mobile bottom-nav). */}
          <button onClick={() => navigate('boxes')} className={menuBtnClass(activeTab === 'boxes')}>
            <span className="inline-flex items-center gap-2.5">
              <Package size={16} strokeWidth={1.75} className={iconCls(activeTab === 'boxes')} />
              {t.navBoxes}
            </span>
          </button>
        </div>
      </div>

      <div className="mb-6 rounded-2xl border border-white/10 bg-white/[0.02] p-3">
        <p className="text-zinc-500 text-[11px] uppercase tracking-[0.16em] mb-2.5">Ссылки</p>
        <div className="space-y-1 text-sm text-zinc-300">
          {/* next/link keeps the navigation INSIDE the Telegram mini-app
              webview. `target="_blank"` / `window.open` would punt the
              user to the system browser, which is jarring inside TMA. */}
          <Link href="/privacy" className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-white/5 hover:text-white transition-colors">
            <Lock size={16} strokeWidth={1.75} className="text-zinc-400 shrink-0" />
            <span>Политика конфиденциальности</span>
          </Link>
          <Link href="/terms" className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-white/5 hover:text-white transition-colors">
            <FileText size={16} strokeWidth={1.75} className="text-zinc-400 shrink-0" />
            <span>Пользовательское соглашение</span>
          </Link>
        </div>
      </div>

      <div className="mb-6 rounded-2xl border border-white/10 bg-white/[0.02] p-3">
        <p className="text-zinc-500 text-[11px] uppercase tracking-[0.16em] mb-2.5">Программы</p>
        <div className="space-y-1">
          {/* Opens the shared <ReferralModal /> — same instance the home
              CTA and the profile menu button trigger. Disabled if no
              opener is wired (e.g. unit-test render). */}
          <button
            type="button"
            onClick={() => { haptic('light'); onOpenReferral?.(); }}
            disabled={!onOpenReferral}
            className={`${linkBtnClass} disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <Gift size={16} strokeWidth={1.75} className="text-zinc-400 group-hover:text-zinc-200 shrink-0" />
            <span>{t.referral}</span>
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
        <p className="text-zinc-500 text-[11px] uppercase tracking-[0.16em] mb-2.5">Аккаунт</p>
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => { haptic('light'); navigate('payments'); }}
            className={linkBtnClass}
          >
            <CreditCard size={16} strokeWidth={1.75} className="text-zinc-400 group-hover:text-zinc-200 shrink-0" />
            <span>{t.payments}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}

function HomeView({ t, direction, subscriptionEndDateLabel, subscriptionDaysLabel, daysLeft, hasActiveSubscription, subscriptionUrl, tgUser, onSubscriptionChange, userIdentifier, navigate, onSetPendingPromo, referralCode, lang, onOpenReferral, onHideNav }: { t: any, direction: number; subscriptionEndDateLabel: string; subscriptionDaysLabel: string; daysLeft: number; hasActiveSubscription: boolean; subscriptionUrl: string | null; tgUser: { id: number; name: string; photo: string; username?: string } | null; onSubscriptionChange: (identOrTgId: number | UserIdentifier) => Promise<void>; userIdentifier: UserIdentifier | null; navigate: (tab: Tab) => void; onSetPendingPromo: (promo: { code: string; discountPercent: number; promoId: number } | null) => void; referralCode?: string | null; lang: 'ru' | 'en'; onOpenReferral: () => void; onHideNav?: (hide: boolean) => void }) {
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [showDevicesModal, setShowDevicesModal] = useState(false);
  const [showPromoModal, setShowPromoModal] = useState(false);
  // (removed) matrixRainRef — the tap-burst effect was dropped per UX
  // feedback 2026-05-13 («строки кода перегружают видимость»). The
  // background rain now runs purely ambient.
  const [devices, setDevices] = useState<{ id: number; device_name: string | null; ip_address: string | null; last_seen_at: string | null; created_at: string }[]>([]);
  const [maxDevices, setMaxDevices] = useState(3);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [deviceOS, setDeviceOS] = useState<'windows' | 'macos' | 'linux' | 'android' | 'ios' | 'unknown'>('unknown');
  const [setupStep, setSetupStep] = useState<1 | 2 | 3>(1);
  const [showDevicePicker, setShowDevicePicker] = useState(false);
  const [setupRegion, setSetupRegion] = useState<'global' | 'russia'>('russia');
  const [setupClient, setSetupClient] = useState<'hundler' | 'happ' | 'v2raytun'>('happ');
  const [vpnKey, setVpnKey] = useState<string | null>(null);
  const [vpnKeyLoading, setVpnKeyLoading] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const [promoCode, setPromoCode] = useState('');
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);

  const userQuery = userIdentifier
    ? (userIdentifier.type === 'telegram' ? `telegramId=${encodeURIComponent(String(userIdentifier.telegramId))}` : `userId=${encodeURIComponent(String(userIdentifier.userId))}`)
    : (tgUser ? `telegramId=${encodeURIComponent(String(tgUser.id))}` : '');

  const fetchDevices = async () => {
    if (!userQuery) return;
    setDevicesLoading(true);
    try {
      const res = await fetch(`/api/users/devices?${userQuery}`);
      if (res.ok) {
        const data = await res.json();
        setDevices(data.devices ?? []);
        setMaxDevices(data.maxDevices ?? 3);
      } else {
        setDevices([]);
      }
    } catch {
      setDevices([]);
    } finally {
      setDevicesLoading(false);
    }
  };

  useEffect(() => { fetchDevices(); }, [userQuery]);

  const handleDevicesClick = () => {
    haptic('medium');
    setShowDevicesModal(true);
    fetchDevices();
  };

  const handleReferralClick = () => {
    haptic('medium');
    if (!referralCode) return;
    onOpenReferral();
  };

  const handleDeleteDevice = async (deviceId: number) => {
    haptic('heavy');
    if (!userQuery) return;
    if (!confirm(t.deleteDeviceConfirm)) return;
    try {
      const res = await fetch(`/api/users/devices?${userQuery}&deviceId=${deviceId}`, { method: 'DELETE' });
      if (res.ok) {
        setDevices((prev) => prev.filter((d) => d.id !== deviceId));
      }
    } catch { /* ignore */ }
  };

  const detectDevice = (): 'windows' | 'macos' | 'linux' | 'android' | 'ios' | 'unknown' => {
    if (typeof window === 'undefined') return 'unknown';
    const ua = navigator.userAgent;
    
    // Check for iOS first (iPhone, iPad, iPod)
    if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
      return 'ios';
    }
    // Check for Android
    if (/Android/.test(ua)) {
      return 'android';
    }
    // Check for Windows
    if (/Windows NT/.test(ua)) {
      return 'windows';
    }
    // Check for macOS
    if (/Mac OS X/.test(ua) && !/like Mac OS X/.test(ua)) {
      return 'macos';
    }
    // Check for Linux (not Android)
    if (/Linux/.test(ua) && !/Android/.test(ua)) {
      return 'linux';
    }
    return 'unknown';
  };

  const handleInstallClick = () => {
    haptic('medium');
    const os = detectDevice();
    setDeviceOS(os);
    setSetupStep(1);
    setShowDevicePicker(false);
    setSetupClient(os === 'windows' ? 'hundler' : 'happ');
    setShowSetupModal(true);
  };

  const fetchVpnKey = async () => {
    if (!userQuery) return;
    setVpnKeyLoading(true);
    setKeyCopied(false);
    try {
      if (subscriptionUrl) {
        setVpnKey(subscriptionUrl);
        return;
      }

      const res = await fetch(`/api/users/devices?${userQuery}`);
      if (res.ok) {
        const data = await res.json();
        // Ищем любое устройство с ключом (не только активное)
        const deviceWithKey = (data.devices ?? []).find((d: { key_uri: string }) => d.key_uri && !d.key_uri.startsWith('pending://'));
        setVpnKey(deviceWithKey?.key_uri ?? null);
      } else {
        setVpnKey(null);
      }
    } catch {
      setVpnKey(null);
    } finally {
      setVpnKeyLoading(false);
    }
  };

  const copyKey = async () => {
    if (!vpnKey) return;
    try {
      await navigator.clipboard.writeText(vpnKey);
      setKeyCopied(true);
      setTimeout(() => setKeyCopied(false), 3000);
    } catch { /* ignore */ }
  };

  const closeSetupModal = useCallback(() => {
    setShowSetupModal(false);
    setSetupStep(1);
    setShowDevicePicker(false);
    setSetupClient('happ');
    setVpnKey(null);
    setKeyCopied(false);
  }, []);

  // Wire the Telegram native BackButton while the setup modal is open.
  // Pressing it goes one step back; if we're already on step 1 the modal
  // closes. Outside Telegram (regular browser) the hook is a no-op and
  // the user falls back to the in-page close affordance.
  const handleSetupBack = useCallback(() => {
    haptic('light');
    setSetupStep((prev) => {
      if (prev > 1) return (prev - 1) as 1 | 2 | 3;
      // We're on step 1 — close the wizard entirely.
      // Use a microtask so React commits the state change first.
      Promise.resolve().then(closeSetupModal);
      return prev;
    });
  }, [closeSetupModal]);
  // Only show the native BackButton while the modal is open. The hook
  // itself short-circuits when not in TMA, so this is safe in plain
  // browsers as well (just becomes a no-op).
  useTelegramBackButton(handleSetupBack, showSetupModal);

  // Hide the global bottom navigation (Главная / Поддержка / Профиль)
  // while the setup wizard is open — it's a focused full-screen flow
  // and the nav bar at the bottom both wastes vertical space and lets
  // the user accidentally fall out of the funnel mid-setup.
  useEffect(() => {
    onHideNav?.(showSetupModal);
    return () => onHideNav?.(false);
  }, [showSetupModal, onHideNav]);
  // Track TMA-ness once after mount; used to decide whether to render
  // an in-page close button as a fallback (browsers / Telegram desktop
  // before BackButton SDK loads).
  const [inTma, setInTma] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const start = Date.now();
    const tick = () => {
      if (cancelled) return;
      if (isInTelegramMiniApp()) { setInTma(true); return; }
      if (Date.now() - start >= 3000) return;
      setTimeout(tick, 200);
    };
    tick();
    return () => { cancelled = true; };
  }, []);

  const getDeviceLabel = () => {
    switch (deviceOS) {
      case 'windows': return t.setupWindows;
      case 'macos': return t.setupMacos;
      case 'linux': return t.setupLinux;
      case 'android': return t.setupAndroid;
      case 'ios': return t.setupIos;
      default: return t.setupUnknown;
    }
  };

  const getDeviceIcon = () => {
    switch (deviceOS) {
      case 'windows': return <Monitor size={26} className="text-white sm:w-[38px] sm:h-[38px]" strokeWidth={1.8} />;
      case 'macos': return <Laptop size={26} className="text-white sm:w-[38px] sm:h-[38px]" strokeWidth={1.8} />;
      case 'linux': return <Monitor size={26} className="text-white sm:w-[38px] sm:h-[38px]" strokeWidth={1.8} />;
      case 'android': return <SmartphoneIcon size={26} className="text-white sm:w-[38px] sm:h-[38px]" strokeWidth={1.8} />;
      case 'ios': return <SmartphoneIcon size={26} className="text-white sm:w-[38px] sm:h-[38px]" strokeWidth={1.8} />;
      default: return <MonitorSmartphone size={26} className="text-white sm:w-[38px] sm:h-[38px]" strokeWidth={1.8} />;
    }
  };

  // Public pretty link to our native Windows installer. Backend `/download`
  // (app/download/route.ts) 302-redirects to the proxy that streams the latest
  // HundlerVPN-Setup-*.exe from the (now private) Hundler-App repo via token.
  const HUNDLER_WINDOWS_DOWNLOAD = 'https://hundlervpn.xyz/download';

  // Which clients we offer per platform, in display order. The FIRST entry is
  // the recommended one (gets the badge) and the default selection. Windows:
  // our native HundlerVPN app first, then Happ. Everywhere else (incl. Android,
  // where our native app is still store-only / too raw to push): Happ + v2rayTun.
  const clientsForOS = (os: typeof deviceOS): Array<'hundler' | 'happ' | 'v2raytun'> =>
    os === 'windows' ? ['hundler', 'happ'] : ['happ', 'v2raytun'];
  const availableClients = clientsForOS(deviceOS);
  // Switching device in the picker also resets to that platform's recommended
  // client so we never end up with an option that doesn't apply (e.g. 'hundler'
  // selected after switching to Android).
  const pickDeviceOS = (os: typeof deviceOS) => {
    setDeviceOS(os);
    setSetupClient(clientsForOS(os)[0]);
  };

  const getStoreLink = () => {
    if (setupClient === 'v2raytun') {
      // v2rayTun — https://v2raytun.com
      if (deviceOS === 'windows') {
        return 'https://storage.v2raytun.com/v2RayTun_Setup.exe';
      }
      if (deviceOS === 'android') {
        return 'https://play.google.com/store/apps/details?id=com.v2raytun.android';
      }
      if (deviceOS === 'ios' || deviceOS === 'macos') {
        return 'https://apps.apple.com/us/app/v2raytun/id6476628951';
      }
      // v2rayTun doesn't have a native Linux build
      return '';
    }
    // Happ Proxy Utility — https://github.com/Happ-proxy
    if (deviceOS === 'windows') {
      return 'https://github.com/Happ-proxy/happ-desktop/releases/latest/download/setup-Happ.x64.exe';
    }
    if (deviceOS === 'android') {
      return 'https://play.google.com/store/apps/details?id=com.happproxy&pli=1';
    }
    if (deviceOS === 'ios' || deviceOS === 'macos') {
      return setupRegion === 'russia'
        ? 'https://apps.apple.com/ru/app/happ-proxy-utility-plus/id6746188973'
        : 'https://apps.apple.com/us/app/happ-proxy-utility/id6504287215';
    }
    if (deviceOS === 'linux') {
      return 'https://github.com/Happ-proxy/happ-desktop/releases/latest/download/Happ.linux.x64.deb';
    }
    return '';
  };

  const openStoreLink = (customLink?: string) => {
    const link = customLink || getStoreLink();
    if (!link) return;

    if (typeof window !== 'undefined' && window.Telegram?.WebApp?.openLink) {
      window.Telegram.WebApp.openLink(link);
      return;
    }

    if (typeof window !== 'undefined') {
      window.open(link, '_blank', 'noopener,noreferrer');
    }
  };

  const handlePromoClick = () => {
    haptic('medium');
    setPromoCode('');
    setPromoError(null);
    setShowPromoModal(true);
  };

  const closePromoModal = () => {
    setShowPromoModal(false);
    setPromoError(null);
    setPromoLoading(false);
  };

  const handleApplyPromo = async () => {
    haptic('medium');
    if ((!tgUser?.id && !userIdentifier) || !promoCode.trim()) return;
    setPromoLoading(true);
    setPromoError(null);
    try {
      const promoBody: Record<string, unknown> = { code: promoCode.trim() };
      if (userIdentifier?.type === 'email') {
        promoBody.userId = userIdentifier.userId;
      } else if (userIdentifier?.type === 'telegram') {
        promoBody.telegramId = userIdentifier.telegramId;
        promoBody.username = tgUser?.username;
        promoBody.photoUrl = tgUser?.photo;
      } else if (tgUser?.id) {
        promoBody.telegramId = tgUser.id;
        promoBody.username = tgUser.username;
        promoBody.photoUrl = tgUser.photo;
      }
      const response = await fetch('/api/promos/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(promoBody),
      });
      const data = await response.json();
      if (!response.ok) {
        setPromoError(data.error || 'Ошибка применения промокода');
        return;
      }
      
      // Скидочный промокод - переносим на страницу оплаты
      if (data.type === 'discount' && data.discountPercent > 0) {
        setShowPromoModal(false);
        setPromoCode('');
        // Сохраняем промокод и переходим на страницу оплаты
        onSetPendingPromo({ code: data.promoCode, discountPercent: data.discountPercent, promoId: data.promoId });
        navigate('payment');
        return;
      }
      
      // Промокод на дни - обновляем подписку
      setPromoCode('');
      if (userIdentifier) {
        await onSubscriptionChange(userIdentifier);
      } else if (tgUser?.id) {
        await onSubscriptionChange(tgUser.id);
      }
      setShowPromoModal(false);
      alert(t.promoApplySuccess);
    } catch (error) {
      console.error('Promo apply error:', error);
      setPromoError('Ошибка применения промокода');
    } finally {
      setPromoLoading(false);
    }
  };

  return (
    <>
      {/* Setup Full-Page View */}
      <AnimatePresence>
        {showSetupModal && (
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 30 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="fixed inset-0 z-40 bg-gradient-to-b from-[#0a0a0a] via-[#050505] to-black flex flex-col overflow-hidden"
          >
            {/* Atmospheric red «0/1» digital rain. Sits behind everything
                else (sticky header has its own opaque backdrop, content
                area is transparent so the rain shows through). The
                canvas is `pointer-events-none` so it never eats taps.
                Density is intentionally LOW (0.05) — earlier passes at
                0.14 were swamping the call-to-action buttons; the rain
                should *frame* the content, not compete with it. The
                tap-burst effect was removed for the same reason — it
                was firing whenever a user simply pressed a control. */}
            <MatrixRain density={0.05} />

            {/* Header.
                Per UX policy (2026-05-14 update):
                  • In TMA (Mini App) — NO in-page buttons. The system
                    BackButton (wired via `useTelegramBackButton`
                    above) is the only nav affordance. Telegram's UX
                    guidelines explicitly say not to duplicate it in
                    HTML.
                  • Outside TMA (plain browser) — BOTH a back and a
                    close button, mirrored in the corners. The
                    asymmetric single-X pass got flagged as broken
                    UX: users couldn't return to the previous step
                    without using the page-level "Back to step" CTAs.
                  • The "1 OF 3" text was dropped — the three progress
                    bars communicate position by themselves. */}
            <div className="relative shrink-0 px-4 pb-3" style={{ paddingTop: 'calc(var(--sat) + 1rem)' }}>
              {!inTma && (
                <>
                  <button
                    onClick={handleSetupBack}
                    className="absolute top-[calc(var(--sat)+0.75rem)] left-3 w-8 h-8 flex items-center justify-center rounded-full border border-white/10 bg-black/40 backdrop-blur text-zinc-400 hover:text-white hover:border-white/30 transition-all active:scale-90 z-10"
                    aria-label="back"
                  >
                    <ChevronLeft size={14} strokeWidth={2.2} />
                  </button>
                  <button
                    onClick={closeSetupModal}
                    className="absolute top-[calc(var(--sat)+0.75rem)] right-3 w-8 h-8 flex items-center justify-center rounded-full border border-white/10 bg-black/40 backdrop-blur text-zinc-400 hover:text-white hover:border-white/30 transition-all active:scale-90 z-10"
                    aria-label="close"
                  >
                    <X size={14} strokeWidth={2.2} />
                  </button>
                </>
              )}
              {/* Progress bars sit in the centre regardless of which
                  side-buttons are showing. Width capped so the bar
                  cluster doesn't drift off-axis when the buttons
                  appear/disappear. */}
              <div className="flex items-center gap-1.5 max-w-md mx-auto px-10">
                {[1, 2, 3].map((s) => (
                  <div key={s} className="relative h-1 flex-1 rounded-full bg-white/10 overflow-hidden">
                    <motion.div
                      className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-red-500 via-red-400 to-red-500 shadow-[0_0_8px_rgba(239,68,68,0.45)]"
                      initial={false}
                      animate={{ width: s <= setupStep ? '100%' : '0%' }}
                      transition={{ duration: 0.5, ease: 'easeOut' }}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Scrollable content.
                2026-05-14 v3:
                  • DESKTOP — bumped max-width from `max-w-md` (448px)
                    to `lg:max-w-2xl` (672px). At 1920px viewport the
                    448-wide column was sitting in the middle of an
                    ocean of black, which the user called «треш». 672
                    is roughly the legal-page column and reads as a
                    deliberate centred layout instead of a stranded
                    mobile card.
                  • MOBILE — vertically centre the wizard content.
                    Pattern: outer scroller + inner `min-h-full flex
                    flex-col justify-center`. When the wizard content
                    is shorter than the viewport (step 1 always is)
                    the flex layout centres it; when it overflows
                    (long device pickers, big QR pages on step 3)
                    `min-h-full` ensures the column still grows
                    naturally and scrolls. This is the standard
                    «centre-when-short, top-when-long» pattern. */}
            <div
              className="relative flex-1 overflow-y-auto"
              style={{
                paddingBottom: 'calc(var(--sab) + 2rem)',
                scrollbarGutter: 'stable both-edges',
              }}
            >
              <div className="min-h-full flex flex-col items-center justify-center px-4 sm:px-6 py-6 sm:py-10">
              <div className="w-full max-w-md lg:max-w-2xl mx-auto">
                <div className="relative mx-auto mb-5 sm:mb-8 flex h-24 w-24 sm:h-36 sm:w-36 items-center justify-center">
                  <div className="absolute inset-0 rounded-full bg-red-500/20 blur-2xl" />
                  <motion.div
                    className="absolute inset-0 rounded-full border border-red-500/25"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 24, repeat: Infinity, ease: 'linear' }}
                  />
                  <div className="absolute inset-2 sm:inset-3 rounded-full border border-white/15" />
                  <div className="absolute inset-4 sm:inset-6 rounded-full border border-white/10" />
                  <motion.div
                    key={setupStep}
                    initial={{ scale: 0.6, opacity: 0, rotate: -12 }}
                    animate={{ scale: 1, opacity: 1, rotate: 0 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                    className="relative z-10 flex h-14 w-14 sm:h-20 sm:w-20 items-center justify-center rounded-full bg-gradient-to-br from-red-500/30 via-zinc-900/80 to-zinc-950 border border-red-500/40 shadow-[0_0_28px_rgba(239,68,68,0.35)]"
                  >
                    {setupStep === 1 ? getDeviceIcon() : setupStep === 2 ? <Download size={26} className="text-white sm:w-[38px] sm:h-[38px]" strokeWidth={1.8} /> : <Key size={26} className="text-white sm:w-[38px] sm:h-[38px]" strokeWidth={1.8} />}
                  </motion.div>
                </div>

                {setupStep === 1 && (
                  <>
                    <h3 className="text-xl sm:text-2xl font-bold text-center text-white mb-2">{t.setupFor} {getDeviceLabel()}</h3>
                    <p className="text-zinc-400 text-center text-sm mb-5 sm:mb-6">{t.setupStepsHint}</p>

                    {/* Client chooser */}
                    <p className="text-zinc-500 text-[11px] uppercase tracking-[0.18em] text-center mb-2">{t.setupChooseClient}</p>
                    <div className="grid grid-cols-2 gap-2 mb-5 sm:mb-6">
                      {availableClients.map((client, idx) => {
                        const selected = setupClient === client;
                        const meta = {
                          hundler: { title: t.setupClientHundlerTitle, subtitle: t.setupClientHundlerSubtitle, icon: <Shield size={20} strokeWidth={1.8} className={selected ? 'text-white' : 'text-zinc-400'} /> },
                          happ: { title: t.setupClientHappTitle, subtitle: t.setupClientHappSubtitle, icon: <HappIcon size={20} className={selected ? 'text-white' : 'text-zinc-400'} /> },
                          v2raytun: { title: t.setupClientV2RayTunTitle, subtitle: t.setupClientV2RayTunSubtitle, icon: <V2RayTunIcon size={20} className={selected ? 'text-white' : 'text-zinc-400'} /> },
                        }[client];
                        // The FIRST client for the platform is the recommended one.
                        const recommended = idx === 0;
                        return (
                          <button
                            key={client}
                            onClick={() => { haptic('light'); setSetupClient(client); }}
                            className={`relative rounded-xl border px-3 py-3 backdrop-blur-sm transition-all text-left ${selected ? 'border-white/60 bg-white/[0.1] shadow-[0_0_16px_rgba(255,255,255,0.18)]' : 'border-white/10 bg-zinc-900/90 hover:border-white/20'}`}
                          >
                            {recommended && (
                              <div className="absolute -top-1.5 right-2 rounded-full bg-black border border-white/80 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
                                {t.setupClientRecommended}
                              </div>
                            )}
                            <div className="flex flex-col gap-2">
                              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${selected ? 'border-white/40 bg-white/10' : 'border-white/10 bg-zinc-800/80'}`}>
                                {meta.icon}
                              </div>
                              <div className="min-w-0">
                                <p className={`font-semibold text-[13px] leading-tight truncate ${selected ? 'text-white' : 'text-zinc-200'}`}>{meta.title}</p>
                                <p className="text-zinc-500 text-[10px] leading-tight truncate">{meta.subtitle}</p>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div className="space-y-2.5">
                      <button
                        onClick={() => setSetupStep(2)}
                        className="w-full bg-gradient-to-r from-red-500 to-red-600 border border-red-400/30 text-white font-semibold py-3.5 sm:py-4 rounded-full flex items-center justify-center gap-2 active:scale-95 text-sm sm:text-base shadow-lg shadow-red-500/25 hover:shadow-red-500/40 transition-shadow"
                      >
                        <ArrowRight size={16} /> {t.setupStart}
                      </button>

                      <button
                        onClick={() => setShowDevicePicker((prev) => !prev)}
                        className="w-full border border-white/20 text-white font-medium py-3.5 sm:py-4 rounded-full flex items-center justify-center gap-2 active:scale-95 transition-colors hover:text-white hover:border-white/25"
                      >
                        <MonitorSmartphone size={16} /> {t.setupOtherDevice}
                      </button>
                    </div>

                    {showDevicePicker && (
                      <div className="mt-4 rounded-2xl border border-white/10 bg-zinc-900/50 p-3">
                        <p className="text-zinc-400 text-xs uppercase tracking-wider mb-2">{t.setupChooseDevice}</p>
                        <div className="grid grid-cols-2 gap-2">
                          <button onClick={() => pickDeviceOS('windows')} className={`rounded-lg border px-3 py-2 text-sm transition-colors ${deviceOS === 'windows' ? 'border-white/35 text-white bg-white/10' : 'border-white/10 text-zinc-300'}`}>Windows</button>
                          <button onClick={() => pickDeviceOS('macos')} className={`rounded-lg border px-3 py-2 text-sm transition-colors ${deviceOS === 'macos' ? 'border-white/35 text-white bg-white/10' : 'border-white/10 text-zinc-300'}`}>macOS</button>
                          <button onClick={() => pickDeviceOS('android')} className={`rounded-lg border px-3 py-2 text-sm transition-colors ${deviceOS === 'android' ? 'border-white/35 text-white bg-white/10' : 'border-white/10 text-zinc-300'}`}>Android</button>
                          <button onClick={() => pickDeviceOS('ios')} className={`rounded-lg border px-3 py-2 text-sm transition-colors ${deviceOS === 'ios' ? 'border-white/35 text-white bg-white/10' : 'border-white/10 text-zinc-300'}`}>iPhone/iPad</button>
                          <button onClick={() => pickDeviceOS('linux')} className={`rounded-lg border px-3 py-2 text-sm transition-colors ${deviceOS === 'linux' ? 'border-white/35 text-white bg-white/10' : 'border-white/10 text-zinc-300'}`}>Linux</button>
                          <button onClick={() => pickDeviceOS('unknown')} className={`rounded-lg border px-3 py-2 text-sm transition-colors ${deviceOS === 'unknown' ? 'border-white/35 text-white bg-white/10' : 'border-white/10 text-zinc-300'}`}>Other</button>
                        </div>

                        <div className="mt-3 pt-3 border-t border-white/10">
                          {vpnKeyLoading ? (
                            <div className="text-center py-2 text-zinc-400 text-xs">{t.setupKeyLoading}</div>
                          ) : vpnKey ? (
                            <>
                              <div className="rounded-lg border border-white/10 bg-zinc-800/60 p-2.5 mb-2">
                                <p className="text-zinc-300 text-[10px] font-mono break-all leading-relaxed select-all">{vpnKey}</p>
                              </div>
                              <button
                                onClick={copyKey}
                                className={`w-full font-medium py-2.5 rounded-lg flex items-center justify-center gap-2 text-sm active:scale-95 transition-all ${keyCopied ? 'bg-green-500/20 border border-green-500/30 text-green-300' : 'border border-white/15 text-white hover:bg-white/5'}`}
                              >
                                {keyCopied ? <><ClipboardCheck size={14} /> {subscriptionUrl ? t.setupLinkCopied : t.setupKeyCopied}</> : <><Copy size={14} /> {subscriptionUrl ? t.setupCopyLink : t.setupCopyForOther}</>}
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={fetchVpnKey}
                              className="w-full border border-white/15 text-zinc-300 font-medium py-2.5 rounded-lg flex items-center justify-center gap-2 text-sm hover:bg-white/5 active:scale-95"
                            >
                              <Key size={14} /> {t.setupCopyForOther}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {setupStep === 2 && (
                  <>
                    <h3 className="text-xl sm:text-2xl font-bold text-center text-white mb-2">{t.setupInstallTitle}</h3>
                    <p className="text-zinc-400 text-center text-sm mb-5 sm:mb-7">{t.setupInstallDesc}</p>

                    {/* Native HundlerVPN Windows client — recommended for Windows.
                        Downloads via our domain (hundlervpn.xyz/download), which
                        proxies the installer from the private Hundler-App repo. */}
                    {setupClient === 'hundler' && deviceOS === 'windows' && (
                      <div className="mb-5 rounded-2xl border border-white/15 bg-white/[0.04] p-4">
                        <p className="text-white font-semibold text-sm mb-1">{t.setupHundlerWinTitle}</p>
                        <p className="text-zinc-400 text-xs mb-3 leading-relaxed">{t.setupHundlerWinDesc}</p>
                        <button
                          onClick={() => openStoreLink(HUNDLER_WINDOWS_DOWNLOAD)}
                          className="w-full bg-gradient-to-r from-red-500 to-red-600 border border-red-400/30 text-white font-semibold py-3.5 rounded-full flex items-center justify-center gap-2 active:scale-95 text-sm shadow-lg shadow-red-500/25 hover:shadow-red-500/40 transition-shadow"
                        >
                          <Download size={16} /> {t.setupHundlerWinTitle}
                        </button>
                      </div>
                    )}


                    {setupClient === 'happ' && (deviceOS === 'ios' || deviceOS === 'macos') && (
                      <div className="mb-5">
                        <p className="text-zinc-500 text-xs uppercase tracking-wider mb-2">{t.setupRegion}</p>
                        <div className="grid grid-cols-2 gap-2">
                          <button onClick={() => setSetupRegion('global')} className={`rounded-lg border px-3 py-2.5 text-sm transition-colors ${setupRegion === 'global' ? 'border-white/35 text-white bg-white/10' : 'border-white/10 text-zinc-300'}`}>{t.setupGlobal}</button>
                          <button onClick={() => setSetupRegion('russia')} className={`rounded-lg border px-3 py-2.5 text-sm transition-colors ${setupRegion === 'russia' ? 'border-white/35 text-white bg-white/10' : 'border-white/10 text-zinc-300'}`}>{t.setupRussia}</button>
                        </div>
                      </div>
                    )}

                    {setupClient !== 'hundler' && !getStoreLink() && !(deviceOS === 'linux' && setupClient === 'happ') && <p className="text-amber-300 text-xs mb-4">{t.setupNoStore}</p>}

                    <div className="space-y-2.5">
                      {setupClient === 'hundler' ? null : deviceOS === 'linux' && setupClient === 'happ' ? (
                        <>
                          <p className="text-zinc-500 text-xs uppercase tracking-wider mb-1">{t.setupChooseFormat || 'Выберите формат'}</p>
                          <button
                            onClick={() => openStoreLink('https://github.com/Happ-proxy/happ-desktop/releases/latest/download/Happ.linux.x64.deb')}
                            className="w-full border border-white/20 text-white font-semibold py-3 sm:py-3.5 rounded-full flex items-center justify-center gap-2 active:scale-95 text-sm transition-colors hover:border-white/35"
                          >
                            <Download size={16} /> .deb <span className="text-zinc-500 text-xs font-normal">(Ubuntu, Debian)</span>
                          </button>
                          <button
                            onClick={() => openStoreLink('https://github.com/Happ-proxy/happ-desktop/releases/latest/download/Happ.linux.x64.rpm')}
                            className="w-full border border-white/20 text-white font-semibold py-3 sm:py-3.5 rounded-full flex items-center justify-center gap-2 active:scale-95 text-sm transition-colors hover:border-white/35"
                          >
                            <Download size={16} /> .rpm <span className="text-zinc-500 text-xs font-normal">(Fedora, RHEL)</span>
                          </button>
                          <button
                            onClick={() => openStoreLink('https://github.com/Happ-proxy/happ-desktop/releases/latest/download/Happ.linux.x64.pkg.tar.zst')}
                            className="w-full border border-white/20 text-white font-semibold py-3 sm:py-3.5 rounded-full flex items-center justify-center gap-2 active:scale-95 text-sm transition-colors hover:border-white/35"
                          >
                            <Download size={16} /> .pkg.tar.zst <span className="text-zinc-500 text-xs font-normal">(Arch)</span>
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => openStoreLink()}
                          disabled={!getStoreLink()}
                          className="w-full border border-white/20 text-white font-semibold py-3.5 sm:py-4 rounded-full flex items-center justify-center gap-2 active:scale-95 disabled:opacity-40 text-sm sm:text-base transition-colors hover:border-white/35"
                        >
                          <Download size={16} /> {t.setupInstallButton}
                        </button>
                      )}

                      <button
                        onClick={() => { setSetupStep(3); fetchVpnKey(); }}
                        className="w-full bg-gradient-to-r from-red-500 to-red-600 border border-red-400/30 text-white font-semibold py-3.5 sm:py-4 rounded-full flex items-center justify-center gap-2 active:scale-95 text-sm sm:text-base shadow-lg shadow-red-500/25 hover:shadow-red-500/40 transition-shadow"
                      >
                        <ArrowRight size={16} /> {t.setupNext}
                      </button>
                    </div>
                  </>
                )}

                {setupStep === 3 && (
                  <>
                    <h3 className="text-xl sm:text-2xl font-bold text-center text-white mb-2">{t.setupAddTitle}</h3>
                    <p className="text-zinc-400 text-center text-sm mb-5">{subscriptionUrl ? 'Скопируйте ссылку подписки и вставьте её в VPN-приложение.' : t.setupAddDesc}</p>

                    {vpnKeyLoading ? (
                      <div className="text-center py-4 text-zinc-400 text-sm">{t.setupKeyLoading}</div>
                    ) : vpnKey ? (
                      <div className="mb-4">
                        <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-3 mb-3">
                          <p className="text-zinc-500 text-[9px] uppercase tracking-wider mb-1.5">{subscriptionUrl ? 'Subscription URL' : 'VLESS Key'}</p>
                          <p className="text-zinc-300 text-[11px] font-mono break-all leading-relaxed select-all">{vpnKey}</p>
                        </div>
                        <button
                          onClick={copyKey}
                          className={`w-full font-semibold py-3 rounded-full flex items-center justify-center gap-2 active:scale-95 transition-all ${keyCopied ? 'bg-green-500/20 border border-green-500/30 text-green-300' : 'border border-white/20 text-white hover:bg-white/5'}`}
                        >
                          {keyCopied ? <><ClipboardCheck size={16} /> {subscriptionUrl ? t.setupLinkCopied : t.setupKeyCopied}</> : <><Copy size={16} /> {subscriptionUrl ? t.setupCopyLink : t.setupAddButton}</>}
                        </button>
                      </div>
                    ) : (
                      <p className="text-amber-300 text-xs text-center mb-4">{t.setupNoKey}</p>
                    )}

                    <button
                      onClick={closeSetupModal}
                      className="w-full bg-gradient-to-r from-red-500 to-red-600 border border-red-400/30 text-white font-semibold py-3.5 sm:py-4 rounded-full flex items-center justify-center gap-2 active:scale-95 text-sm sm:text-base shadow-lg shadow-red-500/25 hover:shadow-red-500/40 transition-shadow"
                    >
                      <ArrowRight size={16} /> {t.setupFinish}
                    </button>
                  </>
                )}
              </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <motion.div 
        custom={direction}
        variants={pageVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        className="flex flex-col items-center gap-6 flex-1 lg:pt-6 w-full"
      >
        {/* Logo — pre-composited tiger + network mesh PNG with a soft
            radial alpha mask so the black backdrop blends into the
            page. See components/TigerNetworkLogo.tsx. */}
        {/* 2026-05-24 (v4): тигр на ноутбуках был всё ещё слишком большим
            (427×427 на 13"-14" ~ половина высоты viewport, и карточка
            «Подписка» прижималась к низу). Двухступенчатая адаптация:
              • lg (1024-1279, тип. 1366×768 ноутбук) → 280×280
              • xl (≥1280, нормальные мониторы) → 340×340
            Mobile 146×146 оставляем как есть.
            История: v1 = 640, v2 = 480, v3 = 427, v4 = 280/340.
            History:
              • 2026-05-13a desktop=320 (felt cramped)
              • 2026-05-14 desktop=640 (felt huge)
              • 2026-05-14 v3 desktop=427 (this) */}
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-[146px] h-[146px] lg:w-[280px] lg:h-[280px] xl:w-[340px] xl:h-[340px]"
        >
          <TigerNetworkLogo className="w-full h-full" />
        </motion.div>

        {/* 2026-05-06 v2.1 compact premium subscription card per user feedback
            ("выглядит хуёво... мне не приходилось листать вниз"):
              - shield icon removed entirely (user said: "эмодзи ебаного щита убери")
              - hero row: BIG day counter (left) + clickable devices chip (right)
                — devices chip itself opens the (redesigned) devices modal,
                  so the bottom-row "My devices" button is gone
              - bottom row reduced to 2 chips: Referral + Promo
              — total card height ~140px shorter than v1 */}
        <div className="w-full max-w-[320px] lg:max-w-[540px] relative rounded-3xl border border-white/15 bg-zinc-900/70 backdrop-blur-md overflow-hidden shadow-[0_20px_60px_-25px_rgba(0,0,0,0.6)]">
          {/* ambient red halo (one) */}
          <div className="pointer-events-none absolute -top-24 -right-24 w-60 h-60 rounded-full bg-red-500/[0.09] blur-3xl" />
          {/* faint top sheen */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />

          <div className="relative p-4 lg:p-5">
            {/* Header: plan name (no shield icon) + active/inactive status pill */}
            <div className="flex items-center justify-between gap-3 mb-4">
              <h3 className="text-white font-semibold text-base lg:text-lg leading-tight truncate">{t.planName}</h3>
              <span
                className={`shrink-0 inline-flex items-center gap-1.5 text-[10px] font-medium px-2.5 py-1 rounded-full border ${
                  hasActiveSubscription
                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25'
                    : 'bg-zinc-500/10 text-zinc-400 border-white/10'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    hasActiveSubscription
                      ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]'
                      : 'bg-zinc-500'
                  }`}
                />
                {hasActiveSubscription
                  ? (lang === 'ru' ? 'Активна' : 'Active')
                  : (lang === 'ru' ? 'Неактивна' : 'Inactive')}
              </span>
            </div>

            {/* Hero: days counter on its own row. The devices chip used to
                live inline on the right (72×72 icon + count) but users were
                missing it / not understanding what the smartphone icon meant
                — moved to a dedicated full-width pill below with the explicit
                "Устройства" label so the affordance is obvious. */}
            <div className="mb-3">
              {hasActiveSubscription ? (
                <>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-white font-bold text-[44px] lg:text-5xl tracking-tight tabular-nums leading-none">
                      {daysLeft}
                    </span>
                    <span className="text-zinc-400 text-sm font-medium">
                      {lang === 'ru'
                        ? (daysLeft % 10 === 1 && daysLeft % 100 !== 11
                            ? 'день'
                            : daysLeft % 10 >= 2 && daysLeft % 10 <= 4 && (daysLeft % 100 < 12 || daysLeft % 100 > 14)
                              ? 'дня'
                              : 'дней')
                        : (daysLeft === 1 ? 'day left' : 'days left')}
                    </span>
                  </div>
                  <div className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
                    <Calendar size={11} className="text-zinc-600" strokeWidth={1.75} />
                    <span className="truncate">{t.until} {subscriptionEndDateLabel}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-white font-bold text-xl lg:text-2xl tracking-tight leading-tight">
                    {lang === 'ru' ? 'Подписка не активна' : 'No subscription'}
                  </div>
                  <p className="mt-1 text-zinc-500 text-[11px]">
                    {lang === 'ru' ? 'Оформите подписку ниже' : 'Activate one below'}
                  </p>
                </>
              )}
            </div>

            {/* Devices pill — full-width horizontal row.
                Layout: [icon-tile] · "Устройства" · [N/MAX badge] · [›]
                Replaces the previous icon-only 72×72 chip. The label +
                badge make the count and the affordance obvious without
                requiring users to decode the smartphone icon.
                Red treatment kicks in when at limit. */}
            <button
              onClick={handleDevicesClick}
              className={`w-full mb-3 flex items-center gap-3 rounded-xl px-3 py-2.5 border transition-all active:scale-[0.99] ${
                devices.length >= maxDevices
                  ? 'border-red-500/30 bg-red-500/[0.06] hover:bg-red-500/[0.10]'
                  : 'border-white/15 bg-white/[0.04] hover:border-white/25 hover:bg-white/[0.07]'
              }`}
              title={t.myDevices}
            >
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                  devices.length >= maxDevices ? 'bg-red-500/15' : 'bg-white/[0.06]'
                }`}
              >
                <Smartphone
                  size={18}
                  strokeWidth={1.75}
                  className={devices.length >= maxDevices ? 'text-red-300' : 'text-zinc-200'}
                />
              </div>
              <span className="flex-1 text-left text-white text-sm font-semibold leading-none">
                {t.devices}
              </span>
              <span
                className={`tabular-nums text-sm font-bold px-2 py-1 rounded-md ${
                  devices.length >= maxDevices
                    ? 'bg-red-500/20 text-red-300'
                    : 'bg-white/[0.06] text-white'
                }`}
              >
                {devices.length}
                <span
                  className={
                    devices.length >= maxDevices
                      ? 'text-red-400/60 font-medium'
                      : 'text-zinc-500 font-medium'
                  }
                >
                  /{maxDevices}
                </span>
              </span>
              <ChevronRight
                size={14}
                strokeWidth={1.75}
                className={
                  devices.length >= maxDevices
                    ? 'text-red-400 shrink-0'
                    : 'text-zinc-400 shrink-0'
                }
              />
            </button>

            {/* Primary CTA: Extend (solid red premium) */}
            <button
              onClick={() => { haptic('medium'); navigate('payment'); }}
              className="w-full mb-2 bg-red-500 hover:bg-red-600 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 active:scale-[0.99] transition-all shadow-[0_8px_24px_-8px_rgba(239,68,68,0.5)]"
            >
              <Zap size={15} strokeWidth={2.25} />
              <span>{t.extend}</span>
              <ChevronRight size={14} strokeWidth={2.25} className="ml-0.5" />
            </button>

            {/* Secondary CTA: Install (clean glass — no shimmer/glow) */}
            <button
              onClick={handleInstallClick}
              className="w-full mb-3 bg-white/[0.04] hover:bg-white/[0.08] border border-white/15 hover:border-white/25 text-white font-medium py-3 rounded-xl flex items-center justify-center gap-2 active:scale-[0.99] transition-all"
            >
              <Settings size={15} strokeWidth={1.75} className="text-zinc-300" />
              <span className="lg:hidden truncate">{t.installShort}</span>
              <span className="hidden lg:inline truncate">{t.install}</span>
              <ChevronRight size={14} strokeWidth={1.75} className="text-zinc-400 ml-0.5 shrink-0" />
            </button>

            {/* Bottom rows: Referral + Promo stacked full-width — RU label
                "Реферальная система" was being truncated in a 2-col grid.
                User explicitly asked: "если нужно кнопку друг за другом поставь". */}
            <div className="space-y-1.5">
              <button
                onClick={handleReferralClick}
                disabled={!referralCode}
                className="w-full bg-white/[0.03] border border-white/10 hover:border-white/20 hover:bg-white/[0.06] text-zinc-300 hover:text-white text-xs font-medium py-2.5 rounded-xl flex items-center justify-center gap-1.5 active:scale-[0.99] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Users size={12} className="text-zinc-500 shrink-0" strokeWidth={1.75} /> {t.referral}
              </button>
              <button
                onClick={handlePromoClick}
                className="w-full bg-white/[0.03] border border-white/10 hover:border-white/20 hover:bg-white/[0.06] text-zinc-300 hover:text-white text-xs font-medium py-2.5 rounded-xl flex items-center justify-center gap-1.5 active:scale-[0.99] transition-colors"
              >
                <Gift size={12} className="text-zinc-500 shrink-0" strokeWidth={1.75} /> {t.promo}
              </button>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Promo Modal — premium glass shell, matches subscription card style:
          one subtle red halo, white sheen along top, white-outlined input,
          solid red apply button. */}
      <AnimatePresence>
        {showPromoModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md"
            onClick={closePromoModal}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0, y: 12 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0, y: 12 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md relative rounded-3xl border border-white/15 bg-zinc-900/80 backdrop-blur-xl overflow-hidden shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)]"
            >
              {/* ambient red halo */}
              <div className="pointer-events-none absolute -top-24 -right-24 w-60 h-60 rounded-full bg-red-500/[0.10] blur-3xl" />
              {/* faint top sheen */}
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />

              <div className="relative p-5">
                {/* Header */}
                <div className="flex items-center gap-3 pb-4 mb-5 border-b border-white/10">
                  <div className="w-11 h-11 rounded-xl border border-white/15 bg-white/[0.04] flex items-center justify-center shrink-0">
                    <Gift size={18} strokeWidth={1.75} className="text-zinc-200" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-white font-semibold text-base leading-tight">{t.promo}</h3>
                    <p className="text-zinc-500 text-xs mt-0.5">
                      {lang === 'ru' ? 'Введите код для активации скидки или дней' : 'Enter a code to redeem days or a discount'}
                    </p>
                  </div>
                  <button
                    onClick={closePromoModal}
                    className="w-8 h-8 rounded-lg border border-white/10 bg-white/[0.03] flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors shrink-0"
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* Input */}
                <label className="block text-zinc-400 text-[10px] font-semibold uppercase tracking-[0.12em] mb-2">
                  {lang === 'ru' ? 'Код промокода' : 'Promo code'}
                </label>
                <input
                  type="text"
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                  placeholder={t.promoPlaceholder}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-white/30 transition-colors font-mono tracking-wider"
                  autoFocus
                />

                {promoError && (
                  <div className="mt-3 px-3 py-2 rounded-xl border border-red-500/25 bg-red-500/[0.08] text-red-300 text-xs">
                    {promoError}
                  </div>
                )}

                <button
                  onClick={handleApplyPromo}
                  disabled={promoLoading || !promoCode.trim() || (!tgUser?.id && !userIdentifier)}
                  className="mt-4 w-full bg-red-500 hover:bg-red-600 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 active:scale-[0.99] transition-all shadow-[0_8px_24px_-8px_rgba(239,68,68,0.5)] disabled:opacity-50 disabled:hover:bg-red-500"
                >
                  {promoLoading ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <Zap size={15} strokeWidth={2.25} />
                      <span>{t.promoApply}</span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Devices Modal — premium glass shell, refined device list cards. */}
      <AnimatePresence>
        {showDevicesModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md"
            onClick={() => setShowDevicesModal(false)}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0, y: 12 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0, y: 12 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md max-h-[85vh] flex flex-col relative rounded-3xl border border-white/15 bg-zinc-900/80 backdrop-blur-xl overflow-hidden shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)]"
            >
              {/* ambient red halo */}
              <div className="pointer-events-none absolute -top-24 -right-24 w-60 h-60 rounded-full bg-red-500/[0.10] blur-3xl" />
              {/* faint top sheen */}
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />

              <div className="relative p-5 pb-3 shrink-0">
                {/* Header */}
                <div className="flex items-center gap-3 pb-4 border-b border-white/10">
                  <div className="w-11 h-11 rounded-xl border border-white/15 bg-white/[0.04] flex items-center justify-center shrink-0">
                    <Smartphone size={18} strokeWidth={1.75} className="text-zinc-200" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-white font-semibold text-base leading-tight">{t.myDevices}</h3>
                    <p className="text-zinc-500 text-xs mt-0.5 tabular-nums">
                      <span className={devices.length >= maxDevices ? 'text-red-300 font-semibold' : 'text-zinc-300 font-semibold'}>
                        {devices.length}
                      </span>
                      <span> / {maxDevices} {lang === 'ru' ? 'устройств' : 'devices'}</span>
                    </p>
                  </div>
                  <button
                    onClick={() => setShowDevicesModal(false)}
                    className="w-8 h-8 rounded-lg border border-white/10 bg-white/[0.03] flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors shrink-0"
                  >
                    <X size={16} />
                  </button>
                </div>

                {devices.length >= maxDevices && (
                  <div className="mt-4 px-3 py-2.5 rounded-xl border border-red-500/25 bg-red-500/[0.08] text-red-300 text-[11px] leading-relaxed">
                    {t.deviceLimitReached}
                  </div>
                )}
              </div>

              <div className="relative px-5 pb-5 flex-1 overflow-y-auto">
                {devicesLoading ? (
                  <div className="flex items-center justify-center py-10">
                    <div className="w-8 h-8 rounded-full border-2 border-white/10 border-t-white/70 animate-spin" />
                  </div>
                ) : devices.length === 0 ? (
                  <div className="text-center py-10 rounded-2xl border border-white/10 bg-white/[0.02]">
                    <div className="w-14 h-14 mx-auto mb-3 rounded-2xl border border-white/15 bg-white/[0.03] flex items-center justify-center">
                      <MonitorSmartphone size={26} strokeWidth={1.75} className="text-zinc-300" />
                    </div>
                    <p className="text-zinc-300 text-sm font-medium">
                      {lang === 'ru' ? 'Нет подключённых устройств' : 'No connected devices'}
                    </p>
                    <p className="text-zinc-500 text-xs mt-1">
                      {lang === 'ru' ? 'Установите VPN на любом устройстве — оно появится здесь' : 'Install VPN on any device — it will appear here'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {devices.map((device) => (
                      <div
                        key={device.id}
                        className="flex items-center gap-3 p-3 rounded-2xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
                      >
                        <div className="w-10 h-10 rounded-xl border border-white/15 bg-white/[0.04] flex items-center justify-center shrink-0">
                          <MonitorSmartphone size={17} strokeWidth={1.75} className="text-zinc-200" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">
                            {device.device_name || (lang === 'ru' ? 'Устройство' : 'Device')}
                          </p>
                          {device.last_seen_at && (
                            <p className="text-[10px] text-zinc-500 mt-0.5">
                              {lang === 'ru' ? 'Активно' : 'Last seen'}: {new Date(device.last_seen_at).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => handleDeleteDevice(device.id)}
                          className="w-8 h-8 rounded-lg border border-white/10 bg-white/[0.03] flex items-center justify-center text-zinc-500 hover:text-red-300 hover:border-red-500/25 hover:bg-red-500/[0.06] transition-colors shrink-0"
                          title={t.deleteDevice}
                        >
                          <Trash2 size={14} strokeWidth={1.75} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* The shared <ReferralModal /> lives at the App root so the home
          CTA, profile menu and the desktop sidebar can all open the same
          instance. handleReferralClick just calls the onOpenReferral prop. */}
    </>
  );
}

function PaymentView({ t, direction, tgUser, onSubscriptionChange, userIdentifier, pendingPromo, onClearPendingPromo }: { t: any, direction: number; tgUser: { id: number; name: string; photo: string; username?: string } | null; onSubscriptionChange: (id: number | UserIdentifier) => Promise<void>; userIdentifier: UserIdentifier | null; pendingPromo?: { code: string; discountPercent: number; promoId: number } | null; onClearPendingPromo?: () => void }) {
  const PRICE_PER_DAY = PRICE_PER_DAY_RUB;
  const MIN_DAYS = 3;
  const MAX_DAYS = 365;
  const PRESET_DAYS = [3, 7, 14, 30, 90, 180, 365];
  const [days, setDays] = useState(30);
  const [payMethod, setPayMethod] = useState<'crypto' | 'sbp'>('sbp');
  const [isLoading, setIsLoading] = useState(false);
  const [sbpState, setSbpState] = useState<'idle' | 'creating' | 'waiting' | 'success' | 'failed'>('idle');
  const [sbpPaymentId, setSbpPaymentId] = useState<number | null>(null);
  const [sbpRedirectUrl, setSbpRedirectUrl] = useState<string | null>(null);
  const [promoInput, setPromoInput] = useState('');
  const [promoLoading, setPromoLoading] = useState(false);
  const [appliedPromo, setAppliedPromo] = useState<{ code: string; discountPercent: number; promoId?: number } | null>(null);
  const [promoError, setPromoError] = useState('');

  // Автоматически применяем pendingPromo при загрузке
  useEffect(() => {
    if (pendingPromo && !appliedPromo) {
      setAppliedPromo({ code: pendingPromo.code, discountPercent: pendingPromo.discountPercent, promoId: pendingPromo.promoId });
      onClearPendingPromo?.();
    }
  }, [pendingPromo]);

  // Centralized pricing — see lib/pricing.ts. Auto-discount tiers stack
  // with promo codes multiplicatively (rawTotal × (1 − duration%) × (1 − promo%)).
  // Server-side recomputes the same numbers in /api/payments/sbp/create
  // and /api/crypto-invoice — never trust the client `amount`.
  const promoPct = appliedPromo?.discountPercent ?? 0;
  const pricing = calculatePricing(days, promoPct);
  const rawTotal = pricing.rawTotal;
  const totalPrice = pricing.finalTotal;
  const durationDiscountPct = pricing.durationDiscountPercent;
  const discountAmount = pricing.durationDiscountAmount + pricing.promoDiscountAmount;
  const totalUsd = +(totalPrice / 100).toFixed(2);

  const handleApplyPromo = async () => {
    const code = promoInput.trim().toUpperCase();
    if (!code) return;
    setPromoLoading(true);
    setPromoError('');
    try {
      const userParam = userIdentifier?.type === 'telegram' ? `&telegramId=${userIdentifier.telegramId}` : userIdentifier?.type === 'email' ? `&userId=${userIdentifier.userId}` : tgUser?.id ? `&telegramId=${tgUser.id}` : '';
      const res = await fetch(`/api/promos/validate?code=${encodeURIComponent(code)}${userParam}`);
      const data = await res.json();
      if (res.ok && data.ok && data.discountPercent > 0) {
        setAppliedPromo({ code: data.code, discountPercent: data.discountPercent, promoId: data.promoId });
        setPromoError('');
      } else if (res.ok && data.ok && data.days > 0) {
        setPromoError('Этот промокод даёт бесплатные дни — примените его на главной');
      } else {
        setPromoError(data.error || 'Промокод недействителен');
      }
    } catch {
      setPromoError('Ошибка проверки');
    } finally {
      setPromoLoading(false);
    }
  };

  const handleRemovePromo = () => {
    haptic('light');
    setAppliedPromo(null);
    setPromoInput('');
    setPromoError('');
  };

  useEffect(() => {
    if (sbpState !== 'waiting' || !sbpPaymentId) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/payments/sbp/status?paymentId=${sbpPaymentId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.status === 'paid') {
          setSbpState('success');
          setAppliedPromo(null); // Очищаем промокод после успешной оплаты
          clearInterval(interval);
          if (userIdentifier) {
            setTimeout(() => { void onSubscriptionChange(userIdentifier); }, 1000);
          } else if (tgUser?.id) {
            setTimeout(() => { void onSubscriptionChange(tgUser.id); }, 1000);
          }
        } else if (data.status === 'failed') {
          setSbpState('failed');
          clearInterval(interval);
        }
      } catch { /* ignore polling errors */ }
    }, 3000);
    return () => clearInterval(interval);
  }, [sbpState, sbpPaymentId]);

  const handleSbpCancel = () => {
    haptic('medium');
    setSbpState('idle');
    setSbpPaymentId(null);
    setSbpRedirectUrl(null);
  };

  const handleSubscribe = async () => {
    haptic('heavy');
    setIsLoading(true);
    try {
      if (payMethod === 'crypto') {
        const reqBody: Record<string, unknown> = { days, amount: totalPrice };
        if (userIdentifier?.type === 'telegram') {
          reqBody.telegramId = userIdentifier.telegramId;
        } else if (userIdentifier?.type === 'email') {
          reqBody.userId = userIdentifier.userId;
        } else if (tgUser?.id) {
          reqBody.telegramId = tgUser.id;
        }
        if (appliedPromo?.promoId) {
          reqBody.promoId = appliedPromo.promoId;
          reqBody.promoCode = appliedPromo.code;
        }

        const response = await fetch('/api/crypto-invoice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reqBody),
        });
        const data = await response.json();
        if (data.ok && data.paymentUrl) {
          if (typeof window !== 'undefined' && window.Telegram?.WebApp?.openLink) {
            window.Telegram.WebApp.openLink(data.paymentUrl);
          } else {
            window.location.href = data.paymentUrl;
          }
        } else {
          alert(data.error || 'Ошибка создания крипто-счета');
        }
      } else if (payMethod === 'sbp') {
        setSbpState('creating');
        const reqBody: Record<string, unknown> = { days, amount: totalPrice };
        if (userIdentifier?.type === 'telegram') {
          reqBody.telegramId = userIdentifier.telegramId;
        } else if (userIdentifier?.type === 'email') {
          reqBody.userId = userIdentifier.userId;
        } else if (tgUser?.id) {
          reqBody.telegramId = tgUser.id;
        }
        // Передаём промокод если применён
        if (appliedPromo?.promoId) {
          reqBody.promoId = appliedPromo.promoId;
          reqBody.promoCode = appliedPromo.code;
        }

        const response = await fetch('/api/payments/sbp/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reqBody),
        });
        const data = await response.json();
        if (data.ok && data.redirect) {
          setSbpPaymentId(data.paymentId);
          setSbpRedirectUrl(data.redirect);
          setSbpState('waiting');
          if (typeof window !== 'undefined' && window.Telegram?.WebApp?.openLink) {
            window.Telegram.WebApp.openLink(data.redirect);
          } else {
            window.open(data.redirect, '_blank');
          }
        } else {
          setSbpState('idle');
          alert(data.error || 'Ошибка создания платежа СБП');
        }
      }
    } catch (error) {
      console.error('Payment error:', error);
      setSbpState('idle');
      alert('Произошла ошибка');
    } finally {
      setIsLoading(false);
    }
  };

  if (sbpState === 'waiting' || sbpState === 'success' || sbpState === 'failed') {
    return (
      <motion.div
        custom={direction}
        variants={pageVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        className="flex flex-col gap-3 flex-1 lg:items-center"
      >
        <div className="w-full max-w-sm mx-auto flex flex-col items-center lg:max-w-[780px]">
          <div className="bg-zinc-900/40 border border-white/10 rounded-xl p-6 w-full text-center">
            {sbpState === 'waiting' && (
              <>
                <div className="flex justify-center mb-4">
                  <div className="w-10 h-10 border-2 border-white/20 border-t-blue-400 rounded-full animate-spin" />
                </div>
                <h3 className="text-white font-medium text-sm mb-2">Ожидание оплаты через СБП</h3>
                <p className="text-zinc-400 text-xs mb-4">Завершите оплату в открывшемся окне. Статус обновится автоматически.</p>
                {sbpRedirectUrl && (
                  <button
                    onClick={() => {
                      if (typeof window !== 'undefined' && window.Telegram?.WebApp?.openLink) {
                        window.Telegram.WebApp.openLink(sbpRedirectUrl);
                      } else {
                        window.open(sbpRedirectUrl, '_blank');
                      }
                    }}
                    className="w-full bg-blue-500/20 text-blue-400 border border-blue-500/30 font-medium py-2.5 rounded-lg hover:bg-blue-500/30 transition-colors text-sm mb-2"
                  >
                    Открыть страницу оплаты
                  </button>
                )}
                <button
                  onClick={handleSbpCancel}
                  className="w-full text-zinc-500 text-xs py-2 hover:text-zinc-300 transition-colors"
                >
                  Отмена
                </button>
              </>
            )}
            {sbpState === 'success' && (
              <>
                <div className="text-3xl mb-3">✅</div>
                <h3 className="text-white font-medium text-sm mb-2">Оплата прошла успешно!</h3>
                <p className="text-zinc-400 text-xs mb-4">Подписка активирована. Статус обновится через несколько секунд.</p>
                <button onClick={handleSbpCancel} className="w-full bg-white text-black font-medium py-2.5 rounded-lg hover:bg-zinc-200 transition-colors text-sm">
                  Готово
                </button>
              </>
            )}
            {sbpState === 'failed' && (
              <>
                <div className="text-3xl mb-3">❌</div>
                <h3 className="text-white font-medium text-sm mb-2">Оплата не прошла</h3>
                <p className="text-zinc-400 text-xs mb-4">Платёж был отменён или произошла ошибка. Попробуйте ещё раз.</p>
                <button onClick={handleSbpCancel} className="w-full bg-white text-black font-medium py-2.5 rounded-lg hover:bg-zinc-200 transition-colors text-sm">
                  Назад
                </button>
              </>
            )}
          </div>
        </div>
      </motion.div>
    );
  }

  // Tariff cards (2×2 grid). Each card represents a "named" plan that
  // maps to a specific number of days. Tapping a card sets `days` so
  // the slider below stays in sync. Layout/UX inspired by Volna VPN
  // Shop screenshot (2026-05-13) but in our brand palette: black canvas
  // + red accents instead of blue.
  const PLAN_CARDS: { label: string; days: number }[] = [
    { label: '1 месяц', days: 30 },
    { label: '3 месяца', days: 90 },
    { label: '6 месяцев', days: 180 },
    { label: '1 год', days: 365 },
  ];
  // Find the card with the highest auto-discount tier — gets the
  // "ВЫГОДНО" badge. Ties broken by longest duration.
  const bestPlanDays = (() => {
    let bestPct = 0;
    let bestDays = PLAN_CARDS[PLAN_CARDS.length - 1]!.days;
    for (const p of PLAN_CARDS) {
      const pct = getDurationDiscountPercent(p.days);
      if (pct > bestPct || (pct === bestPct && p.days > bestDays)) {
        bestPct = pct;
        bestDays = p.days;
      }
    }
    return bestDays;
  })();

  return (
    <motion.div 
      custom={direction}
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="flex flex-col gap-3 flex-1 lg:items-stretch lg:w-full"
    >
      {/* Single-column flow on both mobile and desktop. The block is
          centered and capped at a comfortable reading width so the
          tariff cards stay scannable instead of stretching across the
          whole 1280px content area.
          2026-05-13 v2 — user feedback: «промокод и выбор оплаты вниз
          пусть перекочуют, всё должно быть в столбец друг за другом». */}
      <div className="w-full mx-auto flex flex-col gap-3 lg:gap-4 max-w-sm lg:max-w-2xl">
        {/* Left column: tariff plans grid (2×2) + duration slider. */}
        <motion.div 
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.15, duration: 0.25 }}
          className="relative overflow-hidden bg-gradient-to-br from-zinc-900/60 via-zinc-900/40 to-black/60 border border-red-500/20 rounded-2xl p-4 lg:p-6"
        >
          {/* Decorative red glow — keeps the "premium" feel without
              breaking the strict black/red palette. */}
          <div className="absolute -top-20 -right-20 w-48 h-48 rounded-full bg-red-500/10 blur-3xl pointer-events-none" />

          {/* Plan grid 2×2. Each card is large + tappable; selected =
              red gradient + glow, default = subtle dark. */}
          <div className="relative grid grid-cols-2 gap-2 mb-4 lg:gap-3">
            {PLAN_CARDS.map((plan) => {
              const isSelected = days === plan.days;
              const presetPct = getDurationDiscountPercent(plan.days);
              const planPrice = plan.days * PRICE_PER_DAY;
              const planDiscounted = Math.round(planPrice * (1 - presetPct / 100));
              const planPerMonth = Math.round(planDiscounted / Math.max(1, plan.days / 30));
              const isBest = plan.days === bestPlanDays;
              return (
                <SparkyButton
                  key={plan.days}
                  onClick={() => { haptic('light'); setDays(plan.days); }}
                  className={`relative text-left rounded-xl border p-3 transition-all overflow-hidden ${
                    isSelected
                      ? 'border-red-500/60 bg-gradient-to-br from-red-500/15 via-red-500/8 to-transparent shadow-[0_0_24px_rgba(239,68,68,0.25)]'
                      : 'border-white/10 bg-zinc-900/60 hover:border-red-500/30 hover:bg-zinc-900/80'
                  }`}
                >
                  {/* "Выгодно" badge — only on the best-value plan. */}
                  {isBest && (
                    <div className="absolute -top-px right-3 px-2 py-0.5 rounded-b-md bg-red-500 text-white text-[9px] font-bold uppercase tracking-wider shadow-[0_2px_8px_rgba(239,68,68,0.5)]">
                      Выгодно
                    </div>
                  )}
                  <div className={`text-sm font-semibold mb-2 ${isSelected ? 'text-white' : 'text-zinc-200'}`}>
                    {plan.label}
                  </div>
                  <div className="flex items-end justify-between gap-1">
                    <div className="min-w-0">
                      {presetPct > 0 ? (
                        <>
                          <div className="text-zinc-500 text-[10px] line-through leading-none">{planPrice}₽</div>
                          <div className="text-white text-lg font-bold leading-tight lg:text-2xl">{planDiscounted}₽</div>
                        </>
                      ) : (
                        <div className="text-white text-lg font-bold leading-tight lg:text-2xl">{planDiscounted}₽</div>
                      )}
                      {plan.days >= 60 && (
                        <div className="text-zinc-500 text-[10px] mt-0.5 leading-none">{planPerMonth}₽ в мес.</div>
                      )}
                    </div>
                    {presetPct > 0 && (
                      <div className="shrink-0 px-1.5 py-0.5 rounded-md bg-red-500/15 border border-red-500/30 text-red-400 text-[9px] font-bold leading-none">
                        −{presetPct}%
                      </div>
                    )}
                  </div>
                </SparkyButton>
              );
            })}
          </div>

          {/* Slider section — fine-tune days when none of the presets fit. */}
          <div className="relative pt-3 border-t border-white/5">
            <div className="flex justify-between items-end mb-2.5">
              <div>
                <span className="text-zinc-500 text-[10px] uppercase tracking-widest font-medium">Длительность</span>
                <div className="flex items-baseline gap-1 mt-0.5">
                  <span className="text-2xl font-bold text-white lg:text-3xl">{days}</span>
                  <span className="text-zinc-400 text-xs">{t.daysLabel}</span>
                </div>
              </div>
              <div className="text-right">
                <span className="text-zinc-500 text-[10px] uppercase tracking-widest font-medium">Цена</span>
                <div className="text-white font-bold text-base lg:text-xl mt-0.5">
                  {PRICE_PER_DAY}₽ <span className="text-[10px] text-zinc-500">{t.perDay}</span>
                </div>
              </div>
            </div>
            <input 
              type="range" min={MIN_DAYS} max={MAX_DAYS} value={days} 
              onChange={(e) => setDays(parseInt(e.target.value))}
              className="w-full h-1.5 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-red-500 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(239,68,68,0.6)] [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:bg-red-500 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0"
              style={{ background: `linear-gradient(to right, #ef4444 ${(days - MIN_DAYS) / (MAX_DAYS - MIN_DAYS) * 100}%, #27272a ${(days - MIN_DAYS) / (MAX_DAYS - MIN_DAYS) * 100}%)` }}
            />
            <div className="flex justify-between text-zinc-600 text-[10px] mt-1.5 font-medium">
              <span>{MIN_DAYS} {t.daysLabel}</span>
              <span>{MAX_DAYS} {t.daysLabel}</span>
            </div>
          </div>

          {/* Total summary block — strikethrough when discount applies. */}
          {durationDiscountPct > 0 && (
            <div className="relative mt-3 pt-3 border-t border-white/5 flex justify-between items-center">
              <span className="text-red-400 text-xs font-medium">
                Скидка за длительность −{durationDiscountPct}%
              </span>
              <span className="text-red-400 text-xs font-semibold">
                −{pricing.durationDiscountAmount}₽
              </span>
            </div>
          )}
          <div className={`relative ${durationDiscountPct > 0 ? 'mt-2' : 'mt-3 pt-3 border-t border-white/5'} flex justify-between items-center`}>
            <span className="text-zinc-400 text-xs">{t.total}</span>
            <div className="text-right">
              {(durationDiscountPct > 0 || appliedPromo) ? (
                <div className="flex items-center gap-2">
                  <span className="text-zinc-500 text-xs line-through">{rawTotal}₽</span>
                  <span className="text-lg font-bold text-white">{totalPrice}₽</span>
                </div>
              ) : (
                <span className="text-lg font-bold text-white">{totalPrice}₽</span>
              )}
            </div>
          </div>
        </motion.div>

        {/* Continuation of the vertical flow: promo → pay method →
            features → CTA. Same order on mobile and desktop. */}
        <div className="flex flex-col gap-3 lg:gap-4">

        {/* Promo code field. */}
        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.12, duration: 0.25 }}
          className="bg-zinc-900/40 border border-white/10 rounded-xl p-3 lg:p-4"
        >
          {appliedPromo ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Tag size={14} className="text-red-400" />
                <span className="text-sm text-red-400 font-medium">{appliedPromo.code} (-{appliedPromo.discountPercent}%)</span>
              </div>
              <button onClick={handleRemovePromo} className="text-zinc-500 hover:text-red-400 transition-colors">
                <X size={14} />
              </button>
            </div>
          ) : (
            <div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={promoInput}
                  onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                  placeholder={t.promoPlaceholder}
                  className="flex-1 bg-zinc-800/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-red-500/40"
                  onKeyDown={(e) => e.key === 'Enter' && handleApplyPromo()}
                />
                <button
                  onClick={handleApplyPromo}
                  disabled={promoLoading || !promoInput.trim()}
                  className="bg-white/10 border border-white/15 text-white px-3 rounded-lg text-xs hover:bg-white/15 disabled:opacity-50 shrink-0"
                >
                  {promoLoading ? '...' : t.promoApply}
                </button>
              </div>
              {promoError && <p className="text-red-400 text-[10px] mt-1.5">{promoError}</p>}
            </div>
          )}
        </motion.div>

        {/* Payment method — wide row tiles like the Volna shop screenshot
            but in our palette. SBP = red accent (default), Crypto = white
            accent. */}
        <motion.div 
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.15, duration: 0.25 }}
          className="grid grid-cols-2 gap-2 lg:gap-3"
        >
          {/* 2026-05-13: replaced lucide Wallet/Bitcoin with brand-coloured
              official logos (SBP sigil, CryptoBot mark). Active state is
              encoded in the icon component via opacity — the parent
              `PaymentMethodBtn` still drives the border/glow. */}
          <PaymentMethodBtn icon={<SbpIcon size={20} active={payMethod === 'sbp'} />} label={t.paySbp} isActive={payMethod === 'sbp'} onClick={() => setPayMethod('sbp')} />
          <PaymentMethodBtn icon={<CryptoBotIcon size={20} active={payMethod === 'crypto'} />} label={t.payCrypto} isActive={payMethod === 'crypto'} onClick={() => setPayMethod('crypto')} />
        </motion.div>

        {/* Features list intentionally removed 2026-05-13 — the
            checkout screen is for confirming the purchase, not
            re-selling. Plan capabilities (devices count, unlimited
            bandwidth) are already surfaced earlier in the funnel. */}

        {/* Big red CTA — full width, integrated price. Same shape as the
            tgstore Premium button so the brand feels consistent. */}
        <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2, duration: 0.25 }}>
          <button
            onClick={handleSubscribe}
            disabled={isLoading || sbpState === 'creating'}
            className="group relative w-full overflow-hidden rounded-xl py-3.5 px-4 font-bold text-white text-sm flex items-center justify-between gap-2 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all bg-gradient-to-r from-red-600 via-red-500 to-red-600 shadow-[0_8px_32px_-8px_rgba(239,68,68,0.6)] hover:shadow-[0_8px_36px_-6px_rgba(239,68,68,0.75)]"
          >
            <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />
            <span className="relative flex items-center gap-2">
              <Wallet size={16} />
              {isLoading || sbpState === 'creating' ? 'Загрузка…' : t.subscribe}
            </span>
            <span className="relative px-2.5 py-1 rounded-lg bg-black/25 text-white font-bold text-[13px] tracking-wide">
              {totalPrice}₽
            </span>
          </button>
        </motion.div>
        </div>
      </div>
    </motion.div>
  );
}

const PaymentMethodBtn = memo(function PaymentMethodBtn({ icon, label, isActive, onClick }: { icon: React.ReactNode; label: string; isActive: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex flex-col items-center justify-center p-2.5 rounded-lg border transition-all gap-1 active:scale-95 ${isActive ? 'bg-gradient-to-br from-red-500/15 to-red-500/5 border-red-500/40 shadow-[0_0_16px_rgba(239,68,68,0.2)]' : 'bg-zinc-950/50 border-white/5 hover:bg-zinc-900/50 hover:border-red-500/20'}`}>
      {icon}
      <span className={`text-[8px] font-medium uppercase tracking-wider text-center ${isActive ? 'text-white' : 'text-zinc-500'}`}>{label}</span>
    </button>
  );
});

function FeatureItem({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-3.5 h-3.5 rounded-full bg-red-500/12 flex items-center justify-center shrink-0 border border-red-500/30">
        <Check size={8} strokeWidth={2.5} className="text-red-400" />
      </div>
      <span className="text-zinc-300 text-xs">{text}</span>
    </div>
  );
}

type SupportTicket = {
  id: string;
  subject: string | null;
  status: 'open' | 'closed';
  created_at: string;
  updated_at: string;
  last_message: string | null;
  last_message_at: string;
  messages_count: number;
  unread_count: number;
};

// ---------------------------------------------------------------------------
// Support-ticket photo attachments (shared by user + admin ticket views).
// Images are uploaded inline as base64 in the JSON request body and stored as
// BYTEA in Postgres; they stream back through the attachment GET routes.
// ---------------------------------------------------------------------------

const TICKET_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const TICKET_IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const TICKET_IMAGE_MAX_COUNT = 5;

// Metadata for a stored attachment (no bytes — URL points at the GET route).
type TicketAttachmentMeta = {
  id: string;
  message_id?: string;
  mime_type: string;
  file_name: string | null;
  byte_size: number;
};

// A picked-but-not-yet-sent image (local preview before upload).
type PendingTicketImage = {
  key: string;
  file: File;
  previewUrl: string;
};

// Encode a File as { name, mime, dataBase64 } for the request body.
async function fileToTicketAttachment(file: File): Promise<{ name: string; mime: string; dataBase64: string }> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return { name: file.name, mime: file.type, dataBase64: btoa(binary) };
}

// Validate + dedupe newly picked files against the current pending list.
// Returns the accepted PendingTicketImage[] and an optional error string.
function acceptTicketImages(
  files: FileList | File[],
  existingCount: number,
): { accepted: PendingTicketImage[]; error: string | null } {
  const accepted: PendingTicketImage[] = [];
  let error: string | null = null;
  let count = existingCount;
  for (const file of Array.from(files)) {
    if (count >= TICKET_IMAGE_MAX_COUNT) {
      error = `Можно прикрепить не более ${TICKET_IMAGE_MAX_COUNT} фото`;
      break;
    }
    if (!TICKET_IMAGE_TYPES.includes(file.type)) {
      error = 'Можно прикреплять только изображения';
      continue;
    }
    if (file.size > TICKET_IMAGE_MAX_BYTES) {
      error = 'Изображение слишком большое (макс. 5 МБ)';
      continue;
    }
    accepted.push({
      key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
      file,
      previewUrl: URL.createObjectURL(file),
    });
    count += 1;
  }
  return { accepted, error };
}

// Fullscreen image viewer (tap a thumbnail to open). Rendered via portal so it
// sits above the chat. Tap anywhere / the × to close.
function TicketImageLightbox({ url, onClose }: { url: string | null; onClose: () => void }) {
  if (!url || typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
      >
        <X size={22} />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="attachment" className="max-h-full max-w-full rounded-lg object-contain" />
    </div>,
    document.body,
  );
}

// Thumbnail grid shown inside a message bubble. `buildUrl` resolves an
// attachment to its (auth-carrying) GET URL.
function TicketAttachmentGrid({
  attachments,
  buildUrl,
  onOpen,
}: {
  attachments?: TicketAttachmentMeta[];
  buildUrl: (att: TicketAttachmentMeta) => string;
  onOpen: (url: string) => void;
}) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {attachments.map((att) => {
        const url = buildUrl(att);
        return (
          <button
            key={att.id}
            type="button"
            onClick={() => onOpen(url)}
            className="block overflow-hidden rounded-lg border border-white/10 active:scale-95 transition-transform"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={att.file_name ?? 'image'}
              loading="lazy"
              className="h-36 w-36 object-cover bg-black/20"
            />
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message-level actions for the support-ticket chat (mini-app + admin):
// swipe-left / long-press / hover-button to reply, copy text, and one emoji
// reaction per side. Backend: db/migrations/2026-06-16-ticket-message-actions.
// ---------------------------------------------------------------------------
const TICKET_REACTION_EMOJIS = ['👍', '👎', '❤️', '😊', '😮', '🎉'] as const;

type TicketReaction = { reactor_type: 'user' | 'admin'; emoji: string };

type TicketChatMsg = {
  id: string;
  sender_type: 'user' | 'admin' | 'system';
  message: string;
  created_at: string;
  attachments?: TicketAttachmentMeta[];
  reply_to_id?: string | null;
  reactions?: TicketReaction[];
};

function TicketMessageRow({
  msg,
  isOwn,
  mySide,
  quotedLabel,
  quotedText,
  bubbleClassName,
  meta,
  attachmentsNode,
  onReply,
  onReact,
  onCopy,
  onJumpToQuoted,
  lang,
}: {
  msg: TicketChatMsg;
  isOwn: boolean;
  mySide: 'user' | 'admin';
  quotedLabel: string | null;
  quotedText: string | null;
  bubbleClassName: string;
  meta: React.ReactNode;
  attachmentsNode?: React.ReactNode;
  onReply: (msg: TicketChatMsg) => void;
  onReact: (messageId: string, emoji: string) => void;
  onCopy: (text: string) => void;
  onJumpToQuoted?: (id: string) => void;
  lang: 'ru' | 'en';
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragX, setDragX] = useState(0);
  const startX = useRef(0);
  const startY = useRef(0);
  const dragging = useRef(false);
  const swiped = useRef(false);
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSystem = msg.sender_type === 'system';
  const actionable = !isSystem;

  const clearLongPress = () => {
    if (longPress.current) { clearTimeout(longPress.current); longPress.current = null; }
  };
  const closeMenu = () => setMenuOpen(false);

  const doReply = () => { haptic('light'); onReply(msg); closeMenu(); };
  const doCopy = () => { onCopy(msg.message); closeMenu(); };
  const doReact = (emoji: string) => { onReact(msg.id, emoji); closeMenu(); };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!actionable) return;
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    dragging.current = true;
    swiped.current = false;
    clearLongPress();
    longPress.current = setTimeout(() => {
      dragging.current = false;
      setDragX(0);
      haptic('medium');
      setMenuOpen(true);
    }, 450);
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!dragging.current) return;
    const dx = e.touches[0].clientX - startX.current;
    const dy = e.touches[0].clientY - startY.current;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) clearLongPress();
    if (Math.abs(dy) > Math.abs(dx)) { dragging.current = false; setDragX(0); return; }
    const clamped = Math.max(-72, Math.min(0, dx));
    setDragX(clamped);
    if (clamped <= -52 && !swiped.current) {
      swiped.current = true;
      dragging.current = false;
      setDragX(0);
      doReply();
    }
  };
  const handleTouchEnd = () => {
    clearLongPress();
    dragging.current = false;
    setDragX(0);
  };

  const myReaction = msg.reactions?.find((r) => r.reactor_type === mySide)?.emoji ?? null;

  return (
    <div id={`tmsg-${msg.id}`} className={`group relative flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
      {actionable && dragX < -8 && (
        <div className="absolute right-1 top-1/2 -translate-y-1/2 text-zinc-400" style={{ opacity: Math.min(1, -dragX / 52) }}>
          <Reply size={16} />
        </div>
      )}

      <div
        className="relative max-w-[85%]"
        style={{ transform: dragX ? `translateX(${dragX}px)` : undefined, transition: dragX ? 'none' : 'transform 0.18s ease' }}
      >
        {actionable && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); haptic('light'); setMenuOpen((v) => !v); }}
            aria-label="Actions"
            className={`hidden md:flex absolute -top-2 ${isOwn ? '-left-7' : '-right-7'} w-6 h-6 rounded-full bg-zinc-800/90 border border-white/10 text-zinc-300 items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:text-white z-10`}
          >
            <MoreHorizontal size={14} />
          </button>
        )}

        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className={bubbleClassName}
        >
          {msg.reply_to_id && (quotedText || quotedLabel) && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onJumpToQuoted?.(msg.reply_to_id as string); }}
              className="mb-1.5 w-full text-left rounded-md border-l-2 border-white/40 bg-black/20 px-2 py-1"
            >
              {quotedLabel && <span className="block text-[10px] font-medium text-white/70">{quotedLabel}</span>}
              <span className="block text-[11px] text-white/60 truncate">{quotedText || (lang === 'ru' ? '📷 Фото' : '📷 Photo')}</span>
            </button>
          )}

          {msg.message && (
            <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{msg.message}</p>
          )}
          {attachmentsNode}
          <div className="flex items-center gap-1 mt-1.5">
            <div className="flex-1 min-w-0">{meta}</div>
            {actionable && (
              <div className="flex items-center gap-2 shrink-0">
                {msg.message && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); doCopy(); }} className="text-zinc-500 hover:text-zinc-300 transition-colors" aria-label="Copy"><Copy size={13} /></button>
                )}
                <button type="button" onClick={(e) => { e.stopPropagation(); doReply(); }} className="text-zinc-500 hover:text-zinc-300 transition-colors" aria-label="Reply"><Reply size={13} /></button>
                <button type="button" onClick={(e) => { e.stopPropagation(); haptic('light'); setMenuOpen((v) => !v); }} className="text-zinc-500 hover:text-zinc-300 transition-colors" aria-label="React"><Smile size={13} /></button>
              </div>
            )}
          </div>
        </div>

        {msg.reactions && msg.reactions.length > 0 && (
          <div className={`mt-1 flex gap-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
            {msg.reactions.map((r) => (
              <button
                key={r.reactor_type}
                type="button"
                onClick={(e) => { e.stopPropagation(); if (r.reactor_type === mySide) onReact(msg.id, r.emoji); }}
                className={`px-1.5 py-0.5 rounded-full text-xs border ${r.reactor_type === mySide ? 'bg-white/15 border-white/30' : 'bg-black/30 border-white/10'}`}
              >
                {r.emoji}
              </button>
            ))}
          </div>
        )}

        {menuOpen && (
          <>
            <div className="fixed inset-0 z-20" onClick={closeMenu} onTouchStart={closeMenu} />
            <div className={`absolute z-30 top-full mt-1 ${isOwn ? 'right-0' : 'left-0'} rounded-2xl border border-white/10 bg-zinc-900/95 backdrop-blur-md shadow-xl p-2 w-max`}>
              <div className="flex gap-1 mb-1">
                {TICKET_REACTION_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={(e) => { e.stopPropagation(); doReact(emoji); }}
                    className={`w-8 h-8 rounded-full text-lg flex items-center justify-center hover:bg-white/10 ${myReaction === emoji ? 'bg-white/15' : ''}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <div className="flex flex-col">
                <button type="button" onClick={(e) => { e.stopPropagation(); doReply(); }} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-zinc-200 hover:bg-white/10">
                  <Reply size={15} /> {lang === 'ru' ? '\u041e\u0442\u0432\u0435\u0442\u0438\u0442\u044c' : 'Reply'}
                </button>
                {msg.message && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); doCopy(); }} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-zinc-200 hover:bg-white/10">
                    <Copy size={15} /> {lang === 'ru' ? '\u041a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u0442\u044c' : 'Copy'}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Horizontal strip of picked-but-unsent images with a remove (\u00d7) button.
function PendingImagesStrip({
  images,
  onRemove,
}: {
  images: PendingTicketImage[];
  onRemove: (key: string) => void;
}) {
  if (images.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 pb-2">
      {images.map((img) => (
        <div key={img.key} className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={img.previewUrl}
            alt={img.file.name}
            className="h-16 w-16 rounded-lg object-cover border border-white/15"
          />
          <button
            type="button"
            onClick={() => onRemove(img.key)}
            aria-label="Remove"
            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-zinc-900 border border-white/20 text-zinc-300 hover:text-white flex items-center justify-center"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

type SupportTicketDetails = {
  id: string;
  subject: string | null;
  status: 'open' | 'closed';
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

type SupportTicketMessage = {
  id: string;
  sender_type: 'user' | 'admin' | 'system';
  message: string;
  created_at: string;
  attachments?: TicketAttachmentMeta[];
  reply_to_id?: string | null;
  reactions?: TicketReaction[];
};

function SupportView({ t, direction, userIdentifier, lang, onHideNav, onMarkRead }: { t: any; direction: number; userIdentifier: UserIdentifier | null; lang: 'ru' | 'en'; onHideNav?: (hide: boolean) => void; onMarkRead?: () => void }) {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketsError, setTicketsError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<SupportTicketDetails | null>(null);
  const [ticketMessages, setTicketMessages] = useState<SupportTicketMessage[]>([]);
  const [ticketDetailsLoading, setTicketDetailsLoading] = useState(false);
  const [replyMessage, setReplyMessage] = useState('');
  const [replyTo, setReplyTo] = useState<SupportTicketMessage | null>(null);
  const [replySending, setReplySending] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Photo attachments: picked-but-unsent images for the create form + reply box,
  // plus the fullscreen viewer URL.
  const [createImages, setCreateImages] = useState<PendingTicketImage[]>([]);
  const [replyImages, setReplyImages] = useState<PendingTicketImage[]>([]);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const createFileRef = useRef<HTMLInputElement>(null);
  const replyFileRef = useRef<HTMLInputElement>(null);

  const userQuery = userIdentifier
    ? (userIdentifier.type === 'telegram'
      ? `telegramId=${encodeURIComponent(String(userIdentifier.telegramId))}`
      : `userId=${encodeURIComponent(String(userIdentifier.userId))}`)
    : '';

  const buildAttachmentUrl = useCallback(
    (ticketId: string, att: TicketAttachmentMeta) =>
      `/api/tickets/${ticketId}/attachments/${att.id}?${userQuery}`,
    [userQuery],
  );

  const handlePickImages = (
    files: FileList | null,
    target: 'create' | 'reply',
  ) => {
    if (!files || files.length === 0) return;
    const setter = target === 'create' ? setCreateImages : setReplyImages;
    setter((prev) => {
      const { accepted, error } = acceptTicketImages(files, prev.length);
      if (error) {
        if (target === 'create') setSubmitError(error);
        else setTicketsError(error);
      }
      return [...prev, ...accepted];
    });
  };

  const removePendingImage = (key: string, target: 'create' | 'reply') => {
    const setter = target === 'create' ? setCreateImages : setReplyImages;
    setter((prev) => {
      const found = prev.find((p) => p.key === key);
      if (found) URL.revokeObjectURL(found.previewUrl);
      return prev.filter((p) => p.key !== key);
    });
  };

  const requestBody = userIdentifier
    ? (userIdentifier.type === 'telegram'
      ? { telegramId: userIdentifier.telegramId }
      : { userId: userIdentifier.userId })
    : null;

  const loadTickets = useCallback(async () => {
    if (!userQuery) {
      setTickets([]);
      setTicketsError(null);
      setSelectedTicketId(null);
      setSelectedTicket(null);
      setTicketMessages([]);
      return;
    }

    setTicketsLoading(true);
    setTicketsError(null);
    try {
      const res = await fetch(`/api/tickets?${userQuery}`);
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || t.supportLoadError);
      }

      setTickets(Array.isArray(data.tickets) ? data.tickets : []);
    } catch (error) {
      setTickets([]);
      setTicketsError(error instanceof Error ? error.message : t.supportLoadError);
    } finally {
      setTicketsLoading(false);
    }
  }, [userQuery, t.supportLoadError]);

  const loadTicketDetails = useCallback(async (ticketId: string) => {
    if (!userQuery) return;

    setTicketDetailsLoading(true);
    setTicketsError(null);
    try {
      const res = await fetch(`/api/tickets/${ticketId}?${userQuery}`);
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || t.supportLoadError);
      }

      setSelectedTicket(data.ticket ?? null);
      setTicketMessages(Array.isArray(data.messages) ? data.messages : []);
      // GET /api/tickets/[id] auto-marks the ticket as read on the server,
      // so refresh the global unread badge to clear it.
      onMarkRead?.();
    } catch (error) {
      setSelectedTicket(null);
      setTicketMessages([]);
      setTicketsError(error instanceof Error ? error.message : t.supportLoadError);
    } finally {
      setTicketDetailsLoading(false);
    }
  }, [userQuery, t.supportLoadError, onMarkRead]);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  // Hide navigation when in chat
  useEffect(() => {
    onHideNav?.(!!selectedTicketId);
    return () => onHideNav?.(false);
  }, [selectedTicketId, onHideNav]);

  const handleCreateTicket = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    haptic('medium');

    if (!requestBody) {
      setSubmitError(t.supportCreateError);
      return;
    }

    const messageValue = message.trim();
    if (!messageValue && createImages.length === 0) {
      setSubmitError(t.supportMessageRequired);
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      const attachments = await Promise.all(createImages.map((img) => fileToTicketAttachment(img.file)));
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...requestBody,
          subject: subject.trim() || undefined,
          message: messageValue,
          attachments: attachments.length > 0 ? attachments : undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || t.supportCreateError);
      }

      setSubject('');
      setMessage('');
      createImages.forEach((img) => URL.revokeObjectURL(img.previewUrl));
      setCreateImages([]);
      setShowCreateForm(false);

      const newTicketId = typeof data.ticket?.id === 'string' ? data.ticket.id : null;
      if (newTicketId) {
        setSelectedTicketId(newTicketId);
        await Promise.all([loadTickets(), loadTicketDetails(newTicketId)]);
      } else {
        await loadTickets();
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t.supportCreateError);
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenTicket = (ticketId: string) => {
    haptic('light');
    setSelectedTicketId(ticketId);
    setReplyMessage('');
    void loadTicketDetails(ticketId);
  };

  const handleSendMessage = async () => {
    haptic('medium');
    if (!requestBody || !selectedTicketId) return;

    const messageValue = replyMessage.trim();
    if (!messageValue && replyImages.length === 0) {
      setTicketsError(t.supportMessageRequired);
      return;
    }

    setReplySending(true);
    setTicketsError(null);

    try {
      const attachments = await Promise.all(replyImages.map((img) => fileToTicketAttachment(img.file)));
      const res = await fetch(`/api/tickets/${selectedTicketId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...requestBody,
          message: messageValue,
          attachments: attachments.length > 0 ? attachments : undefined,
          replyToId: replyTo?.id ?? null,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || t.supportTicketActionError);
      }

      setReplyMessage('');
      setReplyTo(null);
      replyImages.forEach((img) => URL.revokeObjectURL(img.previewUrl));
      setReplyImages([]);
      await Promise.all([loadTicketDetails(selectedTicketId), loadTickets()]);
    } catch (error) {
      setTicketsError(error instanceof Error ? error.message : t.supportTicketActionError);
    } finally {
      setReplySending(false);
    }
  };

  const handleReactMessage = async (messageId: string, emoji: string) => {
    if (!requestBody || !selectedTicketId) return;
    haptic('light');
    try {
      const res = await fetch(`/api/tickets/${selectedTicketId}/messages/${messageId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...requestBody, emoji }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t.supportTicketActionError);
      setTicketMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, reactions: data.reactions ?? [] } : m)));
    } catch (error) {
      setTicketsError(error instanceof Error ? error.message : t.supportTicketActionError);
    }
  };

  const handleCopyMessage = async (text: string) => {
    if (!text) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      haptic('light');
    } catch { /* ignore */ }
  };

  const jumpToMessage = (id: string) => {
    const el = document.getElementById(`tmsg-${id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const handleTicketStatus = async (status: 'open' | 'closed') => {
    haptic('medium');
    if (!requestBody || !selectedTicketId) return;

    setStatusUpdating(true);
    setTicketsError(null);

    try {
      const res = await fetch(`/api/tickets/${selectedTicketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...requestBody,
          status,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || t.supportTicketActionError);
      }

      await Promise.all([loadTicketDetails(selectedTicketId), loadTickets()]);
    } catch (error) {
      setTicketsError(error instanceof Error ? error.message : t.supportTicketActionError);
    } finally {
      setStatusUpdating(false);
    }
  };

  const senderLabel = (senderType: 'user' | 'admin' | 'system') => {
    if (senderType === 'admin') return t.supportSenderAdmin;
    if (senderType === 'system') return t.supportSenderSystem;
    return t.supportSenderUser;
  };

  const formatDate = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-GB');
  };

  return (
    <motion.div custom={direction} variants={pageVariants} initial="initial" animate="animate" exit="exit" className="flex flex-col flex-1 items-center w-full">
      <div className="w-full max-w-xs lg:max-w-[560px] space-y-3">
        {!showCreateForm && !selectedTicketId && (
          <button
            onClick={() => {
              setShowCreateForm(true);
              setSubmitError(null);
            }}
            className="w-full rounded-full border border-white/20 bg-zinc-900/40 px-5 py-3 text-white font-semibold text-base flex items-center justify-center gap-2 active:scale-[0.99]"
          >
            <Plus size={18} strokeWidth={2} />
            <span>{t.supportNewTicket}</span>
          </button>
        )}

        {showCreateForm ? (
          <>
            <button onClick={() => setShowCreateForm(false)} className="text-zinc-400 hover:text-white text-sm inline-flex items-center gap-2 mb-2 transition-colors">
              <ChevronRight size={14} className="rotate-180" /> {t.supportBackToList}
            </button>

            {/* 2026-05-06 premium redesign: glass-on-dark with crisp white outline,
                  no red glow blobs, no airplane icon, uppercase micro-labels.
                  Header uses a Pencil compose chip on a neutral white/10 surface. */}
            <form onSubmit={handleCreateTicket} className="relative rounded-2xl border border-white/15 bg-zinc-900/60 backdrop-blur-sm p-5 lg:p-6 overflow-hidden">
              {/* Subtle red halo (one, top-right) — premium accent without dominating */}
              <div className="absolute -top-16 -right-16 w-44 h-44 rounded-full bg-red-500/[0.06] blur-3xl pointer-events-none" />

              <div className="relative">
                {/* Header */}
                <div className="flex items-center gap-3 mb-5 pb-4 border-b border-white/10">
                  <div className="w-11 h-11 rounded-xl border border-white/15 bg-white/[0.04] flex items-center justify-center shrink-0">
                    <Pencil size={17} strokeWidth={1.75} className="text-zinc-200" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-white font-semibold text-base lg:text-lg leading-tight">{t.supportCreateTitle}</h3>
                    <p className="text-zinc-500 text-xs mt-0.5">{t.supportSubjectHint}</p>
                  </div>
                </div>

                {/* Subject */}
                <div className="mb-4">
                  <label className="block text-zinc-400 text-[10px] font-semibold uppercase tracking-[0.12em] mb-2">{t.supportSubject}</label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder={t.supportSubjectPlaceholder}
                    maxLength={120}
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white placeholder:text-zinc-600 outline-none focus:border-white/30 transition-colors"
                  />
                </div>

                {/* Message */}
                <div className="mb-5">
                  <label className="block text-zinc-400 text-[10px] font-semibold uppercase tracking-[0.12em] mb-2">
                    {t.supportMessage} <span className="text-red-400 normal-case">*</span>
                  </label>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={t.supportMessagePlaceholder}
                    rows={5}
                    maxLength={4000}
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white placeholder:text-zinc-600 outline-none focus:border-white/30 transition-colors resize-none min-h-[160px]"
                  />
                </div>

                {/* Photo attachments */}
                <div className="mb-5">
                  <input
                    ref={createFileRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      handlePickImages(e.target.files, 'create');
                      e.target.value = '';
                    }}
                  />
                  <PendingImagesStrip images={createImages} onRemove={(k) => removePendingImage(k, 'create')} />
                  <button
                    type="button"
                    onClick={() => createFileRef.current?.click()}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-zinc-300 hover:text-white hover:bg-white/[0.06] transition-colors"
                  >
                    <ImageIcon size={16} /> {t.supportAttachPhoto}
                  </button>
                </div>

                {submitError && (
                  <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300 flex items-center gap-2">
                    <X size={16} />
                    {submitError}
                  </div>
                )}

                {/* Submit button — solid red, no gradient, no airplane */}
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-xl bg-red-500 hover:bg-red-600 text-white font-semibold py-3.5 active:scale-[0.99] transition-all disabled:opacity-50 disabled:hover:bg-red-500"
                >
                  {submitting ? t.supportSending : t.supportSend}
                </button>
              </div>
            </form>
          </>
        ) : selectedTicketId ? (
          <div className="fixed inset-0 z-30 bg-black flex flex-col">
            {/* Header — premium glass card with white outline, no red glow blob, no chat-icon clutter */}
            <div className="shrink-0 px-4 pb-3 border-b border-white/10 bg-zinc-950/95 backdrop-blur-md" style={{ paddingTop: 'calc(var(--sat) + 3.5rem)' }}>
              {selectedTicket && (
                <div className="rounded-2xl border border-white/15 bg-zinc-900/60 backdrop-blur-sm p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <button
                        onClick={() => {
                          setSelectedTicketId(null);
                          setSelectedTicket(null);
                          setTicketMessages([]);
                          setReplyMessage('');
                          setTicketsError(null);
                        }}
                        className="w-9 h-9 shrink-0 rounded-lg border border-white/15 bg-white/[0.04] flex items-center justify-center active:scale-90 transition-transform"
                      >
                        <ChevronLeft size={18} className="text-white" />
                      </button>
                      <div className="min-w-0">
                        <h3 className="text-white font-semibold text-sm truncate">{selectedTicket.subject || t.supportNoSubject}</h3>
                        <span className={`mt-0.5 inline-flex items-center gap-1.5 text-[11px] ${selectedTicket.status === 'closed' ? 'text-zinc-500' : 'text-emerald-300'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${selectedTicket.status === 'closed' ? 'bg-zinc-500' : 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]'}`} />
                          {selectedTicket.status === 'closed' ? t.supportClosedStatus : t.supportOpenStatus}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleTicketStatus(selectedTicket.status === 'open' ? 'closed' : 'open')}
                      disabled={statusUpdating}
                      className={`shrink-0 text-[11px] font-medium px-3 py-1.5 rounded-lg border transition-all active:scale-95 ${selectedTicket.status === 'open' ? 'border-white/15 bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08]' : 'border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/15'} disabled:opacity-40`}
                    >
                      {selectedTicket.status === 'open' ? t.supportCloseTicket : t.supportReopenTicket}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {ticketsError && (
              <div className="mx-4 mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300 flex items-center gap-2">
                <X size={16} />
                {ticketsError}
              </div>
            )}

            {ticketDetailsLoading || !selectedTicket ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="w-10 h-10 rounded-full border-2 border-white/10 border-t-white/70 animate-spin" />
              </div>
            ) : (
              <>
                {/* Messages — refined bubbles with asymmetric corner for chat-y feel */}
                <div className="flex-1 overflow-y-auto px-4 py-4">
                  {ticketMessages.length === 0 ? (
                    <div className="text-zinc-600 text-sm py-8 text-center">{t.supportTicketNoMessages}</div>
                  ) : (
                    <div className="space-y-2.5">
                      {ticketMessages.map((msg) => {
                        const quoted = msg.reply_to_id ? ticketMessages.find((m) => m.id === msg.reply_to_id) : null;
                        const isOwn = msg.sender_type === 'user';
                        return (
                          <TicketMessageRow
                            key={msg.id}
                            msg={msg}
                            isOwn={isOwn}
                            mySide="user"
                            quotedLabel={quoted ? senderLabel(quoted.sender_type) : null}
                            quotedText={quoted ? quoted.message : null}
                            bubbleClassName={`px-4 py-2.5 ${isOwn ? 'rounded-2xl rounded-br-md bg-red-500/15 border border-red-500/30 text-white' : 'rounded-2xl rounded-bl-md bg-white/[0.04] border border-white/10 text-zinc-100'}`}
                            attachmentsNode={
                              <TicketAttachmentGrid
                                attachments={msg.attachments}
                                buildUrl={(att) => buildAttachmentUrl(selectedTicket.id, att)}
                                onOpen={setLightboxUrl}
                              />
                            }
                            meta={
                              <p className={`text-[10px] mt-1.5 ${isOwn ? 'text-red-200/60' : 'text-zinc-500'}`}>
                                {senderLabel(msg.sender_type)} · {formatDate(msg.created_at)}
                              </p>
                            }
                            onReply={(m) => { setReplyTo(m as SupportTicketMessage); }}
                            onReact={handleReactMessage}
                            onCopy={handleCopyMessage}
                            onJumpToQuoted={jumpToMessage}
                            lang={lang}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Fixed input at bottom — premium pill textarea + circular ArrowUp send (no airplane) */}
                <div className="shrink-0 px-4 pt-3 border-t border-white/10 bg-zinc-950/95 backdrop-blur-md" style={{ paddingBottom: 'calc(var(--sab) + 0.75rem)' }}>
                  {replyTo && (
                    <div className="flex items-center gap-2 mb-2 rounded-xl border-l-2 border-red-400/70 bg-white/[0.04] px-3 py-2">
                      <Reply size={14} className="text-red-300 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-medium text-red-300">{lang === 'ru' ? 'Ответ' : 'Reply'} · {senderLabel(replyTo.sender_type)}</p>
                        <p className="text-[11px] text-zinc-400 truncate">{replyTo.message || (lang === 'ru' ? '📷 Фото' : '📷 Photo')}</p>
                      </div>
                      <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply" className="shrink-0 text-zinc-400 hover:text-white">
                        <X size={16} />
                      </button>
                    </div>
                  )}
                  <PendingImagesStrip images={replyImages} onRemove={(k) => removePendingImage(k, 'reply')} />
                  <div className="flex items-end gap-2">
                    <input
                      ref={replyFileRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        handlePickImages(e.target.files, 'reply');
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => replyFileRef.current?.click()}
                      aria-label={t.supportAttachPhoto}
                      title={t.supportAttachPhoto}
                      className="shrink-0 w-12 h-12 rounded-full bg-white/[0.04] border border-white/10 text-zinc-400 hover:text-white hover:bg-white/[0.08] flex items-center justify-center active:scale-90 transition-all"
                    >
                      <Paperclip size={19} strokeWidth={2} />
                    </button>
                    <textarea
                      value={replyMessage}
                      onChange={(e) => setReplyMessage(e.target.value)}
                      placeholder={t.supportReplyPlaceholder}
                      rows={1}
                      maxLength={4000}
                      className="flex-1 rounded-2xl border border-white/15 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-white/30 focus:bg-white/[0.05] transition-colors resize-none"
                    />
                    <button
                      onClick={handleSendMessage}
                      disabled={replySending || (!replyMessage.trim() && replyImages.length === 0)}
                      aria-label={t.supportSend}
                      className="shrink-0 w-12 h-12 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center active:scale-90 transition-all disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed"
                    >
                      <ArrowUp size={20} strokeWidth={2.25} />
                    </button>
                  </div>
                </div>
                <TicketImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {ticketsError && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {ticketsError}
              </div>
            )}

            {ticketsLoading ? (
              <div className="rounded-[28px] border border-white/10 bg-zinc-900/40 px-5 py-10 text-center text-zinc-400 text-sm">
                {t.supportLoading}
              </div>
            ) : tickets.length === 0 ? (
              <div className="rounded-[28px] border border-white/10 bg-zinc-900/35 px-6 py-14 text-center min-h-[260px] flex flex-col items-center justify-center">
                <div className="w-16 h-16 rounded-2xl border border-white/15 bg-white/[0.03] flex items-center justify-center mb-5">
                  <Mail size={30} strokeWidth={1.8} className="text-zinc-300" />
                </div>
                <p className="text-zinc-300 text-lg leading-snug mb-2">{t.supportNoTicketsTitle}</p>
                <p className="text-zinc-500 text-sm leading-snug max-w-[280px]">{t.supportNoTicketsHint}</p>
              </div>
            ) : (
              tickets.map((ticket) => (
                <button
                  key={ticket.id}
                  onClick={() => handleOpenTicket(ticket.id)}
                  className={`w-full text-left rounded-2xl border p-4 transition-colors ${ticket.unread_count > 0 ? 'border-red-500/40 bg-red-500/5 hover:bg-red-500/10' : 'border-white/10 bg-zinc-900/45 hover:bg-zinc-900/70'}`}
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <h3 className="text-white font-semibold text-sm flex items-center gap-2">
                      {ticket.subject || t.supportNoSubject}
                      {ticket.unread_count > 0 && (
                        <span className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-red-500 text-[10px] font-bold text-white flex items-center justify-center shadow-[0_0_8px_rgba(239,68,68,0.6)]">
                          {ticket.unread_count > 99 ? '99+' : ticket.unread_count}
                        </span>
                      )}
                    </h3>
                    <span className={`px-2 py-1 rounded-full text-[10px] uppercase tracking-wider ${ticket.status === 'closed' ? 'bg-zinc-700/60 text-zinc-300' : 'bg-white/10 text-zinc-200'}`}>
                      {ticket.status === 'closed' ? t.supportClosedStatus : t.supportOpenStatus}
                    </span>
                  </div>

                  {ticket.last_message ? (
                    <p className="text-zinc-300 text-sm leading-relaxed mb-3">{ticket.last_message}</p>
                  ) : null}

                  <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-500">
                    <span>{t.supportLastUpdate}: {formatDate(ticket.last_message_at)}</span>
                    <span>{ticket.messages_count} {t.supportMessagesCount}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function ProfileView({ t, lang, setLang, direction, tgUser, subscriptionDaysLabel, navigate, authMode, onLogout, referralCode, userIdentifier, onOpenReferral }: { t: any; lang: string; setLang: (l: 'ru' | 'en') => void; direction: number; tgUser: { id: number; name: string; photo: string; username?: string } | null; subscriptionDaysLabel: string; navigate: (tab: Tab) => void; authMode?: AuthMode; onLogout?: () => void; referralCode?: string | null; userIdentifier?: UserIdentifier | null; onOpenReferral: () => void }) {
  // The referral modal is shared across HomeView, ProfileView and
  // DesktopSidebar — see App. Two independent bonuses go to the INVITER
  // (the user shown this modal):
  //   1. Signup bonus: +3 days every time a brand-new user registers via
  //      this link (`grantReferralSignupBonus` in lib/access.ts). Fires
  //      once per friend on their first /api/users/sync.
  //   2. Recurring payment bonus: tiered by every paid plan ≥ 30 days the
  //      invitee buys (`applyReferralReward`):
  //        30–179 d → +7, 180–364 d → +14, ≥365 d → +21. Plans <30d earn 0.
  //
  // Link format (lib/referral-code.ts): `u{base36(telegramId)}` for tg-primary
  // users, `e{base36(userId)}` for email/google. Redemption only happens
  // through the Mini App's parseReferralCode in /api/users/sync, so e-prefixed
  // inviters still collect bonuses when an invitee joins via Telegram.

  const handleReferralClick = () => {
    haptic('medium');
    if (!referralCode) return;
    onOpenReferral();
  };

  // 2026-05-06 desktop redesign v3 (per user feedback "нет таких цветов"):
  //   App's actual palette is dark + white + red. NO cyan, NO emerald, NO
  //   violet. Only red is used as a colored accent — sparingly, on
  //   semantically charged rows (Premium TG Stars, foreign-services CTA,
  //   Admin, Logout). Regular rows are neutral (white-on-dark).
  //   - SINGLE CENTRAL COLUMN — no two-column grid (max-w-2xl on lg).
  //   - Servers and Logout live in the main vertical flow.
  //   - Hero: subtle red halo, white avatar ring, red subscription badge.
  //   - Mobile layout fully preserved via lg: prefixes.
  const rowBase = 'w-full flex items-center justify-between p-3 lg:p-4 hover:bg-white/[0.04] transition-colors active:scale-[0.98]';
  // 2026-05-06: per user feedback ("белая окантовка у кнопок в профиле") —
  // bump the outer card border from white/5 (barely visible) to white/15
  // so each grouped button has a clean, premium-looking white outline on
  // both mobile and desktop.
  const groupCard = 'bg-zinc-900/40 lg:bg-zinc-900/50 border border-white/15 rounded-xl lg:rounded-2xl overflow-hidden lg:backdrop-blur-sm';
  // Icon chip on lg+: neutral (white/5) by default, red only for charged rows.
  // 36px squared so the list stays compact.
  const iconChip = (color: 'neutral' | 'red' = 'neutral') => {
    const map = {
      neutral: 'lg:bg-white/[0.04] lg:border-white/[0.06]',
      red:     'lg:bg-red-500/10 lg:border-red-400/20',
    };
    return `lg:flex lg:items-center lg:justify-center lg:w-9 lg:h-9 lg:rounded-lg lg:border ${map[color]}`;
  };
  const groupHeader = 'text-[10px] lg:text-[11px] font-medium text-zinc-500 uppercase tracking-widest mb-2 lg:mb-2.5 px-2';

  return (
    <>
    <motion.div custom={direction} variants={pageVariants} initial="initial" animate="animate" exit="exit" className="flex flex-col flex-1 items-center">
      {/* 2026-05-13: user feedback «профиль на пк маленький» — bumped
          the desktop max-width from max-w-2xl (672 px) to max-w-4xl
          (896 px) so the card stack uses ~30 % more horizontal space and
          stops looking dwarfed inside the wide centered container. */}
      <div className="w-full max-w-xs lg:max-w-4xl">
        {/* HERO CARD — same premium look on mobile and desktop:
              red halo + red avatar glow + red ring + red badge.
              Sizes scale up on lg: but the visual treatment is identical. */}
        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.25 }}
          className="relative mb-4 lg:mb-5 overflow-hidden rounded-2xl bg-zinc-900/60 p-4 lg:p-6 border border-white/[0.06]"
        >
          {/* Red radial halo — visible everywhere */}
          <div className="absolute -top-20 -right-20 w-56 h-56 lg:w-72 lg:h-72 rounded-full bg-red-500/[0.06] blur-3xl pointer-events-none" />

          <div className="relative flex items-center gap-4 lg:gap-5">
            <div className="relative shrink-0">
              {/* Avatar glow — same on mobile and desktop */}
              <div className="absolute -inset-0.5 rounded-full bg-red-500/20 blur-md" />
              <div className="relative w-16 h-16 lg:w-20 lg:h-20 rounded-full bg-zinc-800 border-2 border-red-400/30 flex items-center justify-center overflow-hidden">
                {tgUser?.photo ? (
                  <img src={tgUser.photo} alt="Avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <User size={28} strokeWidth={1.5} className="text-zinc-400 lg:w-10 lg:h-10" />
                )}
              </div>
            </div>

            <div className="flex-1 min-w-0">
              <h2 className="text-lg lg:text-xl font-semibold text-white truncate">{tgUser?.name || 'User'}</h2>
              {tgUser?.username && (
                <p className="text-zinc-500 text-xs font-mono mt-0.5 truncate">@{tgUser.username}</p>
              )}
              <div className="inline-flex items-center gap-1 px-2 py-0.5 mt-1.5 rounded-full bg-red-500/10 border border-red-400/20">
                <div className="w-1 h-1 rounded-full bg-red-400" />
                <span className="text-red-300 text-[9px] lg:text-[10px] font-medium uppercase tracking-wider">{subscriptionDaysLabel}</span>
              </div>
            </div>
          </div>
        </motion.div>

        {/* SINGLE-COLUMN STACK — same flow on mobile and desktop */}
        <div className="space-y-3 lg:space-y-4">
          {/* Account CTA */}
          <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.12, duration: 0.25 }}>
            <div className={groupCard}>
              <button onClick={() => { haptic('medium'); navigate('account'); }} className={rowBase}>
                <div className="flex items-center gap-2 lg:gap-3">
                  <div className={iconChip('neutral')}>
                    <Settings size={18} strokeWidth={1.5} className="text-zinc-400 lg:text-zinc-300" />
                  </div>
                  <span className="text-zinc-200 font-medium text-sm lg:text-[15px]">{t.accountTitle}</span>
                </div>
                <ChevronRight size={14} strokeWidth={1.5} className="text-zinc-600" />
              </button>
            </div>
          </motion.div>

          {/* App settings group */}
          <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.15, duration: 0.25 }}>
            <h3 className={groupHeader}>{t.app}</h3>
            <div className={groupCard}>
              <button onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')} className={rowBase}>
                <div className="flex items-center gap-2 lg:gap-3">
                  <div className={iconChip('neutral')}>
                    <Globe size={18} strokeWidth={1.5} className="text-zinc-400 lg:text-zinc-300" />
                  </div>
                  <span className="text-zinc-200 font-medium text-sm lg:text-[15px]">{t.lang}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-zinc-500 text-xs lg:text-sm">{lang === 'ru' ? 'Русский' : 'English'}</span>
                  <ChevronRight size={14} strokeWidth={1.5} className="text-zinc-600" />
                </div>
              </button>
              <div className="h-px bg-white/5 mx-3 lg:mx-4" />
              <button onClick={() => navigate('support')} className={rowBase}>
                <div className="flex items-center gap-2 lg:gap-3">
                  <div className={iconChip('neutral')}>
                    <HelpCircle size={18} strokeWidth={1.5} className="text-zinc-400 lg:text-zinc-300" />
                  </div>
                  <span className="text-zinc-200 font-medium text-sm lg:text-[15px]">{t.support}</span>
                </div>
                <ChevronRight size={14} strokeWidth={1.5} className="text-zinc-600" />
              </button>
              <div className="h-px bg-white/5 mx-3 lg:mx-4" />
              <button onClick={handleReferralClick} className={rowBase}>
                <div className="flex items-center gap-2 lg:gap-3">
                  <div className={iconChip('neutral')}>
                    <Gift size={18} strokeWidth={1.5} className="text-zinc-400 lg:text-zinc-300" />
                  </div>
                  <span className="text-zinc-200 font-medium text-sm lg:text-[15px]">{t.referral}</span>
                </div>
                <ChevronRight size={14} strokeWidth={1.5} className="text-zinc-600" />
              </button>
              {authMode !== 'email' && (
              <>
              <div className="h-px bg-white/5 mx-3 lg:mx-4" />
              <button onClick={() => { haptic('medium'); navigate('tgstore'); }} className={`${rowBase} bg-gradient-to-r from-red-500/[0.08] to-transparent`}>
                <div className="flex items-center gap-2 lg:gap-3">
                  <div className={iconChip('red')}>
                    <Star size={18} strokeWidth={1.5} className="text-red-400" />
                  </div>
                  <span className="text-zinc-200 font-medium text-sm lg:text-[15px]">{t.tgStoreTitle}</span>
                </div>
                <ChevronRight size={14} strokeWidth={1.5} className="text-zinc-600" />
              </button>
              </>
              )}
              <div className="h-px bg-white/5 mx-3 lg:mx-4" />
              <button onClick={() => { haptic('medium'); navigate('services'); }} className={`${rowBase} bg-gradient-to-r from-red-500/[0.08] to-transparent`}>
                <div className="flex items-center gap-2 lg:gap-3">
                  <div className={iconChip('red')}>
                    <Globe size={18} strokeWidth={1.5} className="text-red-400" />
                  </div>
                  <span className="text-zinc-200 font-medium text-sm lg:text-[15px]">{t.servicesTitle}</span>
                </div>
                <ChevronRight size={14} strokeWidth={1.5} className="text-zinc-600" />
              </button>
              <div className="h-px bg-white/5 mx-3 lg:mx-4" />
              <button onClick={() => navigate('payments')} className={rowBase}>
                <div className="flex items-center gap-2 lg:gap-3">
                  <div className={iconChip('neutral')}>
                    <CreditCard size={18} strokeWidth={1.5} className="text-zinc-400 lg:text-zinc-300" />
                  </div>
                  <span className="text-zinc-200 font-medium text-sm lg:text-[15px]">{t.payments}</span>
                </div>
                <ChevronRight size={14} strokeWidth={1.5} className="text-zinc-600" />
              </button>
              <div className="h-px bg-white/5 mx-3 lg:mx-4" />
              {/* 2026-05-13: next/link instead of <a target="_blank"> — keeps
                  the legal pages inside the Telegram mini-app webview.
                  Telegram routes any `target="_blank"` link out to the system
                  browser, which broke the in-app feel. */}
              <Link href="/terms" className={rowBase}>
                <div className="flex items-center gap-2 lg:gap-3">
                  <div className={iconChip('neutral')}>
                    <FileText size={18} strokeWidth={1.5} className="text-zinc-400 lg:text-zinc-300" />
                  </div>
                  <span className="text-zinc-200 font-medium text-sm lg:text-[15px]">{t.userAgreement}</span>
                </div>
                <ChevronRight size={14} strokeWidth={1.5} className="text-zinc-600" />
              </Link>
              <div className="h-px bg-white/5 mx-3 lg:mx-4" />
              <Link href="/privacy" className={rowBase}>
                <div className="flex items-center gap-2 lg:gap-3">
                  <div className={iconChip('neutral')}>
                    <Lock size={18} strokeWidth={1.5} className="text-zinc-400 lg:text-zinc-300" />
                  </div>
                  <span className="text-zinc-200 font-medium text-sm lg:text-[15px]">{t.privacyPolicy}</span>
                </div>
                <ChevronRight size={14} strokeWidth={1.5} className="text-zinc-600" />
              </Link>
            </div>
          </motion.div>

          {/* Servers — same column, just below App group */}
          <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.18, duration: 0.25 }}>
            <h3 className={groupHeader}>{t.serversTitle}</h3>
            <div className={groupCard}>
              <button onClick={() => navigate('servers')} className={rowBase}>
                <div className="flex items-center gap-2 lg:gap-3">
                  <div className={iconChip('neutral')}>
                    {/* 2026-05-13: Server (rack icon) replaces Globe — matches
                        the section's semantic better than a generic globe. */}
                    <Server size={18} strokeWidth={1.5} className="text-zinc-400 lg:text-zinc-300" />
                  </div>
                  <span className="text-zinc-200 font-medium text-sm lg:text-[15px]">{t.serversTitle}</span>
                </div>
                <ChevronRight size={14} strokeWidth={1.5} className="text-zinc-600" />
              </button>
            </div>
          </motion.div>

          {/* Admin (only for admin tg ids) */}
          {tgUser && ADMIN_TELEGRAM_IDS.includes(tgUser.id) && (
            <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.21, duration: 0.25 }}>
              <h3 className={groupHeader}>Admin</h3>
              <div className={groupCard}>
                <button onClick={() => navigate('admin')} className={rowBase}>
                  <div className="flex items-center gap-2 lg:gap-3">
                    <div className={iconChip('red')}>
                      <ShieldAlert size={18} strokeWidth={1.5} className="text-red-400" />
                    </div>
                    <span className="text-zinc-200 font-medium text-sm lg:text-[15px]">{t.adminPanel}</span>
                  </div>
                  <ChevronRight size={14} strokeWidth={1.5} className="text-zinc-600" />
                </button>
              </div>
            </motion.div>
          )}

          {/* Logout — back in the main column, same width as everything else */}
          {authMode === 'email' && onLogout && (
            <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.24, duration: 0.25 }}>
              <button onClick={onLogout} className="w-full bg-zinc-900/40 lg:bg-zinc-900/50 border border-white/15 rounded-xl lg:rounded-2xl p-3 lg:p-4 flex items-center justify-center gap-2 hover:bg-red-500/10 hover:border-red-500/30 transition-colors active:scale-[0.98]">
                <LogOut size={16} strokeWidth={1.5} className="text-red-400" />
                <span className="text-red-400 font-medium text-sm lg:text-[15px]">{lang === 'ru' ? 'Выйти' : 'Log out'}</span>
              </button>
            </motion.div>
          )}
        </div>
      </div>
    </motion.div>

    {/* The shared <ReferralModal /> lives at the App root — see App. */}
    </>
  );
}

function AccountView({ t, direction, tgUser, navigate, lang, authMode, userIdentifier, accountBanner, setAccountBanner }: { t: any; direction: number; tgUser: { id: number; name: string; photo: string; username?: string } | null; navigate: (tab: Tab) => void; lang: 'ru' | 'en'; authMode?: AuthMode; userIdentifier: UserIdentifier | null; accountBanner: { type: 'success' | 'error'; message: string } | null; setAccountBanner: (b: { type: 'success' | 'error'; message: string } | null) => void }) {
  const [account, setAccount] = useState<{ id: number; telegramId: number | null; email: string | null; emailVerified: boolean; googleId: string | null; username: string | null; firstName: string | null; lastName: string | null; photoUrl: string | null; authType: string; createdAt: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [emailEditMode, setEmailEditMode] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [verifyMode, setVerifyMode] = useState(false);
  const [verifyCode, setVerifyCode] = useState('');

  const fetchAccount = useCallback(async () => {
    if (!userIdentifier) return;
    setLoading(true);
    try {
      const query = userIdentifier.type === 'telegram'
        ? `telegramId=${userIdentifier.telegramId}`
        : `userId=${userIdentifier.userId}`;
      const res = await fetch(`/api/auth/account?${query}`);
      const data = await res.json();
      if (data.ok) setAccount(data.account);
    } catch { /* ignore */ }
    setLoading(false);
  }, [userIdentifier]);

  useEffect(() => { fetchAccount(); }, [fetchAccount]);

  const doAction = async (action: string, extra: Record<string, string> = {}) => {
    if (!userIdentifier) return;
    setActionLoading(true);
    setError('');
    setSuccess('');
    try {
      const body: Record<string, any> = { action, ...extra };
      if (userIdentifier.type === 'telegram') body.telegramId = userIdentifier.telegramId;
      else body.userId = userIdentifier.userId;

      const res = await fetch('/api/auth/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        setSuccess(data.message || t.accountSuccess);
        await fetchAccount();
        return true;
      } else {
        if (data.error === 'EMAIL_TAKEN') setError(t.accountEmailTaken);
        else if (data.error === 'TELEGRAM_TAKEN') setError(t.accountTelegramTaken);
        else if (data.error === 'LAST_AUTH_METHOD') setError(lang === 'ru'
          ? 'Это единственный способ входа. Сначала привяжите другой метод авторизации.'
          : "It's your only sign-in method. Link another auth method first.");
        else if (data.error === 'NOT_LINKED') setError(lang === 'ru'
          ? 'Аккаунт не привязан'
          : 'Account is not linked');
        else if (data.error === 'CANNOT_UNLINK_PRIMARY') setError(lang === 'ru'
          ? 'Нельзя отвязать основной метод входа'
          : "Can't unlink primary sign-in method");
        else setError(data.error || t.accountError);
        return false;
      }
    } catch {
      setError(t.accountError);
      return false;
    } finally {
      setActionLoading(false);
    }
  };

  const handleLinkEmail = async () => {
    if (!newEmail.trim()) return;
    const ok = await doAction('link_email', { email: newEmail.trim() });
    if (ok) { setEmailEditMode(false); setNewEmail(''); }
  };

  const handleSendVerifyCode = async () => {
    const ok = await doAction('verify_email_send');
    if (ok) setVerifyMode(true);
  };

  const handleVerifyCode = async () => {
    if (!verifyCode.trim()) return;
    const ok = await doAction('verify_email_code', { code: verifyCode.trim() });
    if (ok) { setVerifyMode(false); setVerifyCode(''); }
  };

  // Unlink Google account from current user.
  // Shows a confirm dialog, calls the 'unlink_google' action, refreshes state.
  // Server-side enforces that at least one other auth method (telegram or
  // verified email-login) remains — otherwise returns LAST_AUTH_METHOD.
  const [unlinkingGoogle, setUnlinkingGoogle] = useState(false);
  const handleUnlinkGoogle = async () => {
    if (!account?.googleId) return;
    const confirmMsg = lang === 'ru'
      ? `Отвязать Google-аккаунт${account.email ? ` (${account.email})` : ''}? После этого вход через Google работать не будет.`
      : `Unlink Google account${account.email ? ` (${account.email})` : ''}? You won't be able to sign in with Google anymore.`;
    if (typeof window !== 'undefined' && !window.confirm(confirmMsg)) return;

    setUnlinkingGoogle(true);
    setError('');
    setSuccess('');
    try {
      const ok = await doAction('unlink_google');
      if (ok) {
        setAccountBanner({
          type: 'success',
          message: lang === 'ru' ? 'Google-аккаунт отвязан' : 'Google account unlinked',
        });
      }
    } finally {
      setUnlinkingGoogle(false);
    }
  };

  // Link Telegram to an email/google-registered user.
  // Opens Telegram OIDC flow via /api/auth/telegram/start-link?link=<session>.
  // Callback will set telegram_id on the user and redirect back with account_success.
  const handleLinkTelegram = () => {
    if (typeof window === 'undefined') return;
    if (account?.authType === 'telegram') return;
    setError('');
    setSuccess('');

    const session = localStorage.getItem('hvpn_session');
    if (!session) {
      setError(lang === 'ru' ? 'Сессия не найдена, войдите заново' : 'Session not found, please sign in again');
      return;
    }

    const base = window.location.origin;
    const url = `${base}/api/auth/telegram/start-link?link=${encodeURIComponent(session)}`;
    window.location.href = url;
  };

  // Unlink Email from the current user (only for telegram/google-registered users).
  const [unlinkingEmail, setUnlinkingEmail] = useState(false);
  const handleUnlinkEmail = async () => {
    if (!account?.email || account?.authType === 'email') return;
    const confirmMsg = lang === 'ru'
      ? `Отвязать почту${account.email ? ` (${account.email})` : ''}? Вход через почту перестанет работать.`
      : `Unlink email${account.email ? ` (${account.email})` : ''}? You won't be able to sign in with email anymore.`;
    if (typeof window !== 'undefined' && !window.confirm(confirmMsg)) return;

    setUnlinkingEmail(true);
    setError('');
    setSuccess('');
    try {
      const ok = await doAction('unlink_email');
      if (ok) {
        setAccountBanner({
          type: 'success',
          message: lang === 'ru' ? 'Почта отвязана' : 'Email unlinked',
        });
      }
    } finally {
      setUnlinkingEmail(false);
    }
  };

  // Permanently delete the account.
  // Only available to email-registered users (auth_type === 'email').
  // Requires the user to type a confirmation phrase. On success, clears the
  // local session and redirects to /login. Backend cascade-removes all
  // related rows (subscriptions, vpn_keys, payments, devices, tickets, etc.)
  // and triggers an Xray sync so released UUIDs flip back to the pool.
  const [deletingAccount, setDeletingAccount] = useState(false);
  const handleDeleteAccount = async () => {
    if (account?.authType !== 'email') return;
    if (typeof window === 'undefined') return;

    const input = window.prompt(t.accountDeleteConfirmPrompt);
    if (input === null) return; // user pressed Cancel
    if (input.trim() !== t.accountDeleteConfirmWord) {
      setError(t.accountDeleteCancelled);
      return;
    }

    setDeletingAccount(true);
    setError('');
    setSuccess('');
    try {
      const ok = await doAction('delete_account');
      if (ok) {
        try { localStorage.removeItem('hvpn_session'); } catch { /* ignore */ }
        window.location.href = '/login';
      } else {
        setError(t.accountDeleteError);
      }
    } catch {
      setError(t.accountDeleteError);
    } finally {
      setDeletingAccount(false);
    }
  };

  // Unlink Telegram from the current user (only for email/google-registered users).
  const [unlinkingTelegram, setUnlinkingTelegram] = useState(false);
  const handleUnlinkTelegram = async () => {
    if (!account?.telegramId || account?.authType === 'telegram') return;
    const confirmMsg = lang === 'ru'
      ? `Отвязать Telegram${account.username ? ` (@${account.username})` : ''}? Вход через Telegram перестанет работать.`
      : `Unlink Telegram${account.username ? ` (@${account.username})` : ''}? You won't be able to sign in with Telegram anymore.`;
    if (typeof window !== 'undefined' && !window.confirm(confirmMsg)) return;

    setUnlinkingTelegram(true);
    setError('');
    setSuccess('');
    try {
      const ok = await doAction('unlink_telegram');
      if (ok) {
        setAccountBanner({
          type: 'success',
          message: lang === 'ru' ? 'Telegram отвязан' : 'Telegram unlinked',
        });
      }
    } finally {
      setUnlinkingTelegram(false);
    }
  };

  // Link Google account to currently logged-in user.
  //
  // Two routing decisions:
  //  1. Which identifier → server: Telegram users → ?linkTg=<tgId>; Email/Google → ?link=<session>.
  //  2. How to open OAuth: inside Telegram Mini App — we MUST open in the system browser
  //     via Telegram.WebApp.openLink(), because Google's OAuth refuses embedded WebViews
  //     with "disallowed_useragent" (403). In a regular browser — just navigate there.
  //
  // After the OAuth flow completes in the external browser, the callback redirects to
  // hundlervpn.xyz/?account_success=..., which the user will see in that browser.
  // When they come back to the Mini App, our polling effect below will pick up the fresh
  // account state and show the "Linked" badge + success banner automatically.
  const handleLinkGoogle = () => {
    if (typeof window === 'undefined') return;
    setError('');
    setSuccess('');

    const base = window.location.origin;
    let url: string;

    if (userIdentifier?.type === 'telegram') {
      url = `${base}/api/auth/google/start?linkTg=${encodeURIComponent(String(userIdentifier.telegramId))}`;
    } else {
      const session = localStorage.getItem('hvpn_session');
      if (!session) {
        setError(lang === 'ru' ? 'Сессия не найдена, войдите заново' : 'Session not found, please sign in again');
        return;
      }
      url = `${base}/api/auth/google/start?link=${encodeURIComponent(session)}`;
    }

    const tg = typeof window !== 'undefined' ? window.Telegram?.WebApp : null;
    if (tg && typeof tg.openLink === 'function') {
      // Inside Mini App → system browser (required by Google OAuth)
      tg.openLink(url);
      setSuccess(lang === 'ru'
        ? 'Продолжите вход в открывшемся браузере. После успеха вернитесь в Telegram — статус обновится автоматически.'
        : 'Continue sign-in in the opened browser. Once done, come back to Telegram — the status will update automatically.'
      );
      setPollingForGoogle(true);
      return;
    }

    // Regular browser — normal same-window redirect
    window.location.href = url;
  };

  // Poll account state after user initiated OAuth in external browser.
  // Stops when googleId appears or after 2 minutes.
  const [pollingForGoogle, setPollingForGoogle] = useState(false);
  useEffect(() => {
    if (!pollingForGoogle) return;
    const startedAt = Date.now();
    const MAX_MS = 120000; // 2 minutes
    const interval = setInterval(async () => {
      if (!userIdentifier) return;
      try {
        const query = userIdentifier.type === 'telegram'
          ? `telegramId=${userIdentifier.telegramId}`
          : `userId=${userIdentifier.userId}`;
        const res = await fetch(`/api/auth/account?${query}`);
        const data = await res.json();
        if (data.ok && data.account?.googleId) {
          setAccount(data.account);
          const linkedEmail = data.account.email ? ` (${data.account.email})` : '';
          setAccountBanner({
            type: 'success',
            message: (lang === 'ru' ? 'Google-аккаунт привязан' : 'Google account linked') + linkedEmail,
          });
          setSuccess('');
          setPollingForGoogle(false);
        }
      } catch { /* ignore */ }
      if (Date.now() - startedAt > MAX_MS) {
        setPollingForGoogle(false);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [pollingForGoogle, userIdentifier, lang, setAccountBanner]);

  // Auto-dismiss the result banner. Give users more time to read errors than success.
  useEffect(() => {
    if (!accountBanner) return;
    const ms = accountBanner.type === 'error' ? 10000 : 5000;
    const timer = setTimeout(() => setAccountBanner(null), ms);
    return () => clearTimeout(timer);
  }, [accountBanner, setAccountBanner]);

  const showEmailForm = emailEditMode || (!account?.email);
  const canChangeEmail = account && account.email && !account.emailVerified;

  // Friendly "registered via" label covering telegram/email/google.
  const authTypeLabel =
    account?.authType === 'telegram' ? 'Telegram' :
    account?.authType === 'google' ? 'Google' :
    account?.authType === 'email' ? (lang === 'ru' ? 'Email' : 'Email') : '—';

  return (
    <motion.div custom={direction} variants={pageVariants} initial="initial" animate="animate" exit="exit" className="flex flex-col flex-1 items-center">
      <div className="w-full max-w-xs lg:max-w-[900px]">
        <button onClick={() => navigate('profile')} className="mb-4 text-zinc-400 hover:text-white text-xs lg:text-sm inline-flex items-center gap-1.5 transition-colors">
          <ChevronLeft size={14} strokeWidth={1.5} />
          {t.accountBackToProfile}
        </button>

        {/* Page title */}
        <div className="mb-5 lg:mb-6">
          <h1 className="text-white font-bold text-xl lg:text-2xl tracking-tight">{t.accountTitle}</h1>
          <p className="text-zinc-500 text-xs lg:text-sm mt-1">{t.accountSectionSubtitle}</p>
        </div>

        {/* Result banner (from Google link flow redirect) */}
        <AnimatePresence>
          {accountBanner && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className={`mb-4 rounded-xl px-4 py-3 flex items-start gap-2.5 border ${
                accountBanner.type === 'success'
                  ? 'bg-white/[0.04] border-white/[0.10]'
                  : 'bg-red-500/[0.06] border-red-500/20'
              }`}
            >
              {accountBanner.type === 'success'
                ? <CheckCircle2 size={16} className="text-white shrink-0 mt-0.5" />
                : <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
              }
              <p className={`text-xs lg:text-sm leading-snug ${accountBanner.type === 'success' ? 'text-zinc-200' : 'text-red-300'}`}>
                {accountBanner.message}
              </p>
              <button
                onClick={() => setAccountBanner(null)}
                className="ml-auto text-zinc-500 hover:text-white -mr-1"
                aria-label="close"
              >
                <X size={14} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {loading ? (
          <div className="flex justify-center py-16"><RefreshCw size={20} className="animate-spin text-zinc-600" /></div>
        ) : account ? (
          <div className="space-y-4">

            {/* Profile card — same premium look as ProfileView hero
                (red halo + red avatar glow/ring + neutral stat chips). */}
            <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.05, duration: 0.25 }}>
              <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-zinc-900/60 p-4 lg:p-6">
                {/* Red radial halo */}
                <div className="absolute -top-20 -right-20 w-56 h-56 lg:w-72 lg:h-72 rounded-full bg-red-500/[0.06] blur-3xl pointer-events-none" />

                <div className="relative flex items-center gap-4 lg:gap-5 mb-4 lg:mb-5">
                  <div className="relative shrink-0">
                    <div className="absolute -inset-0.5 rounded-full bg-red-500/20 blur-md" />
                    <div className="relative w-14 h-14 lg:w-16 lg:h-16 rounded-full bg-zinc-800 border-2 border-red-400/30 flex items-center justify-center overflow-hidden">
                      {account.photoUrl ? (
                        <img src={account.photoUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <User size={24} strokeWidth={1.5} className="text-zinc-400" />
                      )}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-white font-semibold text-base lg:text-lg truncate">{account.firstName || account.username || 'User'}</h2>
                    <p className="text-zinc-500 text-xs lg:text-sm font-mono mt-0.5 truncate">{account.username ? `@${account.username}` : `ID #${account.id}`}</p>
                  </div>
                </div>
                <div className="relative flex gap-3 lg:gap-4">
                  <div className="flex-1 bg-white/[0.03] rounded-xl px-3.5 lg:px-4 py-2.5 lg:py-3 border border-white/[0.06]">
                    <p className="text-zinc-500 text-[9px] lg:text-[10px] uppercase tracking-[0.15em] mb-1">{t.accountRegisteredVia}</p>
                    <p className="text-white text-xs lg:text-sm font-medium">{authTypeLabel}</p>
                  </div>
                  <div className="flex-1 bg-white/[0.03] rounded-xl px-3.5 lg:px-4 py-2.5 lg:py-3 border border-white/[0.06]">
                    <p className="text-zinc-500 text-[9px] lg:text-[10px] uppercase tracking-[0.15em] mb-1">{t.accountCreatedAt}</p>
                    <p className="text-white text-xs lg:text-sm font-medium">{new Date(account.createdAt).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB')}</p>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Section header: sign-in methods */}
            <div className="flex items-end justify-between px-1 pt-2">
              <h3 className="text-zinc-300 font-semibold text-sm lg:text-base tracking-tight">{t.accountSectionTitle}</h3>
              <span className="text-zinc-600 text-[10px] lg:text-xs uppercase tracking-wider">
                {[account.telegramId, account.googleId, account.email && account.emailVerified].filter(Boolean).length}/3
              </span>
            </div>

            {/* Telegram section */}
            <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.1, duration: 0.25 }}>
              <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/50 overflow-hidden">
                <div className="px-4 lg:px-5 py-3.5 lg:py-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 lg:gap-3 min-w-0">
                    <div className="w-9 h-9 lg:w-10 lg:h-10 rounded-xl bg-[#2AABEE]/10 flex items-center justify-center shrink-0">
                      <Send size={15} strokeWidth={1.75} className="text-[#2AABEE]" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-white text-sm lg:text-base font-medium">Telegram</p>
                      <p className="text-zinc-500 text-[11px] lg:text-sm truncate">
                        {account.telegramId
                          ? (account.username ? `@${account.username}` : `ID: ${account.telegramId}`)
                          : (lang === 'ru' ? 'Вход через Telegram' : 'Sign in with Telegram')}
                      </p>
                    </div>
                  </div>
                  {account.telegramId ? (
                    <div className="flex items-center gap-1.5 bg-white/[0.06] px-2.5 lg:px-3 py-1 lg:py-1.5 rounded-full border border-white/[0.10] shrink-0">
                      <div className="w-1.5 h-1.5 rounded-full bg-white" />
                      <span className="text-white text-[10px] lg:text-xs font-semibold uppercase tracking-wider">{t.accountLinked}</span>
                    </div>
                  ) : (
                    <span className="text-zinc-500 text-[10px] lg:text-xs font-medium bg-white/[0.02] border border-white/[0.05] px-2.5 lg:px-3 py-1 lg:py-1.5 rounded-full shrink-0">{t.accountNotLinked}</span>
                  )}
                </div>
                {/* Link / Unlink Telegram — only for email/google-registered users */}
                {account.authType !== 'telegram' && (
                  !account.telegramId ? (
                    <div className="px-4 lg:px-5 pb-3.5 lg:pb-4 space-y-2">
                      <button
                        onClick={handleLinkTelegram}
                        disabled={actionLoading}
                        className="w-full flex items-center justify-center gap-2 bg-[#2AABEE] hover:bg-[#229ED9] text-white text-sm lg:text-base py-2.5 lg:py-3 rounded-xl font-medium transition-all active:scale-[0.98] disabled:opacity-50"
                      >
                        <Link2 size={15} strokeWidth={2} />
                        {lang === 'ru' ? 'Привязать Telegram' : 'Link Telegram'}
                      </button>
                      <p className="text-amber-200/60 text-[10px] lg:text-[11px] leading-relaxed text-center">
                        {lang === 'ru'
                          ? 'В России может потребоваться VPN — домен oauth.telegram.org блокируется'
                          : 'In Russia you may need a VPN — oauth.telegram.org is blocked'}
                      </p>
                    </div>
                  ) : (
                    <div className="px-4 lg:px-5 pb-3.5 lg:pb-4">
                      <button
                        onClick={handleUnlinkTelegram}
                        disabled={unlinkingTelegram || actionLoading}
                        className="w-full flex items-center justify-center gap-2 bg-white/[0.04] hover:bg-red-500/10 text-zinc-400 hover:text-red-300 text-sm lg:text-base py-2.5 lg:py-3 rounded-xl font-medium transition-all active:scale-[0.98] disabled:opacity-50 border border-white/[0.06] hover:border-red-500/20"
                      >
                        {unlinkingTelegram
                          ? (lang === 'ru' ? 'Отвязываю…' : 'Unlinking…')
                          : (lang === 'ru' ? 'Отвязать Telegram' : 'Unlink Telegram')}
                      </button>
                    </div>
                  )
                )}
              </div>
            </motion.div>

            {/* Google section */}
            <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.13, duration: 0.25 }}>
              <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/50 overflow-hidden">
                <div className="px-4 lg:px-5 py-3.5 lg:py-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 lg:gap-3 min-w-0">
                    <div className="w-9 h-9 lg:w-10 lg:h-10 rounded-xl bg-white flex items-center justify-center shrink-0">
                      <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
                        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <p className="text-white text-sm lg:text-base font-medium">Google</p>
                      <p className="text-zinc-500 text-[11px] lg:text-sm truncate">
                        {account.googleId
                          ? (account.email || (lang === 'ru' ? 'Аккаунт привязан' : 'Account linked'))
                          : (lang === 'ru' ? 'Вход одним кликом' : 'One-click sign in')}
                      </p>
                    </div>
                  </div>
                  {account.googleId ? (
                    <div className="flex items-center gap-1.5 bg-white/[0.06] px-2.5 lg:px-3 py-1 lg:py-1.5 rounded-full border border-white/[0.10] shrink-0">
                      <div className="w-1.5 h-1.5 rounded-full bg-white" />
                      <span className="text-white text-[10px] lg:text-xs font-semibold uppercase tracking-wider">{t.accountLinked}</span>
                    </div>
                  ) : (
                    <span className="text-zinc-500 text-[10px] lg:text-xs font-medium bg-white/[0.02] border border-white/[0.05] px-2.5 lg:px-3 py-1 lg:py-1.5 rounded-full shrink-0">{t.accountNotLinked}</span>
                  )}
                </div>
                {!account.googleId ? (
                  <div className="px-4 lg:px-5 pb-3.5 lg:pb-4">
                    <button
                      onClick={handleLinkGoogle}
                      disabled={actionLoading}
                      className="w-full flex items-center justify-center gap-2 bg-white hover:bg-zinc-100 text-zinc-900 text-sm lg:text-base py-2.5 lg:py-3 rounded-xl font-medium transition-all active:scale-[0.98] disabled:opacity-50"
                    >
                      <Link2 size={15} strokeWidth={2} />
                      {t.accountLinkGoogle}
                    </button>
                  </div>
                ) : (
                  <div className="px-4 lg:px-5 pb-3.5 lg:pb-4">
                    <button
                      onClick={handleUnlinkGoogle}
                      disabled={unlinkingGoogle || actionLoading}
                      className="w-full flex items-center justify-center gap-2 bg-white/[0.04] hover:bg-red-500/10 text-zinc-400 hover:text-red-300 text-sm lg:text-base py-2.5 lg:py-3 rounded-xl font-medium transition-all active:scale-[0.98] disabled:opacity-50 border border-white/[0.06] hover:border-red-500/20"
                    >
                      {unlinkingGoogle
                        ? (lang === 'ru' ? 'Отвязываю…' : 'Unlinking…')
                        : (lang === 'ru' ? 'Отвязать Google' : 'Unlink Google')}
                    </button>
                  </div>
                )}
              </div>
            </motion.div>

            {/* Email section */}
            <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.16, duration: 0.25 }}>
              <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/50 overflow-hidden">
                <div className="px-4 lg:px-5 py-3.5 lg:py-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 lg:gap-3 min-w-0">
                    <div className="w-9 h-9 lg:w-10 lg:h-10 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0">
                      <Mail size={15} strokeWidth={1.75} className="text-red-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-white text-sm lg:text-base font-medium">{t.accountEmail}</p>
                      <p className="text-zinc-500 text-[11px] lg:text-sm truncate">
                        {account.email && !emailEditMode
                          ? account.email
                          : (lang === 'ru' ? 'Резервный способ входа' : 'Fallback sign-in method')}
                      </p>
                    </div>
                  </div>
                  {account.email && account.emailVerified ? (
                    <div className="flex items-center gap-1.5 bg-white/[0.06] px-2.5 lg:px-3 py-1 lg:py-1.5 rounded-full border border-white/[0.10] shrink-0">
                      <div className="w-1.5 h-1.5 rounded-full bg-white" />
                      <span className="text-white text-[10px] lg:text-xs font-semibold uppercase tracking-wider">{t.accountVerified}</span>
                    </div>
                  ) : account.email && !account.emailVerified ? (
                    <span className="text-red-300 text-[10px] lg:text-xs font-medium bg-red-500/10 px-2.5 lg:px-3 py-1 lg:py-1.5 rounded-full border border-red-500/20 shrink-0">{t.accountNotVerified}</span>
                  ) : (
                    <span className="text-zinc-500 text-[10px] lg:text-xs font-medium bg-white/[0.02] border border-white/[0.05] px-2.5 lg:px-3 py-1 lg:py-1.5 rounded-full shrink-0">{t.accountNotLinked}</span>
                  )}
                </div>

                {/* Email actions area */}
                {!account.emailVerified && !verifyMode && (
                  <div className="px-4 lg:px-5 pb-3 lg:pb-4">
                    {(showEmailForm || emailEditMode) && (
                      <div className="space-y-2.5 lg:space-y-3">
                        <input
                          type="email"
                          value={newEmail}
                          onChange={(e) => setNewEmail(e.target.value)}
                          placeholder="email@example.com"
                          className="w-full bg-black/30 border border-white/[0.08] rounded-xl px-3.5 lg:px-4 py-2.5 lg:py-3.5 text-sm lg:text-base text-white placeholder-zinc-600 focus:outline-none focus:border-red-500/30 transition-colors"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={handleLinkEmail}
                            disabled={actionLoading || !newEmail.trim()}
                            className="flex-1 bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white text-sm lg:text-base py-2.5 lg:py-3.5 rounded-xl disabled:opacity-40 transition-all font-medium"
                          >
                            {actionLoading ? t.accountLinking : t.accountLink}
                          </button>
                          {canChangeEmail && (
                            <button
                              onClick={() => { setEmailEditMode(false); setNewEmail(''); }}
                              className="px-4 py-2.5 lg:py-3.5 text-zinc-500 text-sm lg:text-base bg-white/[0.03] rounded-xl border border-white/[0.06] hover:text-zinc-300 transition-colors"
                            >
                              {lang === 'ru' ? 'Отмена' : 'Cancel'}
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {account.email && !emailEditMode && !account.emailVerified && (
                      <div className="space-y-2 lg:space-y-3">
                        <button
                          onClick={handleSendVerifyCode}
                          disabled={actionLoading}
                          className="w-full bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white text-sm lg:text-base py-2.5 lg:py-3.5 rounded-xl disabled:opacity-40 transition-all font-medium"
                        >
                          {t.accountSendCode}
                        </button>
                        <button
                          onClick={() => { setEmailEditMode(true); setNewEmail(account.email || ''); }}
                          className="w-full text-zinc-500 text-xs lg:text-sm hover:text-zinc-300 transition-colors py-1"
                        >
                          {lang === 'ru' ? 'Изменить почту' : 'Change email'}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Unlink email — only for users who registered via telegram/google */}
                {account.email && account.authType !== 'email' && !emailEditMode && !verifyMode && (
                  <div className="px-4 lg:px-5 pb-3.5 lg:pb-4">
                    <button
                      onClick={handleUnlinkEmail}
                      disabled={unlinkingEmail || actionLoading}
                      className="w-full flex items-center justify-center gap-2 bg-white/[0.04] hover:bg-red-500/10 text-zinc-400 hover:text-red-300 text-sm lg:text-base py-2.5 lg:py-3 rounded-xl font-medium transition-all active:scale-[0.98] disabled:opacity-50 border border-white/[0.06] hover:border-red-500/20"
                    >
                      {unlinkingEmail
                        ? (lang === 'ru' ? 'Отвязываю…' : 'Unlinking…')
                        : (lang === 'ru' ? 'Отвязать почту' : 'Unlink email')}
                    </button>
                  </div>
                )}

                {/* Verify code form */}
                {verifyMode && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="px-4 lg:px-5 pb-3 lg:pb-4">
                    <div className="space-y-2.5 lg:space-y-3">
                      <p className="text-zinc-500 text-[11px] lg:text-sm">{t.accountCodeSent}</p>
                      <input
                        type="text"
                        value={verifyCode}
                        onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="000000"
                        maxLength={6}
                        className="w-full bg-black/30 border border-white/[0.08] rounded-xl px-3.5 lg:px-4 py-3 lg:py-4 text-base lg:text-lg text-white text-center tracking-[8px] placeholder-zinc-700 focus:outline-none focus:border-red-500/30 transition-colors font-mono"
                      />
                      <button
                        onClick={handleVerifyCode}
                        disabled={actionLoading || verifyCode.length !== 6}
                        className="w-full bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white text-sm lg:text-base py-2.5 lg:py-3.5 rounded-xl disabled:opacity-40 transition-all font-medium"
                      >
                        {t.accountVerify}
                      </button>
                    </div>
                  </motion.div>
                )}
              </div>
            </motion.div>

            {/* Inline status messages (from local actions like email verify) */}
            <AnimatePresence>
              {error && (
                <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-xl border border-red-500/20 bg-red-500/[0.06] px-4 py-2.5 flex items-start gap-2">
                  <AlertCircle size={14} className="text-red-400 shrink-0 mt-0.5" />
                  <p className="text-red-300 text-xs lg:text-sm leading-snug">{error}</p>
                </motion.div>
              )}
              {success && (
                <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-xl border border-white/[0.10] bg-white/[0.04] px-4 py-2.5 flex items-start gap-2">
                  <CheckCircle2 size={14} className="text-white shrink-0 mt-0.5" />
                  <p className="text-zinc-200 text-xs lg:text-sm leading-snug">{success}</p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Info hint: one email = one account */}
            <div className="flex items-start gap-2 px-1 pt-2 pb-4">
              <Shield size={12} className="text-zinc-600 shrink-0 mt-0.5" />
              <p className="text-zinc-600 text-[11px] lg:text-xs leading-relaxed">
                {t.accountGoogleHint}
              </p>
            </div>

            {/* Danger zone — only for email-registered users */}
            {account.authType === 'email' && (
              <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.22, duration: 0.25 }} className="pt-2">
                <div className="flex items-end justify-between px-1 mb-3">
                  <h3 className="text-red-300/80 font-semibold text-sm lg:text-base tracking-tight uppercase">{t.accountDangerTitle}</h3>
                </div>
                <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.04] overflow-hidden">
                  <div className="px-4 lg:px-5 py-4 lg:py-5">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="w-9 h-9 lg:w-10 lg:h-10 rounded-xl bg-red-500/15 flex items-center justify-center shrink-0">
                        <Trash2 size={15} strokeWidth={1.75} className="text-red-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-white text-sm lg:text-base font-medium">{t.accountDeleteTitle}</p>
                        <p className="text-zinc-400 text-[11px] lg:text-sm leading-relaxed mt-1">{t.accountDeleteDescription}</p>
                      </div>
                    </div>
                    <button
                      onClick={handleDeleteAccount}
                      disabled={deletingAccount || actionLoading}
                      className="w-full flex items-center justify-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-300 hover:text-red-200 text-sm lg:text-base py-2.5 lg:py-3 rounded-xl font-medium transition-all active:scale-[0.98] disabled:opacity-50 border border-red-500/30 hover:border-red-500/50"
                    >
                      <Trash2 size={14} strokeWidth={2} />
                      {deletingAccount ? t.accountDeleting : t.accountDeleteButton}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        ) : (
          <p className="text-zinc-600 text-sm text-center py-12">{t.accountError}</p>
        )}
      </div>
    </motion.div>
  );
}

function PaymentsHistoryView({ t, direction, tgUser, navigate, lang }: { t: any; direction: number; tgUser: { id: number; name: string; photo: string; username?: string } | null; navigate: (tab: Tab) => void; lang: 'ru' | 'en' }) {
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [payments, setPayments] = useState<{ id: number; amount: string; currency: string; status: string; provider: string; paid_at: string | null; created_at: string }[]>([]);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      if (!tgUser?.id) {
        if (isMounted) setPayments([]);
        return;
      }

      setPaymentsLoading(true);
      try {
        const res = await fetch(`/api/users/payments?telegramId=${encodeURIComponent(String(tgUser.id))}`);
        if (!res.ok) {
          if (isMounted) setPayments([]);
          return;
        }
        const data = await res.json();
        if (isMounted) setPayments(data.payments ?? []);
      } catch {
        if (isMounted) setPayments([]);
      } finally {
        if (isMounted) setPaymentsLoading(false);
      }
    };

    void load();
    return () => {
      isMounted = false;
    };
  }, [tgUser?.id]);

  return (
    <motion.div custom={direction} variants={pageVariants} initial="initial" animate="animate" exit="exit" className="flex flex-col flex-1 items-center w-full">
      <div className="w-full max-w-xs lg:max-w-[900px]">
        <button onClick={() => navigate('profile')} className="mb-3 text-zinc-300 hover:text-white text-sm inline-flex items-center gap-2">
          <ChevronRight size={14} className="rotate-180" /> {t.backToProfile}
        </button>

        <div className="rounded-2xl border border-white/10 bg-zinc-900/40 p-4">
          <h3 className="text-lg font-bold text-white mb-4">{t.paymentsHistoryTitle}</h3>

          {paymentsLoading ? (
            <div className="text-center py-8 text-zinc-400 text-sm">Загрузка...</div>
          ) : payments.length === 0 ? (
            <div className="text-center py-8 text-zinc-400 text-sm">{t.noPaymentsYet}</div>
          ) : (
            <div className="space-y-2">
              {payments.map((payment) => {
                // Status -> color + i18n label.
                // Semantic colors are an explicit exception to the dark+white+red
                // palette: success/error/warning need to be instantly readable
                // and the green/red/yellow language is universal for payments.
                const s = (payment.status || '').toLowerCase();
                const isPaid = s === 'paid' || s === 'success' || s === 'completed';
                const isFailed = s === 'failed' || s === 'cancelled' || s === 'canceled' || s === 'expired' || s === 'error';
                const isPending = s === 'pending' || s === 'awaiting_payment' || s === 'awaiting' || s === 'processing' || s === 'created';
                const cls = isPaid
                  ? 'bg-green-500/15 text-green-400 border-green-500/25'
                  : isFailed
                    ? 'bg-red-500/15 text-red-400 border-red-500/25'
                    : isPending
                      ? 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25'
                      : 'bg-white/[0.06] text-zinc-400 border-white/[0.08]';
                const label = isPaid
                  ? (lang === 'ru' ? 'Оплачено' : 'Paid')
                  : isFailed
                    ? (lang === 'ru' ? 'Отклонено' : 'Failed')
                    : isPending
                      ? (lang === 'ru' ? 'В обработке' : 'Pending')
                      : payment.status;
                return (
                  <div key={payment.id} className="rounded-xl border border-white/10 bg-zinc-900/60 p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-white font-medium text-sm">{Number(payment.amount)} {payment.currency}</span>
                      <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${cls}`}>{label}</span>
                    </div>
                    <div className="text-[11px] text-zinc-400">{payment.provider}</div>
                    <div className="text-[10px] text-zinc-500 mt-1 flex items-center gap-1">
                      <Calendar size={11} />
                      {new Date(payment.paid_at || payment.created_at).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-GB')}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

type ServiceRequest = {
  id: number;
  service_name: string;
  description: string | null;
  amount: string | null;
  currency: string;
  status: string;
  message_count: string;
  created_at: string;
  updated_at: string;
};

type ServiceMessage = {
  id: number;
  request_id: number;
  sender_type: 'user' | 'admin';
  message: string;
  created_at: string;
};

function ServicesView({ t, direction, tgUser, navigate, lang, onHideNav }: { t: any; direction: number; tgUser: { id: number; name: string; photo: string; username?: string } | null; navigate: (tab: Tab) => void; lang: 'ru' | 'en'; onHideNav?: (hide: boolean) => void }) {
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [serviceName, setServiceName] = useState('');
  const [description, setDescription] = useState('');
  const [sending, setSending] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<ServiceRequest | null>(null);
  const [messages, setMessages] = useState<ServiceMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [paying, setPaying] = useState(false);

  const loadRequests = useCallback(async () => {
    if (!tgUser?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/services?telegramId=${tgUser.id}`);
      if (res.ok) {
        const data = await res.json();
        setRequests(data.requests || []);
      }
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [tgUser?.id]);

  // Hide navigation when in chat
  useEffect(() => {
    onHideNav?.(!!selectedRequest);
    return () => onHideNav?.(false);
  }, [selectedRequest, onHideNav]);

  const loadMessages = async (req: ServiceRequest) => {
    if (!tgUser?.id) return;
    setMessagesLoading(true);
    try {
      const res = await fetch(`/api/services/messages?telegramId=${tgUser.id}&requestId=${req.id}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
        if (data.request) setSelectedRequest(data.request);
      }
    } catch { /* ignore */ } finally { setMessagesLoading(false); }
  };

  useEffect(() => { loadRequests(); }, [loadRequests]);

  const handleCreate = async () => {
    haptic('medium');
    if (!tgUser?.id || !serviceName.trim()) return;
    setSending(true);
    try {
      const res = await fetch('/api/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: tgUser.id, serviceName: serviceName.trim(), description: description.trim() }),
      });
      if (res.ok) {
        setServiceName('');
        setDescription('');
        setShowForm(false);
        await loadRequests();
      }
    } catch { /* ignore */ } finally { setSending(false); }
  };

  const handleSendMessage = async () => {
    haptic('light');
    if (!tgUser?.id || !selectedRequest || !replyText.trim()) return;
    try {
      await fetch('/api/services/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: tgUser.id, requestId: selectedRequest.id, message: replyText.trim() }),
      });
      setReplyText('');
      await loadMessages(selectedRequest);
    } catch { /* ignore */ }
  };

  const handlePay = async () => {
    haptic('heavy');
    if (!tgUser?.id || !selectedRequest) return;
    setPaying(true);
    try {
      const res = await fetch('/api/services/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: tgUser.id, requestId: selectedRequest.id }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.paymentUrl) {
          if (window.Telegram?.WebApp?.openLink) {
            window.Telegram.WebApp.openLink(data.paymentUrl);
          } else {
            window.open(data.paymentUrl, '_blank');
          }
        }
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Error');
      }
    } catch { /* ignore */ } finally { setPaying(false); }
  };

  // 2026-05-06 (per user feedback "уветовую гамму сделать приложения, а не зелёные"):
  // status pills are now muted, neutral-leaning, with subtle borders so the page
  // reads as part of the app's red+dark+white palette. Only `awaiting_payment`
  // (red, action required) and `cancelled` (red, terminal) use accent colour;
  // `paid`/`completed` keep a tiny emerald hint solely for status semantics.
  const statusLabel = (status: string) => {
    const map: Record<string, { label: string; cls: string }> = {
      new: { label: t.servicesStatusNew, cls: 'bg-white/[0.06] text-zinc-300 border border-white/15' },
      awaiting_payment: { label: t.servicesStatusAwaiting, cls: 'bg-red-500/15 text-red-300 border border-red-500/25' },
      paid: { label: t.servicesStatusPaid, cls: 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20' },
      processing: { label: t.servicesStatusProcessing, cls: 'bg-white/[0.06] text-zinc-200 border border-white/15' },
      completed: { label: t.servicesStatusCompleted, cls: 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20' },
      cancelled: { label: t.servicesStatusCancelled, cls: 'bg-zinc-500/15 text-zinc-400 border border-zinc-500/25' },
    };
    return map[status] || { label: status, cls: 'bg-white/[0.06] text-zinc-400 border border-white/15' };
  };

  if (selectedRequest) {
    const st = statusLabel(selectedRequest.status);
    return (
      <div className="fixed inset-0 z-30 bg-black flex flex-col">
        {/* Header — premium glass card matching support chat */}
        <div className="shrink-0 px-4 pb-3 border-b border-white/10 bg-zinc-950/95 backdrop-blur-md" style={{ paddingTop: 'calc(var(--sat) + 3.5rem)' }}>
          <div className="rounded-2xl border border-white/15 bg-zinc-900/60 backdrop-blur-sm p-3">
            <div className="flex items-center gap-3">
              <button onClick={() => { setSelectedRequest(null); setMessages([]); }} className="w-9 h-9 shrink-0 rounded-lg border border-white/15 bg-white/[0.04] flex items-center justify-center active:scale-90 transition-transform">
                <ChevronLeft size={18} className="text-white" />
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <h4 className="text-white font-semibold text-sm truncate">{selectedRequest.service_name}</h4>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${st.cls}`}>{st.label}</span>
                </div>
                {selectedRequest.amount && (
                  <p className="text-zinc-400 text-xs">
                    <span className="text-zinc-500">{t.servicesAmount}:</span> <span className="text-white font-semibold">{Number(selectedRequest.amount)} {selectedRequest.currency}</span>
                  </p>
                )}
              </div>
            </div>
          </div>

          {selectedRequest.status === 'awaiting_payment' && selectedRequest.amount && (
            <button onClick={handlePay} disabled={paying} className="mt-3 w-full bg-red-500 hover:bg-red-600 text-white font-semibold py-3 rounded-xl text-sm disabled:opacity-50 active:scale-[0.99] transition-all">
              {paying ? '...' : `${t.servicesPay} ${Number(selectedRequest.amount)} ${selectedRequest.currency}`}
            </button>
          )}
        </div>

        {/* Messages — refined bubbles matching support chat */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {messagesLoading ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-8 h-8 rounded-full border-2 border-white/10 border-t-white/70 animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-8 text-zinc-500 text-sm">{lang === 'ru' ? 'Сообщений пока нет' : 'No messages yet'}</div>
          ) : (
            <div className="space-y-2.5">
              {messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.sender_type === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] px-4 py-2.5 text-sm ${
                    msg.sender_type === 'user'
                      ? 'rounded-2xl rounded-br-md bg-red-500/15 border border-red-500/30 text-white'
                      : 'rounded-2xl rounded-bl-md bg-white/[0.04] border border-white/10 text-zinc-100'
                  }`}>
                    <p className="break-words whitespace-pre-wrap leading-relaxed">{msg.message}</p>
                    <p className={`text-[10px] mt-1.5 ${msg.sender_type === 'user' ? 'text-red-200/60' : 'text-zinc-500'}`}>
                      {new Date(msg.created_at).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Fixed input at bottom — premium pill input + circular ArrowUp send (no airplane) */}
        {!['completed', 'cancelled'].includes(selectedRequest.status) && (
          <div className="shrink-0 px-4 pt-3 border-t border-white/10 bg-zinc-950/95 backdrop-blur-md" style={{ paddingBottom: 'calc(var(--sab) + 0.75rem)' }}>
            <div className="flex items-end gap-2">
              <input
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                placeholder={t.servicesReplyPlaceholder}
                className="flex-1 rounded-2xl border border-white/15 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-white/30 focus:bg-white/[0.05] transition-colors"
              />
              <button
                onClick={handleSendMessage}
                disabled={!replyText.trim()}
                aria-label={lang === 'ru' ? 'Отправить' : 'Send'}
                className="shrink-0 w-12 h-12 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center active:scale-90 transition-all disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed"
              >
                <ArrowUp size={20} strokeWidth={2.25} />
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <motion.div custom={direction} variants={pageVariants} initial="initial" animate="animate" exit="exit" className="flex flex-col flex-1 items-center w-full">
      <div className="w-full max-w-xs lg:max-w-[560px]">
        <button onClick={() => navigate('profile')} className="mb-3 text-zinc-300 hover:text-white text-sm inline-flex items-center gap-2">
          <ChevronRight size={14} className="rotate-180" /> {t.servicesBackToProfile}
        </button>

        {/* Hero card — premium glass with subtle red halo, matching support views */}
        <div className="relative rounded-2xl border border-white/15 bg-zinc-900/60 backdrop-blur-sm p-4 lg:p-5 overflow-hidden mb-4">
          <div className="absolute -top-16 -right-16 w-44 h-44 rounded-full bg-red-500/[0.07] blur-3xl pointer-events-none" />
          <div className="relative flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl border border-white/15 bg-white/[0.04] flex items-center justify-center shrink-0">
              <Globe size={20} className="text-zinc-200" />
            </div>
            <div className="min-w-0">
              <h2 className="text-white font-semibold text-base lg:text-lg leading-tight">{t.servicesTitle}</h2>
              <p className="text-zinc-500 text-xs mt-0.5">{t.servicesDesc}</p>
            </div>
          </div>
        </div>

        {/* Toggle new-request — neutral white-outlined button */}
        <button onClick={() => { haptic('medium'); setShowForm(!showForm); }} className="w-full mb-4 bg-white/[0.04] border border-white/15 text-white font-medium py-2.5 rounded-xl flex items-center justify-center gap-2 text-sm hover:bg-white/[0.08] active:scale-[0.99] transition-all">
          <Plus size={16} /> {t.servicesNewRequest}
        </button>

        {showForm && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="relative rounded-2xl border border-white/15 bg-zinc-900/60 backdrop-blur-sm p-5 mb-4 overflow-hidden">
            <div className="absolute -top-16 -right-16 w-40 h-40 rounded-full bg-red-500/[0.06] blur-3xl pointer-events-none" />
            <div className="relative space-y-4">
              <div className="flex items-center gap-3 pb-3 border-b border-white/10">
                <div className="w-11 h-11 rounded-xl border border-white/15 bg-white/[0.04] flex items-center justify-center shrink-0">
                  <Pencil size={17} strokeWidth={1.75} className="text-zinc-200" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-white font-semibold text-base leading-tight">{t.servicesNewRequest}</h3>
                  <p className="text-zinc-500 text-xs mt-0.5">{t.servicesDesc}</p>
                </div>
              </div>
              <div>
                <label className="block text-zinc-400 text-[10px] font-semibold uppercase tracking-[0.12em] mb-2">{t.servicesServiceName} <span className="text-red-400 normal-case">*</span></label>
                <input value={serviceName} onChange={(e) => setServiceName(e.target.value)} placeholder={t.servicesServiceNamePlaceholder} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-white/30 transition-colors" />
              </div>
              <div>
                <label className="block text-zinc-400 text-[10px] font-semibold uppercase tracking-[0.12em] mb-2">{t.servicesDescription}</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t.servicesDescriptionPlaceholder} rows={3} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-white/30 transition-colors resize-none" />
              </div>
              <button onClick={handleCreate} disabled={sending || !serviceName.trim()} className="w-full bg-red-500 hover:bg-red-600 text-white font-semibold py-3 rounded-xl text-sm disabled:opacity-50 disabled:hover:bg-red-500 active:scale-[0.99] transition-all">
                {sending ? t.servicesSending : t.servicesSend}
              </button>
            </div>
          </motion.div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <div className="w-8 h-8 rounded-full border-2 border-white/10 border-t-white/70 animate-spin" />
          </div>
        ) : requests.length === 0 ? (
          <div className="text-center py-12 rounded-2xl border border-white/10 bg-zinc-900/35">
            <div className="w-14 h-14 mx-auto mb-3 rounded-2xl border border-white/15 bg-white/[0.03] flex items-center justify-center">
              <Globe size={26} strokeWidth={1.75} className="text-zinc-300" />
            </div>
            <p className="text-zinc-300 text-sm font-medium">{t.servicesNoRequests}</p>
            <p className="text-zinc-500 text-xs mt-1">{t.servicesNoRequestsHint}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {requests.map((req) => {
              const st = statusLabel(req.status);
              return (
                <button key={req.id} onClick={() => { haptic('light'); setSelectedRequest(req); loadMessages(req); }} className="w-full text-left rounded-xl border border-white/15 bg-zinc-900/50 p-3 hover:bg-white/[0.06] transition-colors active:scale-[0.98]">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-white font-medium text-sm truncate">{req.service_name}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ml-2 ${st.cls}`}>{st.label}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-zinc-500">
                    <span>{new Date(req.created_at).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB')}</span>
                    <div className="flex items-center gap-2">
                      {req.amount && <span className="text-white font-semibold">{Number(req.amount)} {req.currency}</span>}
                      <span>{req.message_count} {lang === 'ru' ? 'сообщ.' : 'msgs'}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// Human-readable byte formatter for the admin traffic stats (2026-06-11).
// Uses binary units (KiB/MiB/GiB/TiB) shown with familiar КБ/МБ/ГБ/ТБ labels,
// matching the existing per-user formatting.
function formatTrafficBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 МБ';
  const tb = bytes / (1024 ** 4);
  if (tb >= 1) return `${tb.toFixed(2)} ТБ`;
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(2)} ГБ`;
  const mb = bytes / (1024 ** 2);
  if (mb >= 1) return `${mb.toFixed(1)} МБ`;
  return `${(bytes / 1024).toFixed(0)} КБ`;
}

type AdminStats = {
  totalUsers: number;
  todayUsers: number;
  bannedUsers: number;
  totalRevenue: number;
  currentMonthRevenue: number;
  totalPayments: number;
  paidPayments: number;
  activeSubscriptions: number;
  monthlyRevenue: { month: string; revenue: number; paidCount: number }[];
  // Traffic (2026-06-11): lifetime total bytes consumed by users + a monthly
  // histogram that accumulates forward from when tracking started.
  totalTrafficBytes: number;
  monthlyTraffic: { month: string; bytes: number }[];
};

type AdminUser = {
  id: string;
  // v57: email-only users have NULL telegram_id.
  telegram_id: string | null;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  email_verified: boolean | null;
  auth_type: string | null;
  status: string;
  is_banned: boolean;
  ban_reason: string | null;
  ban_type: string | null;
  created_at: string;
  last_seen_at: string;
  total_paid: string;
  payments_count: string;
  subscription_status: string | null;
  subscription_end: string | null;
  // v68 (2026-05-06): abuse-detection signals.
  // total_lifetime_days = SUM of every subscription's duration since signup
  // (paid + bonus + referral + promo). Comes back as a numeric string.
  // device_count = number of currently-bound (kicked_at IS NULL) devices.
  total_lifetime_days: string | number;
  device_count: string | number;
  // 2026-06-13 (admin partner view): referral identity / reach / balance.
  referral_code?: string | null;
  referral_balance_rub?: string | number;
  referred_count?: string | number;
  is_partner?: boolean;
  partner_cash_percent?: number;
  // Only allowlisted inviters earn from website/email (?ref=) signups;
  // for everyone else the site link does nothing, so we hide it.
  is_site_referral_inviter?: boolean;
};

// 2026-06-13: invitee list returned by /api/admin/users/<id>/referrals.
type AdminInvitee = {
  id: string;
  telegram_id: string | null;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  auth_type: string | null;
  created_at: string;
  last_seen_at: string | null;
  total_paid_rub: string;
  cash_generated_rub: string;
};
type AdminUserReferrals = {
  inviter: {
    id: string;
    referral_code: string | null;
    balance_rub: string;
    is_partner: boolean;
    cash_percent: number;
    invitee_count: number;
    total_cash_earned_rub: string;
  };
  invitees: AdminInvitee[];
};

type AdminPromo = {
  id: number;
  code: string;
  days: number;
  discount_percent: number | null;
  max_uses: number;
  used_count: number;
  is_active: boolean;
  created_at: string;
  expires_at: string | null;
};

// Box-won coupons are auto-issued with the reserved `BOX` code prefix
// (COUPON_CODE_PREFIX in lib/boxes.ts). Everything else was created by an
// admin by hand in the promo panel.
const isBoxPromo = (p: AdminPromo) => p.code.toUpperCase().startsWith('BOX');

type AdminTicket = {
  id: string;
  user_id: string;
  telegram_id: string | null;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  subject: string | null;
  status: 'open' | 'closed';
  created_at: string;
  updated_at: string;
  last_message: string | null;
  last_message_at: string;
  messages_count: number;
  unread_count: number;
};

type AdminTicketDetails = {
  id: string;
  user_id: string;
  telegram_id: string | null;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  subject: string | null;
  status: 'open' | 'closed';
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

type AdminTicketMessage = {
  id: string;
  sender_type: 'user' | 'admin' | 'system';
  message: string;
  created_at: string;
  attachments?: TicketAttachmentMeta[];
  reply_to_id?: string | null;
  reactions?: TicketReaction[];
};

function AdminTicketsView({
  t,
  lang,
  tgId,
  onHideNav,
  pendingCompose,
  onPendingComposeConsumed,
}: {
  t: any;
  lang: 'ru' | 'en';
  tgId?: number;
  onHideNav?: (hide: boolean) => void;
  // v57: when admin clicks "Написать" on a user card in the Users tab, the
  // parent AdminView populates this prop and switches to the tickets tab.
  // We auto-open the composer with the right target type/value.
  pendingCompose?: { type: 'telegramId' | 'userId' | 'username'; value: string } | null;
  onPendingComposeConsumed?: () => void;
}) {
  const [tickets, setTickets] = useState<AdminTicket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketsError, setTicketsError] = useState<string | null>(null);
  const [ticketsSearch, setTicketsSearch] = useState('');
  const [ticketsFilter, setTicketsFilter] = useState<'open' | 'all'>('open');
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<AdminTicketDetails | null>(null);
  const [ticketMessages, setTicketMessages] = useState<AdminTicketMessage[]>([]);
  const [replyTo, setReplyTo] = useState<AdminTicketMessage | null>(null);
  const [ticketDetailsLoading, setTicketDetailsLoading] = useState(false);
  const [replyMessage, setReplyMessage] = useState('');
  const [replySending, setReplySending] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [deletingTicket, setDeletingTicket] = useState(false);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);

  // Compose new ticket (admin → user) state.
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTargetType, setComposeTargetType] = useState<'telegramId' | 'userId' | 'username'>('telegramId');
  const [composeTargetValue, setComposeTargetValue] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeMessage, setComposeMessage] = useState('');
  const [composeSending, setComposeSending] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);

  // Photo attachments (admin reply + compose) + fullscreen viewer.
  const [replyImages, setReplyImages] = useState<PendingTicketImage[]>([]);
  const [composeImages, setComposeImages] = useState<PendingTicketImage[]>([]);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const replyFileRef = useRef<HTMLInputElement>(null);
  const composeFileRef = useRef<HTMLInputElement>(null);

  const buildAttachmentUrl = useCallback(
    (ticketId: string, att: TicketAttachmentMeta) =>
      `/api/admin/tickets/${ticketId}/attachments/${att.id}?telegramId=${encodeURIComponent(String(tgId))}`,
    [tgId],
  );

  const handlePickImages = (
    files: FileList | null,
    target: 'reply' | 'compose',
  ) => {
    if (!files || files.length === 0) return;
    const setter = target === 'reply' ? setReplyImages : setComposeImages;
    setter((prev) => {
      const { accepted, error } = acceptTicketImages(files, prev.length);
      if (error) {
        if (target === 'reply') setTicketsError(error);
        else setComposeError(error);
      }
      return [...prev, ...accepted];
    });
  };

  const removePendingImage = (key: string, target: 'reply' | 'compose') => {
    const setter = target === 'reply' ? setReplyImages : setComposeImages;
    setter((prev) => {
      const found = prev.find((p) => p.key === key);
      if (found) URL.revokeObjectURL(found.previewUrl);
      return prev.filter((p) => p.key !== key);
    });
  };

  // v57: when the parent AdminView passes a pendingCompose target, open the
  // composer pre-filled and immediately tell the parent it has been consumed
  // so that switching back & forth doesn't re-open the form.
  useEffect(() => {
    if (!pendingCompose) return;
    setComposeOpen(true);
    setComposeTargetType(pendingCompose.type);
    setComposeTargetValue(pendingCompose.value);
    setComposeSubject('');
    setComposeMessage('');
    setComposeError(null);
    onPendingComposeConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCompose]);

  const formatDate = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-GB');
  };

  const getTicketOwner = (ticket: { first_name: string | null; last_name: string | null; username: string | null; telegram_id: string | null; user_id: string; }) => {
    return [ticket.first_name, ticket.last_name].filter(Boolean).join(' ') || ticket.username || `TG ${ticket.telegram_id ?? ticket.user_id}`;
  };

  const loadTickets = async (nextSearch = ticketsSearch, nextFilter = ticketsFilter) => {
    if (!tgId) {
      setTickets([]);
      return;
    }

    setTicketsLoading(true);
    setTicketsError(null);
    try {
      const params = new URLSearchParams({ telegramId: String(tgId) });
      if (nextFilter === 'open') params.set('status', 'open');
      if (nextSearch.trim()) params.set('search', nextSearch.trim());

      const res = await fetch(`/api/admin/tickets?${params}`);
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || t.adminTicketLoadError);
      }

      setTickets(Array.isArray(data.tickets) ? data.tickets : []);
    } catch (error) {
      setTickets([]);
      setTicketsError(error instanceof Error ? error.message : t.adminTicketLoadError);
    } finally {
      setTicketsLoading(false);
    }
  };

  const loadTicketDetails = async (ticketId: string) => {
    if (!tgId) return;

    setTicketDetailsLoading(true);
    setTicketsError(null);
    try {
      const res = await fetch(`/api/admin/tickets/${ticketId}?telegramId=${encodeURIComponent(String(tgId))}`);
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || t.adminTicketLoadError);
      }

      setSelectedTicket(data.ticket ?? null);
      setTicketMessages(Array.isArray(data.messages) ? data.messages : []);
    } catch (error) {
      setSelectedTicket(null);
      setTicketMessages([]);
      setTicketsError(error instanceof Error ? error.message : t.adminTicketLoadError);
    } finally {
      setTicketDetailsLoading(false);
    }
  };

  useEffect(() => {
    if (!tgId) {
      setTickets([]);
      return;
    }
    void loadTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tgId, ticketsFilter]);

  // Hide navigation when in chat
  useEffect(() => {
    onHideNav?.(!!selectedTicketId);
    return () => onHideNav?.(false);
  }, [selectedTicketId, onHideNav]);

  const handleTicketSearchSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void loadTickets(ticketsSearch, ticketsFilter);
  };

  const handleOpenTicket = (ticketId: string) => {
    haptic('light');
    setSelectedTicketId(ticketId);
    setReplyMessage('');
    void loadTicketDetails(ticketId);
  };

  const handleSendReply = async () => {
    haptic('medium');
    if (!tgId || !selectedTicketId) return;

    const message = replyMessage.trim();
    if (!message && replyImages.length === 0) {
      setTicketsError(t.supportMessageRequired);
      return;
    }

    setReplySending(true);
    setTicketsError(null);
    try {
      const attachments = await Promise.all(replyImages.map((img) => fileToTicketAttachment(img.file)));
      const res = await fetch(`/api/admin/tickets/${selectedTicketId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegramId: tgId,
          message,
          attachments: attachments.length > 0 ? attachments : undefined,
          replyToId: replyTo?.id ?? null,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || t.adminTicketActionError);
      }

      setReplyMessage('');
      setReplyTo(null);
      replyImages.forEach((img) => URL.revokeObjectURL(img.previewUrl));
      setReplyImages([]);
      await Promise.all([
        loadTicketDetails(selectedTicketId),
        loadTickets(ticketsSearch, ticketsFilter),
      ]);
    } catch (error) {
      setTicketsError(error instanceof Error ? error.message : t.adminTicketActionError);
    } finally {
      setReplySending(false);
    }
  };

  const handleReactMessage = async (messageId: string, emoji: string) => {
    if (!tgId || !selectedTicketId) return;
    haptic('light');
    try {
      const res = await fetch(`/api/admin/tickets/${selectedTicketId}/messages/${messageId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: tgId, emoji }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t.adminTicketActionError);
      setTicketMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, reactions: data.reactions ?? [] } : m)));
    } catch (error) {
      setTicketsError(error instanceof Error ? error.message : t.adminTicketActionError);
    }
  };

  const handleCopyMessage = async (text: string) => {
    if (!text) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      haptic('light');
    } catch { /* ignore */ }
  };

  const jumpToMessage = (id: string) => {
    const el = document.getElementById(`tmsg-${id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const handleTicketStatus = async (status: 'open' | 'closed') => {
    haptic('medium');
    if (!tgId || !selectedTicketId) return;

    setStatusUpdating(true);
    setTicketsError(null);
    try {
      const res = await fetch(`/api/admin/tickets/${selectedTicketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: tgId, status }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || t.adminTicketActionError);
      }

      await Promise.all([
        loadTicketDetails(selectedTicketId),
        loadTickets(ticketsSearch, ticketsFilter),
      ]);
    } catch (error) {
      setTicketsError(error instanceof Error ? error.message : t.adminTicketActionError);
    } finally {
      setStatusUpdating(false);
    }
  };

  const handleDeleteTicket = async () => {
    haptic('heavy');
    if (!tgId || !selectedTicketId) return;
    if (!window.confirm(t.adminTicketDeleteConfirm)) return;

    setDeletingTicket(true);
    setTicketsError(null);
    try {
      const res = await fetch(`/api/admin/tickets/${selectedTicketId}?telegramId=${encodeURIComponent(String(tgId))}`, {
        method: 'DELETE',
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || t.adminTicketActionError);
      }

      setSelectedTicketId(null);
      setSelectedTicket(null);
      setTicketMessages([]);
      await loadTickets(ticketsSearch, ticketsFilter);
    } catch (error) {
      setTicketsError(error instanceof Error ? error.message : t.adminTicketActionError);
    } finally {
      setDeletingTicket(false);
    }
  };

  const handleComposeSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    haptic('medium');
    if (!tgId) return;

    const target = composeTargetValue.trim();
    const message = composeMessage.trim();
    const subject = composeSubject.trim();

    if (!target) {
      setComposeError(lang === 'ru' ? 'Укажите получателя' : 'Recipient is required');
      return;
    }
    if (!message && composeImages.length === 0) {
      setComposeError(lang === 'ru' ? 'Введите сообщение' : 'Message is required');
      return;
    }

    setComposeSending(true);
    setComposeError(null);
    try {
      const attachments = await Promise.all(composeImages.map((img) => fileToTicketAttachment(img.file)));
      const targetPayload: Record<string, string | number> = {};
      if (composeTargetType === 'telegramId' || composeTargetType === 'userId') {
        const n = Number(target);
        if (!Number.isFinite(n)) {
          setComposeError(lang === 'ru' ? 'Некорректный ID' : 'Invalid ID');
          setComposeSending(false);
          return;
        }
        targetPayload[composeTargetType] = n;
      } else {
        targetPayload.username = target.replace(/^@/, '');
      }

      const res = await fetch('/api/admin/tickets/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegramId: tgId,
          target: targetPayload,
          subject: subject || undefined,
          message,
          attachments: attachments.length > 0 ? attachments : undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || (lang === 'ru' ? 'Не удалось отправить' : 'Failed to send'));
      }

      // Success — clear form, close composer, jump straight into the new
      // ticket so the admin sees their freshly-sent message.
      setComposeOpen(false);
      setComposeTargetValue('');
      setComposeSubject('');
      setComposeMessage('');
      composeImages.forEach((img) => URL.revokeObjectURL(img.previewUrl));
      setComposeImages([]);
      const newTicketId: string | undefined = data.ticket?.id;
      await loadTickets(ticketsSearch, ticketsFilter);
      if (newTicketId) {
        setSelectedTicketId(newTicketId);
        await loadTicketDetails(newTicketId);
      }
    } catch (error) {
      setComposeError(error instanceof Error ? error.message : (lang === 'ru' ? 'Ошибка' : 'Error'));
    } finally {
      setComposeSending(false);
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    haptic('heavy');
    if (!tgId || !selectedTicketId) return;
    if (!window.confirm(t.adminTicketDeleteMessageConfirm)) return;

    setDeletingMessageId(messageId);
    setTicketsError(null);
    try {
      const res = await fetch(`/api/admin/tickets/${selectedTicketId}/messages/${messageId}?telegramId=${encodeURIComponent(String(tgId))}`, {
        method: 'DELETE',
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || t.adminTicketActionError);
      }

      await Promise.all([
        loadTicketDetails(selectedTicketId),
        loadTickets(ticketsSearch, ticketsFilter),
      ]);
    } catch (error) {
      setTicketsError(error instanceof Error ? error.message : t.adminTicketActionError);
    } finally {
      setDeletingMessageId(null);
    }
  };

  const senderLabel = (senderType: 'user' | 'admin' | 'system') => {
    if (senderType === 'admin') return t.adminTicketSenderAdmin;
    if (senderType === 'system') return t.adminTicketSenderSystem;
    return t.adminTicketSenderUser;
  };

  return (
    <div>
      {!selectedTicketId ? (
        <>
          <div className="flex flex-wrap gap-2 mb-3 items-center">
            <button
              onClick={() => {
                setTicketsFilter('open');
                void loadTickets(ticketsSearch, 'open');
              }}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${ticketsFilter === 'open' ? 'bg-white/10 border-white/25 text-white' : 'border-white/10 text-zinc-400 hover:text-white hover:bg-white/5'}`}
            >
              {t.adminTicketsOpenOnly}
            </button>
            <button
              onClick={() => {
                setTicketsFilter('all');
                void loadTickets(ticketsSearch, 'all');
              }}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${ticketsFilter === 'all' ? 'bg-white/10 border-white/25 text-white' : 'border-white/10 text-zinc-400 hover:text-white hover:bg-white/5'}`}
            >
              {t.adminTicketsAll}
            </button>
            <button
              onClick={() => {
                setComposeOpen((v) => !v);
                setComposeError(null);
              }}
              className="ml-auto text-xs px-3 py-1.5 rounded-lg border border-red-500/40 bg-red-500/15 text-red-300 hover:bg-red-500/25 transition-colors inline-flex items-center gap-1.5"
            >
              <Plus size={12} strokeWidth={2.5} />
              {lang === 'ru' ? 'Написать пользователю' : 'Message a user'}
            </button>
          </div>

          {composeOpen && (
            <form onSubmit={handleComposeSubmit} className="mb-3 rounded-xl border border-red-500/25 bg-gradient-to-br from-red-500/10 via-zinc-900/70 to-zinc-900/60 p-3 space-y-2.5">
              <div className="flex gap-1.5">
                {(['telegramId', 'username', 'userId'] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setComposeTargetType(opt)}
                    className={`text-[10px] px-2.5 py-1 rounded-lg border transition-colors ${composeTargetType === opt ? 'bg-white/15 border-white/30 text-white' : 'border-white/10 text-zinc-400 hover:text-white hover:bg-white/5'}`}
                  >
                    {opt === 'telegramId' ? 'Telegram ID' : opt === 'username' ? '@username' : 'User ID'}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={composeTargetValue}
                onChange={(e) => setComposeTargetValue(e.target.value)}
                placeholder={composeTargetType === 'telegramId' ? '123456789' : composeTargetType === 'username' ? '@username' : '42'}
                className="w-full bg-zinc-800/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-red-500/40"
              />
              <input
                type="text"
                value={composeSubject}
                onChange={(e) => setComposeSubject(e.target.value)}
                placeholder={lang === 'ru' ? 'Тема (необязательно)' : 'Subject (optional)'}
                maxLength={120}
                className="w-full bg-zinc-800/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-red-500/40"
              />
              <textarea
                value={composeMessage}
                onChange={(e) => setComposeMessage(e.target.value)}
                placeholder={lang === 'ru' ? 'Сообщение пользователю…' : 'Message to user…'}
                rows={3}
                maxLength={4000}
                className="w-full bg-zinc-800/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-red-500/40 resize-none"
              />
              <input
                ref={composeFileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  handlePickImages(e.target.files, 'compose');
                  e.target.value = '';
                }}
              />
              <PendingImagesStrip images={composeImages} onRemove={(k) => removePendingImage(k, 'compose')} />
              <button
                type="button"
                onClick={() => composeFileRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-zinc-800/60 px-3 py-1.5 text-xs text-zinc-300 hover:text-white hover:bg-zinc-700/60"
              >
                <ImageIcon size={13} /> {t.supportAttachPhoto}
              </button>
              {composeError && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{composeError}</div>
              )}
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setComposeOpen(false);
                    setComposeError(null);
                  }}
                  className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-zinc-400 hover:text-white hover:bg-white/5"
                >
                  {lang === 'ru' ? 'Отмена' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={composeSending}
                  className="text-xs px-3 py-1.5 rounded-lg bg-gradient-to-r from-red-500 to-red-600 text-white font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Send size={12} />
                  {composeSending ? (lang === 'ru' ? 'Отправка…' : 'Sending…') : (lang === 'ru' ? 'Отправить' : 'Send')}
                </button>
              </div>
            </form>
          )}

          <form onSubmit={handleTicketSearchSubmit} className="mb-3 flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                value={ticketsSearch}
                onChange={(e) => setTicketsSearch(e.target.value)}
                placeholder={t.adminTicketsSearch}
                className="w-full bg-zinc-800/60 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-white/25"
              />
            </div>
            <button type="submit" className="bg-white/10 border border-white/15 text-white px-3 rounded-lg text-sm hover:bg-white/15">
              <Search size={14} />
            </button>
          </form>

          {ticketsError && (
            <div className="mb-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {ticketsError}
            </div>
          )}

          {ticketsLoading ? (
            <div className="text-center py-8 text-zinc-400 text-sm">Загрузка...</div>
          ) : tickets.length === 0 ? (
            <div className="text-center py-8 text-zinc-400 text-sm">{t.adminNoTickets}</div>
          ) : (
            <div className="space-y-2">
              {tickets.map((ticket) => (
                <button
                  key={ticket.id}
                  onClick={() => handleOpenTicket(ticket.id)}
                  className={`w-full text-left rounded-xl border p-3 transition-colors ${ticket.unread_count > 0 ? 'border-red-500/40 bg-red-500/5 hover:bg-red-500/10' : 'border-white/10 bg-zinc-900/60 hover:bg-zinc-900/80'}`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-white text-sm font-medium truncate flex items-center gap-2">
                        {ticket.subject || t.adminTicketSubjectEmpty}
                        {ticket.unread_count > 0 && (
                          <span className="shrink-0 min-w-[18px] h-[18px] px-1.5 rounded-full bg-red-500 text-[10px] font-bold text-white flex items-center justify-center shadow-[0_0_8px_rgba(239,68,68,0.6)]">
                            {ticket.unread_count > 99 ? '99+' : ticket.unread_count}
                          </span>
                        )}
                      </p>
                      <p className="text-zinc-500 text-[10px] truncate">
                        {getTicketOwner(ticket)} · TG: {ticket.telegram_id || '—'}
                      </p>
                    </div>
                    <span className={`text-[9px] uppercase tracking-wider px-2 py-1 rounded-full ${ticket.status === 'closed' ? 'bg-zinc-700/60 text-zinc-300' : 'bg-white/10 text-zinc-200'}`}>
                      {ticket.status === 'closed' ? t.adminTicketClosed : t.adminTicketOpen}
                    </span>
                  </div>
                  <p className="text-zinc-400 text-xs line-clamp-2 min-h-[2.2rem]">{ticket.last_message || '—'}</p>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-zinc-500">
                    <span>{formatDate(ticket.last_message_at)}</span>
                    <span>{ticket.messages_count} {t.supportMessagesCount}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="fixed inset-0 z-30 bg-black flex flex-col">
          {/* Header */}
          <div className="shrink-0 px-4 pb-3 border-b border-white/10 bg-zinc-950" style={{ paddingTop: 'calc(var(--sat) + 3.5rem)' }}>
            <button
              onClick={() => {
                setSelectedTicketId(null);
                setSelectedTicket(null);
                setTicketMessages([]);
              }}
              className="text-zinc-400 hover:text-white text-sm inline-flex items-center gap-2 transition-colors mb-3"
            >
              <ChevronRight size={14} className="rotate-180" /> {t.adminTicketBack}
            </button>

            {selectedTicket && (
              <div className="relative rounded-xl border border-red-500/20 bg-gradient-to-br from-red-500/10 via-zinc-900/80 to-zinc-900/60 p-3 overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 bg-red-500/10 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />
                <div className="relative">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-red-500/30 to-red-600/20 border border-red-500/30 flex items-center justify-center shrink-0">
                        <Mail size={16} className="text-red-400" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-white font-bold text-sm truncate">{selectedTicket.subject || t.adminTicketSubjectEmpty}</h3>
                        <p className="text-zinc-500 text-[10px] truncate">
                          {getTicketOwner(selectedTicket)} · TG: {selectedTicket.telegram_id || '—'}
                        </p>
                      </div>
                    </div>
                    <span className={`text-xs shrink-0 ${selectedTicket.status === 'closed' ? 'text-zinc-500' : 'text-green-400'}`}>
                      {selectedTicket.status === 'closed' ? t.adminTicketClosed : t.adminTicketOpen}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => handleTicketStatus(selectedTicket.status === 'open' ? 'closed' : 'open')}
                      disabled={statusUpdating}
                      className={`text-[10px] px-3 py-1.5 rounded-lg border transition-all active:scale-95 ${selectedTicket.status === 'open' ? 'border-red-500/30 bg-red-500/15 text-red-400' : 'border-green-500/30 bg-green-500/15 text-green-400'} disabled:opacity-40`}
                    >
                      {selectedTicket.status === 'open' ? t.adminTicketClose : t.adminTicketReopen}
                    </button>
                    <button
                      onClick={handleDeleteTicket}
                      disabled={deletingTicket}
                      className="text-[10px] px-3 py-1.5 rounded-lg border border-rose-500/30 bg-rose-500/15 text-rose-400 transition-all active:scale-95 disabled:opacity-40"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {ticketsError && (
            <div className="mx-4 mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300 flex items-center gap-2">
              <X size={16} />
              {ticketsError}
            </div>
          )}

          {ticketDetailsLoading || !selectedTicket ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="w-10 h-10 rounded-full border-2 border-red-500/20 border-t-red-500 animate-spin" />
            </div>
          ) : (
            <>
              {/* Messages - scrollable area */}
              <div className="flex-1 overflow-y-auto px-4 py-4">
                {ticketMessages.length === 0 ? (
                  <div className="text-zinc-600 text-sm py-8 text-center">{t.adminTicketNoMessages}</div>
                ) : (
                  <div className="space-y-3">
                    {ticketMessages.map((msg) => {
                      const quoted = msg.reply_to_id ? ticketMessages.find((m) => m.id === msg.reply_to_id) : null;
                      const isOwn = msg.sender_type === 'admin';
                      return (
                        <TicketMessageRow
                          key={msg.id}
                          msg={msg}
                          isOwn={isOwn}
                          mySide="admin"
                          quotedLabel={quoted ? senderLabel(quoted.sender_type) : null}
                          quotedText={quoted ? quoted.message : null}
                          bubbleClassName={`rounded-2xl px-4 py-3 ${isOwn ? 'bg-gradient-to-br from-red-500/20 to-red-600/10 border border-red-500/25 text-white' : 'bg-zinc-800/80 border border-white/10 text-zinc-200'}`}
                          attachmentsNode={
                            <TicketAttachmentGrid
                              attachments={msg.attachments}
                              buildUrl={(att) => buildAttachmentUrl(selectedTicket.id, att)}
                              onOpen={setLightboxUrl}
                            />
                          }
                          meta={
                            <div className="mt-2 flex items-center justify-between gap-2">
                              <p className={`text-[10px] ${isOwn ? 'text-red-300/60' : 'text-zinc-500'}`}>
                                {senderLabel(msg.sender_type)} · {formatDate(msg.created_at)}
                              </p>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDeleteMessage(msg.id); }}
                                disabled={deletingMessageId === msg.id}
                                className="text-zinc-500 hover:text-red-300 transition-colors disabled:opacity-40 shrink-0"
                                title={t.adminTicketDeleteMessage}
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          }
                          onReply={(m) => { setReplyTo(m as AdminTicketMessage); }}
                          onReact={handleReactMessage}
                          onCopy={handleCopyMessage}
                          onJumpToQuoted={jumpToMessage}
                          lang={lang}
                        />
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Fixed input at bottom */}
              <div className="shrink-0 px-4 pt-3 border-t border-white/10 bg-zinc-950" style={{ paddingBottom: 'calc(var(--sab) + 0.75rem)' }}>
                {replyTo && (
                  <div className="flex items-center gap-2 mb-2 rounded-xl border-l-2 border-red-400/70 bg-white/[0.04] px-3 py-2">
                    <Reply size={14} className="text-red-300 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-medium text-red-300">{lang === 'ru' ? 'Ответ' : 'Reply'} · {senderLabel(replyTo.sender_type)}</p>
                      <p className="text-[11px] text-zinc-400 truncate">{replyTo.message || (lang === 'ru' ? '📷 Фото' : '📷 Photo')}</p>
                    </div>
                    <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply" className="shrink-0 text-zinc-400 hover:text-white">
                      <X size={16} />
                    </button>
                  </div>
                )}
                <PendingImagesStrip images={replyImages} onRemove={(k) => removePendingImage(k, 'reply')} />
                <div className="flex gap-2">
                  <input
                    ref={replyFileRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      handlePickImages(e.target.files, 'reply');
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => replyFileRef.current?.click()}
                    aria-label={t.supportAttachPhoto}
                    title={t.supportAttachPhoto}
                    className="shrink-0 w-12 h-12 rounded-xl border border-white/10 bg-zinc-900/60 text-zinc-400 hover:text-white hover:bg-zinc-800/80 flex items-center justify-center active:scale-95 transition-all"
                  >
                    <Paperclip size={18} strokeWidth={2} />
                  </button>
                  <textarea
                    value={replyMessage}
                    onChange={(e) => setReplyMessage(e.target.value)}
                    placeholder={t.adminTicketReplyPlaceholder}
                    rows={1}
                    maxLength={4000}
                    className="flex-1 rounded-xl border border-white/10 bg-zinc-900/60 px-4 py-3 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-red-500/40 transition-colors resize-none"
                  />
                  <button
                    onClick={handleSendReply}
                    disabled={replySending}
                    className="shrink-0 w-12 h-12 rounded-xl bg-gradient-to-r from-red-500 to-red-600 text-white flex items-center justify-center active:scale-95 transition-all disabled:opacity-50 shadow-lg shadow-red-500/25"
                  >
                    <Send size={18} strokeWidth={2} />
                  </button>
                </div>
              </div>
              <TicketImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Password gate shown before AdminView. Pure UI guard — backend admin
 * routes are still protected by `isAdmin(telegramId)` (see lib/admin.ts).
 *
 * The password is intentionally simple (4 digits) and is checked
 * client-side: anyone determined enough can read it from the bundle.
 * Its sole purpose is to prevent over-the-shoulder access if the user
 * leaves the Mini App open on a desk.
 */
function AdminPasswordGate({ lang, expected, onUnlock, onCancel }: { lang: 'ru' | 'en'; expected: string; onUnlock: () => void; onCancel: () => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    if (value.trim() === expected) {
      hapticNotification('success');
      onUnlock();
    } else {
      hapticNotification('error');
      setError(lang === 'ru' ? 'Неверный пароль' : 'Wrong password');
      setShake(true);
      setTimeout(() => setShake(false), 400);
      setValue('');
      inputRef.current?.focus();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex flex-col items-center justify-center flex-1 px-4 py-8"
    >
      <div className={`w-full max-w-sm rounded-2xl border border-red-500/20 bg-gradient-to-br from-zinc-900/60 via-zinc-900/40 to-black/60 p-6 ${shake ? 'animate-shake' : ''}`}>
        <div className="flex items-center justify-center mb-4">
          <div className="w-14 h-14 rounded-2xl bg-red-500/15 border border-red-500/40 flex items-center justify-center shadow-[0_0_24px_rgba(239,68,68,0.2)]">
            <ShieldAlert size={26} className="text-red-400" />
          </div>
        </div>
        <h2 className="text-white text-lg font-bold text-center mb-1">
          {lang === 'ru' ? 'Доступ в админку' : 'Admin access'}
        </h2>
        <p className="text-zinc-400 text-xs text-center mb-5">
          {lang === 'ru' ? 'Введите пароль для входа в панель' : 'Enter the password to open the panel'}
        </p>
        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={value}
            onChange={(e) => { setValue(e.target.value); if (error) setError(null); }}
            placeholder="••••"
            maxLength={16}
            className="w-full bg-zinc-800/60 border border-white/10 rounded-xl px-4 py-3 text-center text-white text-xl tracking-[0.4em] placeholder:text-zinc-600 placeholder:tracking-[0.4em] outline-none focus:border-red-500/40"
          />
          {error && (
            <p className="text-red-400 text-xs text-center mt-2">{error}</p>
          )}
          <button
            type="submit"
            disabled={!value.trim()}
            className="w-full mt-4 rounded-xl py-3 px-4 font-bold text-white text-sm bg-gradient-to-r from-red-600 via-red-500 to-red-600 shadow-[0_8px_32px_-8px_rgba(239,68,68,0.6)] hover:shadow-[0_8px_36px_-6px_rgba(239,68,68,0.75)] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {lang === 'ru' ? 'Войти' : 'Sign in'}
          </button>
        </form>
        <button
          onClick={onCancel}
          className="w-full mt-2 text-zinc-500 hover:text-zinc-300 text-xs py-2 transition-colors"
        >
          {lang === 'ru' ? 'Отмена' : 'Cancel'}
        </button>
      </div>
      <style jsx>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-6px); }
          80% { transform: translateX(6px); }
        }
        .animate-shake { animation: shake 0.4s ease-in-out; }
      `}</style>
    </motion.div>
  );
}

function AdminView({ t, direction, tgUser, navigate, lang, onHideNav, onLockAdmin }: { t: any; direction: number; tgUser: { id: number; name: string; photo: string; username?: string } | null; navigate: (tab: Tab) => void; lang: 'ru' | 'en'; onHideNav?: (hide: boolean) => void; onLockAdmin?: () => void }) {
  const [adminTab, setAdminTab] = useState<'stats' | 'users' | 'promos' | 'activations' | 'tickets' | 'broadcasts' | 'fragment' | 'services' | 'referrals' | 'boxes' | 'withdrawals'>('stats');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersSearch, setUsersSearch] = useState('');
  const [usersPage, setUsersPage] = useState(1);
  const [usersTotalPages, setUsersTotalPages] = useState(1);
  // v68: 'active_no_devices' = potential abusers (paid sub but 0 devices).
  const [usersSubFilter, setUsersSubFilter] = useState<'all' | 'active' | 'none' | 'active_no_devices'>('all');
  // v68: sort by lifetime days desc to surface heavy-usage accounts.
  const [usersSortBy, setUsersSortBy] = useState<'recent' | 'lifetime'>('recent');
  // 2026-06-13: partner-only filter + per-user invitee expander state.
  const [usersPartnersOnly, setUsersPartnersOnly] = useState(false);
  const [expandedReferralsUserId, setExpandedReferralsUserId] = useState<string | null>(null);
  const [referralsDetail, setReferralsDetail] = useState<Record<string, { loading: boolean; data: AdminUserReferrals | null }>>({});
  const [promos, setPromos] = useState<AdminPromo[]>([]);
  const [promosLoading, setPromosLoading] = useState(false);
  const [showPromoForm, setShowPromoForm] = useState(false);
  // Promo source filter: separate codes the admin created by hand from
  // coupons users won by opening daily/super boxes. Box coupons are always
  // issued with the reserved `BOX` code prefix (see COUPON_CODE_PREFIX in
  // lib/boxes.ts), so the prefix is a reliable discriminator.
  const [promoFilter, setPromoFilter] = useState<'all' | 'mine' | 'boxes'>('all');

  // Promo activations — list of every user who applied a promo, with the
  // promo code, when, and what kind (days vs discount). Visible only to
  // the owner Telegram id (see ADMIN_OWNER_ID below) per explicit
  // requirement from 2026-05-13.
  type PromoActivation = {
    id: number;
    usedAt: string;
    promo: { id: number; code: string; days: number; discountPercent: number | null; deletedAt: string | null };
    user: {
      id: number;
      telegramId: number | null;
      username: string | null;
      firstName: string | null;
      lastName: string | null;
      email: string | null;
      referralCode: string | null;
      photoUrl: string | null;
    };
  };
  const [activations, setActivations] = useState<PromoActivation[]>([]);
  const [activationsLoading, setActivationsLoading] = useState(false);
  const [activationsSearch, setActivationsSearch] = useState('');
  const [activationsTotal, setActivationsTotal] = useState(0);
  const [activationDeletingId, setActivationDeletingId] = useState<number | null>(null);
  const [promoCode, setPromoCode] = useState('');
  const [promoType, setPromoType] = useState<'days' | 'discount'>('discount');
  const [promoDays, setPromoDays] = useState('7');
  const [promoDiscount, setPromoDiscount] = useState('50');
  const [promoMaxUses, setPromoMaxUses] = useState('100');
  const [promoCreating, setPromoCreating] = useState(false);
  const [banningId, setBanningId] = useState<number | null>(null);
  // Manual "add subscription days" control (owner-only). `grantOpenId` is the
  // user card whose inline days input is expanded; `grantValue` holds the typed
  // number of days; `grantingId` disables the button while a grant is in flight.
  const [grantOpenId, setGrantOpenId] = useState<string | null>(null);
  const [grantValue, setGrantValue] = useState('30');
  const [grantingId, setGrantingId] = useState<string | null>(null);

  // Broadcast state
  const [broadcasts, setBroadcasts] = useState<{ id: string; title: string | null; message: string; status: string; total_users: number; sent_count: number; failed_count: number; created_at: string; sent_at: string | null }[]>([]);
  const [broadcastsLoading, setBroadcastsLoading] = useState(false);
  const [showBroadcastForm, setShowBroadcastForm] = useState(false);
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  // 2026-05-11: ref + state for the custom-emoji helper that injects
  // `<tg-emoji emoji-id="…">FALLBACK</tg-emoji>` HTML tags into the
  // broadcast message at the cursor position. The bot already sends
  // broadcasts with parse_mode="HTML", so Telegram renders the tag as
  // a real custom emoji for users with Telegram Premium and as the
  // fallback character for everyone else.
  const broadcastMessageRef = useRef<HTMLTextAreaElement | null>(null);
  const [emojiHelperOpen, setEmojiHelperOpen] = useState(false);
  const [emojiHelperId, setEmojiHelperId] = useState('');
  const [emojiHelperFallback, setEmojiHelperFallback] = useState('');
  const [broadcastImage, setBroadcastImage] = useState('');
  // 2026-06-11: optionally upload a photo file instead of pasting a URL.
  // We keep the file as a base64 data URL (sent to the API as imageDataBase64)
  // plus a preview URL + filename for the UI. An uploaded file takes
  // precedence over the pasted broadcastImage URL.
  const [broadcastImageDataUrl, setBroadcastImageDataUrl] = useState<string | null>(null);
  const [broadcastImageName, setBroadcastImageName] = useState<string | null>(null);
  const broadcastImageInputRef = useRef<HTMLInputElement | null>(null);
  const [broadcastButtonText, setBroadcastButtonText] = useState('');
  const [broadcastButtonUrl, setBroadcastButtonUrl] = useState('');
  // 2026-05-05: button kind for the inline button in a broadcast.
  //   'url'   — plain URL (legacy, uses broadcastButtonUrl)
  //   'app'   — opens the Mini App (bot builds a t.me/<bot>?startapp=open URL)
  //   'promo' — opens the Mini App + auto-applies broadcastButtonPromoCode
  // When `broadcastButtonKind` ≠ 'url', `broadcastButtonUrl` is ignored.
  const [broadcastButtonKind, setBroadcastButtonKind] = useState<'url' | 'app' | 'promo'>('url');
  const [broadcastButtonPromoCode, setBroadcastButtonPromoCode] = useState('');
  const [broadcastTargetId, setBroadcastTargetId] = useState('');
  // v65: audience filter — 'all' (default) | 'active' | 'no_sub' | 'active_no_devices'.
  // 'active_no_devices' (2026-05-05): users with active sub but zero bound
  // devices — i.e. paid but never installed the VPN client.
  // Ignored when broadcastTargetId is set (single-user override).
  const [broadcastAudience, setBroadcastAudience] = useState<'all' | 'active' | 'no_sub' | 'active_no_devices'>('all');
  const [broadcastSending, setBroadcastSending] = useState(false);
  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);

  // --- v45 admin device management ---
  // Selected user whose devices are being inspected. `null` = modal closed.
  const [devicesUser, setDevicesUser] = useState<AdminUser | null>(null);
  const [devicesData, setDevicesData] = useState<{
    user: { id: string; telegram_id: string | null; sub_status: string | null; sub_end: string | null; max_devices: number | null; is_banned: boolean; subscription_url: string | null };
    devices: Array<{
      id: string; device_hash: string; device_name: string | null; ip_address: string | null;
      user_agent: string | null; created_at: string; last_seen_at: string;
      kicked_at: string | null; vpn_key_id: string | null; uuid: string | null;
      pool_assigned_at: string | null; rank: number;
    }>;
    pool: { assigned: number };
  } | null>(null);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [deviceActionId, setDeviceActionId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);



  // v57: when admin clicks "Написать" on a user card, this state tells
  // AdminTicketsView to open the composer pre-filled with the chosen
  // identifier. We then switch to the tickets tab.
  const [pendingCompose, setPendingCompose] = useState<{
    type: 'telegramId' | 'userId' | 'username';
    value: string;
  } | null>(null);

  // Hide bottom navigation while the admin device modal is open.
  useEffect(() => {
    onHideNav?.(!!devicesUser);
    return () => onHideNav?.(false);
  }, [devicesUser, onHideNav]);

  const copyToClipboard = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      haptic('light');
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    } catch { /* ignore */ }
  };

  // v57: pick the best identifier for the composer. telegram_id is preferred
  // (the user gets the message in the Mini App). For email-only users we fall
  // back to userId — the recipient sees the ticket in the web Support tab.
  const handleWriteToUser = (u: AdminUser) => {
    haptic('light');
    if (u.telegram_id) {
      setPendingCompose({ type: 'telegramId', value: u.telegram_id });
    } else if (u.username) {
      setPendingCompose({ type: 'username', value: u.username });
    } else {
      setPendingCompose({ type: 'userId', value: u.id });
    }
    setAdminTab('tickets');
  };

  const tgId = tgUser?.id;
  // Owner-only features (e.g. global promo-activation feed) are gated by
  // an exact match on this id, not by isAdmin(). The other admin
  // (1483598839) is a support seat and does not get this feed.
  // 2026-05-13: explicit user request — реализуй только у пользователя
  // с id 2029065770.
  const ADMIN_OWNER_ID = 2029065770;
  const isOwner = tgId === ADMIN_OWNER_ID;

  // Stat override feature — hidden behind password, owner-only.
  const [statEditorOpen, setStatEditorOpen] = useState(false);
  const [statPasswordInput, setStatPasswordInput] = useState('');
  const [statPasswordError, setStatPasswordError] = useState(false);
  const [statPasswordPrompt, setStatPasswordPrompt] = useState(false);
  const [statOverrides, setStatOverrides] = useState<Record<string, any>>({});
  const [statOverridesLoading, setStatOverridesLoading] = useState(false);
  const [statOverridesSaving, setStatOverridesSaving] = useState(false);
  const [statOverridesSaved, setStatOverridesSaved] = useState(false);
  const STAT_EDITOR_PASSWORD = process.env.NEXT_PUBLIC_STAT_EDITOR_PASSWORD ?? '';

  const loadStatOverrides = async () => {
    if (!tgId) return;
    setStatOverridesLoading(true);
    try {
      const res = await fetch(`/api/admin/stat-overrides?telegramId=${tgId}`);
      if (res.ok) {
        const data = await res.json();
        setStatOverrides(data.overrides ?? {});
      }
    } catch { /* ignore */ } finally { setStatOverridesLoading(false); }
  };

  const saveStatOverrides = async () => {
    if (!tgId) return;
    setStatOverridesSaving(true);
    setStatOverridesSaved(false);
    try {
      const res = await fetch('/api/admin/stat-overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: tgId, overrides: statOverrides }),
      });
      if (res.ok) {
        setStatOverridesSaved(true);
        // Reload stats so changes appear immediately
        loadStats();
        setTimeout(() => setStatOverridesSaved(false), 3000);
      }
    } catch { /* ignore */ } finally { setStatOverridesSaving(false); }
  };

  const handleStatPasswordSubmit = () => {
    if (statPasswordInput === STAT_EDITOR_PASSWORD) {
      setStatPasswordPrompt(false);
      setStatPasswordInput('');
      setStatPasswordError(false);
      setStatEditorOpen(true);
      loadStatOverrides();
    } else {
      setStatPasswordError(true);
    }
  };

  const updateOverride = (key: string, value: string) => {
    setStatOverrides((prev: Record<string, any>) => {
      const next = { ...prev };
      const num = Number(value);
      if (value === '' || value === undefined) {
        delete next[key];
      } else if (!isNaN(num)) {
        next[key] = num;
      }
      return next;
    });
  };

  const updateMonthlyOverride = (month: string, field: 'revenue' | 'paidCount', value: string) => {
    setStatOverrides((prev: Record<string, any>) => {
      const next = { ...prev };
      const monthly = { ...(next.monthlyRevenue || {}) };
      const entry = { ...(monthly[month] || {}) };
      const num = Number(value);
      if (value === '' || value === undefined) {
        delete entry[field];
      } else if (!isNaN(num)) {
        entry[field] = num;
      }
      // Clean up empty entries
      if (Object.keys(entry).length === 0) {
        delete monthly[month];
      } else {
        monthly[month] = entry;
      }
      if (Object.keys(monthly).length === 0) {
        delete next.monthlyRevenue;
      } else {
        next.monthlyRevenue = monthly;
      }
      return next;
    });
  };

  const loadMaintenance = async () => {
    try {
      const res = await fetch('/api/maintenance');
      if (res.ok) {
        const data = await res.json();
        setMaintenanceEnabled(data.enabled);
      }
    } catch { /* ignore */ }
  };

  const toggleMaintenance = async () => {
    if (!tgId) return;
    setMaintenanceLoading(true);
    try {
      const res = await fetch('/api/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: tgId, enabled: !maintenanceEnabled }),
      });
      if (res.ok) {
        setMaintenanceEnabled(!maintenanceEnabled);
      }
    } catch { /* ignore */ } finally { setMaintenanceLoading(false); }
  };

  const loadStats = async () => {
    if (!tgId) return;
    setStatsLoading(true);
    try {
      const res = await fetch(`/api/admin/stats?telegramId=${tgId}`);
      if (res.ok) {
        const data = await res.json();
        setStats(data.stats);
      }
    } catch { /* ignore */ } finally { setStatsLoading(false); }
  };

  const loadUsers = async (
    page = 1,
    search = '',
    subscription: 'all' | 'active' | 'none' | 'active_no_devices' = 'all',
    sort: 'recent' | 'lifetime' = 'recent',
    // 2026-06-13: pass an explicit value when toggling the partner filter to
    // avoid the stale-closure read; otherwise falls back to current state.
    partnersOverride?: boolean,
  ) => {
    if (!tgId) return;
    setUsersLoading(true);
    try {
      const params = new URLSearchParams({ telegramId: String(tgId), page: String(page) });
      if (search) params.set('search', search);
      if (subscription && subscription !== 'all') params.set('subscription', subscription);
      if (sort && sort !== 'recent') params.set('sort', sort);
      const partners = partnersOverride ?? usersPartnersOnly;
      if (partners) params.set('partner', '1');
      const res = await fetch(`/api/admin/users?${params}`);
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users ?? []);
        setUsersTotalPages(data.totalPages ?? 1);
        setUsersPage(data.page ?? 1);
      }
    } catch { /* ignore */ } finally { setUsersLoading(false); }
  };

  // 2026-06-13: toggle the "partners only" filter and reload from page 1.
  const handlePartnersToggle = () => {
    const next = !usersPartnersOnly;
    setUsersPartnersOnly(next);
    setExpandedReferralsUserId(null);
    loadUsers(1, usersSearch, usersSubFilter, usersSortBy, next);
  };

  // 2026-06-13: lazy-load a user's invitee list for the card expander.
  const loadUserReferrals = async (userId: string) => {
    if (!tgId) return;
    setReferralsDetail((prev) => ({ ...prev, [userId]: { loading: true, data: prev[userId]?.data ?? null } }));
    try {
      const res = await fetch(`/api/admin/users/${userId}/referrals?telegramId=${tgId}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setReferralsDetail((prev) => ({ ...prev, [userId]: { loading: false, data } }));
      } else {
        setReferralsDetail((prev) => ({ ...prev, [userId]: { loading: false, data: prev[userId]?.data ?? null } }));
      }
    } catch {
      setReferralsDetail((prev) => ({ ...prev, [userId]: { loading: false, data: prev[userId]?.data ?? null } }));
    }
  };

  const toggleUserReferrals = (userId: string) => {
    if (expandedReferralsUserId === userId) { setExpandedReferralsUserId(null); return; }
    setExpandedReferralsUserId(userId);
    if (!referralsDetail[userId]?.data) loadUserReferrals(userId);
  };

  const loadPromos = async () => {
    if (!tgId) return;
    setPromosLoading(true);
    try {
      const res = await fetch(`/api/admin/promos?telegramId=${tgId}`);
      if (res.ok) {
        const data = await res.json();
        setPromos(data.promos ?? []);
      }
    } catch { /* ignore */ } finally { setPromosLoading(false); }
  };

  // Owner-only: load the global feed of promo activations.
  const loadActivations = async (searchTerm = activationsSearch) => {
    if (!tgId || !isOwner) return;
    setActivationsLoading(true);
    try {
      const params = new URLSearchParams({ telegramId: String(tgId), limit: '200' });
      const term = searchTerm.trim();
      if (term) params.set('search', term);
      const res = await fetch(`/api/admin/promos/activations?${params}`);
      if (res.ok) {
        const data = await res.json();
        setActivations(data.activations ?? []);
        setActivationsTotal(Number(data.total ?? 0));
      } else {
        setActivations([]);
        setActivationsTotal(0);
      }
    } catch {
      setActivations([]);
      setActivationsTotal(0);
    } finally {
      setActivationsLoading(false);
    }
  };

  // Remove a single activation row (does NOT undo what the activation
  // granted — only deletes the audit row + decrements used_count). The
  // backend handles those side-effects.
  const handleDeleteActivation = async (activationId: number) => {
    if (!tgId || !isOwner) return;
    if (!confirm(lang === 'ru'
      ? 'Удалить эту активацию из истории? Бонус, который получил пользователь, останется у него.'
      : 'Remove this activation from history? The bonus the user already received will stay.'
    )) return;
    setActivationDeletingId(activationId);
    try {
      const params = new URLSearchParams({ telegramId: String(tgId), activationId: String(activationId) });
      const res = await fetch(`/api/admin/promos/activations?${params}`, { method: 'DELETE' });
      if (res.ok) {
        // Optimistic: drop the row locally so the user doesn't wait for
        // a full reload. The total counter also decrements.
        setActivations((prev) => prev.filter((a) => a.id !== activationId));
        setActivationsTotal((prev) => Math.max(0, prev - 1));
      } else {
        const data = await res.json().catch(() => null);
        alert((data && data.error) || (lang === 'ru' ? 'Ошибка удаления' : 'Delete failed'));
      }
    } catch {
      alert(lang === 'ru' ? 'Ошибка сети' : 'Network error');
    } finally {
      setActivationDeletingId(null);
    }
  };

  const loadBroadcasts = async () => {
    if (!tgId) return;
    setBroadcastsLoading(true);
    try {
      const res = await fetch(`/api/admin/broadcasts?telegramId=${tgId}`);
      if (res.ok) {
        const data = await res.json();
        setBroadcasts(data.broadcasts ?? []);
      }
    } catch { /* ignore */ } finally { setBroadcastsLoading(false); }
  };

  // 2026-05-11: inject a `<tg-emoji emoji-id="…">FALLBACK</tg-emoji>` tag
  // at the current caret position of the broadcast textarea. The tag is
  // recognised by Telegram's HTML parser (Bot API ≥ 6.6), and the bot
  // already calls send_message/send_photo with parse_mode="HTML", so
  // nothing on the delivery side needs to change. Users with Telegram
  // Premium see the real custom emoji; everyone else sees the inner
  // fallback character.
  const insertCustomEmoji = () => {
    const ta = broadcastMessageRef.current;
    const id = emojiHelperId.trim();
    const fallback = emojiHelperFallback.trim();
    if (!id || !fallback) return;
    const tag = `<tg-emoji emoji-id="${id}">${fallback}</tg-emoji>`;
    const start = ta?.selectionStart ?? broadcastMessage.length;
    const end = ta?.selectionEnd ?? broadcastMessage.length;
    const next = broadcastMessage.slice(0, start) + tag + broadcastMessage.slice(end);
    setBroadcastMessage(next);
    setEmojiHelperId('');
    setEmojiHelperFallback('');
    // Restore focus + place the caret right after the inserted tag so
    // the admin can keep typing without re-clicking the textarea.
    if (ta) {
      setTimeout(() => {
        ta.focus();
        const pos = start + tag.length;
        ta.setSelectionRange(pos, pos);
      }, 0);
    }
  };

  // 2026-06-11: read a picked broadcast image file into a base64 data URL.
  const handleBroadcastImagePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert(t.adminBroadcastImageBadType);
      if (broadcastImageInputRef.current) broadcastImageInputRef.current.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert(t.adminBroadcastImageTooBig);
      if (broadcastImageInputRef.current) broadcastImageInputRef.current.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setBroadcastImageDataUrl(typeof reader.result === 'string' ? reader.result : null);
      setBroadcastImageName(file.name);
      // A file overrides the pasted URL — clear it to avoid confusion.
      setBroadcastImage('');
    };
    reader.readAsDataURL(file);
  };

  const clearBroadcastImageFile = () => {
    setBroadcastImageDataUrl(null);
    setBroadcastImageName(null);
    if (broadcastImageInputRef.current) broadcastImageInputRef.current.value = '';
  };

  const handleCreateBroadcast = async () => {
    haptic('heavy');
    if (!tgId || !broadcastMessage.trim()) return;
    // 2026-05-05: for 'promo' kind the code is required — the API will
    // reject without it anyway, so fail fast on the client.
    if (broadcastButtonKind === 'promo' && !broadcastButtonPromoCode.trim()) {
      alert(lang === 'ru' ? 'Укажите промокод для кнопки' : 'Promo code is required');
      return;
    }
    setBroadcastSending(true);
    try {
      const res = await fetch('/api/admin/broadcasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegramId: tgId,
          title: broadcastTitle.trim() || null,
          message: broadcastMessage.trim(),
          // An uploaded file (imageDataBase64) takes precedence over a pasted
          // URL on the server; we still send imageUrl as a fallback.
          imageUrl: broadcastImage.trim() || null,
          imageDataBase64: broadcastImageDataUrl || null,
          buttonText: broadcastButtonText.trim() || null,
          // For 'app'/'promo' kinds the bot builds the URL itself, so
          // we don't need to send buttonUrl. Sending it anyway is fine —
          // the server strips it for non-'url' kinds.
          buttonUrl: broadcastButtonKind === 'url' ? (broadcastButtonUrl.trim() || null) : null,
          // 2026-05-05: button kind + promo code.
          buttonKind: broadcastButtonKind,
          buttonPromoCode: broadcastButtonKind === 'promo'
            ? broadcastButtonPromoCode.trim().toUpperCase()
            : null,
          targetTelegramId: broadcastTargetId.trim() || null,
          // v65: audience filter ignored server-side when targetTelegramId is set.
          targetAudience: broadcastAudience,
        }),
      });
      if (res.ok) {
        setBroadcastTitle('');
        setBroadcastMessage('');
        setBroadcastImage('');
        clearBroadcastImageFile();
        setBroadcastButtonText('');
        setBroadcastButtonUrl('');
        setBroadcastButtonKind('url');
        setBroadcastButtonPromoCode('');
        setBroadcastTargetId('');
        setBroadcastAudience('all');
        setEmojiHelperOpen(false);
        setEmojiHelperId('');
        setEmojiHelperFallback('');
        setShowBroadcastForm(false);
        await loadBroadcasts();
      } else {
        const data = await res.json().catch(() => ({ error: 'Error' }));
        alert(data.error || 'Error');
      }
    } catch { /* ignore */ } finally { setBroadcastSending(false); }
  };

  const handleBan = async (userId: number | string, ban: boolean, banType?: 'login' | 'subscription') => {
    haptic('heavy');
    if (!tgId) return;
    const normalizedUserId = typeof userId === 'string' ? Number(userId) : userId;
    if (!Number.isFinite(normalizedUserId)) {
      alert('Invalid user id');
      return;
    }

    setBanningId(normalizedUserId);
    try {
      const res = await fetch('/api/admin/ban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: tgId, targetUserId: normalizedUserId, ban, banType }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Error' }));
        alert(data.error || 'Error');
        return;
      }

      await loadUsers(usersPage, usersSearch, usersSubFilter, usersSortBy);
    } catch { /* ignore */ } finally { setBanningId(null); }
  };

  // Manually add (days > 0) or remove (days < 0) subscription days for a user.
  // Hits POST /api/admin/users/[id]/grant-days, then refreshes the list so the
  // card's "N days left" badge reflects the new expiry immediately.
  const handleGrantDays = async (userId: number | string, rawDays: string) => {
    haptic('medium');
    if (!tgId) return;
    const days = Math.trunc(Number(rawDays));
    if (!Number.isFinite(days) || days === 0) {
      alert(lang === 'ru' ? 'Введите ненулевое число дней' : 'Enter a non-zero number of days');
      return;
    }
    const key = String(userId);
    setGrantingId(key);
    try {
      const res = await fetch(`/api/admin/users/${userId}/grant-days`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: tgId, days }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Error' }));
        alert(data.error || 'Error');
        return;
      }
      setGrantOpenId(null);
      await loadUsers(usersPage, usersSearch, usersSubFilter, usersSortBy);
    } catch { /* ignore */ } finally { setGrantingId(null); }
  };

  const handleCreatePromo = async () => {
    haptic('medium');
    if (!tgId || !promoCode.trim()) return;
    if (promoType === 'days' && !promoDays) return;
    if (promoType === 'discount' && !promoDiscount) return;
    setPromoCreating(true);
    try {
      const payload: Record<string, unknown> = {
        telegramId: tgId,
        code: promoCode.trim(),
        maxUses: Number(promoMaxUses) || 100,
      };
      if (promoType === 'days') {
        payload.days = Number(promoDays);
      } else {
        payload.discountPercent = Number(promoDiscount);
      }
      const res = await fetch('/api/admin/promos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setPromoCode('');
        setPromoDays('7');
        setPromoDiscount('50');
        setPromoMaxUses('100');
        setShowPromoForm(false);
        await loadPromos();
      } else {
        const data = await res.json();
        alert(data.error || 'Error');
      }
    } catch { /* ignore */ } finally { setPromoCreating(false); }
  };

  const handleDeletePromo = async (promoId: number) => {
    haptic('heavy');
    if (!tgId) return;
    try {
      await fetch(`/api/admin/promos?telegramId=${tgId}&promoId=${promoId}`, { method: 'DELETE' });
      await loadPromos();
    } catch { /* ignore */ }
  };

  // v45: admin device management. Opens a modal showing ALL sessions (including
  // kicked / over-limit) for the selected user, with kick / unkick controls.
  const openUserDevices = async (u: AdminUser) => {
    haptic('medium');
    if (!tgId) return;
    setDevicesUser(u);
    setDevicesData(null);
    setDevicesLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${u.id}/devices?telegramId=${tgId}`, { cache: 'no-store' });
      if (res.ok) {
        setDevicesData(await res.json());
      } else {
        setDevicesData(null);
      }
    } catch { setDevicesData(null); }
    finally { setDevicesLoading(false); }
  };

  const closeUserDevices = () => {
    setDevicesUser(null);
    setDevicesData(null);
  };

  const reloadDevices = async () => {
    if (!tgId || !devicesUser) return;
    setDevicesLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${devicesUser.id}/devices?telegramId=${tgId}`, { cache: 'no-store' });
      if (res.ok) setDevicesData(await res.json());
    } catch { /* ignore */ }
    finally { setDevicesLoading(false); }
  };

  const handleAdminKick = async (deviceId: string) => {
    if (!tgId || !devicesUser) return;
    haptic('heavy');
    setDeviceActionId(deviceId);
    try {
      const res = await fetch(
        `/api/admin/users/${devicesUser.id}/devices/${deviceId}?telegramId=${tgId}`,
        { method: 'DELETE' },
      );
      if (res.ok) {
        await reloadDevices();
      } else {
        const data = await res.json().catch(() => ({ error: 'Error' }));
        alert(data.error || 'Error');
      }
    } catch { /* ignore */ }
    finally { setDeviceActionId(null); }
  };

  const handleAdminUnkick = async (deviceId: string) => {
    if (!tgId || !devicesUser) return;
    haptic('medium');
    setDeviceActionId(deviceId);
    try {
      const res = await fetch(
        `/api/admin/users/${devicesUser.id}/devices/${deviceId}?telegramId=${tgId}&action=unkick`,
        { method: 'POST' },
      );
      if (res.ok) {
        await reloadDevices();
      } else {
        const data = await res.json().catch(() => ({ error: 'Error' }));
        alert(data.error || 'Error');
      }
    } catch { /* ignore */ }
    finally { setDeviceActionId(null); }
  };

  // Hard-delete: physically removes the device_sessions row so device_hash
  // can re-register freely. Use this to clean up stale/kicked rows.
  const handleAdminHardDelete = async (deviceId: string) => {
    if (!tgId || !devicesUser) return;
    if (!confirm(lang === 'ru'
      ? 'Удалить запись об устройстве навсегда? Пользователь сможет снова добавить это устройство.'
      : 'Delete this device record permanently? User will be able to re-register it.')) return;
    haptic('heavy');
    setDeviceActionId(deviceId);
    try {
      const res = await fetch(
        `/api/admin/users/${devicesUser.id}/devices/${deviceId}?telegramId=${tgId}&hard=1`,
        { method: 'DELETE' },
      );
      if (res.ok) {
        await reloadDevices();
      } else {
        const data = await res.json().catch(() => ({ error: 'Error' }));
        alert(data.error || 'Error');
      }
    } catch { /* ignore */ }
    finally { setDeviceActionId(null); }
  };

  useEffect(() => {
    loadMaintenance();
  }, []);



  useEffect(() => {
    if (adminTab === 'stats') { loadStats(); }
    else if (adminTab === 'users') loadUsers(1, usersSearch, usersSubFilter, usersSortBy);
    else if (adminTab === 'promos') loadPromos();
    else if (adminTab === 'activations') loadActivations(activationsSearch);
    else if (adminTab === 'broadcasts') loadBroadcasts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminTab, tgId]);


  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadUsers(1, usersSearch, usersSubFilter, usersSortBy);
  };

  // v58 / v68: clicking a subscription filter button refetches users from page 1.
  const handleSubFilterChange = (next: 'all' | 'active' | 'none' | 'active_no_devices') => {
    setUsersSubFilter(next);
    loadUsers(1, usersSearch, next, usersSortBy);
  };

  // v68: toggle between recent-signup (default) and lifetime-days-desc sort.
  const handleSortChange = (next: 'recent' | 'lifetime') => {
    setUsersSortBy(next);
    loadUsers(1, usersSearch, usersSubFilter, next);
  };


  return (
    /* 2026-05-23: на ПК админка раньше сидела в `max-w-md` (448 px) —
       юзер пожаловался что «пиздец узкая». Теперь на lg+ растягиваем
       до 1280 px (как у корневого main-контейнера), на мобайле
       остаётся та же ширина с горизонтальным паддингом. */
    <motion.div custom={direction} variants={pageVariants} initial="initial" animate="animate" exit="exit" className="flex flex-col flex-1 items-center w-full px-3">
      <div className="w-full max-w-md lg:max-w-[1280px]">
        <button onClick={() => navigate('profile')} className="mb-3 text-zinc-300 hover:text-white text-sm inline-flex items-center gap-2">
          <ChevronRight size={14} className="rotate-180" /> {t.adminBackToProfile}
        </button>

        {/* Maintenance Toggle */}
        <div className={`rounded-2xl border p-4 mb-4 ${maintenanceEnabled ? 'border-yellow-500/30 bg-yellow-500/10' : 'border-white/10 bg-zinc-900/40'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${maintenanceEnabled ? 'bg-yellow-500/20' : 'bg-zinc-800'}`}>
                <Settings size={18} className={maintenanceEnabled ? 'text-yellow-400' : 'text-zinc-500'} />
              </div>
              <div>
                <h4 className="text-white font-medium text-sm">{lang === 'ru' ? 'Тех. работы' : 'Maintenance'}</h4>
                <p className="text-zinc-500 text-xs">{maintenanceEnabled ? (lang === 'ru' ? 'Включено' : 'Enabled') : (lang === 'ru' ? 'Выключено' : 'Disabled')}</p>
              </div>
            </div>
            <button
              onClick={toggleMaintenance}
              disabled={maintenanceLoading}
              className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${maintenanceEnabled ? 'bg-yellow-500 text-black hover:bg-yellow-400' : 'bg-zinc-800 text-white hover:bg-zinc-700'} disabled:opacity-50`}
            >
              {maintenanceLoading ? '...' : (maintenanceEnabled ? (lang === 'ru' ? 'Выключить' : 'Disable') : (lang === 'ru' ? 'Включить' : 'Enable'))}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-zinc-900/40 p-4 mb-4">
          <div className="flex items-center justify-between mb-4 gap-2">
            <h3 className="text-lg font-bold text-white flex items-center gap-2 min-w-0">
              <ShieldAlert size={20} className="text-red-400 shrink-0" />
              <span className="truncate">{t.adminPanel}</span>
            </h3>
            {onLockAdmin && (
              <button
                onClick={onLockAdmin}
                className="shrink-0 inline-flex items-center gap-1.5 text-zinc-400 hover:text-red-400 border border-white/10 hover:border-red-500/40 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors"
                title={lang === 'ru' ? 'Закрыть админку (потребуется снова ввести пароль)' : 'Lock admin panel (password required again)'}
              >
                <Lock size={12} />
                {lang === 'ru' ? 'Закрыть' : 'Lock'}
              </button>
            )}
          </div>

          {/* Admin Sub-tabs */}
          <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
            <button onClick={() => setAdminTab('stats')} className={`text-xs font-medium py-2 px-3 rounded-lg border transition-all whitespace-nowrap shrink-0 ${adminTab === 'stats' ? 'bg-white/10 border-white/25 text-white' : 'border-white/5 text-zinc-400 hover:text-white'}`}>
              {t.adminStats}
            </button>
            <button onClick={() => setAdminTab('users')} className={`text-xs font-medium py-2 px-3 rounded-lg border transition-all whitespace-nowrap shrink-0 ${adminTab === 'users' ? 'bg-white/10 border-white/25 text-white' : 'border-white/5 text-zinc-400 hover:text-white'}`}>
              {t.adminUsers}
            </button>
            <button onClick={() => setAdminTab('promos')} className={`text-xs font-medium py-2 px-3 rounded-lg border transition-all whitespace-nowrap shrink-0 ${adminTab === 'promos' ? 'bg-white/10 border-white/25 text-white' : 'border-white/5 text-zinc-400 hover:text-white'}`}>
              {t.adminPromos}
            </button>
            {isOwner && (
              <button onClick={() => setAdminTab('activations')} className={`text-xs font-medium py-2 px-3 rounded-lg border transition-all whitespace-nowrap shrink-0 ${adminTab === 'activations' ? 'bg-red-500/15 border-red-500/40 text-white' : 'border-white/5 text-zinc-400 hover:text-white'}`}>
                {lang === 'ru' ? '🎁 Активации' : '🎁 Activations'}
              </button>
            )}
            <button onClick={() => setAdminTab('tickets')} className={`text-xs font-medium py-2 px-3 rounded-lg border transition-all whitespace-nowrap shrink-0 ${adminTab === 'tickets' ? 'bg-white/10 border-white/25 text-white' : 'border-white/5 text-zinc-400 hover:text-white'}`}>
              {t.adminTickets}
            </button>
            {isOwner && (
              <button onClick={() => setAdminTab('broadcasts')} className={`text-xs font-medium py-2 px-3 rounded-lg border transition-all whitespace-nowrap shrink-0 ${adminTab === 'broadcasts' ? 'bg-white/10 border-white/25 text-white' : 'border-white/5 text-zinc-400 hover:text-white'}`}>
                {t.adminBroadcasts}
              </button>
            )}
            <button onClick={() => setAdminTab('referrals')} className={`text-xs font-medium py-2 px-3 rounded-lg border transition-all whitespace-nowrap shrink-0 ${adminTab === 'referrals' ? 'bg-white/10 border-white/25 text-white' : 'border-white/5 text-zinc-400 hover:text-white'}`}>
              Рефералы
            </button>
            <button onClick={() => setAdminTab('withdrawals')} className={`text-xs font-medium py-2 px-3 rounded-lg border transition-all whitespace-nowrap shrink-0 ${adminTab === 'withdrawals' ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200' : 'border-white/5 text-zinc-400 hover:text-white'}`}>
              💸 {lang === 'ru' ? 'Выводы' : 'Withdrawals'}
            </button>
            <button onClick={() => setAdminTab('fragment')} className={`text-xs font-medium py-2 px-3 rounded-lg border transition-all whitespace-nowrap shrink-0 ${adminTab === 'fragment' ? 'bg-gradient-to-r from-purple-500/20 to-yellow-500/20 border-purple-500/50 text-white' : 'border-white/5 text-zinc-400 hover:text-white'}`}>
              ⭐ Fragment
            </button>
            <button onClick={() => setAdminTab('services')} className={`text-xs font-medium py-2 px-3 rounded-lg border transition-all whitespace-nowrap shrink-0 ${adminTab === 'services' ? 'bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 border-emerald-500/50 text-white' : 'border-white/5 text-zinc-400 hover:text-white'}`}>
              🌐 {t.adminServices}
            </button>
            {isOwner && (
              <button onClick={() => setAdminTab('boxes')} className={`text-xs font-medium py-2 px-3 rounded-lg border transition-all whitespace-nowrap shrink-0 ${adminTab === 'boxes' ? 'bg-gradient-to-r from-fuchsia-500/20 to-amber-500/20 border-fuchsia-500/40 text-white' : 'border-white/5 text-zinc-400 hover:text-white'}`}>
                📦 Боксы
              </button>
            )}
          </div>

          {/* Stats Tab */}
          {adminTab === 'stats' && (
            statsLoading ? (
              <div className="text-center py-8 text-zinc-400 text-sm">Загрузка...</div>
            ) : stats ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Users size={14} className="text-blue-400" />
                    <span className="text-zinc-400 text-[10px] uppercase tracking-wider">{t.adminTotalUsers}</span>
                  </div>
                  <span className="text-white text-xl font-bold">{stats.totalUsers}</span>
                </div>
                <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Users size={14} className="text-green-400" />
                    <span className="text-zinc-400 text-[10px] uppercase tracking-wider">{t.adminTodayUsers}</span>
                  </div>
                  <span className="text-white text-xl font-bold">{stats.todayUsers}</span>
                </div>
                <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Ban size={14} className="text-red-400" />
                    <span className="text-zinc-400 text-[10px] uppercase tracking-wider">{t.adminBannedUsers}</span>
                  </div>
                  <span className="text-white text-xl font-bold">{stats.bannedUsers}</span>
                </div>
                <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <CreditCard size={14} className="text-yellow-400" />
                    <span className="text-zinc-400 text-[10px] uppercase tracking-wider">{t.adminRevenue}</span>
                  </div>
                  <span className="text-white text-xl font-bold">{stats.totalRevenue}₽</span>
                </div>
                <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Calendar size={14} className="text-amber-400" />
                    <span className="text-zinc-400 text-[10px] uppercase tracking-wider">{t.adminRevenueMonth}</span>
                  </div>
                  <span className="text-white text-xl font-bold">{stats.currentMonthRevenue}₽</span>
                </div>
                <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Zap size={14} className="text-cyan-400" />
                    <span className="text-zinc-400 text-[10px] uppercase tracking-wider">{t.adminActiveSubs}</span>
                  </div>
                  <span className="text-white text-xl font-bold">{stats.activeSubscriptions}</span>
                </div>
                <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Check size={14} className="text-emerald-400" />
                    <span className="text-zinc-400 text-[10px] uppercase tracking-wider">{t.adminPaidPayments}</span>
                  </div>
                  <span className="text-white text-xl font-bold">{stats.paidPayments}</span>
                </div>
                <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Download size={14} className="text-violet-400" />
                    <span className="text-zinc-400 text-[10px] uppercase tracking-wider">{t.adminTraffic}</span>
                  </div>
                  <span className="text-white text-xl font-bold">{formatTrafficBytes(stats.totalTrafficBytes)}</span>
                </div>
              </div>
            ) : null
          )}

          {/* Revenue by month (v-monthly) — visible on Stats tab */}
          {adminTab === 'stats' && stats && stats.monthlyRevenue && stats.monthlyRevenue.length > 0 && (
            <div className="mt-3 rounded-xl border border-white/10 bg-zinc-900/60 p-3">
              <div className="flex items-center gap-2 mb-3">
                <Calendar size={14} className="text-amber-400" />
                <span className="text-zinc-400 text-[10px] uppercase tracking-wider">{t.adminRevenueByMonth}</span>
              </div>
              {(() => {
                const maxRev = Math.max(...stats.monthlyRevenue.map((m) => m.revenue), 1);
                const monthNames = lang === 'ru'
                  ? ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']
                  : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                const fmtMonth = (m: string) => {
                  const [y, mo] = m.split('-');
                  const idx = parseInt(mo, 10) - 1;
                  return `${monthNames[idx] ?? mo} ${y}`;
                };
                return (
                  <div className="space-y-2">
                    {stats.monthlyRevenue.map((m) => (
                      <div key={m.month} className="flex items-center gap-2">
                        <span className="text-zinc-400 text-[11px] w-16 shrink-0">{fmtMonth(m.month)}</span>
                        <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-amber-500/70 to-yellow-400"
                            style={{ width: `${(m.revenue / maxRev) * 100}%` }}
                          />
                        </div>
                        <span className="text-white text-[12px] font-semibold w-20 text-right shrink-0">{m.revenue}₽</span>
                        <span className="text-zinc-500 text-[10px] w-12 text-right shrink-0">{m.paidCount} {lang === 'ru' ? 'опл.' : 'paid'}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}



          {/* Users Tab */}
          {adminTab === 'users' && (
            <div>
              <form onSubmit={handleSearchSubmit} className="mb-2 flex gap-2">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="text"
                    value={usersSearch}
                    onChange={(e) => setUsersSearch(e.target.value)}
                    placeholder={t.adminSearchUsers}
                    className="w-full bg-zinc-800/60 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-white/25"
                  />
                </div>
                <button type="submit" className="bg-white/10 border border-white/15 text-white px-3 rounded-lg text-sm hover:bg-white/15">
                  <Search size={14} />
                </button>
              </form>

              {/* v58 / v68: subscription filter chips + lifetime sort. */}
              <div className="mb-3 flex gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => handleSubFilterChange('all')}
                  className={`text-[11px] px-2.5 py-1 rounded-md border transition-all ${usersSubFilter === 'all' ? 'bg-white/10 border-white/25 text-white' : 'border-white/5 text-zinc-400 hover:text-white hover:border-white/15'}`}
                >
                  {lang === 'ru' ? 'Все' : 'All'}
                </button>
                <button
                  type="button"
                  onClick={() => handleSubFilterChange('active')}
                  className={`text-[11px] px-2.5 py-1 rounded-md border transition-all inline-flex items-center gap-1 ${usersSubFilter === 'active' ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-200' : 'border-white/5 text-zinc-400 hover:text-emerald-200 hover:border-emerald-500/30'}`}
                >
                  ✅ {lang === 'ru' ? 'С подпиской' : 'With sub'}
                </button>
                <button
                  type="button"
                  onClick={() => handleSubFilterChange('none')}
                  className={`text-[11px] px-2.5 py-1 rounded-md border transition-all inline-flex items-center gap-1 ${usersSubFilter === 'none' ? 'bg-red-500/20 border-red-500/40 text-red-200' : 'border-white/5 text-zinc-400 hover:text-red-200 hover:border-red-500/30'}`}
                >
                  ❌ {lang === 'ru' ? 'Без подписки' : 'No sub'}
                </button>
                {/* v68: "Платящие без устройств" — активная подписка + 0 устройств.
                    Подсвечено оранжевым как внимание/подозрение на абьюз. */}
                <button
                  type="button"
                  onClick={() => handleSubFilterChange('active_no_devices')}
                  className={`text-[11px] px-2.5 py-1 rounded-md border transition-all inline-flex items-center gap-1 ${usersSubFilter === 'active_no_devices' ? 'bg-orange-500/20 border-orange-500/40 text-orange-200' : 'border-white/5 text-zinc-400 hover:text-orange-200 hover:border-orange-500/30'}`}
                  title={lang === 'ru' ? 'Платят подписку, но ни одного устройства не привязали' : 'Paying users with zero bound devices'}
                >
                  ⚠️ {lang === 'ru' ? 'Суб без устр-в' : 'Sub no dev'}
                </button>
                {/* 2026-06-13: partner-only filter (inviters with a special реф-условием). */}
                <button
                  type="button"
                  onClick={handlePartnersToggle}
                  className={`text-[11px] px-2.5 py-1 rounded-md border transition-all inline-flex items-center gap-1 ${usersPartnersOnly ? 'bg-amber-500/20 border-amber-500/40 text-amber-200' : 'border-white/5 text-zinc-400 hover:text-amber-200 hover:border-amber-500/30'}`}
                  title={lang === 'ru' ? 'Только партнёры (особое реф-условие)' : 'Partners only'}
                >
                  🤝 {lang === 'ru' ? 'Партнёры' : 'Partners'}
                </button>
              </div>

              {/* v68: sort toggle. "По дням" — сортирует по полной сумме
                  дней подписки за всё время по убыванию — быстрый способ
                  найти heavy users для расследования абьюза. */}
              <div className="mb-3 flex gap-1.5 items-center text-[10px] text-zinc-500">
                <span className="shrink-0">{lang === 'ru' ? 'Сорт:' : 'Sort:'}</span>
                <button
                  type="button"
                  onClick={() => handleSortChange('recent')}
                  className={`px-2 py-1 rounded border transition-all ${usersSortBy === 'recent' ? 'bg-white/10 border-white/25 text-white' : 'border-white/5 text-zinc-400 hover:text-white hover:border-white/15'}`}
                >
                  {lang === 'ru' ? 'Новые' : 'Recent'}
                </button>
                <button
                  type="button"
                  onClick={() => handleSortChange('lifetime')}
                  className={`px-2 py-1 rounded border transition-all inline-flex items-center gap-1 ${usersSortBy === 'lifetime' ? 'bg-purple-500/20 border-purple-500/40 text-purple-200' : 'border-white/5 text-zinc-400 hover:text-purple-200 hover:border-purple-500/30'}`}
                  title={lang === 'ru' ? 'Сумма дней подписки за всё время' : 'Total subscription days lifetime'}
                >
                  📊 {lang === 'ru' ? 'По дням' : 'By days'}
                </button>
              </div>

              {usersLoading ? (
                <div className="text-center py-8 text-zinc-400 text-sm">Загрузка...</div>
              ) : users.length === 0 ? (
                <div className="text-center py-8 text-zinc-400 text-sm">{t.adminNoUsers}</div>
              ) : (
                <div className="space-y-2">
                  {users.map((u) => {
                    // v57: build a list of identifier rows that the admin can
                    // copy from the card. user.id is always present;
                    // telegram_id / username / email are optional.
                    const idRows: { key: string; label: React.ReactNode; value: string; mono?: boolean }[] = [
                      { key: 'id', label: 'ID', value: u.id, mono: true },
                    ];
                    if (u.telegram_id) idRows.push({ key: 'tg', label: 'TG', value: u.telegram_id, mono: true });
                    if (u.username) idRows.push({ key: 'un', label: '@', value: u.username, mono: true });
                    if (u.email) idRows.push({ key: 'em', label: <Mail size={11} className="opacity-70" />, value: u.email });

                    // Display name fallbacks: full name → @username → email → user#id.
                    const displayName =
                      [u.first_name, u.last_name].filter(Boolean).join(' ')
                      || u.username
                      || u.email
                      || (u.telegram_id ? `TG ${u.telegram_id}` : `User #${u.id}`);

                    return (
                    <div key={u.id} className="rounded-xl border border-white/10 bg-zinc-900/60 p-3">
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <p className="text-white text-sm font-medium truncate">
                              {displayName}
                            </p>
                            {u.is_partner && (
                              <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/15 text-amber-300 uppercase tracking-wide font-semibold">
                                🤝 {lang === 'ru' ? 'Партнёр' : 'Partner'}
                              </span>
                            )}
                          </div>
                          <div className="space-y-0.5 mt-1">
                            {idRows.map((row) => {
                              const copyKey = `u${u.id}-${row.key}`;
                              return (
                                <div key={row.key} className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                                  <span className="opacity-70 shrink-0 inline-flex items-center justify-center w-5 text-center">{row.label}</span>
                                  <span className={`truncate flex-1 min-w-0 ${row.mono ? 'font-mono' : ''} text-zinc-300`}>{row.value}</span>
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); copyToClipboard(row.value, copyKey); }}
                                    className="text-zinc-500 hover:text-white shrink-0 p-0.5 transition-colors"
                                    title={lang === 'ru' ? 'Копировать' : 'Copy'}
                                  >
                                    {copiedKey === copyKey ? <ClipboardCheck size={12} className="text-emerald-400" /> : <Copy size={12} />}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        {u.auth_type && u.auth_type !== 'telegram' && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded border border-blue-500/30 bg-blue-500/10 text-blue-300 shrink-0 uppercase tracking-wide">
                            {u.auth_type}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 mt-2 flex-wrap">
                          <button
                            onClick={() => handleWriteToUser(u)}
                            className="text-[10px] px-2.5 py-1.5 rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/30 hover:bg-purple-500/30 inline-flex items-center gap-1"
                            title={lang === 'ru' ? 'Открыть форму обращений' : 'Open ticket composer'}
                          >
                            <Send size={10} /> {lang === 'ru' ? 'Написать' : 'Message'}
                          </button>
                          <button
                            onClick={() => openUserDevices(u)}
                            className="text-[10px] px-2.5 py-1.5 rounded-lg bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 inline-flex items-center gap-1"
                          >
                            <Smartphone size={10} /> {lang === 'ru' ? 'Устройства' : 'Devices'}
                          </button>
                          {isOwner && (
                            <button
                              onClick={() => { haptic('light'); setGrantValue('30'); setGrantOpenId(grantOpenId === String(u.id) ? null : String(u.id)); }}
                              className="text-[10px] px-2.5 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 inline-flex items-center gap-1"
                            >
                              <Plus size={10} /> {lang === 'ru' ? 'Дни' : 'Days'}
                            </button>
                          )}
                          {isOwner && grantOpenId === String(u.id) && (
                            <div className="w-full flex items-center gap-1.5 mt-1">
                              <input
                                type="number"
                                inputMode="numeric"
                                value={grantValue}
                                onChange={(e) => setGrantValue(e.target.value)}
                                placeholder={lang === 'ru' ? 'дней (можно −)' : 'days (± ok)'}
                                className="w-24 text-[11px] px-2 py-1.5 rounded-lg bg-black/40 border border-white/10 text-white outline-none focus:border-emerald-500/50"
                              />
                              <button
                                onClick={() => handleGrantDays(u.id, grantValue)}
                                disabled={grantingId === String(u.id)}
                                className="text-[10px] px-3 py-1.5 rounded-lg bg-emerald-500/30 text-emerald-200 border border-emerald-500/40 hover:bg-emerald-500/40 disabled:opacity-50"
                              >
                                {grantingId === String(u.id) ? '…' : (lang === 'ru' ? 'Начислить' : 'Apply')}
                              </button>
                              <button
                                onClick={() => setGrantOpenId(null)}
                                className="text-[10px] px-2.5 py-1.5 rounded-lg bg-white/5 text-zinc-400 border border-white/10 hover:bg-white/10"
                              >
                                {lang === 'ru' ? 'Отмена' : 'Cancel'}
                              </button>
                            </div>
                          )}
                          {u.is_banned ? (
                            isOwner ? (
                              <button
                                onClick={() => handleBan(u.id, false)}
                                disabled={banningId === Number(u.id)}
                                className="text-[10px] px-2.5 py-1.5 rounded-lg bg-green-500/20 text-green-300 border border-green-500/30 hover:bg-green-500/30 disabled:opacity-50"
                              >
                                {t.adminUnban}
                              </button>
                            ) : null
                          ) : (
                            <>
                              {isOwner && (
                                <button
                                  onClick={() => handleBan(u.id, true, 'login')}
                                  disabled={banningId === Number(u.id)}
                                  className="text-[10px] px-2.5 py-1.5 rounded-lg bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 disabled:opacity-50"
                                >
                                  {t.adminBanLogin}
                                </button>
                              )}
                              {isOwner && (
                                <button
                                  onClick={() => handleBan(u.id, true, 'subscription')}
                                  disabled={banningId === Number(u.id)}
                                  className="text-[10px] px-2.5 py-1.5 rounded-lg bg-orange-500/20 text-orange-300 border border-orange-500/30 hover:bg-orange-500/30 disabled:opacity-50"
                                >
                                  {t.adminBanSubscription}
                                </button>
                              )}
                            </>
                          )}
                      </div>
                      <div className="flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-zinc-400 mt-2">
                        <span>💰 {Number(u.total_paid)}₽</span>
                        {(() => {
                          const isActive = u.subscription_status === 'active' && u.subscription_end && new Date(u.subscription_end) > new Date();
                          if (!isActive) return <span className="text-red-400">❌ {lang === 'ru' ? 'Нет подписки' : 'No sub'}</span>;
                          const daysLeft = Math.ceil((new Date(u.subscription_end!).getTime() - Date.now()) / 86400000);
                          const color = daysLeft <= 1 ? 'text-red-400' : daysLeft <= 3 ? 'text-orange-400' : daysLeft <= 7 ? 'text-yellow-400' : 'text-green-400';
                          return <span className={color}>✅ {daysLeft}{lang === 'ru' ? 'д' : 'd'} → {new Date(u.subscription_end!).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB')}</span>;
                        })()}
                        {/* v68: lifetime stats — highlighted purple if user has
                            history of paid days, since this is the abuse-detection
                            signal. "Devices" turns red when an active sub user
                            has 0 bound devices (= the active_no_devices abuser pattern). */}
                        {(() => {
                          const totalDays = Number(u.total_lifetime_days || 0);
                          if (totalDays <= 0) return null;
                          return (
                            <span
                              className={totalDays >= 90 ? 'text-purple-300' : 'text-zinc-300'}
                              title={lang === 'ru' ? 'Всего дней подписки с момента регистрации' : 'Total subscription days since signup'}
                            >
                              📊 {totalDays}{lang === 'ru' ? 'д всего' : 'd total'}
                            </span>
                          );
                        })()}
                        {(() => {
                          const devCount = Number(u.device_count || 0);
                          const isActive = u.subscription_status === 'active' && u.subscription_end && new Date(u.subscription_end) > new Date();
                          // Suspicious: active sub but 0 devices.
                          const sus = isActive && devCount === 0;
                          return (
                            <span
                              className={sus ? 'text-orange-400 font-semibold' : 'text-zinc-400'}
                              title={sus ? (lang === 'ru' ? 'Подозрение на абьюз: платит но не пользуется' : 'Suspicious: paying but not using') : ''}
                            >
                              📱 {devCount}{lang === 'ru' ? '' : ''}
                            </span>
                          );
                        })()}
                        {u.is_banned && <span className="text-red-400">🚫</span>}
                        <span>📅 {new Date(u.created_at).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB')}</span>
                      </div>
                      {/* 2026-06-13 (partner view): referral identity, links,
                          balance and an invitee expander. Shown for managed
                          partners and for anyone who invited at least 1 user. */}
                      {(() => {
                        const referredCount = Number(u.referred_count || 0);
                        if (!u.is_partner && referredCount === 0) return null;
                        const refCode = u.referral_code || '';
                        const botUser = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || 'hundlervpnbot';
                        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://hundlervpn.xyz';
                        const tgLink = refCode ? `https://t.me/${botUser}?startapp=ref_${refCode}` : '';
                        const siteLink = refCode ? `${appUrl}/?ref=${refCode}` : '';
                        const balance = Number(u.referral_balance_rub || 0);
                        const pct = u.partner_cash_percent ?? 10;
                        const expanded = expandedReferralsUserId === u.id;
                        const detail = referralsDetail[u.id];
                        // The TG deep link works for every referrer, but the website/email
                        // (?ref=) link only attributes signups for allowlisted inviters
                        // (e.g. 5700). Hide the dead «Сайт» link for everyone else.
                        const links = refCode
                          ? [
                              { k: 'tg', label: 'TG', value: tgLink },
                              ...(u.is_site_referral_inviter
                                ? [{ k: 'site', label: lang === 'ru' ? 'Сайт' : 'Site', value: siteLink }]
                                : []),
                            ]
                          : [];
                        return (
                          <div className={u.is_partner
                            ? 'mt-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-2'
                            : 'mt-2 rounded-lg border border-white/10 bg-white/[0.02] p-2'}>
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="text-[11px] font-medium">
                                {u.is_partner
                                  ? <span className="text-amber-300">🤝 {lang === 'ru' ? 'Партнёр' : 'Partner'} · {pct}%</span>
                                  : <span className="text-zinc-300">🔗 {lang === 'ru' ? 'Рефовод' : 'Referrer'}</span>}
                              </span>
                              <span className="text-[10px] text-emerald-300">💵 {balance.toFixed(0)}₽ {lang === 'ru' ? 'баланс' : 'balance'}</span>
                            </div>
                            {links.length > 0 && (
                              <div className="space-y-1 mt-1.5">
                                {links.map((lnk) => {
                                  const ck = `ref${u.id}-${lnk.k}`;
                                  return (
                                    <div key={lnk.k} className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                                      <span className="opacity-70 shrink-0 w-7">{lnk.label}</span>
                                      <span className="truncate flex-1 min-w-0 font-mono text-zinc-300">{lnk.value}</span>
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); copyToClipboard(lnk.value, ck); }}
                                        className="text-zinc-500 hover:text-white shrink-0 p-0.5"
                                        title={lang === 'ru' ? 'Копировать' : 'Copy'}
                                      >
                                        {copiedKey === ck ? <ClipboardCheck size={12} className="text-emerald-400" /> : <Copy size={12} />}
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={() => toggleUserReferrals(u.id)}
                              className="mt-1.5 text-[10px] px-2 py-1 rounded-md border border-white/10 text-zinc-300 hover:bg-white/5 inline-flex items-center gap-1"
                            >
                              👥 {lang === 'ru' ? 'Пригласил' : 'Invited'}: {referredCount} {expanded ? '▲' : '▼'}
                            </button>
                            {expanded && (
                              <div className="mt-1.5">
                                {detail?.loading && !detail?.data ? (
                                  <div className="text-[10px] text-zinc-500 py-1">{lang === 'ru' ? 'Загрузка…' : 'Loading…'}</div>
                                ) : detail?.data && detail.data.invitees.length > 0 ? (
                                  <div className="space-y-1">
                                    {detail.data.invitees.map((inv) => {
                                      const invName = [inv.first_name, inv.last_name].filter(Boolean).join(' ') || inv.username || inv.email || (inv.telegram_id ? `TG ${inv.telegram_id}` : `#${inv.id}`);
                                      return (
                                        <div key={inv.id} className="flex items-center justify-between gap-2 text-[10px] rounded-md bg-black/20 px-2 py-1">
                                          <span className="truncate flex-1 min-w-0 text-zinc-300">
                                            {invName} <span className="text-zinc-600">#{inv.id}{inv.auth_type && inv.auth_type !== 'telegram' ? ` · ${inv.auth_type}` : ''}</span>
                                          </span>
                                          <span className="text-zinc-400 shrink-0">💰 {Number(inv.total_paid_rub).toFixed(0)}₽</span>
                                          <span className="text-emerald-300 shrink-0" title={lang === 'ru' ? 'Кэш, который он принёс' : 'Cash generated'}>+{Number(inv.cash_generated_rub).toFixed(0)}₽</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <div className="text-[10px] text-zinc-500 py-1">{lang === 'ru' ? 'Пока никого не пригласил' : 'No invitees yet'}</div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                    );
                  })}

                  {usersTotalPages > 1 && (
                    <div className="flex justify-center gap-2 pt-2">
                      <button
                        onClick={() => loadUsers(usersPage - 1, usersSearch, usersSubFilter, usersSortBy)}
                        disabled={usersPage <= 1}
                        className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-zinc-300 hover:bg-white/5 disabled:opacity-30"
                      >
                        ←
                      </button>
                      <span className="text-xs text-zinc-400 py-1.5">{usersPage} / {usersTotalPages}</span>
                      <button
                        onClick={() => loadUsers(usersPage + 1, usersSearch, usersSubFilter, usersSortBy)}
                        disabled={usersPage >= usersTotalPages}
                        className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-zinc-300 hover:bg-white/5 disabled:opacity-30"
                      >
                        →
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Promos Tab */}
          {adminTab === 'promos' && (
            <div>
              <button
                onClick={() => setShowPromoForm(!showPromoForm)}
                className="w-full mb-3 bg-white/10 border border-white/15 text-white font-medium py-2.5 rounded-xl flex items-center justify-center gap-2 text-sm hover:bg-white/15 active:scale-95"
              >
                <Plus size={14} /> {t.adminCreatePromo}
              </button>

              {/* Source filter — separate admin-made codes from box-won coupons. */}
              <div className="mb-3 grid grid-cols-3 gap-1.5">
                {([
                  ['all', t.adminPromoFilterAll, promos.length],
                  ['mine', t.adminPromoFilterMine, promos.filter((p) => !isBoxPromo(p)).length],
                  ['boxes', t.adminPromoFilterBoxes, promos.filter((p) => isBoxPromo(p)).length],
                ] as const).map(([key, label, count]) => (
                  <button
                    key={key}
                    onClick={() => setPromoFilter(key)}
                    className={`text-xs font-medium py-2 px-2 rounded-lg border transition-all ${promoFilter === key ? 'bg-white/10 border-white/25 text-white' : 'border-white/5 text-zinc-400 hover:text-white'}`}
                  >
                    {label} <span className="text-zinc-500">{count}</span>
                  </button>
                ))}
              </div>

              {showPromoForm && (
                <div className="mb-4 rounded-xl border border-white/10 bg-zinc-900/60 p-3 space-y-2.5">
                  <div>
                    <label className="text-zinc-400 text-[10px] uppercase tracking-wider block mb-1">{t.adminPromoCode}</label>
                    <input
                      type="text"
                      value={promoCode}
                      onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                      placeholder="PROMO2024"
                      className="w-full bg-zinc-800/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-white/25"
                    />
                  </div>
                  <div>
                    <label className="text-zinc-400 text-[10px] uppercase tracking-wider block mb-1">{lang === 'ru' ? 'Тип' : 'Type'}</label>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button onClick={() => setPromoType('discount')} className={`text-xs py-2 rounded-lg border transition-all ${promoType === 'discount' ? 'bg-white/10 border-white/25 text-white' : 'border-white/5 text-zinc-400'}`}>
                        {lang === 'ru' ? '% Скидка' : '% Discount'}
                      </button>
                      <button onClick={() => setPromoType('days')} className={`text-xs py-2 rounded-lg border transition-all ${promoType === 'days' ? 'bg-white/10 border-white/25 text-white' : 'border-white/5 text-zinc-400'}`}>
                        {lang === 'ru' ? 'Дни подписки' : 'Free days'}
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-zinc-400 text-[10px] uppercase tracking-wider block mb-1">
                        {promoType === 'discount' ? (lang === 'ru' ? 'Скидка %' : 'Discount %') : t.adminPromoDays}
                      </label>
                      {promoType === 'discount' ? (
                        <input
                          type="number"
                          value={promoDiscount}
                          onChange={(e) => setPromoDiscount(e.target.value)}
                          min="1" max="100"
                          className="w-full bg-zinc-800/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-white/25"
                        />
                      ) : (
                        <input
                          type="number"
                          value={promoDays}
                          onChange={(e) => setPromoDays(e.target.value)}
                          min="1"
                          className="w-full bg-zinc-800/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-white/25"
                        />
                      )}
                    </div>
                    <div>
                      <label className="text-zinc-400 text-[10px] uppercase tracking-wider block mb-1">{t.adminPromoMaxUses}</label>
                      <input
                        type="number"
                        value={promoMaxUses}
                        onChange={(e) => setPromoMaxUses(e.target.value)}
                        min="1"
                        className="w-full bg-zinc-800/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-white/25"
                      />
                    </div>
                  </div>
                  <button
                    onClick={handleCreatePromo}
                    disabled={promoCreating || !promoCode.trim() || (promoType === 'days' ? !promoDays : !promoDiscount)}
                    className="w-full bg-white text-black font-medium py-2.5 rounded-lg hover:bg-zinc-200 transition-colors disabled:opacity-50 text-sm"
                  >
                    {promoCreating ? '...' : t.adminPromoCreate}
                  </button>
                </div>
              )}

              {promosLoading ? (
                <div className="text-center py-8 text-zinc-400 text-sm">Загрузка...</div>
              ) : (() => {
                const filteredPromos = promos.filter((p) =>
                  promoFilter === 'all' ? true : promoFilter === 'boxes' ? isBoxPromo(p) : !isBoxPromo(p),
                );
                return filteredPromos.length === 0 ? (
                <div className="text-center py-8 text-zinc-400 text-sm">{t.adminNoPromos}</div>
              ) : (
                <div className="space-y-2">
                  {filteredPromos.map((p) => (
                    <div key={p.id} className={`rounded-xl border p-3 ${p.is_active ? 'border-white/10 bg-zinc-900/60' : 'border-white/5 bg-zinc-900/30 opacity-60'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <Tag size={12} className="text-cyan-400" />
                          <span className="text-white font-mono text-sm font-bold">{p.code}</span>
                          <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full ${isBoxPromo(p) ? 'bg-amber-500/15 text-amber-300' : 'bg-cyan-500/15 text-cyan-300'}`}>
                            {isBoxPromo(p) ? `🎁 ${t.adminPromoFilterBoxes}` : `✍️ ${t.adminPromoFilterMine}`}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full ${p.is_active ? 'bg-green-500/20 text-green-300' : 'bg-zinc-700 text-zinc-400'}`}>
                            {p.is_active ? 'Active' : 'Off'}
                          </span>
                          {p.is_active && (
                            <button onClick={() => handleDeletePromo(p.id)} className="text-zinc-500 hover:text-red-400 transition-colors">
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-x-3 text-[10px] text-zinc-400">
                        {p.discount_percent ? (
                          <span>🏷️ -{p.discount_percent}%</span>
                        ) : (
                          <span>📅 {p.days} {lang === 'ru' ? 'дн.' : 'days'}</span>
                        )}
                        <span>👥 {p.used_count}/{p.max_uses}</span>
                        <span>{new Date(p.created_at).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB')}</span>
                      </div>
                    </div>
                  ))}
                </div>
              );
              })()}
            </div>
          )}

          {/* Promo activations feed — owner-only.
              Lists every entry from `promo_code_uses` joined with the
              applying user and the promo definition. Supports a single
              search field (matches code / username / email / referral
              code / telegram_id substring).
              Note: discount-only promos for SBP/Crypto are recorded in
              `promo_code_uses` at invoice-creation time (see
              `app/api/payments/sbp/create/route.ts` and
              `app/api/crypto-invoice/route.ts`), so "activated" here
              means «введён и принят», not обязательно «оплачен». */}
          {adminTab === 'activations' && isOwner && (
            <div>
              <form
                onSubmit={(e) => { e.preventDefault(); loadActivations(activationsSearch); }}
                className="flex gap-2 mb-3"
              >
                <input
                  type="text"
                  value={activationsSearch}
                  onChange={(e) => setActivationsSearch(e.target.value)}
                  placeholder={lang === 'ru' ? 'Промокод / username / email / tg id' : 'Promo / username / email / tg id'}
                  className="flex-1 bg-zinc-800/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-red-500/40"
                />
                <button
                  type="submit"
                  className="bg-white/10 border border-white/15 text-white px-3 rounded-lg text-xs hover:bg-white/15 active:scale-95 shrink-0"
                >
                  {lang === 'ru' ? 'Найти' : 'Search'}
                </button>
              </form>

              <div className="mb-3 text-zinc-500 text-[11px]">
                {lang === 'ru' ? 'Всего активаций: ' : 'Total activations: '}
                <span className="text-white font-medium">{activationsTotal}</span>
              </div>

              {activationsLoading ? (
                <div className="text-center py-8 text-zinc-400 text-sm">{lang === 'ru' ? 'Загрузка…' : 'Loading…'}</div>
              ) : activations.length === 0 ? (
                <div className="text-center py-8 text-zinc-400 text-sm">
                  {lang === 'ru' ? 'Пока никто не активировал промокоды' : 'No promo activations yet'}
                </div>
              ) : (
                <div className="space-y-2">
                  {activations.map((a) => {
                    const fullName = [a.user.firstName, a.user.lastName].filter(Boolean).join(' ').trim();
                    const displayName = fullName || a.user.username || a.user.email || (a.user.telegramId ? `tg ${a.user.telegramId}` : `id ${a.user.id}`);
                    const dt = new Date(a.usedAt);
                    const isDeletedPromo = !!a.promo.deletedAt;
                    const isDeleting = activationDeletingId === a.id;
                    return (
                      <div key={a.id} className={`rounded-xl border bg-zinc-900/60 p-3 transition-opacity ${isDeletedPromo ? 'border-white/5 opacity-75' : 'border-white/10'} ${isDeleting ? 'opacity-40' : ''}`}>
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-2 min-w-0">
                            {a.user.photoUrl ? (
                              <img src={a.user.photoUrl} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
                            ) : (
                              <div className="w-7 h-7 rounded-full bg-red-500/15 border border-red-500/30 text-red-300 text-[11px] font-bold flex items-center justify-center shrink-0">
                                {(displayName[0] || '?').toUpperCase()}
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="text-white text-sm font-medium truncate">{displayName}</div>
                              <div className="text-zinc-500 text-[10px] truncate">
                                {a.user.username ? `@${a.user.username}` : null}
                                {a.user.username && a.user.telegramId ? ' · ' : null}
                                {a.user.telegramId ? `tg ${a.user.telegramId}` : null}
                                {(a.user.username || a.user.telegramId) && a.user.email ? ' · ' : null}
                                {a.user.email || null}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold border ${isDeletedPromo ? 'bg-zinc-700/40 border-zinc-600/40 text-zinc-400 line-through' : 'bg-red-500/15 border-red-500/30 text-red-300'}`}>
                              {a.promo.code}
                            </span>
                            <button
                              onClick={() => handleDeleteActivation(a.id)}
                              disabled={isDeleting}
                              className="text-zinc-500 hover:text-red-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed p-1 -m-1"
                              title={lang === 'ru' ? 'Удалить эту активацию' : 'Delete this activation'}
                              aria-label={lang === 'ru' ? 'Удалить активацию' : 'Delete activation'}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-zinc-400">
                          {a.promo.discountPercent ? (
                            <span>🏷️ -{a.promo.discountPercent}%</span>
                          ) : (
                            <span>📅 {a.promo.days} {lang === 'ru' ? 'дн.' : 'days'}</span>
                          )}
                          <span>🕒 {dt.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-GB')}</span>
                          {isDeletedPromo && (
                            <span className="text-zinc-500 italic">
                              {lang === 'ru' ? '· промокод удалён' : '· promo deleted'}
                            </span>
                          )}
                          {a.user.referralCode ? <span className="text-zinc-500">ref: {a.user.referralCode}</span> : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {adminTab === 'tickets' && (
            <AdminTicketsView
              t={t}
              lang={lang}
              tgId={tgId}
              onHideNav={onHideNav}
              pendingCompose={pendingCompose}
              onPendingComposeConsumed={() => setPendingCompose(null)}
            />
          )}

          {/* Broadcasts Tab */}
          {adminTab === 'broadcasts' && isOwner && (
            <div>
              <button
                onClick={() => setShowBroadcastForm(!showBroadcastForm)}
                className="w-full mb-3 bg-white/10 border border-white/15 text-white py-2 rounded-lg text-sm font-medium hover:bg-white/15 transition-colors flex items-center justify-center gap-2"
              >
                <Plus size={14} />
                {t.adminBroadcastSend}
              </button>

              {showBroadcastForm && (
                <div className="rounded-xl border border-white/15 bg-zinc-900/80 p-3 mb-3 space-y-3">
                  <input
                    type="text"
                    value={broadcastTitle}
                    onChange={(e) => setBroadcastTitle(e.target.value)}
                    placeholder={t.adminBroadcastTitle}
                    className="w-full bg-zinc-800/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-white/25"
                  />
                  <textarea
                    ref={broadcastMessageRef}
                    value={broadcastMessage}
                    onChange={(e) => setBroadcastMessage(e.target.value)}
                    placeholder={t.adminBroadcastMessage}
                    rows={4}
                    className="w-full bg-zinc-800/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-white/25 resize-none"
                  />
                  {/* 2026-05-11: HTML hint + custom-emoji helper. The bot
                      sends every broadcast with parse_mode="HTML" (see
                      bot/main.py:process_pending_broadcasts), so any
                      Telegram-supported HTML tag the admin types here
                      goes through as formatting: <b>, <i>, <u>, <s>,
                      <code>, <a href="…">, <tg-emoji emoji-id="…">…</tg-emoji>.
                      The helper below just makes the <tg-emoji> tag
                      easier to insert without remembering the syntax. */}
                  <div className="rounded-lg border border-white/10 bg-zinc-800/40 p-2.5">
                    <button
                      type="button"
                      onClick={() => setEmojiHelperOpen((v) => !v)}
                      className="w-full flex items-center justify-between text-left text-xs text-zinc-300 hover:text-white"
                    >
                      <span className="flex items-center gap-1.5">
                        <span>{lang === 'ru' ? 'Кастомные эмодзи' : 'Custom emoji'}</span>
                        <span className="text-[10px] text-zinc-500">(Premium)</span>
                      </span>
                      <span className="text-zinc-500 text-base leading-none">{emojiHelperOpen ? '−' : '+'}</span>
                    </button>
                    {emojiHelperOpen && (
                      <div className="mt-2.5 space-y-2">
                        <p className="text-[11px] text-zinc-500 leading-relaxed">
                          {lang === 'ru'
                            ? 'Получите emoji_id, переслав сообщение с кастомным эмодзи боту @ShowJSONbot. Пользователи без Telegram Premium увидят запасной символ.'
                            : 'Get emoji_id by forwarding a message with the custom emoji to @ShowJSONbot. Users without Telegram Premium see the fallback character.'}
                        </p>
                        <input
                          type="text"
                          value={emojiHelperId}
                          onChange={(e) => setEmojiHelperId(e.target.value)}
                          placeholder="emoji_id (например 5368324170671202286)"
                          className="w-full bg-zinc-900/60 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-white placeholder:text-zinc-600 outline-none focus:border-white/25 font-mono"
                        />
                        <input
                          type="text"
                          value={emojiHelperFallback}
                          onChange={(e) => setEmojiHelperFallback(e.target.value)}
                          placeholder={lang === 'ru' ? 'fallback (например 👍)' : 'fallback (e.g. 👍)'}
                          className="w-full bg-zinc-900/60 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-white placeholder:text-zinc-600 outline-none focus:border-white/25"
                        />
                        <button
                          type="button"
                          onClick={insertCustomEmoji}
                          disabled={!emojiHelperId.trim() || !emojiHelperFallback.trim()}
                          className="w-full bg-white/10 hover:bg-white/15 border border-white/15 text-white text-xs py-1.5 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {lang === 'ru' ? 'Вставить в текст' : 'Insert into text'}
                        </button>
                        <p className="text-[10px] text-zinc-600 leading-snug">
                          {lang === 'ru'
                            ? 'Также можно использовать HTML: <b>жирный</b>, <i>курсив</i>, <a href="…">ссылка</a>, <code>код</code>.'
                            : 'You can also use HTML: <b>bold</b>, <i>italic</i>, <a href="…">link</a>, <code>code</code>.'}
                        </p>
                      </div>
                    )}
                  </div>
                  {/* 2026-06-11: broadcast image — upload a file OR paste a URL.
                      An uploaded file takes precedence; it's stored as BYTEA in
                      Postgres and served via /api/broadcasts/<id>/image, which
                      the bot hands to Telegram's sendPhoto. */}
                  <div className="space-y-2">
                    {broadcastImageDataUrl ? (
                      <div className="flex items-center gap-3 bg-zinc-800/60 border border-white/10 rounded-lg p-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={broadcastImageDataUrl}
                          alt="preview"
                          className="w-14 h-14 rounded-md object-cover border border-white/10"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs text-white truncate">{broadcastImageName}</div>
                          <button
                            type="button"
                            onClick={clearBroadcastImageFile}
                            className="mt-1 text-[11px] text-red-400 hover:text-red-300"
                          >
                            {t.adminBroadcastImageRemove}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => broadcastImageInputRef.current?.click()}
                          className="w-full bg-zinc-800/60 hover:border-white/25 border border-white/10 border-dashed rounded-lg px-3 py-2.5 text-sm text-zinc-300 transition-colors"
                        >
                          📷 {t.adminBroadcastImageUpload}
                        </button>
                        <input
                          type="text"
                          value={broadcastImage}
                          onChange={(e) => setBroadcastImage(e.target.value)}
                          placeholder={t.adminBroadcastImage}
                          className="w-full bg-zinc-800/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-white/25"
                        />
                        <p className="text-[10px] text-zinc-600 leading-snug">{t.adminBroadcastImageOrUrl}</p>
                      </>
                    )}
                    <input
                      ref={broadcastImageInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleBroadcastImagePick}
                      className="hidden"
                    />
                  </div>
                  {/* 2026-05-05: button kind picker.
                      - 'url'   → show URL input (legacy)
                      - 'app'   → no extra input (bot builds t.me/<bot>?startapp=open)
                      - 'promo' → show promo code input (bot builds ?startapp=promo_<CODE>)
                      Button text is always editable; the bot falls back to a
                      sensible default ("Открыть приложение" / "Активировать CODE")
                      when the admin leaves it empty for app/promo kinds. */}
                  <div>
                    <div className="text-xs text-zinc-400 mb-1.5">{t.adminBroadcastButtonKind}</div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {([
                        { value: 'url', label: t.adminBroadcastButtonKindUrl },
                        { value: 'app', label: t.adminBroadcastButtonKindApp },
                        { value: 'promo', label: t.adminBroadcastButtonKindPromo },
                      ] as const).map((opt) => {
                        const active = broadcastButtonKind === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setBroadcastButtonKind(opt.value)}
                            className={`text-xs py-2 px-2 rounded-lg border transition-colors ${
                              active
                                ? 'bg-white text-black border-white font-medium'
                                : 'bg-zinc-800/60 text-white border-white/10 hover:border-white/25'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <input
                    type="text"
                    value={broadcastButtonText}
                    onChange={(e) => setBroadcastButtonText(e.target.value)}
                    placeholder={
                      broadcastButtonKind === 'app'
                        ? (lang === 'ru' ? 'Текст кнопки (по умолчанию «Открыть приложение»)' : 'Button text (default: "Open app")')
                        : broadcastButtonKind === 'promo'
                        ? (lang === 'ru' ? 'Текст кнопки (по умолчанию «Активировать CODE»)' : 'Button text (default: "Activate CODE")')
                        : t.adminBroadcastButton
                    }
                    className="w-full bg-zinc-800/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-white/25"
                  />
                  {broadcastButtonKind === 'url' && (
                    <input
                      type="text"
                      value={broadcastButtonUrl}
                      onChange={(e) => setBroadcastButtonUrl(e.target.value)}
                      placeholder={t.adminBroadcastButtonUrl}
                      className="w-full bg-zinc-800/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-white/25"
                    />
                  )}
                  {broadcastButtonKind === 'promo' && (
                    <input
                      type="text"
                      value={broadcastButtonPromoCode}
                      onChange={(e) => setBroadcastButtonPromoCode(e.target.value.toUpperCase())}
                      placeholder={t.adminBroadcastButtonPromoCode}
                      className="w-full bg-zinc-800/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-white/25 uppercase tracking-wider"
                    />
                  )}
                  {broadcastButtonKind === 'app' && (
                    <div className="text-[11px] text-zinc-500 px-1">
                      {lang === 'ru'
                        ? 'Кнопка откроет Telegram Mini App (HundlerVPN).'
                        : 'Button opens the Telegram Mini App (HundlerVPN).'}
                    </div>
                  )}
                  {broadcastButtonKind === 'promo' && (
                    <div className="text-[11px] text-zinc-500 px-1">
                      {lang === 'ru'
                        ? 'Кнопка откроет приложение и активирует промокод. Убедитесь, что промокод создан и активен.'
                        : 'Button opens the app and auto-applies the promo code. Make sure the code is created and active.'}
                    </div>
                  )}
                  {/* v65: audience filter — disabled when single-user target is set.
                      2026-05-05: 4 options now (added 'active_no_devices'),
                      switched to 2-col grid for readability. */}
                  <div>
                    <div className="text-xs text-zinc-400 mb-1.5">{t.adminBroadcastAudience}</div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {([
                        { value: 'all', label: t.adminBroadcastAudienceAll },
                        { value: 'active', label: t.adminBroadcastAudienceActive },
                        { value: 'no_sub', label: t.adminBroadcastAudienceNoSub },
                        { value: 'active_no_devices', label: t.adminBroadcastAudienceActiveNoDevices },
                      ] as const).map((opt) => {
                        const active = broadcastAudience === opt.value;
                        const disabled = !!broadcastTargetId.trim();
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => !disabled && setBroadcastAudience(opt.value)}
                            disabled={disabled}
                            className={`text-xs py-2 px-2 rounded-lg border transition-colors ${
                              active
                                ? 'bg-white text-black border-white font-medium'
                                : 'bg-zinc-800/60 text-white border-white/10 hover:border-white/25'
                            } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <input
                    type="text"
                    value={broadcastTargetId}
                    onChange={(e) => setBroadcastTargetId(e.target.value)}
                    placeholder={t.adminBroadcastTargetId}
                    className="w-full bg-zinc-800/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-white/25"
                  />
                  <button
                    onClick={handleCreateBroadcast}
                    disabled={broadcastSending || !broadcastMessage.trim()}
                    className="w-full bg-white text-black font-medium py-2.5 rounded-lg hover:bg-zinc-200 transition-colors disabled:opacity-50 text-sm"
                  >
                    {broadcastSending ? '...' : t.adminBroadcastSend}
                  </button>
                </div>
              )}

              {broadcastsLoading ? (
                <div className="text-center py-8 text-zinc-400 text-sm">Загрузка...</div>
              ) : broadcasts.length === 0 ? (
                <div className="text-center py-8 text-zinc-400 text-sm">{t.adminNoBroadcasts}</div>
              ) : (
                <div className="space-y-2">
                  {broadcasts.map((b) => (
                    <div key={b.id} className="rounded-xl border border-white/10 bg-zinc-900/60 p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-white text-sm font-medium truncate">{b.title || b.message.slice(0, 30)}</span>
                        <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
                          b.status === 'sent' ? 'bg-green-500/20 text-green-300' :
                          b.status === 'sending' ? 'bg-yellow-500/20 text-yellow-300' :
                          b.status === 'failed' ? 'bg-red-500/20 text-red-300' :
                          'bg-zinc-700 text-zinc-400'
                        }`}>
                          {b.status === 'sent' ? t.adminBroadcastSent :
                           b.status === 'sending' ? t.adminBroadcastSending :
                           b.status === 'failed' ? t.adminBroadcastFailed :
                           t.adminBroadcastPending}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 text-[10px] text-zinc-400">
                        <span>👥 {b.sent_count}/{b.total_users}</span>
                        {b.failed_count > 0 && <span className="text-red-400">❌ {b.failed_count}</span>}
                        <span>{new Date(b.created_at).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB')}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Fragment Tab */}
          {adminTab === 'fragment' && <AdminFragmentView tgId={tgId} lang={lang} />}

          {/* Services Tab */}
          {adminTab === 'services' && <AdminServicesView tgId={tgId} lang={lang} />}

          {/* Boxes Tab — owner-only feed of all box opens across all
              users. Source: GET /api/admin/boxes/feed. */}
          {adminTab === 'boxes' && isOwner && <AdminBoxesView tgId={tgId} lang={lang} />}

          {/* Referrals Tab (2026-05-09) — admin-only view of who-invited-whom
              with bonus accounting. Source: GET /api/admin/referrals. */}
          {adminTab === 'referrals' && <AdminReferralsView tgId={tgId} />}

          {/* Withdrawals Tab (2026-05-22) — admin-only inbox of cash referral
              withdrawal requests with split-pane chat. Source:
              GET /api/admin/withdrawals + per-row /api/admin/withdrawals/[id]. */}
          {adminTab === 'withdrawals' && <AdminWithdrawalsView tgId={tgId} lang={lang} />}

          {/* Servers Tab (v62, 2026-05-15) — кто сейчас на каком VPN-сервере.
              Источник — user_server_traffic (xray-traffic.sh push raз в 5 мин
              на NL VPS). active_now = updated_at < 10 мин назад. */}
        </div>
      </div>

      {/* v45 admin device modal (fullscreen on mobile, centered on desktop) */}
      {devicesUser && (
        <div
          className="fixed inset-0 z-[60] bg-black/90 sm:bg-black/75 sm:backdrop-blur-sm flex sm:items-center justify-center sm:p-4"
          onClick={(e) => { if (e.target === e.currentTarget) closeUserDevices(); }}
        >
          <div
            className="w-full sm:max-w-lg bg-zinc-950 sm:border border-white/10 sm:rounded-2xl flex flex-col"
            style={{ height: '100dvh', maxHeight: '100dvh' }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0"
              style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 3.5rem)' }}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Smartphone size={16} className="text-blue-400 shrink-0" />
                  <h3 className="text-white text-sm font-semibold truncate">
                    {[devicesUser.first_name, devicesUser.last_name].filter(Boolean).join(' ') || devicesUser.username || `ID ${devicesUser.telegram_id}`}
                  </h3>
                </div>
                <p className="text-zinc-500 text-[10px] mt-0.5 truncate">
                  {devicesUser.username ? `@${devicesUser.username} · ` : ''}TG: {devicesUser.telegram_id}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={reloadDevices}
                  disabled={devicesLoading}
                  className="text-zinc-400 hover:text-white p-2 rounded-lg hover:bg-white/5 disabled:opacity-50"
                >
                  <RefreshCw size={14} className={devicesLoading ? 'animate-spin' : ''} />
                </button>
                <button
                  onClick={closeUserDevices}
                  className="text-zinc-400 hover:text-white p-2 rounded-lg hover:bg-white/5"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Subscription URL (user's 'master key') + summary row */}
            {devicesData && (
              <div className="shrink-0 border-b border-white/5">
                {devicesData.user.subscription_url && (
                  <div className="px-4 py-2.5 bg-blue-500/5 border-b border-white/5">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-[10px] uppercase tracking-wider text-blue-400 font-medium">
                        {lang === 'ru' ? 'Ключ подписки' : 'Subscription URL'}
                      </span>
                      <button
                        onClick={() => copyToClipboard(devicesData.user.subscription_url!, 'sub')}
                        className="text-[10px] px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 inline-flex items-center gap-1"
                      >
                        {copiedKey === 'sub' ? <><ClipboardCheck size={10}/> {lang === 'ru' ? 'Скопир.' : 'Copied'}</> : <><Copy size={10}/> {lang === 'ru' ? 'Копировать' : 'Copy'}</>}
                      </button>
                    </div>
                    <p className="text-white text-[11px] font-mono break-all leading-tight">
                      {devicesData.user.subscription_url}
                    </p>
                  </div>
                )}
                <div className="px-4 py-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-zinc-400">
                  {(() => {
                    const active = devicesData.devices.filter(d => !d.kicked_at).length;
                    const kicked = devicesData.devices.filter(d => d.kicked_at).length;
                    const maxD = devicesData.user.max_devices ?? 3;
                    return <>
                      <span>📱 {active}/{maxD}</span>
                      {kicked > 0 && <span className="text-rose-400">🚫 {kicked} kicked</span>}
                      <span>🔑 {devicesData.pool.assigned} UUIDs</span>
                      {devicesData.user.is_banned && <span className="text-rose-400">⛔ banned</span>}
                      {devicesData.user.sub_status === 'active' && devicesData.user.sub_end
                        ? <span className="text-green-400">✅ active → {new Date(devicesData.user.sub_end).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB')}</span>
                        : <span className="text-zinc-500">❌ no active sub</span>}
                    </>;
                  })()}
                </div>
              </div>
            )}

            {/* Devices list */}
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {devicesLoading && !devicesData ? (
                <div className="text-center py-10 text-zinc-500 text-sm">…</div>
              ) : !devicesData || devicesData.devices.length === 0 ? (
                <div className="text-center py-10 text-zinc-500 text-sm">
                  {lang === 'ru' ? 'У пользователя нет устройств' : 'No devices'}
                </div>
              ) : (
                <div className="space-y-2">
                  {devicesData.devices.map((d) => {
                    const isKicked = !!d.kicked_at;
                    const isActionLoading = deviceActionId === d.id;
                    const lastSeen = new Date(d.last_seen_at);
                    const lastSeenRel = (() => {
                      const min = Math.floor((Date.now() - lastSeen.getTime()) / 60000);
                      if (min < 1) return lang === 'ru' ? 'только что' : 'just now';
                      if (min < 60) return `${min}${lang === 'ru' ? 'м' : 'm'}`;
                      const h = Math.floor(min / 60);
                      if (h < 24) return `${h}${lang === 'ru' ? 'ч' : 'h'}`;
                      return `${Math.floor(h / 24)}${lang === 'ru' ? 'д' : 'd'}`;
                    })();
                    return (
                      <div
                        key={d.id}
                        className={`rounded-xl border p-3 ${isKicked ? 'border-rose-500/20 bg-rose-500/5' : 'border-white/10 bg-zinc-900/60'}`}
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-white text-sm font-medium truncate">
                                {d.device_name || (lang === 'ru' ? 'Устройство' : 'Device')}
                              </span>
                              <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0 ${isKicked ? 'bg-rose-500/20 text-rose-300' : 'bg-green-500/15 text-green-300'}`}>
                                {isKicked ? (lang === 'ru' ? 'Кикнуто' : 'kicked') : (lang === 'ru' ? 'Активно' : 'active')}
                              </span>
                            </div>
                            <p className="text-zinc-500 text-[10px] mt-0.5">
                              #{d.rank} · {d.ip_address || '—'} · {lastSeenRel}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {isKicked ? (
                              <button
                                onClick={() => handleAdminUnkick(d.id)}
                                disabled={isActionLoading}
                                className="text-[10px] px-2.5 py-1.5 rounded-lg bg-green-500/20 text-green-300 border border-green-500/30 hover:bg-green-500/30 disabled:opacity-50"
                              >
                                {isActionLoading ? '…' : (lang === 'ru' ? 'Вернуть' : 'Restore')}
                              </button>
                            ) : (
                              <button
                                onClick={() => handleAdminKick(d.id)}
                                disabled={isActionLoading}
                                className="text-[10px] px-2.5 py-1.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30 disabled:opacity-50"
                              >
                                {isActionLoading ? '…' : (lang === 'ru' ? 'Кик' : 'Kick')}
                              </button>
                            )}
                            <button
                              onClick={() => handleAdminHardDelete(d.id)}
                              disabled={isActionLoading}
                              title={lang === 'ru' ? 'Удалить навсегда' : 'Delete forever'}
                              className="text-[10px] p-1.5 rounded-lg bg-zinc-800/80 text-zinc-400 border border-white/10 hover:bg-rose-500/20 hover:text-rose-300 disabled:opacity-50"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                        {d.uuid && (
                          <div className="mt-1 mb-1 rounded-lg border border-white/5 bg-black/30 px-2 py-1.5 flex items-center justify-between gap-2">
                            <span className="text-zinc-300 text-[10px] font-mono truncate flex-1">
                              {d.uuid}
                            </span>
                            <button
                              onClick={() => copyToClipboard(d.uuid!, `uuid-${d.id}`)}
                              className="text-zinc-400 hover:text-white shrink-0 p-1 rounded hover:bg-white/5"
                              title={lang === 'ru' ? 'Копировать UUID' : 'Copy UUID'}
                            >
                              {copiedKey === `uuid-${d.id}` ? <ClipboardCheck size={11} className="text-green-400"/> : <Copy size={11}/>}
                            </button>
                          </div>
                        )}
                        {d.user_agent && (
                          <p className="text-zinc-600 text-[9px] mt-1 font-mono truncate" title={d.user_agent}>
                            UA: {d.user_agent.slice(0, 80)}{d.user_agent.length > 80 ? '…' : ''}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function AdminFragmentView({ tgId, lang }: { tgId: number | undefined; lang: 'ru' | 'en' }) {
  const [prices, setPrices] = useState<{ id?: number; product_type: string; period: string; stars_amount: number | null; price_rub: string; is_active: boolean }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [orders, setOrders] = useState<{ id: number; user_id: number; product_type: string; period: string; stars_amount: number | null; price_rub: string; telegram_username: string | null; status: string; first_name: string | null; username: string | null; telegram_id: number | null; created_at: string }[]>([]);

  const defaultPrices = [
    { product_type: 'premium', period: '3 months', stars_amount: null, price_rub: '1200', is_active: true },
    { product_type: 'premium', period: '6 months', stars_amount: null, price_rub: '1700', is_active: true },
    { product_type: 'premium', period: '12 months', stars_amount: null, price_rub: '2900', is_active: true },
    { product_type: 'stars', period: '100 stars', stars_amount: 100, price_rub: '200', is_active: true },
    { product_type: 'stars', period: '500 stars', stars_amount: 500, price_rub: '900', is_active: true },
    { product_type: 'stars', period: '1000 stars', stars_amount: 1000, price_rub: '1700', is_active: true },
  ];

  useEffect(() => {
    const load = async () => {
      try {
        const [pricesRes, ordersRes] = await Promise.all([
          fetch('/api/fragment/prices'),
          fetch(`/api/fragment/order?telegramId=${tgId}`),
        ]);
        
        if (pricesRes.ok) {
          const data = await pricesRes.json();
          if (data.prices?.length > 0) {
            setPrices(data.prices.map((p: any) => ({ ...p, price_rub: String(p.price_rub) })));
          } else {
            setPrices(defaultPrices);
          }
        } else {
          setPrices(defaultPrices);
        }
        
        if (ordersRes.ok) {
          const data = await ordersRes.json();
          setOrders(data.orders || []);
        }
      } catch { setPrices(defaultPrices); } finally { setLoading(false); }
    };
    load();
  }, [tgId]);

  const updatePrice = (index: number, field: string, value: string | boolean) => {
    setPrices(prev => prev.map((p, i) => i === index ? { ...p, [field]: value } : p));
  };

  const handleSave = async () => {
    haptic('medium');
    if (!tgId) return;
    setSaving(true);
    try {
      const res = await fetch('/api/fragment/prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegramId: tgId,
          prices: prices.map(p => ({
            product_type: p.product_type,
            period: p.period,
            stars_amount: p.stars_amount,
            price_rub: parseFloat(p.price_rub) || 0,
            is_active: p.is_active,
          })),
        }),
      });
      if (res.ok) {
        alert(lang === 'ru' ? 'Сохранено!' : 'Saved!');
      }
    } catch { alert('Error'); } finally { setSaving(false); }
  };

  const handleOrderStatus = async (orderId: number, status: string) => {
    haptic('medium');
    try {
      await fetch('/api/fragment/order/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: tgId, orderId, status }),
      });
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status } : o));
    } catch { /* ignore */ }
  };

  const handleDeleteOrder = async (orderId: number) => {
    haptic('heavy');
    if (!confirm(lang === 'ru' ? 'Удалить заказ?' : 'Delete order?')) return;
    try {
      await fetch('/api/fragment/order/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: tgId, orderId }),
      });
      setOrders(prev => prev.filter(o => o.id !== orderId));
    } catch { /* ignore */ }
  };

  const periodLabels: Record<string, string> = {
    '3 months': '3 мес', '6 months': '6 мес', '12 months': '12 мес',
    '100 stars': '100 ⭐', '500 stars': '500 ⭐', '1000 stars': '1000 ⭐',
  };

  if (loading) return <div className="text-center py-8 text-zinc-400">Загрузка...</div>;

  return (
    <div className="space-y-4">
      {/* Prices */}
      <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-3">
        <h3 className="text-white font-medium mb-3 flex items-center gap-2">
          <Star size={16} className="text-yellow-400" />
          {lang === 'ru' ? 'Цены Fragment' : 'Fragment Prices'}
        </h3>
        <div className="space-y-2">
          {prices.map((price, index) => (
            <div key={`${price.product_type}-${price.period}`} className="p-2 bg-zinc-800/50 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${price.product_type === 'premium' ? 'bg-purple-500/20 text-purple-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                    {price.product_type === 'premium' ? 'Premium' : 'Stars'}
                  </span>
                  <span className="text-zinc-400 text-xs">{periodLabels[price.period] || price.period}</span>
                </div>
                <label className="flex items-center gap-1 text-[10px] text-zinc-400">
                  <input type="checkbox" checked={price.is_active} onChange={(e) => updatePrice(index, 'is_active', e.target.checked)} className="rounded w-3 h-3" />
                  Вкл
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={price.price_rub}
                  onChange={(e) => updatePrice(index, 'price_rub', e.target.value)}
                  className="w-full bg-zinc-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm"
                  placeholder="Цена в ₽"
                />
              </div>
            </div>
          ))}
        </div>
        <button onClick={handleSave} disabled={saving} className="mt-3 w-full bg-gradient-to-r from-purple-500 to-yellow-500 text-white font-medium py-2 rounded-lg text-sm disabled:opacity-50">
          {saving ? '...' : (lang === 'ru' ? 'Сохранить цены' : 'Save prices')}
        </button>
      </div>

      {/* Orders */}
      <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-3">
        <h3 className="text-white font-medium mb-3">{lang === 'ru' ? 'Заказы' : 'Orders'}</h3>
        {orders.length === 0 ? (
          <p className="text-zinc-500 text-sm text-center py-4">{lang === 'ru' ? 'Заказов пока нет' : 'No orders yet'}</p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {orders.map(order => (
              <div key={order.id} className="p-2 bg-zinc-800/50 rounded-lg">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-white text-sm font-medium">#{order.id} {order.first_name || order.username}</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded ${order.status === 'paid' ? 'bg-green-500/20 text-green-400' : order.status === 'completed' ? 'bg-blue-500/20 text-blue-400' : 'bg-zinc-500/20 text-zinc-400'}`}>
                      {order.status}
                    </span>
                    <button onClick={() => handleDeleteOrder(order.id)} className="text-red-400 hover:text-red-300 text-xs">
                      ✕
                    </button>
                  </div>
                </div>
                <div className="text-xs text-zinc-400">
                  <span className="text-zinc-500">ID:{order.user_id}</span> • {order.product_type === 'stars' ? `${order.stars_amount} ⭐` : `Premium ${order.period.replace('_', ' ')}`} • {order.price_rub} ₽ • @{order.telegram_username}
                </div>
                {order.status === 'paid' && (
                  <button onClick={() => handleOrderStatus(order.id, 'completed')} className="mt-2 text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded hover:bg-green-500/30">
                    ✓ Выполнено
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

type AdminServiceRequest = {
  id: number;
  user_id: number;
  service_name: string;
  description: string | null;
  amount: string | null;
  currency: string;
  status: string;
  message_count: string;
  telegram_id: number | null;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Admin "Рефералы" tab (v2, 2026-05-17).
 *
 * Source data: GET /api/admin/referrals?telegramId=<admin_tg>.
 * Backend returns:
 *   - totals          — global KPIs incl. paid amount + paying invitees
 *   - categoryCounts  — inviter count per category, drives filter-tab badges
 *   - inviters[]      — aggregated per-inviter rows pre-sorted by category
 *                       priority (worst first) then totalBonus DESC
 *   - pairs[]         — flat (inviter, invitee) pairs with full engagement
 *                       metrics, already grouped into `inviter.invitees[]`
 *
 * UI layout:
 *   1. KPI cards (4 high-level numbers).
 *   2. Filter tabs by category with count badges:
 *        🐋 Whale   → paying friends, top priority
 *        ⚡ Active   → ≥1 invitee converted to real user
 *        👥 Neutral  → few friends, nothing yet
 *        ⚠ Suspicious → many invitees, no payments, weak device coverage
 *        🚨 Abuser   → ≥5 invitees w/ 0 payments + 0 devices + 0 sub-invites
 *   3. Search box (case-insensitive substring on username/name/id/tg_id).
 *   4. Inviter list. Each row carries a category badge + abuse signal
 *      badges. Click expands to show every invitee with their own
 *      paidCount, deviceCount and sub-invitee count.
 *
 * Why category-first sort: an admin looking for refund/ban candidates
 * shouldn't have to scroll past 200 healthy referral chains. Pre-sorting
 * to (worst-first, paid bonus DESC) puts the actionable rows on top.
 */
type AdminReferralPair = {
  inviterId: string;
  inviterTelegramId: string | null;
  inviterUsername: string | null;
  inviterFirstName: string | null;
  inviteeId: string;
  inviteeTelegramId: string | null;
  inviteeUsername: string | null;
  inviteeFirstName: string | null;
  inviteeAuthType: string;
  invitedAt: string;
  signupBonus: number;
  paymentBonus: number;
  paymentCount: number;
  totalBonus: number;
  inviteePaidCount: number;
  inviteePaidAmountRub: number;
  inviteeDeviceCount: number;
  inviteeSubInviteeCount: number;
  inviteeLastSeenAt: string | null;
};
type AdminReferralCategory = 'whale' | 'active' | 'neutral' | 'suspicious' | 'abuser';
type AdminReferralSignal =
  | 'no_devices'
  | 'no_payments'
  | 'dead_end'
  | 'burst'
  | 'all_same_authtype'
  | 'never_seen';
type AdminReferralInviter = {
  inviterId: string;
  inviterTelegramId: string | null;
  inviterUsername: string | null;
  inviterFirstName: string | null;
  inviteeCount: number;
  paymentCount: number;
  signupBonus: number;
  paymentBonus: number;
  totalBonus: number;
  paidInviteeCount: number;
  deviceInviteeCount: number;
  subInviterCount: number;
  paidAmountRub: number;
  category: AdminReferralCategory;
  signals: AdminReferralSignal[];
  invitees: AdminReferralPair[];
};
type AdminReferralResponse = {
  ok: boolean;
  totals: {
    totalPairs: number;
    totalInviters: number;
    totalDays: number;
    totalPayments: number;
    totalPaidRub: number;
    totalPaidInvitees: number;
    totalActiveDeviceInvitees: number;
  };
  categoryCounts: Record<AdminReferralCategory, number>;
  inviters: AdminReferralInviter[];
  pairs: AdminReferralPair[];
};

// Visual config for each category. `priority` lower = worse-class (matches
// backend CATEGORY_ORDER) so the tabs read left-to-right from "all" →
// most-actionable. Colours follow the existing dark/red brand palette.
const ADMIN_REFERRAL_CATEGORY_META: Record<
  AdminReferralCategory,
  { label: string; icon: typeof Crown; chip: string; ring: string; bg: string; priority: number }
> = {
  whale:      { label: 'Платящие',       icon: Crown,       chip: 'text-amber-300',   ring: 'border-amber-500/40',   bg: 'bg-amber-500/10',   priority: 1 },
  active:     { label: 'Активные',       icon: Zap,         chip: 'text-emerald-300', ring: 'border-emerald-500/30', bg: 'bg-emerald-500/10', priority: 2 },
  neutral:    { label: 'Нейтральные',     icon: Users,       chip: 'text-zinc-300',    ring: 'border-zinc-500/30',    bg: 'bg-zinc-500/10',    priority: 3 },
  suspicious: { label: 'Подозрительные', icon: AlertCircle, chip: 'text-orange-300',  ring: 'border-orange-500/40',  bg: 'bg-orange-500/10',  priority: 4 },
  abuser:     { label: 'Абьюзеры',       icon: ShieldAlert, chip: 'text-red-300',     ring: 'border-red-500/40',     bg: 'bg-red-500/10',     priority: 5 },
};
const ADMIN_REFERRAL_SIGNAL_LABELS: Record<AdminReferralSignal, string> = {
  no_devices:        'нет устройств',
  no_payments:       'нет оплат',
  dead_end:          'тупик',
  burst:             'реги всплеском',
  all_same_authtype: 'один auth_type',
  never_seen:        'не подключались',
};

// ────────────────────────────────────────────────────────────────────────────
// AdminBoxesView — owner-only global feed of every box open by every user.
// Source: GET /api/admin/boxes/rewards?telegramId=<owner>&limit=…&boxKind=…
//                                        &rewardKind=hours|discount_coupon
// Shows: who opened, when, rarity, kind, reward (hours / coupon%), coupon
// status (used / expired / active), and totals at the top (always over
// the full table, regardless of the active filter).
// ────────────────────────────────────────────────────────────────────────────
function AdminBoxesView({ tgId, lang }: { tgId: number | undefined; lang: 'ru' | 'en' }) {
  type FeedEntry = {
    id: number;
    createdAt: string;
    user: {
      id: number;
      telegramId: string | null;
      username: string | null;
      firstName: string | null;
      lastName: string | null;
      email: string | null;
      displayName: string;
    };
    boxKind: 'daily' | 'super';
    rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
    rewardKind: 'subscription_hours' | 'subscription_days' | 'discount_coupon';
    rewardValue: number;
    rewardHours?: number | null;
    discountPercent?: number | null;
    couponCode?: string | null;
    couponExpiresAt?: string | null;
    couponUsedAt?: string | null;
    couponExpired?: boolean;
  };
  type Totals = { totalOpens: number; totalHoursGranted: number; totalCouponsIssued: number; couponsActive: number; couponsUsed: number; couponsExpired: number };

  const [items, setItems] = useState<FeedEntry[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [filter, setFilter] = useState<'all' | 'daily' | 'super' | 'coupons'>('all');
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFeed = useCallback(async (offset: number) => {
    if (!tgId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ telegramId: String(tgId), limit: '50', offset: String(offset) });
      if (filter === 'daily' || filter === 'super') params.set('boxKind', filter);
      if (filter === 'coupons') params.set('rewardKind', 'discount_coupon');
      const res = await fetch(`/api/admin/boxes/rewards?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || 'Failed to load');
        return;
      }
      const data = await res.json();
      setTotals(data.totals ?? null);
      setHasMore(!!data.hasMore);
      setItems((prev) => offset === 0 ? data.items : [...prev, ...data.items]);
    } catch (e) {
      console.error('[AdminBoxesView] fetch failed:', e);
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, [tgId, filter]);

  useEffect(() => { void fetchFeed(0); }, [fetchFeed]);

  const formatUser = (u: FeedEntry['user']) => {
    // Prefer username (clickable visually as @handle), fall back to
    // displayName which the backend already composed for us.
    if (u.username) return `@${u.username}`;
    return u.displayName || (u.telegramId ? `tg:${u.telegramId}` : `user#${u.id}`);
  };

  const couponStatus = (r: FeedEntry): { label: string; cls: string } => {
    if (r.rewardKind !== 'discount_coupon') return { label: '', cls: '' };
    if (r.couponUsedAt) return { label: 'использован', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' };
    if (r.couponExpired) return { label: 'истёк', cls: 'bg-zinc-700/40 text-zinc-400 border-zinc-600/40' };
    return { label: 'активен', cls: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30' };
  };

  // v4 (2026-05-21 late): self-only cooldown reset. Lives here (admin
  // panel, owner-only tab) because the BoxesView screen no longer
  // has any admin chrome. Backend endpoint refuses any userId param
  // — it always resolves to the caller's telegram_id, so even a
  // tampered request body can't reset someone else's streak.
  const [resetting, setResetting] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const handleResetMyCooldown = async () => {
    if (!tgId || resetting) return;
    const confirmMsg = lang === 'ru'
      ? 'Сбросить ТВОЙ кулдаун и стрик? История наград сохранится. На других пользователей не влияет.'
      : 'Reset YOUR cooldown and streak? Reward history will be kept. Does not affect other users.';
    if (!window.confirm(confirmMsg)) return;
    setResetting(true);
    setResetMsg(null);
    haptic('medium');
    try {
      const res = await fetch('/api/boxes/admin/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: tgId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResetMsg(data?.error || (lang === 'ru' ? 'Не удалось сбросить' : 'Reset failed'));
        return;
      }
      setResetMsg(lang === 'ru' ? 'Кулдаун сброшен ✓' : 'Cooldown reset ✓');
      hapticNotification('success');
      // Refresh the feed so any prior open re-appears at the top of
      // the timeline once the admin tries again. The feed itself
      // doesn't change from a reset (no row is deleted), but it's
      // nice to confirm via re-fetch that the call landed.
      void fetchFeed(0);
      setTimeout(() => setResetMsg(null), 2500);
    } catch (e) {
      console.error('[AdminBoxesView] reset failed:', e);
      setResetMsg(lang === 'ru' ? 'Сетевая ошибка' : 'Network error');
    } finally {
      setResetting(false);
    }
  };

  // v5 (2026-05-22): per-row delete in the admin feed. Lets owners scrub
  // bogus / spam / test entries from the global box-rewards audit log.
  // Admin gate is enforced server-side; subscription hours already
  // credited stay credited (DELETE is on box_rewards only, not on
  // subscriptions). Optimistically removes the row from the visible
  // feed while the request is in flight; rolls back on error.
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const handleDeleteReward = async (rewardId: number) => {
    if (!tgId || deletingId) return;
    const confirmMsg = lang === 'ru'
      ? 'Удалить эту запись из истории открытий? Действие необратимо.\n\nВыданные часы у пользователя НЕ забираются — это только удаление строки из аудит-лога.'
      : 'Delete this row from the opens history? Irreversible.\n\nAlready-credited hours are NOT refunded — this only removes the audit-log row.';
    if (!window.confirm(confirmMsg)) return;
    setDeletingId(rewardId);
    haptic('medium');
    // Optimistic removal — pull the row out of local state immediately
    // so the user sees instant feedback. Stash the previous list so we
    // can restore it if the API rejects.
    const prevItems = items;
    setItems((prev) => prev.filter((r) => r.id !== rewardId));
    try {
      const res = await fetch('/api/boxes/admin/delete-reward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: tgId, rewardId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Roll back — restore the row, surface the error.
        setItems(prevItems);
        setResetMsg(data?.error || (lang === 'ru' ? 'Не удалось удалить' : 'Delete failed'));
        setTimeout(() => setResetMsg(null), 3000);
        return;
      }
      hapticNotification('success');
      // Refresh totals (ignore items — we already removed locally).
      // The feed endpoint also returns updated totals, but we're not
      // refetching to avoid jumping the scroll position. Totals will
      // refresh on next manual reload.
    } catch (e) {
      console.error('[AdminBoxesView] delete failed:', e);
      setItems(prevItems);
      setResetMsg(lang === 'ru' ? 'Сетевая ошибка' : 'Network error');
      setTimeout(() => setResetMsg(null), 3000);
    } finally {
      setDeletingId(null);
    }
  };

  // v4.2 (2026-05-22): self-only "grant SUPER" debug helper. Primes the
  // admin's own box state so their NEXT open lands on streak=7 (SUPER).
  // Same scope/safety as reset: caller is resolved by telegram_id, no
  // userId param accepted, refuses non-admin callers.
  // Use case: testing the SUPER reveal animation + crown SVG without
  // grinding 7 daily opens. The state is preserved server-side, so the
  // admin can also tap "Open" on the public Boxes screen and get the
  // SUPER right away — no client-side flag-passing needed.
  const [granting, setGranting] = useState(false);
  const handleGrantSuper = async () => {
    if (!tgId || granting) return;
    const confirmMsg = lang === 'ru'
      ? 'Подготовить SUPER бокс для следующего открытия? Это перезапишет твой текущий стрик на 6.'
      : 'Prime the next open as a SUPER box? This will overwrite your current streak to 6.';
    if (!window.confirm(confirmMsg)) return;
    setGranting(true);
    setResetMsg(null);
    haptic('medium');
    try {
      const res = await fetch('/api/boxes/admin/grant-super', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: tgId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResetMsg(data?.error || (lang === 'ru' ? 'Не удалось выдать' : 'Grant failed'));
        return;
      }
      setResetMsg(lang === 'ru' ? 'SUPER готов — открывай ✓' : 'SUPER ready — open it ✓');
      hapticNotification('success');
      void fetchFeed(0);
      setTimeout(() => setResetMsg(null), 3000);
    } catch (e) {
      console.error('[AdminBoxesView] grant-super failed:', e);
      setResetMsg(lang === 'ru' ? 'Сетевая ошибка' : 'Network error');
    } finally {
      setGranting(false);
    }
  };

  // v5 (2026-05-22): manual cleanup of expired-and-unused box-issued promo
  // codes. We keep them in the table by default (audit + UI badge), but
  // give the admin a button to wipe stale rows on demand. Used coupons
  // are NEVER touched (used_count > 0 → preserve the redemption trail).
  const [cleaningCoupons, setCleaningCoupons] = useState(false);
  const handleCleanupExpiredCoupons = async () => {
    if (!tgId || cleaningCoupons) return;
    const confirmMsg = lang === 'ru'
      ? 'Удалить все истёкшие неиспользованные промокоды из боксов?\n\nИспользованные купоны останутся (нужны для аудита).\n\nЭто не затронет ручные промокоды — только те, что выпали из боксов (BOX*****).'
      : 'Delete all expired and never-redeemed box promo codes?\n\nRedeemed coupons stay (audit trail). Only box-issued codes (BOX*****) are touched.';
    if (!window.confirm(confirmMsg)) return;
    setCleaningCoupons(true);
    setResetMsg(null);
    haptic('medium');
    try {
      const res = await fetch('/api/boxes/admin/cleanup-expired-coupons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: tgId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResetMsg(data?.error || (lang === 'ru' ? 'Не удалось очистить' : 'Cleanup failed'));
        setTimeout(() => setResetMsg(null), 3000);
        return;
      }
      const count = data?.deleted ?? 0;
      setResetMsg(
        lang === 'ru'
          ? (count > 0 ? `Удалено: ${count} промокодов` : 'Истёкших промокодов нет')
          : (count > 0 ? `Deleted: ${count} coupons` : 'No expired coupons'),
      );
      hapticNotification('success');
      void fetchFeed(0);
      setTimeout(() => setResetMsg(null), 3500);
    } catch (e) {
      console.error('[AdminBoxesView] cleanup coupons failed:', e);
      setResetMsg(lang === 'ru' ? 'Сетевая ошибка' : 'Network error');
      setTimeout(() => setResetMsg(null), 3000);
    } finally {
      setCleaningCoupons(false);
    }
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2 flex-wrap">
        <p className="text-zinc-500 text-[10px] uppercase tracking-wider">
          {lang === 'ru' ? 'Все открытия боксов' : 'All box opens'}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          {resetMsg && (
            <span className="text-[10px] text-zinc-400">{resetMsg}</span>
          )}
          <button
            onClick={handleCleanupExpiredCoupons}
            disabled={cleaningCoupons || granting || resetting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-700/30 border border-zinc-500/40 hover:bg-zinc-700/50 text-zinc-200 text-xs font-medium transition-colors active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
            title={lang === 'ru' ? 'Удаляет истёкшие неиспользованные промокоды (BOX*****)' : 'Deletes expired & unused box-issued promo codes (BOX*****)'}
          >
            {cleaningCoupons ? (
              <RefreshCw size={13} strokeWidth={1.75} className="animate-spin" />
            ) : (
              <Trash2 size={13} strokeWidth={1.75} />
            )}
            {lang === 'ru' ? 'Очистить истёкшие' : 'Clean expired'}
          </button>
          <button
            onClick={handleGrantSuper}
            disabled={granting || resetting || cleaningCoupons}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-400/40 hover:from-amber-500/30 hover:to-orange-500/30 text-amber-200 text-xs font-bold transition-colors active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_12px_-4px_rgba(251,191,36,0.6)]"
            title={lang === 'ru' ? 'Готовит SUPER только для тебя — следующее открытие будет SUPER' : 'Primes a SUPER for you only — next open will be SUPER'}
          >
            {granting ? (
              <RefreshCw size={13} strokeWidth={1.75} className="animate-spin" />
            ) : (
              <Trophy size={13} strokeWidth={2} />
            )}
            {lang === 'ru' ? 'Выдать SUPER' : 'Grant SUPER'}
          </button>
          <button
            onClick={handleResetMyCooldown}
            disabled={resetting || granting || cleaningCoupons}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 text-amber-300 text-xs font-medium transition-colors active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
            title={lang === 'ru' ? 'Сбрасывает только ваш кулдаун, не других' : "Resets only your cooldown, not anyone else's"}
          >
            <RefreshCw size={13} strokeWidth={1.75} className={resetting ? 'animate-spin' : ''} />
            {lang === 'ru' ? 'Сбросить мой кулдаун' : 'Reset my cooldown'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
        <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-3">
          <p className="text-zinc-500 text-[10px] uppercase tracking-wider mb-0.5">Всего открытий</p>
          <p className="text-white text-xl font-bold tabular-nums">{totals?.totalOpens ?? '—'}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-3">
          <p className="text-zinc-500 text-[10px] uppercase tracking-wider mb-0.5">Часов выдано</p>
          <p className="text-emerald-300 text-xl font-bold tabular-nums">{totals?.totalHoursGranted ?? '—'}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-3">
          <p className="text-zinc-500 text-[10px] uppercase tracking-wider mb-0.5">Купонов</p>
          <p className="text-fuchsia-300 text-xl font-bold tabular-nums">{totals?.totalCouponsIssued ?? '—'}</p>
          {totals && (
            <p className="text-zinc-500 text-[9px] mt-1">
              акт. {totals.couponsActive} · исп. {totals.couponsUsed} · истёк. {totals.couponsExpired}
            </p>
          )}
        </div>
      </div>

      <div className="flex gap-2 mb-3 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-thin">
        {([
          ['all', 'Все'],
          ['daily', 'Daily'],
          ['super', 'SUPER'],
          ['coupons', 'Купоны'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`text-xs font-medium py-1.5 px-3 rounded-lg border transition-all whitespace-nowrap shrink-0 ${filter === key ? 'bg-white/10 border-white/25 text-white' : 'border-white/5 text-zinc-400 hover:text-white'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-red-300 text-xs">{error}</div>
      )}

      {items.length === 0 && !loading && !error ? (
        <div className="text-center py-8 text-zinc-500 text-sm">Ничего не найдено</div>
      ) : (
        <div className="space-y-1.5">
          {items.map((r) => {
            const cs = couponStatus(r);
            const styles = BOX_RARITY_STYLES[r.rarity];
            return (
              <div
                key={r.id}
                className={`rounded-lg border ${styles.ring} bg-gradient-to-r ${styles.bg} px-3 py-2 flex items-center justify-between gap-3 ${deletingId === r.id ? 'opacity-50 pointer-events-none' : ''}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-[8px] font-bold tracking-wider uppercase ${styles.chip}`}>
                      {r.boxKind === 'super' ? '★' : ''} {r.rarity}
                    </span>
                    <span className={`text-sm font-semibold ${styles.text} truncate`}>
                      {r.rewardKind === 'discount_coupon'
                        ? `−${r.discountPercent}% ${r.couponCode ? `(${r.couponCode})` : ''}`
                        : `${r.rewardHours}ч`}
                    </span>
                    {cs.label && (
                      <span className={`shrink-0 px-1.5 py-0.5 rounded text-[8px] font-semibold border ${cs.cls}`}>
                        {cs.label}
                      </span>
                    )}
                  </div>
                  <p className="text-zinc-400 text-[10px] truncate">
                    {formatUser(r.user)}
                    {' · '}
                    {new Date(r.createdAt).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                {/* v5 (2026-05-22): per-row trash button. Owner-only because
                    AdminBoxesView is rendered only for `isOwner` callers
                    (see admin tab gate around line 7567). The endpoint
                    re-validates `isAdmin(telegramId)` server-side as
                    defence-in-depth — never trust the client gate alone. */}
                <button
                  onClick={() => handleDeleteReward(r.id)}
                  disabled={deletingId === r.id}
                  className="shrink-0 w-8 h-8 rounded-md border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-300 flex items-center justify-center transition-colors active:scale-90 disabled:opacity-40 disabled:cursor-not-allowed"
                  title={lang === 'ru' ? 'Удалить запись' : 'Delete row'}
                  aria-label={lang === 'ru' ? 'Удалить запись' : 'Delete row'}
                >
                  <Trash2 size={13} strokeWidth={1.75} />
                </button>
              </div>
            );
          })}

          {hasMore && (
            <button
              onClick={() => fetchFeed(items.length)}
              disabled={loading}
              className="w-full mt-2 px-4 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-zinc-200 text-xs font-medium transition-colors disabled:opacity-50"
            >
              {loading ? 'Загрузка…' : 'Загрузить ещё'}
            </button>
          )}
          {loading && items.length === 0 && (
            <div className="text-center py-6 text-zinc-500 text-sm">Загрузка…</div>
          )}
        </div>
      )}
    </div>
  );
}

function AdminReferralsView({ tgId }: { tgId: number | undefined }) {
  const [data, setData] = useState<AdminReferralResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  // Active filter tab. 'all' = show every inviter regardless of category.
  // Default to 'all' so the admin lands on a familiar view; switching to a
  // specific tab is one click. Worst-class rows sort to the top inside
  // 'all' anyway (see backend CATEGORY_ORDER).
  const [categoryFilter, setCategoryFilter] = useState<AdminReferralCategory | 'all'>('all');
  // Set of inviterIds whose invitee panel is currently open. Stored in
  // a Set for O(1) toggle checks; rerender via clone on every change.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!tgId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/referrals?telegramId=${tgId}`, { cache: 'no-store' });
      if (!res.ok) {
        const msg = res.status === 403 ? 'Доступ запрещён' : `Ошибка ${res.status}`;
        setError(msg);
        return;
      }
      const json: AdminReferralResponse = await res.json();
      setData(json);
    } catch (e) {
      console.error('admin/referrals load failed:', e);
      setError('Сетевая ошибка');
    } finally {
      setLoading(false);
    }
  }, [tgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (inviterId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(inviterId)) next.delete(inviterId);
      else next.add(inviterId);
      return next;
    });
  };

  // Two-stage filter: 1) category tab restricts which inviters are even
  // candidates, 2) text search does case-insensitive substring match on
  // the most useful identifier fields. Both run client-side; the dataset
  // is small (one row per actual inviter, not per invitee) so this is
  // cheap even at thousands of rows.
  const q = search.trim().toLowerCase();
  const byCategory = (data?.inviters ?? []).filter(
    (inv) => categoryFilter === 'all' || inv.category === categoryFilter,
  );
  const filtered = !q
    ? byCategory
    : byCategory.filter((inv) => {
        const hay = [
          inv.inviterId,
          inv.inviterTelegramId ?? '',
          inv.inviterUsername ?? '',
          inv.inviterFirstName ?? '',
        ].join(' ').toLowerCase();
        return hay.includes(q);
      });

  const inviterLabel = (inv: { inviterUsername: string | null; inviterFirstName: string | null; inviterId: string; inviterTelegramId: string | null }) => {
    if (inv.inviterUsername) return `@${inv.inviterUsername}`;
    if (inv.inviterFirstName) return inv.inviterFirstName;
    return `id ${inv.inviterId}`;
  };
  const inviteeLabel = (p: AdminReferralPair) => {
    if (p.inviteeUsername) return `@${p.inviteeUsername}`;
    if (p.inviteeFirstName) return p.inviteeFirstName;
    return `id ${p.inviteeId}`;
  };

  // Pretty-print sums of money. Backend returns numbers, so just round
  // to integer roubles. Locale-aware spacing helps readability at >1k₽.
  const fmtRub = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`;

  return (
    <div>
      {/* Header + refresh */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-white font-medium text-sm">Рефералы</h3>
          <p className="text-zinc-500 text-[11px] mt-0.5">Кто кого пригласил и сколько начислено бонусных дней</p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="text-xs bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-300 hover:text-white px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 disabled:opacity-40"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Обновить
        </button>
      </div>

      {error && (
        <div className="mb-3 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-xs">
          {error}
        </div>
      )}

      {/* KPIs — 6 cards: inviters, pairs, bonus days, payments, paid ₽,
          paying invitees. The last two were added in v2 (2026-05-17) to
          surface real conversion value rather than just bonus accounting. */}
      {data && (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-2 mb-3">
          <div className="bg-zinc-900/50 border border-white/10 rounded-xl p-3">
            <div className="text-zinc-500 text-[10px] uppercase tracking-wider">Приглашающих</div>
            <div className="text-white text-xl font-bold mt-1">{data.totals.totalInviters}</div>
          </div>
          <div className="bg-zinc-900/50 border border-white/10 rounded-xl p-3">
            <div className="text-zinc-500 text-[10px] uppercase tracking-wider">Приглашений</div>
            <div className="text-white text-xl font-bold mt-1">{data.totals.totalPairs}</div>
          </div>
          <div className="bg-zinc-900/50 border border-white/10 rounded-xl p-3">
            <div className="text-zinc-500 text-[10px] uppercase tracking-wider">Бонусных дней</div>
            <div className="text-emerald-400 text-xl font-bold mt-1">{data.totals.totalDays}</div>
          </div>
          <div className="bg-zinc-900/50 border border-white/10 rounded-xl p-3">
            <div className="text-zinc-500 text-[10px] uppercase tracking-wider">Платежей друзей</div>
            <div className="text-white text-xl font-bold mt-1">{data.totals.totalPayments}</div>
          </div>
          <div className="bg-zinc-900/50 border border-white/10 rounded-xl p-3">
            <div className="text-zinc-500 text-[10px] uppercase tracking-wider">Сумма оплат</div>
            <div className="text-amber-300 text-xl font-bold mt-1">{fmtRub(data.totals.totalPaidRub)}</div>
          </div>
          <div className="bg-zinc-900/50 border border-white/10 rounded-xl p-3">
            <div className="text-zinc-500 text-[10px] uppercase tracking-wider">Платящих друзей</div>
            <div className="text-white text-xl font-bold mt-1">
              {data.totals.totalPaidInvitees}
              <span className="text-zinc-500 text-xs font-normal ml-1">/ {data.totals.totalPairs}</span>
            </div>
          </div>
        </div>
      )}

      {/* Category filter tabs. Show 'all' first then each non-empty category,
          ordered by visual priority (абьюзеры last so they don't dominate
          the eye, but easy to find since the badge is red). */}
      {data && data.inviters.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          <button
            onClick={() => setCategoryFilter('all')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] transition-colors ${
              categoryFilter === 'all'
                ? 'bg-white/10 border-white/25 text-white'
                : 'bg-zinc-900/60 border-white/10 text-zinc-400 hover:text-white hover:border-white/20'
            }`}
          >
            <span className="font-medium">Все</span>
            <span className="text-zinc-500">{data.inviters.length}</span>
          </button>
          {(Object.entries(ADMIN_REFERRAL_CATEGORY_META) as [AdminReferralCategory, typeof ADMIN_REFERRAL_CATEGORY_META[AdminReferralCategory]][])
            .sort(([, a], [, b]) => a.priority - b.priority)
            .map(([cat, meta]) => {
              const count = data.categoryCounts[cat] ?? 0;
              if (count === 0) return null;
              const Icon = meta.icon;
              const active = categoryFilter === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] transition-colors ${
                    active
                      ? `${meta.bg} ${meta.ring} ${meta.chip}`
                      : 'bg-zinc-900/60 border-white/10 text-zinc-400 hover:text-white hover:border-white/20'
                  }`}
                >
                  <Icon size={12} />
                  <span className="font-medium">{meta.label}</span>
                  <span className={active ? meta.chip : 'text-zinc-500'}>{count}</span>
                </button>
              );
            })}
        </div>
      )}

      {/* Search */}
      {data && data.inviters.length > 0 && (
        <div className="relative mb-2">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по @username, имени, id, telegram_id…"
            className="w-full bg-zinc-900/60 border border-white/10 rounded-lg pl-8 pr-3 py-2 text-white text-xs placeholder:text-zinc-500 focus:border-white/25 focus:outline-none"
          />
        </div>
      )}

      {/* Inviter list */}
      {loading && !data && (
        <div className="text-center py-8 text-zinc-400 text-sm">Загрузка...</div>
      )}

      {data && data.inviters.length === 0 && (
        <div className="text-center py-8 text-zinc-500 text-sm">Пока никто никого не пригласил</div>
      )}

      {data && filtered.length === 0 && data.inviters.length > 0 && (
        <div className="text-center py-6 text-zinc-500 text-xs">
          {q ? `Ничего не найдено по «${search}»` : 'В этой категории пусто'}
        </div>
      )}

      {data && filtered.length > 0 && (
        <div className="space-y-1.5">
          {filtered.map((inv) => {
            const isOpen = expanded.has(inv.inviterId);
            const meta = ADMIN_REFERRAL_CATEGORY_META[inv.category];
            const CategoryIcon = meta.icon;
            return (
              <div
                key={inv.inviterId}
                className={`bg-zinc-900/40 border rounded-xl overflow-hidden ${meta.ring}`}
              >
                {/* Inviter row (clickable to expand) */}
                <button
                  onClick={() => toggle(inv.inviterId)}
                  className="w-full flex items-center gap-2.5 p-3 hover:bg-white/[0.02] transition-colors text-left"
                >
                  <ChevronDown
                    size={14}
                    className={`text-zinc-500 shrink-0 transition-transform ${isOpen ? '' : '-rotate-90'}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-white text-sm font-medium truncate">{inviterLabel(inv)}</span>
                      <span className="text-zinc-500 text-[11px]">id {inv.inviterId}</span>
                      {inv.inviterTelegramId && (
                        <span className="text-zinc-600 text-[10px]">tg {inv.inviterTelegramId}</span>
                      )}
                      {/* Category chip */}
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[9.5px] uppercase tracking-wider ${meta.bg} ${meta.ring} ${meta.chip}`}>
                        <CategoryIcon size={10} />
                        {meta.label}
                      </span>
                      {/* Abuse signal chips (each shown as a small
                          orange/red pill, capped at 3 to avoid a wrap-explosion
                          on heavy-burst rows). */}
                      {inv.signals.slice(0, 3).map((s) => (
                        <span
                          key={s}
                          className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-red-500/10 border border-red-500/30 text-red-300 text-[9.5px]"
                          title={ADMIN_REFERRAL_SIGNAL_LABELS[s]}
                        >
                          ⚠ {ADMIN_REFERRAL_SIGNAL_LABELS[s]}
                        </span>
                      ))}
                      {inv.signals.length > 3 && (
                        <span className="text-red-300/70 text-[9.5px]">+{inv.signals.length - 3}</span>
                      )}
                    </div>
                    <div className="text-zinc-400 text-[11px] mt-0.5 flex items-center flex-wrap gap-x-2 gap-y-0.5">
                      <span>Пригласил <span className="text-white">{inv.inviteeCount}</span></span>
                      <span className="text-zinc-600">·</span>
                      <span>Платят <span className="text-white">{inv.paidInviteeCount}</span>/{inv.inviteeCount}</span>
                      <span className="text-zinc-600">·</span>
                      <span>С устр. <span className="text-white">{inv.deviceInviteeCount}</span>/{inv.inviteeCount}</span>
                      {inv.subInviterCount > 0 && (
                        <>
                          <span className="text-zinc-600">·</span>
                          <span>Сами пригласили <span className="text-white">{inv.subInviterCount}</span></span>
                        </>
                      )}
                      {inv.paidAmountRub > 0 && (
                        <>
                          <span className="text-zinc-600">·</span>
                          <span>Оплаты <span className="text-amber-300">{fmtRub(inv.paidAmountRub)}</span></span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-emerald-400 text-sm font-bold">+{inv.totalBonus}д</div>
                    <div className="text-zinc-600 text-[10px]">
                      {inv.signupBonus > 0 && <>signup {inv.signupBonus}</>}
                      {inv.signupBonus > 0 && inv.paymentBonus > 0 && ' · '}
                      {inv.paymentBonus > 0 && <>pay {inv.paymentBonus}</>}
                    </div>
                  </div>
                </button>

                {/* Invitee panel — expanded engagement metrics for each
                    invitee. Three small chips per row mirror the inviter
                    summary: 📱 devices, 💳 payments, 👥 sub-invitees. */}
                {isOpen && (
                  <div className="border-t border-white/5 bg-black/20 divide-y divide-white/5">
                    {inv.invitees.map((p) => (
                      <div key={p.inviteeId} className="flex items-center gap-2.5 px-3 py-2">
                        <div className="w-1 h-1 rounded-full bg-zinc-600 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-zinc-200 text-[12.5px] truncate">{inviteeLabel(p)}</span>
                            <span className="text-zinc-600 text-[10px]">id {p.inviteeId}</span>
                            <span className="text-zinc-700 text-[9px] uppercase tracking-wider">{p.inviteeAuthType}</span>
                            {/* Per-invitee engagement chips. Each chip is
                                colour-coded: green=positive (paying, has
                                devices, brought more refs), zinc=zero. */}
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9.5px] ${p.inviteeDeviceCount > 0 ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20' : 'bg-zinc-800/60 text-zinc-500 border border-white/5'}`} title="Активных устройств">
                              <Smartphone size={10} />
                              {p.inviteeDeviceCount}
                            </span>
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9.5px] ${p.inviteePaidCount > 0 ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20' : 'bg-zinc-800/60 text-zinc-500 border border-white/5'}`} title="Оплат и сумма">
                              <CreditCard size={10} />
                              {p.inviteePaidCount}
                              {p.inviteePaidAmountRub > 0 && (
                                <span className="ml-0.5 text-amber-200/80">{fmtRub(p.inviteePaidAmountRub)}</span>
                              )}
                            </span>
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9.5px] ${p.inviteeSubInviteeCount > 0 ? 'bg-sky-500/10 text-sky-300 border border-sky-500/20' : 'bg-zinc-800/60 text-zinc-500 border border-white/5'}`} title="Сколько сам пригласил">
                              <Users size={10} />
                              {p.inviteeSubInviteeCount}
                            </span>
                          </div>
                          <div className="text-zinc-500 text-[10px] mt-0.5">
                            {new Date(p.invitedAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}
                            {p.inviteeLastSeenAt && (
                              <> · посл. видели {new Date(p.inviteeLastSeenAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-emerald-300 text-xs font-medium">+{p.totalBonus}д</div>
                          {p.paymentBonus > 0 && (
                            <div className="text-zinc-600 text-[10px]">из них pay {p.paymentBonus}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AdminServicesView({ tgId, lang }: { tgId: number | undefined; lang: 'ru' | 'en' }) {
  const [requests, setRequests] = useState<AdminServiceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ServiceMessage[]>([]);
  const [replyText, setReplyText] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [sending, setSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const loadRequests = async () => {
    if (!tgId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/services?telegramId=${tgId}`);
      if (res.ok) {
        const data = await res.json();
        setRequests(data.requests || []);
      }
    } catch { /* ignore */ } finally { setLoading(false); }
  };

  const loadMessages = async (requestId: number) => {
    if (!tgId) return;
    try {
      const res = await fetch('/api/admin/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: tgId, requestId, action: 'messages' }),
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch { /* ignore */ }
  };

  useEffect(() => { loadRequests(); }, [tgId]);

  const handleReply = async (requestId: number) => {
    if (!tgId || !replyText.trim()) return;
    setSending(true);
    try {
      await fetch('/api/admin/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: tgId, requestId, action: 'reply', message: replyText.trim() }),
      });
      setReplyText('');
      await loadMessages(requestId);
    } catch { /* ignore */ } finally { setSending(false); }
  };

  const handleSetAmount = async (requestId: number) => {
    if (!tgId || !amountInput) return;
    haptic('medium');
    try {
      await fetch('/api/admin/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: tgId, requestId, action: 'set_amount', amount: amountInput }),
      });
      setAmountInput('');
      await loadRequests();
      await loadMessages(requestId);
    } catch { /* ignore */ }
  };

  const handleStatus = async (requestId: number, status: string) => {
    if (!tgId) return;
    haptic('medium');
    try {
      await fetch('/api/admin/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: tgId, requestId, action: 'set_status', status }),
      });
      await loadRequests();
      await loadMessages(requestId);
    } catch { /* ignore */ }
  };

  const handleDelete = async (requestId: number) => {
    if (!tgId || !confirm(lang === 'ru' ? 'Удалить заявку?' : 'Delete request?')) return;
    haptic('heavy');
    try {
      await fetch('/api/admin/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: tgId, requestId, action: 'delete' }),
      });
      setSelectedId(null);
      setMessages([]);
      await loadRequests();
    } catch { /* ignore */ }
  };

  const statusColors: Record<string, string> = {
    new: 'bg-blue-500/20 text-blue-400',
    awaiting_payment: 'bg-yellow-500/20 text-yellow-400',
    paid: 'bg-green-500/20 text-green-400',
    processing: 'bg-purple-500/20 text-purple-400',
    completed: 'bg-emerald-500/20 text-emerald-400',
    cancelled: 'bg-red-500/20 text-red-400',
  };

  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (loading) return <div className="text-center py-8 text-zinc-400">...</div>;

  const selected = requests.find(r => r.id === selectedId);

  if (selected) {
    return (
      <div className="flex flex-col" style={{ minHeight: '60vh' }}>
        {/* Header */}
        <div className="flex items-center gap-2 mb-3">
          <button onClick={() => { setSelectedId(null); setMessages([]); }} className="text-zinc-400 hover:text-white p-1.5 rounded-lg hover:bg-white/5">
            <ChevronRight size={16} className="rotate-180" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-white font-medium text-sm truncate">{selected.service_name}</h4>
              <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${statusColors[selected.status] || 'bg-zinc-500/20 text-zinc-400'}`}>{selected.status}</span>
            </div>
            <p className="text-zinc-500 text-[10px] truncate">
              👤 {selected.first_name || selected.username || `ID:${selected.user_id}`} {selected.username ? `@${selected.username}` : ''} · TG:{selected.telegram_id}
              {selected.amount ? ` · 💰${Number(selected.amount)} ${selected.currency}` : ''}
            </p>
          </div>
        </div>

        {/* Action bar */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {['new', 'awaiting_payment'].includes(selected.status) && (
            <div className="flex gap-1.5 items-center">
              <input type="number" value={amountInput} onChange={(e) => setAmountInput(e.target.value)} placeholder="₽" className="w-20 bg-zinc-800/60 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white placeholder:text-zinc-500 outline-none" />
              <button onClick={() => handleSetAmount(selected.id)} disabled={!amountInput} className="text-[10px] px-2 py-1.5 rounded-lg bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 hover:bg-yellow-500/30 disabled:opacity-30">
                💰 {lang === 'ru' ? 'Цена' : 'Price'}
              </button>
            </div>
          )}
          {selected.status === 'paid' && (
            <button onClick={() => handleStatus(selected.id, 'processing')} className="text-[10px] px-2 py-1.5 rounded-lg bg-purple-500/20 text-purple-400 border border-purple-500/30 hover:bg-purple-500/30">
              ▶ {lang === 'ru' ? 'В обработку' : 'Process'}
            </button>
          )}
          {['paid', 'processing'].includes(selected.status) && (
            <button onClick={() => handleStatus(selected.id, 'completed')} className="text-[10px] px-2 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30">
              ✓ {lang === 'ru' ? 'Готово' : 'Done'}
            </button>
          )}
          {!['completed', 'cancelled'].includes(selected.status) && (
            <button onClick={() => handleStatus(selected.id, 'cancelled')} className="text-[10px] px-2 py-1.5 rounded-lg bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30">
              ✕
            </button>
          )}
          <button onClick={() => handleDelete(selected.id)} className="text-[10px] px-2 py-1.5 rounded-lg bg-red-500/10 text-red-400/60 border border-red-500/20 hover:bg-red-500/30 ml-auto">
            🗑
          </button>
        </div>

        {/* Chat messages */}
        <div className="flex-1 rounded-2xl border border-white/10 bg-zinc-950/50 p-3 overflow-y-auto space-y-2" style={{ maxHeight: '50vh', minHeight: '200px' }}>
          {messages.length === 0 ? (
            <p className="text-zinc-600 text-xs text-center py-8">{lang === 'ru' ? 'Нет сообщений' : 'No messages'}</p>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.sender_type === 'admin' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                  msg.sender_type === 'admin'
                    ? 'bg-emerald-500/20 text-white rounded-br-sm'
                    : 'bg-zinc-800 text-zinc-200 rounded-bl-sm border border-white/5'
                }`}>
                  <p className={`text-[10px] font-medium mb-0.5 ${msg.sender_type === 'admin' ? 'text-emerald-400' : 'text-blue-400'}`}>{msg.sender_type === 'admin' ? (lang === 'ru' ? 'Админ' : 'Admin') : (selected.first_name || selected.username || 'User')}</p>
                  <p className="break-words whitespace-pre-wrap">{msg.message}</p>
                  <p className="text-[9px] text-zinc-500 mt-1 text-right">{new Date(msg.created_at).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</p>
                </div>
              </div>
            ))
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Reply input */}
        <div className="flex gap-2 mt-3">
          <input
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReply(selected.id); } }}
            placeholder={lang === 'ru' ? 'Написать сообщение...' : 'Type a message...'}
            className="flex-1 bg-zinc-800/60 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-emerald-500/50"
          />
          <button onClick={() => handleReply(selected.id)} disabled={sending || !replyText.trim()} className="bg-emerald-500 hover:bg-emerald-400 text-white px-4 rounded-xl disabled:opacity-30 transition-colors active:scale-95">
            <Send size={16} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-white font-medium text-sm">🌐 {lang === 'ru' ? 'Заявки на услуги' : 'Service Requests'}</h4>
        <button onClick={loadRequests} className="text-zinc-400 hover:text-white">
          <RefreshCw size={14} />
        </button>
      </div>
      {requests.length === 0 ? (
        <p className="text-zinc-500 text-sm text-center py-4">{lang === 'ru' ? 'Заявок нет' : 'No requests'}</p>
      ) : (
        requests.map((req) => (
          <button key={req.id} onClick={() => { setSelectedId(req.id); loadMessages(req.id); }} className="w-full text-left p-2.5 bg-zinc-800/50 rounded-lg hover:bg-white/5 transition-colors">
            <div className="flex items-center justify-between mb-1">
              <span className="text-white text-sm font-medium truncate">#{req.id} {req.service_name}</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ml-2 ${statusColors[req.status] || 'bg-zinc-500/20 text-zinc-400'}`}>{req.status}</span>
            </div>
            <div className="text-xs text-zinc-400">
              {req.first_name || req.username || `User:${req.user_id}`} {req.amount ? `· ${Number(req.amount)} ${req.currency}` : ''} · {req.message_count} msg
            </div>
          </button>
        ))
      )}
    </div>
  );
}

function ServersView({ t, direction, navigate }: { t: any; direction: number; navigate: (tab: Tab) => void }) {
  const [servers, setServers] = useState<{ id: number; name: string; host: string; port: number; country: string; is_active: boolean; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [pingResults, setPingResults] = useState<Record<number, number | null>>({});
  const [pinging, setPinging] = useState(false);

  // Known ISO-3166-1 alpha-2 codes we have rows for. Used to skip the
  // `flagcdn.com` request for an unknown code (which would 404 and trigger
  // an onError → Globe fallback anyway — but avoiding the request is cleaner).
  const knownCountryCodes = new Set(['NL', 'DE', 'US', 'FI', 'RU', 'GB', 'FR', 'SE', 'CA', 'JP', 'AU', 'SG']);

  // UI-friendly server name overrides. The canonical `name` column in the
  // DB stays untouched (production: «DE-Frankfurt-01», «NL-Amsterdam-02»
  // etc. — see /api/servers route + admin panel) so the ops/billing side
  // sees the technical hostname, while the user only sees the country
  // they recognise. Keep this map in sync with `knownCountryCodes` above.
  const COUNTRY_DISPLAY_NAMES: Record<string, string> = {
    DE: 'Германия',
    NL: 'Нидерланды',
    RU: 'Россия',
    FI: 'Финляндия',
    US: 'США',
    GB: 'Великобритания',
    FR: 'Франция',
    SE: 'Швеция',
    CA: 'Канада',
    JP: 'Япония',
    AU: 'Австралия',
    SG: 'Сингапур',
  };
  const displayServerName = (srv: { name: string; country: string }): string => {
    const code = (srv.country || '').toUpperCase();
    return COUNTRY_DISPLAY_NAMES[code] ?? srv.name;
  };

  const loadServers = async () => {
    try {
      const res = await fetch('/api/servers', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setServers(data.servers ?? []);
      }
    } catch { /* ignore */ } finally { setLoading(false); }
  };

  const pingServers = async () => {
    setPinging(true);
    try {
      // Refresh the server list too — user may have pressed Ping specifically
      // because a newly added server is missing from the view.
      await loadServers();
      const res = await fetch('/api/servers/ping', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setPingResults(data.ping ?? {});
      }
    } catch { /* ignore */ } finally { setPinging(false); }
  };

  useEffect(() => {
    loadServers();
  }, []);

  const activeCount = servers.filter(s => s.is_active).length;

  return (
    <motion.div
      custom={direction}
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{ duration: 0.25 }}
      className="w-full max-w-md mx-auto"
    >
      <div className="px-4 pb-28 space-y-5">
        {/* Header */}
        <div className="relative rounded-2xl border border-red-500/20 bg-gradient-to-br from-red-500/10 via-zinc-900/50 to-zinc-900/30 p-4 overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={() => navigate('profile')} className="text-zinc-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/5 -ml-1">
                <ChevronRight size={18} strokeWidth={2} className="rotate-180" />
              </button>
              <div>
                <h2 className="text-white font-bold text-lg">{t.serversTitle}</h2>
                {!loading && servers.length > 0 && (
                  <div className="flex items-center gap-3 mt-1">
                    <div className="flex items-center gap-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-400 shadow-[0_0_4px_rgba(74,222,128,0.6)]" />
                      <span className="text-green-400/80 text-[10px] font-medium">{activeCount}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                      <span className="text-zinc-500 text-[10px] font-medium">{servers.length - activeCount}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <button
              onClick={pingServers}
              disabled={pinging}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-all text-xs text-red-400 font-medium disabled:opacity-50 active:scale-95"
            >
              <RefreshCw size={13} className={pinging ? 'animate-spin' : ''} />
              {pinging ? '...' : 'Ping'}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-10 h-10 rounded-full border-2 border-red-500/20 border-t-red-500 animate-spin" />
          </div>
        ) : servers.length === 0 ? (
          <div className="text-center py-16 rounded-2xl border border-white/5 bg-zinc-900/30">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-zinc-800/50 border border-white/5 flex items-center justify-center">
              <Globe size={28} strokeWidth={1.2} className="text-zinc-600" />
            </div>
            <p className="text-zinc-500 text-sm">{t.noServers}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {servers.map((srv, idx) => (
              <div 
                key={srv.id} 
                className={`group relative rounded-2xl border transition-all duration-300 overflow-hidden ${
                  srv.is_active 
                    ? 'bg-gradient-to-br from-zinc-900/80 via-zinc-900/60 to-green-950/20 border-green-500/20 hover:border-green-500/40 shadow-[0_0_20px_rgba(34,197,94,0.05)]' 
                    : 'bg-gradient-to-br from-zinc-900/60 to-zinc-900/30 border-white/5 hover:border-white/10'
                }`}
              >
                {srv.is_active && (
                  <div className="absolute top-0 right-0 w-24 h-24 bg-green-500/5 rounded-full blur-2xl" />
                )}
                <div className="relative p-4">
                  <div className="flex items-center gap-4">
                    {/* Flag */}
                    <div className={`relative w-12 h-12 rounded-xl flex items-center justify-center overflow-hidden ${
                      srv.is_active 
                        ? 'bg-gradient-to-br from-green-500/20 to-green-600/10 border border-green-500/30' 
                        : 'bg-zinc-800/60 border border-white/5'
                    }`}>
                      {knownCountryCodes.has(srv.country.toUpperCase()) ? (
                        <img
                          src={`https://flagcdn.com/h60/${srv.country.toLowerCase()}.png`}
                          srcSet={`https://flagcdn.com/h120/${srv.country.toLowerCase()}.png 2x, https://flagcdn.com/h240/${srv.country.toLowerCase()}.png 4x`}
                          alt={srv.country}
                          loading="lazy"
                          className="w-9 h-7 object-cover rounded-md shadow-sm"
                          onError={(e) => {
                            const img = e.currentTarget;
                            img.style.display = 'none';
                            const fallback = img.nextElementSibling as HTMLElement | null;
                            if (fallback) fallback.style.display = 'flex';
                          }}
                        />
                      ) : null}
                      <span
                        className="text-zinc-400 text-xs font-bold tracking-wider"
                        style={{ display: knownCountryCodes.has(srv.country.toUpperCase()) ? 'none' : 'flex' }}
                      >
                        {srv.country.toUpperCase()}
                      </span>
                      <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-zinc-900 ${
                        srv.is_active ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)]' : 'bg-zinc-600'
                      }`} />
                    </div>
                    
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-semibold truncate">{displayServerName(srv)}</p>
                      <p className="text-zinc-500 text-xs mt-0.5 uppercase tracking-wider">{srv.country}</p>
                    </div>
                    
                    {/* Ping */}
                    {pingResults[srv.id] !== undefined && (
                      <div className={`text-xs font-mono font-bold px-2.5 py-1.5 rounded-xl border ${
                        pingResults[srv.id] === null 
                          ? 'text-red-400 bg-red-500/10 border-red-500/20' 
                          : pingResults[srv.id]! < 100 
                            ? 'text-green-400 bg-green-500/10 border-green-500/20' 
                            : pingResults[srv.id]! < 300 
                              ? 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20' 
                              : 'text-orange-400 bg-orange-500/10 border-orange-500/20'
                      }`}>
                        {pingResults[srv.id] === null ? 'ERR' : `${pingResults[srv.id]}ms`}
                      </div>
                    )}
                    
                    {/* Status badge */}
                    <div className={`text-[9px] uppercase tracking-widest font-bold px-2.5 py-1.5 rounded-xl ${
                      srv.is_active 
                        ? 'text-green-400 bg-green-500/15 border border-green-500/30' 
                        : 'text-zinc-500 bg-zinc-800/50 border border-white/5'
                    }`}>
                      {srv.is_active ? t.serverActive : t.serverInactive}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function EmailAuthView({ lang, setLang, onLogin }: { lang: 'ru' | 'en'; setLang: (l: 'ru' | 'en') => void; onLogin: (user: { id: number; email: string; name: string }, sessionToken: string) => void }) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleSendCode = async () => {
    haptic('medium');
    if (!email.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || (lang === 'ru' ? 'Ошибка' : 'Error'));
        return;
      }
      setStep('code');
      setCooldown(60);
    } catch {
      setError(lang === 'ru' ? 'Ошибка сети' : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    haptic('medium');
    if (!code.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || (lang === 'ru' ? 'Неверный код' : 'Invalid code'));
        return;
      }
      onLogin(data.user, data.sessionToken);
    } catch {
      setError(lang === 'ru' ? 'Ошибка сети' : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    haptic('light');
    if (cooldown > 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || (lang === 'ru' ? 'Ошибка' : 'Error'));
        return;
      }
      setCooldown(60);
      setCode('');
    } catch {
      setError(lang === 'ru' ? 'Ошибка сети' : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#020202] flex flex-col items-center justify-center p-4 font-sans relative overflow-hidden">
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute -top-[20%] -left-[10%] w-[40vw] h-[40vw] max-w-[300px] max-h-[300px] rounded-full bg-white/10 blur-[55px]" />
        <div className="absolute top-[40%] -right-[10%] w-[50vw] h-[50vw] max-w-[400px] max-h-[400px] rounded-full bg-white/5 blur-[65px]" />
      </div>

      <div className="relative z-10 w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="font-syncopate font-bold text-xl tracking-[0.12em] text-white mb-1">
            HUNDLER
            <span className="relative inline-block ml-1.5">
              <span className="absolute inset-0 bg-gradient-to-r from-white to-zinc-300 blur-sm opacity-35"></span>
              <span className="relative text-transparent bg-clip-text bg-gradient-to-r from-zinc-200 via-white to-zinc-400">VPN</span>
            </span>
          </h1>
          <p className="text-zinc-500 text-xs mt-2">
            {lang === 'ru' ? 'Войдите или зарегистрируйтесь по email' : 'Sign in or register with email'}
          </p>
        </div>

        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="bg-gradient-to-b from-[#151515] via-[#0b0b0b] to-[#020202] border border-white/15 rounded-2xl p-5 shadow-2xl"
        >
          {step === 'email' ? (
            <>
              <div className="mb-4">
                <label className="text-zinc-400 text-[10px] uppercase tracking-wider block mb-1.5">Email</label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendCode()}
                    placeholder="user@example.com"
                    autoFocus
                    className="w-full bg-zinc-800/60 border border-white/10 rounded-xl pl-10 pr-3 py-3 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-white/25 transition-colors"
                  />
                </div>
              </div>

              {error && <p className="text-red-400 text-xs mb-3">{error}</p>}

              <button
                onClick={handleSendCode}
                disabled={loading || !email.trim()}
                className="w-full bg-gradient-to-r from-white/20 to-white/10 border border-white/25 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 text-sm transition-all"
              >
                {loading ? '...' : (lang === 'ru' ? 'Получить код' : 'Get code')}
              </button>
            </>
          ) : (
            <>
              <div className="mb-2">
                <p className="text-zinc-400 text-xs mb-3">
                  {lang === 'ru' ? 'Код отправлен на' : 'Code sent to'} <span className="text-white">{email}</span>
                </p>
                <button onClick={() => { setStep('email'); setError(null); setCode(''); }} className="text-zinc-500 text-[10px] hover:text-white transition-colors mb-3 inline-block">
                  {lang === 'ru' ? '← Изменить email' : '← Change email'}
                </button>
              </div>

              <div className="mb-4">
                <label className="text-zinc-400 text-[10px] uppercase tracking-wider block mb-1.5">
                  {lang === 'ru' ? 'Код подтверждения' : 'Verification code'}
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  onKeyDown={(e) => e.key === 'Enter' && handleVerifyCode()}
                  placeholder="000000"
                  autoFocus
                  maxLength={6}
                  className="w-full bg-zinc-800/60 border border-white/10 rounded-xl px-3 py-3 text-center text-lg font-mono text-white tracking-[0.5em] placeholder:text-zinc-600 placeholder:tracking-[0.5em] outline-none focus:border-white/25 transition-colors"
                />
              </div>

              {error && <p className="text-red-400 text-xs mb-3">{error}</p>}

              <button
                onClick={handleVerifyCode}
                disabled={loading || code.length < 6}
                className="w-full bg-gradient-to-r from-white/20 to-white/10 border border-white/25 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 text-sm transition-all mb-3"
              >
                {loading ? '...' : (lang === 'ru' ? 'Войти' : 'Sign in')}
              </button>

              <button
                onClick={handleResend}
                disabled={cooldown > 0 || loading}
                className="w-full text-zinc-500 text-xs py-2 hover:text-white transition-colors disabled:opacity-40"
              >
                {cooldown > 0
                  ? (lang === 'ru' ? `Отправить повторно (${cooldown}с)` : `Resend (${cooldown}s)`)
                  : (lang === 'ru' ? 'Отправить повторно' : 'Resend code')
                }
              </button>
            </>
          )}
        </motion.div>

        <div className="mt-4 text-center">
          <button onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')} className="text-zinc-600 text-xs hover:text-zinc-400 transition-colors">
            {lang === 'ru' ? 'English' : 'Русский'}
          </button>
        </div>
      </div>
    </div>
  );
}

function TgStoreView({ t, direction, tgUser, navigate, lang }: { t: any; direction: number; tgUser: { id: number; name: string; photo: string; username?: string } | null; navigate: (tab: Tab) => void; lang: 'ru' | 'en' }) {
  const [prices, setPrices] = useState<{ id: number; product_type: string; period: string; stars_amount: number | null; price_rub: string; original_price_rub: string | null; discount_percent: number | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [productType, setProductType] = useState<'stars' | 'premium'>('premium');
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);
  const [starsAmount, setStarsAmount] = useState<number>(100);
  const [username, setUsername] = useState(tgUser?.username || '');
  const [submitting, setSubmitting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    const loadPrices = async () => {
      try {
        const res = await fetch('/api/fragment/prices');
        if (res.ok) {
          const data = await res.json();
          setPrices(data.prices || []);
        }
      } catch (err) {
        console.error('Failed to load prices:', err);
      } finally {
        setLoading(false);
      }
    };
    loadPrices();
  }, []);

  // Sort plans so the *largest / longest* option is rendered LAST. UX
  // request 2026-05-13: «Выгодно» бейдж должен быть на ПОСЛЕДНЕЙ карточке,
  // не на первой. Логика `bestValueId` ниже остаётся прежней (выбирает
  // самый длинный период / самое большое количество звёзд) — мы просто
  // меняем порядок отображения, чтобы «лучший» тариф визуально шёл в конце.
  const filteredPrices = prices
    .filter(p => p.product_type === productType)
    .slice()
    .sort((a, b) => {
      if (productType === 'premium') {
        const ma = parseInt((a.period.match(/(\d+)/) || ['0', '0'])[1], 10);
        const mb = parseInt((b.period.match(/(\d+)/) || ['0', '0'])[1], 10);
        return ma - mb;
      }
      return (a.stars_amount ?? 0) - (b.stars_amount ?? 0);
    });
  const selectedPrice = filteredPrices.find(p => p.period === selectedPeriod);

  const handlePurchase = async () => {
    haptic('heavy');
    if (!tgUser?.id || !selectedPeriod) return;
    
    setSubmitting(true);
    try {
      const res = await fetch('/api/fragment/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegramId: tgUser.id,
          productType,
          period: selectedPeriod,
          starsAmount: productType === 'stars' ? starsAmount : null,
          telegramUsername: username || tgUser.username,
        }),
      });

      const data = await res.json();
      if (data.redirect) {
        // Open in external browser for Telegram WebApp
        if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp?.openLink) {
          (window as any).Telegram.WebApp.openLink(data.redirect);
        } else {
          window.location.href = data.redirect;
        }
      } else if (data.error) {
        alert(data.error);
      }
    } catch (err) {
      console.error('Failed to create order:', err);
      alert('Ошибка создания заказа');
    } finally {
      setSubmitting(false);
    }
  };

  const periodLabels: Record<string, string> = {
    '3 months': t.tgStore3Months,
    '6 months': t.tgStore6Months,
    '12 months': t.tgStore12Months,
    '3_months': t.tgStore3Months,
    '6_months': t.tgStore6Months,
    '12_months': t.tgStore12Months,
    '100 stars': '100 Stars',
    '500 stars': '500 Stars',
    '1000 stars': '1000 Stars',
    '100_stars': '100 Stars',
    '500_stars': '500 Stars',
    '1000_stars': '1000 Stars',
  };

  const getProductLabel = () => {
    if (!selectedPrice) return '';
    return periodLabels[selectedPrice.period] || selectedPrice.period.replace('_', ' ');
  };

  // 2026-05-11: visual helpers for the premium redesign — kept INSIDE the
  // component so we can branch on `productType` without prop-drilling. The
  // brand stays strictly black / red / white per project palette; we use
  // the *intensity* of the red glow + monochrome accents to differentiate
  // Premium vs Stars rather than introducing a second hue.
  const isPremium = productType === 'premium';
  const ProductIcon = isPremium ? Zap : Star;
  // Per-month price helper. We only annotate the multi-month plans —
  // shorter periods don't benefit from the breakdown and clutter the card.
  //
  // 2026-05-13 bugfix: regex used to be `(\d+)\s*month` which matched
  // "3 months" (space) but NOT "3_months" (underscore — what the API
  // actually returns). When every period fell through to `null`, the
  // `bestValueId` reduce in Premium branch compared 0 ≥ 0 for all
  // entries and kept the FIRST one — i.e. 3 months — so the "Выгодно"
  // badge landed on 3 months instead of 12. Accept both separators.
  const monthsForPeriod = (period: string): number | null => {
    const m = period.match(/(\d+)[\s_]*month/i);
    return m ? parseInt(m[1], 10) : null;
  };
  // "Best value" badge target. Per UX feedback (2026-05-11):
  //   - Premium → ALWAYS the longest plan (12-month). It's the canonical
  //     "best value" for a recurring subscription regardless of whether
  //     the shorter periods happen to have a momentary higher %-off.
  //   - Stars   → the largest pack (more stars per RUB at the top tier).
  // Memoising would be nicer but the list is ≤ 6 items so the tiny scan
  // is free.
  const bestValueId: number | null = (() => {
    if (filteredPrices.length < 2) return null;
    if (productType === 'premium') {
      // Longest period (12 → 6 → 3). Ties unlikely; first one wins.
      return filteredPrices.reduce((a, b) =>
        (monthsForPeriod(a.period) ?? 0) >= (monthsForPeriod(b.period) ?? 0) ? a : b
      ).id;
    }
    // Stars — largest amount.
    return filteredPrices.reduce((a, b) =>
      (a.stars_amount ?? 0) >= (b.stars_amount ?? 0) ? a : b
    ).id;
  })();

  return (
    <motion.div custom={direction} variants={pageVariants} initial="initial" animate="animate" exit="exit" className="flex flex-col flex-1 items-center w-full">
      <div className="w-full max-w-xs lg:max-w-[560px]">
        <button onClick={() => navigate('profile')} className="mb-4 text-zinc-400 hover:text-white text-xs inline-flex items-center gap-1.5 transition-colors">
          <ChevronLeft size={14} /> {t.tgStoreBackToProfile}
        </button>

        {/* Premium hero card. Black canvas with a single red-glow disc as
            the focal point — keeps the palette monochrome (black/white/red)
            while feeling "premium" through depth + soft glow + restrained
            type. The disc colour shifts subtly based on productType so the
            user has visual feedback when toggling. */}
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-zinc-900/80 to-black p-5 mb-4">
          {/* Decorative glow — pure red, very low opacity, behind icon. */}
          <div
            className={`absolute -top-10 -right-10 w-40 h-40 rounded-full blur-3xl pointer-events-none transition-opacity duration-500 ${
              isPremium ? 'bg-red-500/30 opacity-100' : 'bg-red-500/15 opacity-80'
            }`}
          />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_0%_100%,rgba(239,68,68,0.08),transparent_60%)] pointer-events-none" />

          <div className="relative flex items-center gap-3.5">
            <div
              className={`relative w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-300 ${
                isPremium
                  ? 'bg-gradient-to-br from-red-500 to-red-700 shadow-[0_0_24px_rgba(239,68,68,0.45)]'
                  : 'bg-zinc-950 border border-red-500/40 shadow-[inset_0_0_18px_rgba(239,68,68,0.18),0_0_18px_rgba(239,68,68,0.18)]'
              }`}
            >
              <ProductIcon
                size={26}
                className={isPremium ? 'text-white' : 'text-red-400'}
                strokeWidth={isPremium ? 2.5 : 2}
                fill={isPremium ? 'currentColor' : 'none'}
              />
              {/* Tiny shimmer dot in the corner of the icon tile to add
                  the kind of micro-detail premium UIs always have. */}
              <div className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-white/90 shadow-[0_0_6px_rgba(255,255,255,0.8)]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-medium text-red-400/80 uppercase tracking-[0.2em] mb-0.5">
                {t.tgStoreTitle}
              </div>
              <h2 className="text-base font-bold text-white leading-tight truncate">
                {isPremium ? t.tgStorePremium : t.tgStoreStars}
              </h2>
            </div>
          </div>
        </div>

        {loading ? (
          // Skeleton loading — three placeholder cards. Matches the period
          // list visually so the layout doesn't jump when prices arrive.
          <div className="space-y-2.5">
            <div className="h-12 rounded-xl bg-zinc-900/40 border border-white/5 animate-pulse" />
            <div className="h-[68px] rounded-xl bg-zinc-900/40 border border-white/5 animate-pulse" />
            <div className="h-[68px] rounded-xl bg-zinc-900/40 border border-white/5 animate-pulse" />
            <div className="h-[68px] rounded-xl bg-zinc-900/40 border border-white/5 animate-pulse" />
          </div>
        ) : filteredPrices.length === 0 && !loading ? (
          <div className="rounded-2xl border border-white/10 bg-zinc-900/40 py-10 text-center">
            <div className="text-zinc-500 text-xs">{t.tgStoreNoPrices}</div>
          </div>
        ) : (
          <>
            {/* Product Type — segmented toggle. Single shared track with a
                sliding red-glow active state to feel like a premium control
                rather than two stacked buttons. */}
            <div className="mb-4">
              <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-[0.18em] mb-2 px-1">
                {t.tgStoreSelectProduct}
              </div>
              <div className="relative grid grid-cols-2 p-1 rounded-xl bg-zinc-900/60 border border-white/10">
                <button
                  onClick={() => { setProductType('premium'); setSelectedPeriod(null); }}
                  className={`relative z-10 py-2.5 rounded-lg text-sm font-medium transition-colors duration-200 flex items-center justify-center gap-2 ${
                    isPremium ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <Zap size={15} className={isPremium ? 'text-white' : ''} />
                  {t.tgStorePremium}
                </button>
                <button
                  onClick={() => { setProductType('stars'); setSelectedPeriod(null); }}
                  className={`relative z-10 py-2.5 rounded-lg text-sm font-medium transition-colors duration-200 flex items-center justify-center gap-2 ${
                    !isPremium ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <Star size={15} className={!isPremium ? 'text-white' : ''} fill={!isPremium ? 'currentColor' : 'none'} />
                  {t.tgStoreStars}
                </button>
                {/* Sliding pill highlight */}
                <div
                  className={`absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-lg bg-gradient-to-b from-red-500 to-red-600 shadow-[0_4px_18px_rgba(239,68,68,0.35)] transition-transform duration-300 ease-out ${
                    isPremium ? 'translate-x-1' : 'translate-x-[calc(100%+3px)]'
                  }`}
                />
              </div>
            </div>

            {/* Period / amount selection. Each entry is a fully-detailed
                card: title + (per-month price for multi-month) + total
                price + optional discount + optional "best value" badge. */}
            <div className="mb-4">
              <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-[0.18em] mb-2 px-1">
                {productType === 'stars' ? t.tgStoreSelectAmount : t.tgStoreSelectPeriod}
              </div>
              <div className="space-y-2">
                {filteredPrices.map((price) => {
                  const total = parseFloat(price.price_rub);
                  const original = price.original_price_rub ? parseFloat(price.original_price_rub) : null;
                  const months = monthsForPeriod(price.period);
                  const perMonth = months && months > 1 ? Math.round(total / months) : null;
                  const isSelected = selectedPeriod === price.period;
                  const isBest = bestValueId === price.id;
                  return (
                    <button
                      key={price.id}
                      onClick={() => setSelectedPeriod(price.period)}
                      className={`group relative w-full text-left rounded-xl border overflow-hidden transition-all duration-200 ${
                        isSelected
                          ? 'border-red-500/60 bg-gradient-to-r from-red-500/12 via-red-500/6 to-transparent shadow-[0_0_24px_rgba(239,68,68,0.18)]'
                          : 'border-white/8 bg-zinc-900/50 hover:border-white/20 hover:bg-zinc-900/70'
                      }`}
                    >
                      {/* "Best value" badge — small, white-on-red, top-right. */}
                      {isBest && (
                        <div className="absolute top-0 right-0 px-2 py-0.5 rounded-bl-lg bg-red-500 text-white text-[9px] font-bold uppercase tracking-wider shadow-[0_2px_8px_rgba(239,68,68,0.4)]">
                          {lang === 'ru' ? 'Выгодно' : 'Best'}
                        </div>
                      )}
                      <div className="flex items-center gap-3 p-3.5">
                        {/* Radio indicator */}
                        <div
                          className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                            isSelected ? 'border-red-500 bg-red-500' : 'border-zinc-600 group-hover:border-zinc-400'
                          }`}
                        >
                          {isSelected && <Check size={12} className="text-white" strokeWidth={3} />}
                        </div>
                        {/* Title + per-month annotation */}
                        <div className="flex-1 min-w-0">
                          <div className={`font-semibold text-sm truncate ${isSelected ? 'text-white' : 'text-zinc-200'}`}>
                            {periodLabels[price.period] || price.period.replace('_', ' ')}
                          </div>
                          {perMonth && (
                            <div className="text-[11px] text-zinc-500 mt-0.5">
                              {perMonth.toLocaleString()} ₽ / {lang === 'ru' ? 'мес' : 'mo'}
                            </div>
                          )}
                        </div>
                        {/* Price block: optional strikethrough + total + discount % */}
                        <div className="text-right shrink-0">
                          {original && original > total && (
                            <div className="text-[11px] text-zinc-600 line-through leading-none mb-0.5">
                              {original.toLocaleString()} ₽
                            </div>
                          )}
                          <div className={`font-bold text-base leading-tight ${isSelected ? 'text-white' : 'text-zinc-100'}`}>
                            {total.toLocaleString()} ₽
                          </div>
                          {price.discount_percent && price.discount_percent > 0 && (
                            <div className="inline-block mt-0.5 px-1.5 py-0.5 rounded-md bg-red-500/15 border border-red-500/30 text-red-400 text-[9px] font-bold leading-none">
                              −{price.discount_percent}%
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Username field with @ prefix and inline icon. Glassy bg,
                red focus border to match the rest. */}
            <div className="mb-5">
              <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-[0.18em] mb-2 px-1">
                {t.tgStoreUsername}
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none gap-1 text-zinc-500">
                  <User size={14} />
                  <span className="text-sm font-medium">@</span>
                </div>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                  placeholder={t.tgStoreUsernamePlaceholder.replace(/^@/, '')}
                  className="w-full bg-zinc-900/60 border border-white/10 rounded-xl pl-12 pr-4 py-3 text-white text-sm placeholder:text-zinc-600 outline-none focus:border-red-500/60 focus:bg-zinc-900/80 transition-all"
                />
              </div>
            </div>

            {/* Premium CTA — full red gradient, integrated price pill, soft
                shimmer at idle, scale on press. Disabled state stays in the
                palette (red dimmed) instead of going grey. */}
            <button
              onClick={() => setShowConfirm(true)}
              disabled={!selectedPeriod || submitting || !username}
              className="group relative w-full overflow-hidden rounded-xl py-3.5 px-4 font-bold text-white text-sm flex items-center justify-between gap-2 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all bg-gradient-to-r from-red-600 via-red-500 to-red-600 shadow-[0_8px_32px_-8px_rgba(239,68,68,0.6)] hover:shadow-[0_8px_36px_-6px_rgba(239,68,68,0.75)]"
            >
              {/* Shimmer sweep — pure white, very subtle, only on hover. */}
              <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />
              <span className="relative flex items-center gap-2">
                <Wallet size={17} />
                {t.tgStorePay}
              </span>
              {selectedPrice && (
                <span className="relative px-2.5 py-1 rounded-lg bg-black/25 text-white font-bold text-[13px] tracking-wide">
                  {parseFloat(selectedPrice.price_rub).toLocaleString()} ₽
                </span>
              )}
            </button>
          </>
        )}

        {/* Confirmation Modal — premium glass dialog. Black/red palette,
            order-summary in a bordered block, distinct CTA row. */}
        {showConfirm && selectedPrice && (
          <div className="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="relative w-full max-w-xs rounded-2xl border border-white/10 bg-gradient-to-b from-zinc-900 to-black p-5 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.8),0_0_40px_-8px_rgba(239,68,68,0.2)]">
              {/* Decorative red glow at top */}
              <div className="absolute -top-12 left-1/2 -translate-x-1/2 w-32 h-32 rounded-full bg-red-500/25 blur-3xl pointer-events-none" />

              <div className="relative">
                <div className="flex items-center justify-center mb-4">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center shadow-[0_0_20px_rgba(239,68,68,0.4)]">
                    <ProductIcon size={22} className="text-white" strokeWidth={2.5} fill={isPremium ? 'currentColor' : 'none'} />
                  </div>
                </div>
                <h3 className="text-white font-bold text-base mb-1 text-center">
                  {lang === 'ru' ? 'Подтвердите заказ' : 'Confirm Order'}
                </h3>
                <p className="text-zinc-500 text-[11px] text-center mb-4">
                  {lang === 'ru'
                    ? 'Проверьте детали перед оплатой'
                    : 'Review details before payment'}
                </p>

                {/* Summary block — bordered list with hairline dividers */}
                <div className="rounded-xl border border-white/10 bg-zinc-950/50 divide-y divide-white/5 mb-4">
                  <div className="flex justify-between items-center px-3.5 py-2.5">
                    <span className="text-zinc-500 text-xs">{lang === 'ru' ? 'Товар' : 'Product'}</span>
                    <span className="text-white font-medium text-sm">{getProductLabel()}</span>
                  </div>
                  <div className="flex justify-between items-center px-3.5 py-2.5">
                    <span className="text-zinc-500 text-xs">{lang === 'ru' ? 'Получатель' : 'Recipient'}</span>
                    <a
                      href={`https://t.me/${username}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white font-medium text-sm hover:text-red-400 transition-colors"
                    >
                      @{username}
                    </a>
                  </div>
                  <div className="flex justify-between items-center px-3.5 py-3 bg-red-500/5">
                    <span className="text-zinc-400 text-xs uppercase tracking-wider">{lang === 'ru' ? 'К оплате' : 'Total'}</span>
                    <span className="text-white font-bold text-lg">
                      {parseFloat(selectedPrice.price_rub).toLocaleString()} ₽
                    </span>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => setShowConfirm(false)}
                    className="flex-1 py-3 rounded-xl border border-white/10 text-zinc-300 font-medium text-sm hover:bg-white/5 hover:border-white/20 transition-colors"
                  >
                    {lang === 'ru' ? 'Отмена' : 'Cancel'}
                  </button>
                  <button
                    onClick={() => { setShowConfirm(false); handlePurchase(); }}
                    disabled={submitting}
                    className="flex-1 py-3 rounded-xl bg-gradient-to-r from-red-500 to-red-600 text-white font-bold text-sm disabled:opacity-50 transition-all shadow-[0_4px_16px_-4px_rgba(239,68,68,0.5)] active:scale-[0.98]"
                  >
                    {submitting ? <RefreshCw size={16} className="animate-spin mx-auto" /> : (lang === 'ru' ? 'Оплатить' : 'Pay')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// BoxesView (admin-only beta, 2026-05-21).
//
// v2 (2026-05-21 evening): rewards now in HOURS not days; common drops are
// small (2–6h) so the box feels like a discount coupon, not a free day of
// VPN. Added: useRef double-click lock, multi-stage open animation
// (shake → flash → reveal), "What can drop?" modal with all probabilities,
// and admin-only reset-cooldown button.
// ────────────────────────────────────────────────────────────────────────────
type BoxKind = 'daily' | 'super';
type BoxRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
type BoxRewardKind = 'subscription_hours' | 'subscription_days' | 'discount_coupon';
type BoxRewardEntry = {
  id: number;
  boxKind: BoxKind;
  rewardKind: BoxRewardKind;
  rewardValue: number;
  rewardHours: number;
  rarity: BoxRarity;
  // Coupon-specific (only for rewardKind = 'discount_coupon').
  couponCode?: string;
  discountPercent?: number;
  couponExpiresAt?: string;
  couponExpired?: boolean;
  streakAtOpen: number;
  createdAt: string;
};
type BoxStateData = {
  currentStreak: number;
  totalOpens: number;
  lastOpenedAt: string | null;
  nextAvailableAt: string | null;
  canOpenNow: boolean;
  upcomingStreak: number;
  upcomingBoxKind: BoxKind;
  cooldownMs: number;
  streakLength: number;
  recentRewards: BoxRewardEntry[];
};
type BoxOpenResult = {
  reward: {
    boxKind: BoxKind;
    rewardKind: BoxRewardKind;
    rewardValue: number;
    rewardHours: number;
    rarity: BoxRarity;
    couponCode?: string;
    discountPercent?: number;
    couponExpiresAt?: string;
  };
  streakAtOpen: number;
  state: BoxStateData;
};

const BOX_RARITY_STYLES: Record<BoxRarity, { ring: string; bg: string; text: string; glow: string; chip: string }> = {
  common:    { ring: 'border-zinc-500/40',   bg: 'from-zinc-700/40 to-zinc-900/60',   text: 'text-zinc-200',    glow: '',                                              chip: 'bg-zinc-700/40 text-zinc-200' },
  uncommon:  { ring: 'border-blue-500/50',   bg: 'from-blue-700/30 to-blue-900/50',   text: 'text-blue-300',    glow: 'shadow-[0_0_28px_rgba(59,130,246,0.35)]',       chip: 'bg-blue-500/20 text-blue-300' },
  rare:      { ring: 'border-purple-500/60', bg: 'from-purple-700/35 to-purple-900/55',text:'text-purple-300',  glow: 'shadow-[0_0_32px_rgba(168,85,247,0.45)]',       chip: 'bg-purple-500/20 text-purple-300' },
  epic:      { ring: 'border-pink-500/70',   bg: 'from-pink-700/40 to-fuchsia-900/55',text: 'text-pink-300',    glow: 'shadow-[0_0_36px_rgba(236,72,153,0.55)]',       chip: 'bg-pink-500/20 text-pink-300' },
  legendary: { ring: 'border-amber-400/80',  bg: 'from-amber-600/45 to-orange-700/60',text: 'text-amber-200',   glow: 'shadow-[0_0_44px_rgba(251,191,36,0.65)]',       chip: 'bg-amber-500/30 text-amber-200' },
};

// Reward-table mirror for the "What can drop?" modal. Probabilities are
// computed from the weight tables in lib/boxes.ts (sum of daily weights
// = 1000, super = 10000), so any change to weights there must be
// reflected here too. Each row is either a subscription extension (hours)
// OR a one-shot 24h discount coupon (percent off purchase).
type RewardTableRow =
  | { type: 'hours'; hours: number; chance: number; rarity: BoxRarity }
  | { type: 'coupon'; percent: number; chance: number; rarity: BoxRarity };

// MUST stay in sync with DAILY_REWARDS / SUPER_REWARDS in @/lib/boxes.ts.
// chance = weight / totalWeight × 100 (totals: daily=1000, super=10000).
// If you change the weights server-side, update these numbers too — the
// "What can drop?" modal is the public-facing odds disclosure and any
// drift will look like deceptive advertising.
const REWARD_TABLE_DISPLAY: Record<BoxKind, RewardTableRow[]> = {
  daily: [
    { type: 'coupon', percent: 5,   chance: 45,   rarity: 'common' },
    { type: 'hours',  hours: 4,     chance: 23,   rarity: 'common' },
    { type: 'coupon', percent: 10,  chance: 17,   rarity: 'uncommon' },
    { type: 'hours',  hours: 12,    chance: 8,    rarity: 'uncommon' },
    { type: 'coupon', percent: 20,  chance: 4,    rarity: 'rare' },
    { type: 'hours',  hours: 24,    chance: 2,    rarity: 'rare' },
    { type: 'hours',  hours: 72,    chance: 0.7,  rarity: 'epic' },
    { type: 'coupon', percent: 40,  chance: 0.2,  rarity: 'epic' },
    { type: 'hours',  hours: 168,   chance: 0.1,  rarity: 'legendary' },
  ],
  super: [
    { type: 'hours',  hours: 12,    chance: 25,   rarity: 'common' },
    { type: 'coupon', percent: 10,  chance: 20,   rarity: 'common' },
    { type: 'hours',  hours: 24,    chance: 18,   rarity: 'uncommon' },
    { type: 'coupon', percent: 20,  chance: 12,   rarity: 'uncommon' },
    { type: 'hours',  hours: 48,    chance: 12,   rarity: 'rare' },
    { type: 'coupon', percent: 40,  chance: 7,    rarity: 'rare' },
    { type: 'hours',  hours: 168,   chance: 4,    rarity: 'epic' },
    { type: 'hours',  hours: 336,   chance: 1.5,  rarity: 'epic' },
    { type: 'hours',  hours: 720,   chance: 0.4,  rarity: 'legendary' },
    { type: 'hours',  hours: 2160,  chance: 0.1,  rarity: 'legendary' },
  ],
};

function formatCooldown(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600).toString().padStart(2, '0');
  const m = Math.floor((total % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(total % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function rarityLabel(rarity: BoxRarity, t: any): string {
  switch (rarity) {
    case 'common': return t.boxesRarityCommon;
    case 'uncommon': return t.boxesRarityUncommon;
    case 'rare': return t.boxesRarityRare;
    case 'epic': return t.boxesRarityEpic;
    case 'legendary': return t.boxesRarityLegendary;
  }
}

// Pretty-print an hours reward: "+2 ч" / "+12 ч" for <1 day, "+1 день" /
// "+7 дней" for whole days, "+1 д 12 ч" for mixed. RU plural inflection
// follows the same rule used elsewhere in the app (1 → day, 2-4 → дня,
// 5+ → дней). EN keeps it simple (day / days, h).
function formatRewardHoursLabel(hours: number, lang: 'ru' | 'en'): string {
  if (hours <= 0) return '';
  if (hours < 24) {
    return lang === 'ru' ? `+${hours} ч` : `+${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  if (remH === 0) {
    if (lang === 'ru') {
      const word = days === 1 ? 'день' : (days >= 2 && days <= 4) ? 'дня' : 'дней';
      return `+${days} ${word}`;
    }
    return `+${days} ${days === 1 ? 'day' : 'days'}`;
  }
  return lang === 'ru' ? `+${days} д ${remH} ч` : `+${days}d ${remH}h`;
}

// ────────────────────────────────────────────────────────────────────────────
// BoxChestImage — premium black-tactical chest, painted by the user with
// a tiger sigil on the lid and red neon trim along every seam.
//
// v5 (2026-05-22): replaced the inline-SVG isometric cube
// (`BoxChestSvg`, kept in git history) with two PNG hero images
// supplied by the user — one closed, one open. Reasoning:
//   • The painted illustrations carry far more brand weight (tiger
//     sigil + red neon = the Hundler VPN look) than any procedural
//     SVG could produce in a reasonable line count.
//   • Two states only — closed and open — exactly maps to the
//     animation we need: idle/shaking → closed, flashing → open.
//   • Stripped to 90 KB / 119 KB WebP via scripts/optimize-box-images.mjs
//     (~24x smaller than the 2.2 MB sources). PNG fallbacks at
//     200-230 KB ride along for ancient WebViews.
//
// SUPER variant: same artwork, but warmed via a `hue-rotate(28deg)
// saturate(1.15) brightness(1.06)` filter so the red neon shifts to
// gold/amber. Plus a crown SVG overlay above the lid (closed state
// only) and 6 floating sparkle motes — same flourishes that lived on
// the SVG cube. Keeps SUPER unmistakably premium without forcing the
// user to paint a second hero image.
//
// Animation behaviour:
//   - stage 'idle' / 'shaking'   → closed bokovushka, 100% opacity
//   - stage 'flashing'           → crossfade to open variant (240 ms)
//   - lid-rotate is gone — the open PNG already shows an open lid,
//     so no transform-origin tricks. The kicked-in crossfade timing
//     lines up with the 700 ms flashMs window.
function BoxChestImage({ kind, stage }: { kind: 'daily' | 'super'; stage: 'idle' | 'shaking' | 'flashing' }) {
  const isSuper = kind === 'super';
  const lidOpen = stage === 'flashing';

  // Filter that turns the red-neon source into gold/amber for SUPER.
  // Tested values: 28deg hue-rotate slides red (#ef4444 ≈ 0°) toward
  // orange (#f97316 ≈ 25°) without crossing into the green spectrum;
  // saturate/brightness tweaks compensate for the slight desaturation
  // that hue-rotate causes on rich reds.
  const tintFilter = isSuper
    ? 'hue-rotate(28deg) saturate(1.15) brightness(1.06)'
    : 'none';

  // v4.4 (2026-05-23): убрали `drop-shadow` от PNG бокса. На iOS Safari
  // он рендерился как полупрозрачный ПРЯМОУГОЛЬНИК позади сундука (вместо
  // мягкой radial-тени по силуэту), потому что PNG имеет тонкую alpha-
  // полосу по краям из-за антиалиасинга при экспорте. Получался квадрат
  // сзади бокса — юзер жаловался. Подсветку даёт сама hero-card (twin
  // glows top-right/bottom-left), отдельная тень от PNG лишняя.

  return (
    <div
      className="relative w-[180px] h-[180px] flex items-center justify-center"
      style={tintFilter !== 'none' ? { filter: tintFilter } : undefined}
      aria-hidden="true"
    >
      {/* Closed PNG — base layer. WebP source preferred, PNG fallback
          for any WebView without WebP support. Sized intrinsically via
          width/height attrs (browsers can lay out before bytes load).
          loading="eager" because this is above the fold and the user
          stares at it for the entire box-opens-screen lifetime. */}
      <picture>
        <source srcSet="/boxes/box-closed.webp" type="image/webp" />
        <img
          src="/boxes/box-closed.png"
          alt=""
          width={180}
          height={180}
          loading="eager"
          decoding="async"
          draggable={false}
          className="absolute inset-0 w-full h-full object-contain select-none transition-opacity duration-[240ms] ease-out"
          style={{ opacity: lidOpen ? 0 : 1 }}
        />
      </picture>
      {/* Open PNG — same slot, opposite opacity. Keeps both PNGs in the
          DOM during reveal so the crossfade is smooth (no popping). */}
      <picture>
        <source srcSet="/boxes/box-open.webp" type="image/webp" />
        <img
          src="/boxes/box-open.png"
          alt=""
          width={180}
          height={180}
          loading="eager"
          decoding="async"
          draggable={false}
          className="absolute inset-0 w-full h-full object-contain select-none transition-opacity duration-[240ms] ease-out"
          style={{ opacity: lidOpen ? 1 : 0 }}
        />
      </picture>

      {/* v4.4 (2026-05-23): пульсирующая точка под сундуком удалена.
          Юзер жаловался что на iPhone позади неё рендерится тёмный
          квадратик (артефакт WebKit SVG rasterizer + наш drop-shadow
          фильтр от родителя). Точка ничего не добавляла к UX — просто
          лишняя анимация в idle. Бокс и без неё хорошо "дышит" через
          motion.div boxAnimateProps[stage].idle. */}

      {/* SUPER-only flourishes — crown, sparkles, bottom shimmer star.
          Renders on top of the painted box; crown fades to 0.5 opacity
          when the lid is open so it doesn't fight the open-box artwork. */}
      {isSuper && (
        <svg
          width="180"
          height="180"
          viewBox="-90 -90 180 180"
          className="absolute inset-0 w-full h-full pointer-events-none overflow-visible"
        >
          {/* Crown — sits above the chest. Gold-on-amber with a soft
              glow. The 7-vertex polyline draws a 3-tooth crown with
              jewel dots in the middle. */}
          <g
            transform="translate(0, -68)"
            opacity={lidOpen ? 0.45 : 0.95}
            style={{
              filter: 'drop-shadow(0 0 5px #f59e0b)',
              transition: 'opacity 240ms ease-out',
            }}
          >
            <path
              d="M -16 6 L -11 -8 L -5 2 L 0 -12 L 5 2 L 11 -8 L 16 6 Z"
              fill="#fbbf24"
              stroke="#fed7aa"
              strokeWidth="0.7"
              strokeLinejoin="round"
            />
            <circle cx="-11" cy="-8" r="1.5" fill="#fff" opacity="0.9" />
            <circle cx="0"   cy="-12" r="1.7" fill="#fff" opacity="0.95" />
            <circle cx="11"  cy="-8" r="1.5" fill="#fff" opacity="0.9" />
          </g>

          {/* 6 sparkle motes orbiting the chest, staggered timing. */}
          {stage === 'idle' && (
            <g opacity="0.85">
              <circle cx="-72" cy="-32" r="1.6" fill="#fbbf24">
                <animate attributeName="opacity" values="0.2;1;0.2" dur="1.8s" repeatCount="indefinite" />
              </circle>
              <circle cx="72"  cy="-38" r="1.4" fill="#fbbf24">
                <animate attributeName="opacity" values="1;0.2;1"   dur="2.4s" repeatCount="indefinite" />
              </circle>
              <circle cx="62"  cy="48"  r="1.2" fill="#fbbf24">
                <animate attributeName="opacity" values="0.3;1;0.3" dur="1.6s" repeatCount="indefinite" />
              </circle>
              <circle cx="-66" cy="46"  r="1.3" fill="#fbbf24">
                <animate attributeName="opacity" values="0.3;1;0.3" dur="2.0s" begin="0.4s" repeatCount="indefinite" />
              </circle>
              <circle cx="-38" cy="-66" r="1.1" fill="#fbbf24">
                <animate attributeName="opacity" values="0.5;1;0.5" dur="1.4s" begin="0.7s" repeatCount="indefinite" />
              </circle>
              <circle cx="40"  cy="-66" r="1.1" fill="#fbbf24">
                <animate attributeName="opacity" values="0.5;1;0.5" dur="1.4s" begin="1.1s" repeatCount="indefinite" />
              </circle>
            </g>
          )}

          {/* Bottom 4-point twinkle on the shadow plane. */}
          <g transform="translate(0, 76)" opacity="0.65">
            <path
              d="M 0 -5 L 1.2 -1.2 L 5 0 L 1.2 1.2 L 0 5 L -1.2 1.2 L -5 0 L -1.2 -1.2 Z"
              fill="#fed7aa"
            >
              <animate attributeName="opacity" values="0.3;0.95;0.3" dur="3s" repeatCount="indefinite" />
            </path>
          </g>
        </svg>
      )}
    </div>
  );
}

function BoxesView({ t, direction, lang, tgUser, userIdentifier, isAdmin, navigate, onSubscriptionChange }: {
  t: any;
  direction: number;
  lang: 'ru' | 'en';
  tgUser: { id: number; name: string; photo: string; username?: string } | null;
  userIdentifier: UserIdentifier | null;
  isAdmin: boolean;
  navigate: (tab: Tab) => void;
  onSubscriptionChange: (identOrTgId: number | UserIdentifier) => Promise<void>;
}) {
  const [state, setState] = useState<BoxStateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 2026-05-24: распознанный 403 telegram_required от backend. Email-only
  // юзеры без привязки Telegram попадают сюда вместо raw-error toast'а —
  // см. /api/boxes/state, /open, /rewards (assertTelegramLinked). Боксы
  // — retention-фича через TG-push, без TG награды просто «пропадают»
  // в email-только аккаунте. Hard-block с CTA на привязку.
  const [needsTelegramLink, setNeedsTelegramLink] = useState(false);
  const [reveal, setReveal] = useState<BoxOpenResult | null>(null);
  const [stage, setStage] = useState<'idle' | 'shaking' | 'flashing'>('idle');
  // v4.3 (2026-05-22): убран pendingReward floating block — раньше
  // приз "вылетал" из бокса в виде квадратика перед reveal-модалкой,
  // юзеры жаловались на странность и подлагивание. Теперь после flash-
  // фазы сразу открывается reveal-модалка.
  const [showRewardTable, setShowRewardTable] = useState(false);
  const [rewardTableKind, setRewardTableKind] = useState<BoxKind>('daily');
  const [now, setNow] = useState(() => Date.now());

  // Synchronous lock for the open button. React's `opening` state lags
  // one render behind synchronous double-clicks; the ref catches the
  // SECOND click before React has applied disabled={opening} to the DOM.
  // This is the same bug class as the production double-reward incident.
  const openingRef = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const loadState = useCallback(async () => {
    if (!tgUser) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Always include telegramId for admin gating — backend rejects
      // requests where the param is absent or non-admin.
      const tgPart = `telegramId=${encodeURIComponent(String(tgUser.id))}`;
      const q = userIdentifier?.type === 'email'
        ? `${tgPart}&userId=${encodeURIComponent(String(userIdentifier.userId))}`
        : tgPart;
      const res = await fetch(`/api/boxes/state?${q}`, { cache: 'no-store' });
      if (res.status === 403) {
        // Distinguish two distinct 403s from the API: `telegram_required`
        // (email-only user without a linked TG — render the link-CTA panel)
        // vs. anything else (legacy admin gate / generic forbid — fall back
        // to the existing red error card). Reading the JSON body is
        // cheap and we already do it for non-403 errors.
        const data = await res.json().catch(() => ({}));
        if (data?.error === 'telegram_required') {
          setNeedsTelegramLink(true);
          setError(null);
          setState(null);
          return;
        }
        setError(t.boxesNotAdmin);
        setState(null);
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || t.boxesError);
        return;
      }
      const data = await res.json();
      setNeedsTelegramLink(false);
      setState(data.state ?? null);
    } catch (e) {
      console.error('[BoxesView] load state failed:', e);
      setError(t.boxesError);
    } finally {
      setLoading(false);
    }
  }, [tgUser, userIdentifier, t.boxesNotAdmin, t.boxesError]);

  useEffect(() => { void loadState(); }, [loadState]);

  const handleOpen = async () => {
    // Double lock: ref for synchronous protection + state for the disabled
    // styling. Without the ref, two click events fired before React
    // re-renders both pass `if (opening) return`.
    if (!tgUser || openingRef.current) return;
    if (state && !state.canOpenNow) return;
    openingRef.current = true;
    setOpening(true);
    setError(null);
    setStage('shaking');
    haptic('heavy');

    // Min visible anim window — bumped to 450ms so the shake reads but
    // doesn't drag. Fast networks no longer wait the full 700ms+280ms
    // (~1s) plus a slow refreshSubscriptionState (~1-3s extra) before
    // the reveal pops; the user complained of 15-20s open times because
    // we previously awaited refreshSubscriptionState here, which fires
    // a serial chain of API calls. Now the reveal shows immediately
    // and the subscription refresh runs fire-and-forget.
    // v4 (2026-05-21 late): shortened from 450/160 ms — users complained
    // the open-to-reveal pause felt sluggish. With CSPRNG picking on the
    // server in <5 ms, the only thing keeping the reveal back is this
    // animation budget, so we tighten it. Shake itself is also shorter
    // (see boxAnimateProps below: 0.32 s).
    //
    // v4.3 (2026-05-22): возвращены к коротким значениям после удаления
    // pendingReward float-block. flashMs нужен только чтобы лид-открытие
    // успело отыграть и юзер увидел открытый сундук перед модалкой.
    const minAnimMs = 180;
    const flashMs = 240;
    const startedAt = Date.now();

    try {
      const body: Record<string, number> = { telegramId: tgUser.id };
      if (userIdentifier?.type === 'email') body.userId = userIdentifier.userId;
      const res = await fetch('/api/boxes/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 429 && data?.nextAvailableAt) {
          setError(t.boxesError);
          await loadState();
          return;
        }
        // 403 telegram_required — same handling as in loadState. This
        // shouldn't normally hit (the open button is only rendered when
        // !needsTelegramLink) but a stale tab where the user unlinked TG
        // could still POST here — render the CTA cleanly instead of a
        // raw «telegram_required» toast.
        if (res.status === 403 && data?.error === 'telegram_required') {
          setNeedsTelegramLink(true);
          setError(null);
          setState(null);
          return;
        }
        setError(data?.error || t.boxesError);
        return;
      }
      const data: BoxOpenResult & { ok: true } = await res.json();

      const elapsed = Date.now() - startedAt;
      if (elapsed < minAnimMs) {
        await new Promise((r) => setTimeout(r, minAnimMs - elapsed));
      }
      setStage('flashing');
      hapticNotification('success');
      setState(data.state);
      // v4.3: короткая пауза чтобы лид успел открыться, потом
      // сразу показываем reveal-модалку — без промежуточного
      // floating квадратика.
      await new Promise((r) => setTimeout(r, flashMs));
      setReveal(data);
      // Fire and forget — the user already sees their reward; refreshing
      // global sub state can run in the background. This avoids piling
      // a 1-3s API round-trip onto the open animation.
      if (userIdentifier) {
        void onSubscriptionChange(userIdentifier).catch((e) =>
          console.error('[BoxesView] background sub refresh failed:', e),
        );
      }
    } catch (e) {
      console.error('[BoxesView] open failed:', e);
      setError(t.boxesError);
    } finally {
      openingRef.current = false;
      setOpening(false);
      setStage('idle');
    }
  };

  // Copy-to-clipboard helper for coupon codes. Fallback path covers
  // older WebViews that don't expose navigator.clipboard.
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const copyCouponCode = async (code: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(code);
      } else {
        const ta = document.createElement('textarea');
        ta.value = code;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopiedCode(code);
      haptic('light');
      setTimeout(() => setCopiedCode((c) => (c === code ? null : c)), 1800);
    } catch (e) {
      console.error('[BoxesView] copy failed:', e);
    }
  };

  // v4 (2026-05-21 late): handleAdminReset / "Сбросить кулдаун" chip
  // moved into AdminBoxesView. Keeping it on the public Boxes screen
  // (even gated) felt wrong now that the page has no admin chrome at
  // all — and the admin can only reset their own account, which is
  // an admin-flow concern.

  const openRewardTable = (kind: BoxKind) => {
    setRewardTableKind(kind);
    setShowRewardTable(true);
  };

  const cooldownMs = state?.nextAvailableAt
    ? Math.max(0, new Date(state.nextAvailableAt).getTime() - now)
    : 0;
  const canOpen = !!state && (state.canOpenNow || cooldownMs <= 0);
  const upcomingIsSuper = state?.upcomingBoxKind === 'super';
  const streakLength = state?.streakLength ?? 7;
  const filledCells = state
    ? Math.min(state.currentStreak % streakLength === 0 && state.currentStreak > 0 ? streakLength : state.currentStreak % streakLength, streakLength)
    : 0;
  const upcomingCellIdx = state ? ((state.upcomingStreak - 1) % streakLength) : 0;

  // Stage-driven animation props for the hero box. Switching this object
  // by stage gives a smooth handoff between idle breathing, shake, and
  // the final scale-out flash without juggling multiple <motion.div>s.
  const boxAnimateProps: Record<typeof stage, any> = {
    idle: canOpen
      ? { y: [0, -6, 0], rotate: [-2, 2, -2], scale: 1, opacity: 1, transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' } }
      : { y: 0, rotate: 0, scale: 1, opacity: 1, transition: { duration: 0.3 } },
    shaking: {
      // v4: tightened keyframes — 0.32s instead of 0.7s. Half the
      // wiggles, same dramatic peak (±14°) so it still reads but
      // doesn't make users wait.
      rotate: [-14, 12, -8, 6, 0],
      scale: [1, 1.06, 1.04, 1.02, 1],
      y: 0,
      opacity: 1,
      transition: { duration: 0.32, times: [0, 0.3, 0.55, 0.8, 1], ease: 'easeOut' },
    },
    flashing: {
      // v4.2 (2026-05-22): completely smooth, no bounces. The user
      // reported "странно и криво открывается" — root cause was
      // (a) lid transform-origin bug fixed in BoxChestSvg, and
      // (b) the outer motion.div was scale/y-bouncing simultaneously
      // with the inner SVG lid rotation, so the box appeared to
      // "kick" while opening. Now the outer wrapper stays still
      // and only the lid rotates inside the SVG. The single
      // scale: 1.04 → 1 micro-pulse is enough to register the
      // "click" of the lid releasing without dancing the whole box.
      scale: [1, 1.04, 1],
      opacity: 1,
      rotate: 0,
      y: 0,
      transition: { duration: 0.4, times: [0, 0.25, 1], ease: 'easeOut' },
    },
  };

  return (
    <motion.div
      key="boxes"
      custom={direction}
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="pt-6 pb-4"
    >
      <div className="max-w-2xl mx-auto">
        {/* v4 (2026-05-21 late): page-level title + icon removed entirely
            at user request — the bottom-nav "Боксы" label already names
            the screen.
            v4.1 (2026-05-22): action chips ("What can drop?" + history)
            moved BELOW the hero card per user feedback — they live just
            after the streak/stats block so the box itself is the first
            thing the user sees on entry. They're also centred now
            (justify-center, equal-width buttons) so the row reads as a
            symmetric pair instead of left-aligned chips. */}

        {/* Loading / forbidden state */}
        {loading && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-12 flex items-center justify-center">
            <RefreshCw size={20} className="animate-spin text-zinc-500" />
          </div>
        )}

        {/* 2026-05-24: hard-block CTA for email-only users without a linked
            Telegram. Backend (lib/boxes.ts assertTelegramLinked) refuses
            state/open/rewards with 403 «telegram_required» — we surface a
            proper onboarding panel instead of a generic error toast.
            Tier above the regular error card so a stale `error` state from
            a previous load doesn't bleed through.  */}
        {!loading && needsTelegramLink && (
          <div className="rounded-2xl border border-red-500/30 bg-gradient-to-br from-red-950/40 via-zinc-950 to-black p-7 text-center shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]">
            <div className="w-14 h-14 rounded-2xl bg-red-500/15 border border-red-500/30 flex items-center justify-center mx-auto mb-4">
              <Send size={26} className="text-red-300" strokeWidth={1.75} />
            </div>
            <h3 className="text-white text-lg font-bold mb-2">{t.boxesTelegramRequiredTitle}</h3>
            <p className="text-zinc-400 text-sm leading-relaxed mb-5 max-w-sm mx-auto">
              {t.boxesTelegramRequiredDesc}
            </p>
            <button
              onClick={() => {
                if (typeof window === 'undefined') return;
                let session: string | null = null;
                try { session = window.localStorage.getItem('hvpn_session'); } catch { /* ignore */ }
                if (!session) {
                  setError(t.boxesLinkTelegramNoSession);
                  return;
                }
                haptic('medium');
                const base = window.location.origin;
                window.location.href = `${base}/api/auth/telegram/start-link?link=${encodeURIComponent(session)}`;
              }}
              className="inline-flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold px-5 py-3 rounded-xl active:scale-[0.98] transition-all shadow-[0_8px_24px_-8px_rgba(239,68,68,0.5)]"
            >
              <Send size={16} strokeWidth={2} />
              {t.boxesLinkTelegramButton}
            </button>
            {error && (
              <p className="text-red-300/80 text-xs mt-3">{error}</p>
            )}
          </div>
        )}

        {!loading && !needsTelegramLink && !state && error && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6 text-center">
            <ShieldAlert size={28} className="text-red-400 mx-auto mb-2" strokeWidth={1.5} />
            <p className="text-red-200 text-sm">{error}</p>
          </div>
        )}

        {/* Hero card */}
        {!loading && state && (
          <>
            {/* Hero card. v4: premium reskin — deeper blacks, gold accent
                for SUPER, refined ruby gradient for DAILY (instead of the
                flat red wash), and a subtle inner ring instead of the
                bright border so the card looks "made of metal" rather
                than "wrapped in neon". */}
            <div className={`relative overflow-hidden rounded-[24px] border ${upcomingIsSuper ? 'border-amber-400/40' : 'border-white/10'} bg-gradient-to-br ${upcomingIsSuper ? 'from-amber-900/20 via-zinc-950 to-black' : 'from-red-950/30 via-zinc-950 to-black'} p-6 mb-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]`}>
              {/* Twin static glows top-right gold + bottom-left ruby */}
              <div className={`absolute -top-24 -right-24 w-72 h-72 rounded-full blur-3xl ${upcomingIsSuper ? 'bg-amber-500/15' : 'bg-red-600/10'} pointer-events-none`} />
              <div className={`absolute -bottom-24 -left-20 w-60 h-60 rounded-full blur-3xl ${upcomingIsSuper ? 'bg-orange-700/10' : 'bg-amber-500/[0.04]'} pointer-events-none`} />
              {/* Pulsing aura behind the box during the shake stage */}
              <AnimatePresence>
                {stage === 'shaking' && (
                  <motion.div
                    key="aura"
                    initial={{ opacity: 0, scale: 0.4 }}
                    animate={{ opacity: [0, 0.6, 0.85], scale: [0.4, 1.1, 1.5] }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.32, times: [0, 0.5, 1] }}
                    className={`absolute left-1/2 top-[100px] -translate-x-1/2 -translate-y-1/2 w-48 h-48 rounded-full blur-2xl pointer-events-none ${upcomingIsSuper ? 'bg-amber-400/60' : 'bg-red-500/55'}`}
                  />
                )}
              </AnimatePresence>

              <div className="relative">
                {/* v4 (2026-05-21 late): replaced the flat icon-tile with a
                    full SVG treasure chest — proper 3D-ish faces (front,
                    top), gold/red metal trim, central ribbon + lock, and
                    a dedicated <g> for the lid that animates open during
                    the shaking → flashing transition. SVG is inlined so
                    there's no extra HTTP roundtrip / image weight, and it
                    scales crisply on every screen. */}
                <div className="flex flex-col items-center mb-5 relative">
                  <motion.div
                    animate={boxAnimateProps[stage]}
                    className="relative"
                  >
                    <BoxChestImage kind={upcomingIsSuper ? 'super' : 'daily'} stage={stage} />
                  </motion.div>

                  {/* Light beams that shoot out of the chest at the moment
                      the lid lifts — only visible during 'flashing'. */}
                  <AnimatePresence>
                    {stage === 'flashing' && (
                      <motion.div
                        key="beams"
                        initial={{ opacity: 0, scale: 0.4 }}
                        animate={{ opacity: [0, 1, 0.7, 0], scale: [0.4, 1.1, 1.4, 1.7] }}
                        transition={{ duration: 0.5, times: [0, 0.25, 0.6, 1] }}
                        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                      >
                        <svg width="240" height="240" viewBox="-120 -120 240 240" className="overflow-visible">
                          <defs>
                            <radialGradient id={`beam-grad-${upcomingIsSuper ? 'super' : 'daily'}`} cx="0" cy="0" r="50%">
                              <stop offset="0%" stopColor={upcomingIsSuper ? '#fde68a' : '#fecaca'} stopOpacity="1" />
                              <stop offset="60%" stopColor={upcomingIsSuper ? '#f59e0b' : '#ef4444'} stopOpacity="0.4" />
                              <stop offset="100%" stopColor="transparent" stopOpacity="0" />
                            </radialGradient>
                          </defs>
                          {/* 12 radial light rays around the box */}
                          {Array.from({ length: 12 }).map((_, i) => {
                            const angle = (i * 360) / 12;
                            return (
                              <rect
                                key={i}
                                x="-2"
                                y="-110"
                                width="4"
                                height="80"
                                fill={`url(#beam-grad-${upcomingIsSuper ? 'super' : 'daily'})`}
                                transform={`rotate(${angle})`}
                              />
                            );
                          })}
                          {/* Bright center burst */}
                          <circle cx="0" cy="0" r="40" fill={`url(#beam-grad-${upcomingIsSuper ? 'super' : 'daily'})`} />
                        </svg>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* v4.1 (2026-05-22): radial spark burst — 16
                      particles fly outward from the box centre when
                      the lid pops. Each spark has its own random
                      angle (deterministic per-index) + rotation +
                      scale curve so the burst feels organic, not
                      gridded. Pure motion.div + transform — no SVG
                      filters, runs at 60fps even on low-end Android.
                      Sparks use the daily/super accent palette so
                      they match the box. */}
                  <AnimatePresence>
                    {stage === 'flashing' && (
                      <div
                        key="sparks"
                        className="absolute left-1/2 top-[78px] -translate-x-1/2 -translate-y-1/2 pointer-events-none w-0 h-0"
                      >
                        {Array.from({ length: 16 }).map((_, i) => {
                          // Random-but-deterministic spark trajectory.
                          // Distance/duration vary per index so the
                          // burst doesn't read as a perfect ring.
                          const angle = (i / 16) * Math.PI * 2 + (i % 2) * 0.18;
                          const dist = 70 + (i * 13) % 35;
                          const dx = Math.cos(angle) * dist;
                          const dy = Math.sin(angle) * dist;
                          const dur = 0.55 + ((i * 17) % 25) / 100;
                          const isOrange = upcomingIsSuper || i % 3 === 0;
                          return (
                            <motion.div
                              key={i}
                              initial={{ x: 0, y: 0, opacity: 0, scale: 0 }}
                              animate={{
                                x: dx,
                                y: dy,
                                opacity: [0, 1, 1, 0],
                                scale: [0.2, 1.1, 0.7, 0.2],
                              }}
                              transition={{ duration: dur, times: [0, 0.18, 0.7, 1], ease: 'easeOut' }}
                              className="absolute w-1.5 h-1.5 rounded-full"
                              style={{
                                background: isOrange ? '#fdba74' : '#fca5a5',
                                boxShadow: isOrange
                                  ? '0 0 6px 1px rgba(249,115,22,0.85)'
                                  : '0 0 6px 1px rgba(239,68,68,0.85)',
                              }}
                            />
                          );
                        })}
                      </div>
                    )}
                  </AnimatePresence>

                  {/* v4.3 (2026-05-22): floating "pendingReward"
                      квадратик, который вылетал из бокса перед показом
                      reveal-модалки, удалён по фидбэку юзера ("странный
                      квадратик в пульсирующем кружке бесит"). Также это
                      убирает лишний рендер во время и так насыщенной
                      flash-фазы, что должно помочь с лагами на телефонах.
                      Reveal-модалка открывается сразу — в ней и так
                      есть крупная иконка с rarity и сумма награды. */}
                </div>

                {/* Open button / cooldown */}
                {canOpen ? (
                  <button
                    onClick={handleOpen}
                    disabled={opening}
                    className={`w-full py-4 rounded-xl font-bold text-sm tracking-wider uppercase transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed ${upcomingIsSuper ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-[0_4px_20px_-4px_rgba(251,191,36,0.6)]' : 'bg-gradient-to-r from-red-500 to-red-600 text-white shadow-[0_4px_16px_-4px_rgba(239,68,68,0.5)]'}`}
                  >
                    {opening ? (
                      <span className="inline-flex items-center gap-2 justify-center">
                        <RefreshCw size={16} className="animate-spin" />
                        {t.boxesOpening}
                      </span>
                    ) : t.boxesOpenButton}
                  </button>
                ) : (
                  <div className="w-full py-4 rounded-xl bg-white/[0.04] border border-white/10 text-center">
                    <p className="text-zinc-500 text-[10px] tracking-wider uppercase mb-1">{t.boxesCooldownPrefix}</p>
                    <p className="text-white text-2xl font-mono font-bold tracking-wider tabular-nums">{formatCooldown(cooldownMs)}</p>
                  </div>
                )}

                {error && !reveal && (
                  <p className="mt-3 text-red-400 text-xs text-center">{error}</p>
                )}
              </div>
            </div>

            {/* Streak progress */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Flame size={16} className={state.currentStreak > 0 ? 'text-orange-400' : 'text-zinc-600'} strokeWidth={1.75} />
                  <span className="text-zinc-400 text-[11px] tracking-wider uppercase">{t.boxesProgressLabel}</span>
                </div>
                <span className="text-white text-xs font-bold tabular-nums">
                  {state.currentStreak} / {streakLength}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {Array.from({ length: streakLength }).map((_, idx) => {
                  const isSuper = idx === streakLength - 1;
                  const filled = idx < filledCells;
                  const upcoming = !filled && idx === upcomingCellIdx && state.canOpenNow;
                  return (
                    <div
                      key={idx}
                      className={`flex-1 h-2.5 rounded-full transition-colors ${
                        filled
                          ? (isSuper ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]' : 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]')
                          : upcoming
                            ? (isSuper ? 'bg-amber-400/40 animate-pulse' : 'bg-red-500/40 animate-pulse')
                            : (isSuper ? 'bg-amber-400/15 border border-amber-400/30' : 'bg-white/[0.06]')
                      }`}
                      title={isSuper ? t.boxesBoxSuper : `${t.boxesBoxDaily} ${idx + 1}`}
                    />
                  );
                })}
              </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <Flame size={14} className="text-orange-400" strokeWidth={1.75} />
                  <span className="text-zinc-500 text-[10px] tracking-wider uppercase">{t.boxesStreakLabel}</span>
                </div>
                <p className="text-white text-2xl font-bold tabular-nums">
                  {state.currentStreak}
                  <span className="text-zinc-500 text-sm font-medium ml-1">{t.boxesStreakDays}</span>
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <Package size={14} className="text-red-400" strokeWidth={1.75} />
                  <span className="text-zinc-500 text-[10px] tracking-wider uppercase">{t.boxesTotalLabel}</span>
                </div>
                <p className="text-white text-2xl font-bold tabular-nums">{state.totalOpens}</p>
              </div>
            </div>

            {/* v4.1 (2026-05-22): action chips moved here (below the
                hero card + streak + stats). Centered as a symmetric
                pair via justify-center + equal-flex children, so they
                read as a balanced row rather than left-aligned. The
                same row used to live above the hero card; user wanted
                the box itself to be the first thing on screen. */}
            <div className="grid grid-cols-2 gap-2 mb-5">
              <button
                onClick={() => openRewardTable(upcomingIsSuper ? 'super' : 'daily')}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 text-zinc-200 text-xs font-medium transition-colors active:scale-[0.98]"
              >
                <HelpCircle size={13} strokeWidth={1.75} />
                {t.boxesWhatCanDrop}
              </button>
              <button
                onClick={() => navigate('boxes-history')}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 text-zinc-200 text-xs font-medium transition-colors active:scale-[0.98]"
              >
                <Calendar size={13} strokeWidth={1.75} />
                {t.boxesHistoryTitle}
              </button>
            </div>
          </>
        )}
      </div>

      {/* "What can drop?" modal */}
      <AnimatePresence>
        {showRewardTable && (
          <motion.div
            key="reward-table"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            onClick={() => setShowRewardTable(false)}
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 240, damping: 22 }}
              className="relative w-full max-w-md max-h-[85vh] overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-zinc-900 to-zinc-950 flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/5">
                <h2 className="text-white text-base font-bold flex items-center gap-2">
                  <HelpCircle size={18} className="text-red-400" strokeWidth={1.75} />
                  {t.boxesWhatCanDropTitle}
                </h2>
                <button
                  onClick={() => setShowRewardTable(false)}
                  className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="px-5 pt-3 pb-1 flex gap-2 shrink-0">
                <button
                  onClick={() => setRewardTableKind('daily')}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold tracking-wider uppercase transition-colors ${rewardTableKind === 'daily' ? 'bg-red-500/20 text-red-300 border border-red-500/40' : 'bg-white/5 text-zinc-400 border border-white/10 hover:text-zinc-200'}`}
                >
                  {t.boxesBoxDaily}
                </button>
                <button
                  onClick={() => setRewardTableKind('super')}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold tracking-wider uppercase transition-colors ${rewardTableKind === 'super' ? 'bg-amber-500/20 text-amber-300 border border-amber-400/40' : 'bg-white/5 text-zinc-400 border border-white/10 hover:text-zinc-200'}`}
                >
                  {t.boxesBoxSuper}
                </button>
              </div>
              <div className="px-5 py-3 overflow-y-auto flex-1">
                <p className="text-zinc-400 text-xs mb-3 leading-relaxed">
                  {rewardTableKind === 'super' ? t.boxesWhatCanDropSuperHint : t.boxesWhatCanDropDailyHint}
                </p>
                <div className="space-y-2">
                  {REWARD_TABLE_DISPLAY[rewardTableKind].map((row, idx) => {
                    const styles = BOX_RARITY_STYLES[row.rarity];
                    const label = row.type === 'coupon'
                      ? `${t.boxesCouponPrefix}${row.percent}%`
                      : formatRewardHoursLabel(row.hours, lang);
                    const subLabel = row.type === 'coupon' ? t.boxesCouponSubHint : t.boxesHoursSubHint;
                    return (
                      <div
                        key={`${rewardTableKind}-${idx}`}
                        className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-gradient-to-r ${styles.bg} border ${styles.ring}`}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <span className={`shrink-0 px-2 py-0.5 rounded-md text-[9px] font-bold tracking-wider uppercase ${styles.chip}`}>
                            {rarityLabel(row.rarity, t)}
                          </span>
                          <div className="min-w-0">
                            <p className={`text-sm font-semibold ${styles.text} truncate`}>
                              {row.type === 'coupon' ? <Tag size={12} className="inline mr-1 -translate-y-px" strokeWidth={2} /> : null}
                              {label}
                            </p>
                            <p className="text-zinc-500 text-[9px] truncate">{subLabel}</p>
                          </div>
                        </div>
                        <p className="text-zinc-200 text-xs font-mono tabular-nums shrink-0">
                          {row.chance < 1 ? row.chance.toFixed(2) : row.chance.toFixed(1)}%
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div
                className="px-5 py-3 border-t border-white/5 shrink-0"
                style={{ paddingBottom: 'max(0.75rem, calc(env(safe-area-inset-bottom) + 0.5rem))' }}
              >
                <p className="text-zinc-500 text-[10px] text-center">{t.boxesWhatCanDropFooter}</p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* White flash overlay during the 'flashing' stage. Goes 0 → 0.95
          → 0 in 280 ms so it doesn't trap eyes on a held frame. */}
      <AnimatePresence>
        {stage === 'flashing' && (
          <motion.div
            key="flash"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.95, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.28, times: [0, 0.5, 1] }}
            className="fixed inset-0 z-40 bg-white pointer-events-none"
          />
        )}
      </AnimatePresence>

      {/* Reveal modal */}
      <AnimatePresence>
        {reveal && (
          <motion.div
            key="reveal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6"
            onClick={() => setReveal(null)}
          >
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.85, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 26, mass: 0.6 }}
              className={`relative w-full max-w-sm rounded-3xl border ${BOX_RARITY_STYLES[reveal.reward.rarity].ring} bg-gradient-to-br ${BOX_RARITY_STYLES[reveal.reward.rarity].bg} p-6 ${BOX_RARITY_STYLES[reveal.reward.rarity].glow}`}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Pulsing halo around epic+ rewards for extra "wow". */}
              {(reveal.reward.rarity === 'epic' || reveal.reward.rarity === 'legendary') && (
                <motion.div
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1.3, opacity: [0, 0.5, 0] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  className={`absolute inset-0 -m-2 rounded-3xl pointer-events-none ${reveal.reward.rarity === 'legendary' ? 'shadow-[0_0_80px_30px_rgba(251,191,36,0.6)]' : 'shadow-[0_0_60px_20px_rgba(236,72,153,0.5)]'}`}
                />
              )}

              <button
                onClick={() => setReveal(null)}
                className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center text-zinc-400 hover:text-white transition-colors z-10"
                aria-label="Close"
              >
                <X size={16} />
              </button>

              <div className="text-center relative">
                <span className={`inline-block px-3 py-1 rounded-md text-[10px] font-bold tracking-[0.2em] uppercase mb-3 ${BOX_RARITY_STYLES[reveal.reward.rarity].chip}`}>
                  {rarityLabel(reveal.reward.rarity, t)}
                </span>
                <div className="mb-4 flex justify-center">
                  <motion.div
                    initial={{ rotate: -10, scale: 0.6 }}
                    animate={{ rotate: 0, scale: 1 }}
                    transition={{ type: 'spring', stiffness: 220, damping: 14, delay: 0.05 }}
                    className={`w-24 h-24 rounded-2xl flex items-center justify-center ${reveal.reward.rewardKind === 'discount_coupon' ? 'bg-fuchsia-500/25 border-2 border-fuchsia-400/60' : reveal.reward.boxKind === 'super' ? 'bg-amber-500/30 border-2 border-amber-400/70' : 'bg-red-500/20 border-2 border-red-500/50'}`}
                  >
                    {reveal.reward.rewardKind === 'discount_coupon'
                      ? <Tag size={42} className="text-fuchsia-300" strokeWidth={1.5} />
                      : reveal.reward.boxKind === 'super'
                        ? <Trophy size={42} className="text-amber-300" strokeWidth={1.5} />
                        : <Package size={42} className="text-red-300" strokeWidth={1.5} />}
                  </motion.div>
                </div>
                <p className="text-zinc-400 text-[10px] tracking-wider uppercase mb-1">{t.boxesRewardTitle}</p>

                {reveal.reward.rewardKind === 'discount_coupon' ? (
                  <>
                    <p className={`text-3xl font-bold mb-2 ${BOX_RARITY_STYLES[reveal.reward.rarity].text}`}>
                      {`${t.boxesCouponPrefix}${reveal.reward.discountPercent}%`}
                    </p>
                    <p className="text-zinc-400 text-[11px] mb-3">{t.boxesCouponRevealHint}</p>
                    {reveal.reward.couponCode && (
                      <button
                        onClick={() => copyCouponCode(reveal.reward.couponCode!)}
                        className="w-full mb-3 px-4 py-3 rounded-xl bg-black/40 border border-white/15 hover:border-white/30 transition-colors flex items-center justify-between gap-2 active:scale-[0.99]"
                      >
                        <span className="font-mono font-bold text-white text-lg tracking-[0.18em]">
                          {reveal.reward.couponCode}
                        </span>
                        <span className="inline-flex items-center gap-1 text-xs text-zinc-300 font-medium">
                          {copiedCode === reveal.reward.couponCode ? (
                            <><Check size={14} className="text-emerald-400" strokeWidth={2.5} /> {t.boxesCopied}</>
                          ) : (
                            <><Copy size={14} strokeWidth={2} /> {t.boxesCopy}</>
                          )}
                        </span>
                      </button>
                    )}
                    {reveal.reward.couponExpiresAt && (
                      <p className="text-amber-300/90 text-[11px] mb-2">
                        {t.boxesCouponExpiresAt}{' '}
                        <span className="font-semibold">
                          {new Date(reveal.reward.couponExpiresAt).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-GB', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}
                        </span>
                      </p>
                    )}
                    <p className="text-emerald-400 text-xs font-semibold">{t.boxesCouponSaved}</p>
                  </>
                ) : (
                  <>
                    <p className={`text-3xl font-bold mb-3 ${BOX_RARITY_STYLES[reveal.reward.rarity].text}`}>
                      {formatRewardHoursLabel(reveal.reward.rewardHours, lang)}
                    </p>
                    <p className="text-emerald-400 text-xs font-semibold">{t.boxesClaimed}</p>
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// BoxesHistoryView — full paginated reward history (separate screen).
// Routed at activeTab === 'boxes-history'. Uses /api/boxes/rewards with
// limit/offset; loads 30 at a time with a "Load more" button. Coupon
// rows show the code + a copy button + "expires" / "expired" label so
// users can revisit earlier drops, not just the freshly-revealed one.
// ────────────────────────────────────────────────────────────────────────────
function BoxesHistoryView({ t, direction, lang, tgUser, userIdentifier, navigate }: {
  t: any;
  direction: number;
  lang: 'ru' | 'en';
  tgUser: { id: number; name: string; photo: string; username?: string } | null;
  userIdentifier: UserIdentifier | null;
  navigate: (tab: Tab) => void;
}) {
  const PAGE_SIZE = 30;
  const [items, setItems] = useState<BoxRewardEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 2026-05-24: same hard-block as BoxesView. The history endpoint also
  // refuses email-only callers without telegram_id with 403/telegram_required
  // — we render the link-CTA panel instead of dumping the raw error string.
  const [needsTelegramLink, setNeedsTelegramLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const fetchPage = useCallback(async (offset: number) => {
    if (!tgUser) return;
    setLoading(true);
    setError(null);
    try {
      const tgPart = `telegramId=${encodeURIComponent(String(tgUser.id))}`;
      const idPart = userIdentifier?.type === 'email'
        ? `&userId=${encodeURIComponent(String(userIdentifier.userId))}`
        : '';
      const res = await fetch(`/api/boxes/rewards?${tgPart}${idPart}&limit=${PAGE_SIZE}&offset=${offset}`, { cache: 'no-store' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 403 && data?.error === 'telegram_required') {
          setNeedsTelegramLink(true);
          setError(null);
          setItems([]);
          setTotal(0);
          return;
        }
        setError(data?.error || t.boxesError);
        return;
      }
      const data = await res.json();
      setNeedsTelegramLink(false);
      setTotal(data.total ?? 0);
      setItems((prev) => offset === 0 ? data.items : [...prev, ...data.items]);
    } catch (e) {
      console.error('[BoxesHistoryView] fetch failed:', e);
      setError(t.boxesError);
    } finally {
      setLoading(false);
    }
  }, [tgUser, userIdentifier, t.boxesError]);

  useEffect(() => { void fetchPage(0); }, [fetchPage]);

  const copyCouponCode = async (code: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(code);
      } else {
        const ta = document.createElement('textarea');
        ta.value = code;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopiedCode(code);
      haptic('light');
      setTimeout(() => setCopiedCode((c) => (c === code ? null : c)), 1500);
    } catch (e) {
      console.error('[BoxesHistoryView] copy failed:', e);
    }
  };

  const hasMore = items.length < total;

  // v4 (2026-05-21 late): "Clear history" handler. Hits DELETE
  // /api/boxes/rewards which wipes only the history rows — streak,
  // cooldown, and previously-issued coupons are preserved (see
  // clearUserRewardHistory() in @/lib/boxes for the full contract).
  const [clearing, setClearing] = useState(false);
  const handleClear = async () => {
    if (!tgUser || clearing || items.length === 0) return;
    const ok = window.confirm(t.boxesHistoryClearConfirm);
    if (!ok) return;
    setClearing(true);
    haptic('medium');
    try {
      const tgPart = `telegramId=${encodeURIComponent(String(tgUser.id))}`;
      const idPart = userIdentifier?.type === 'email'
        ? `&userId=${encodeURIComponent(String(userIdentifier.userId))}`
        : '';
      const res = await fetch(`/api/boxes/rewards?${tgPart}${idPart}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || t.boxesError);
        return;
      }
      // Wipe local state and reload — no point in re-fetching an empty
      // result, just zero everything client-side.
      setItems([]);
      setTotal(0);
      hapticNotification('success');
    } catch (e) {
      console.error('[BoxesHistoryView] clear failed:', e);
      setError(t.boxesError);
    } finally {
      setClearing(false);
    }
  };

  return (
    <motion.div
      key="boxes-history"
      custom={direction}
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="pt-6 pb-6"
    >
      <div className="max-w-2xl mx-auto">
        <button
          onClick={() => navigate('boxes')}
          className="mb-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-zinc-300 text-xs font-medium transition-colors active:scale-[0.98]"
        >
          <ChevronLeft size={14} strokeWidth={2} />
          {t.boxesHistoryBack}
        </button>

        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Calendar size={20} className="text-zinc-400 shrink-0" strokeWidth={1.75} />
              <h1 className="text-white text-xl font-bold tracking-tight">{t.boxesHistoryTitle}</h1>
            </div>
            <p className="text-zinc-500 text-xs">
              {total > 0 ? `${total} ${t.boxesHistoryTotalSuffix}` : t.boxesHistoryEmpty}
            </p>
          </div>
          {/* "Clear" chip — only rendered when there's something to clear.
              Red palette so the destructive intent is obvious; the
              actual wipe is confirm()-gated. */}
          {items.length > 0 && (
            <button
              onClick={handleClear}
              disabled={clearing}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 hover:border-red-500/40 text-red-300 text-xs font-medium transition-colors active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 size={13} strokeWidth={1.75} />
              {t.boxesHistoryClear}
            </button>
          )}
        </div>

        {error && !needsTelegramLink && (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-red-300 text-xs">
            {error}
          </div>
        )}

        {/* 2026-05-24: hard-block CTA — same panel as BoxesView. Renders
            instead of the empty-history / item-list when the API refused
            with 403/telegram_required for an email-only user. */}
        {needsTelegramLink ? (
          <div className="rounded-2xl border border-red-500/30 bg-gradient-to-br from-red-950/40 via-zinc-950 to-black p-7 text-center shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]">
            <div className="w-14 h-14 rounded-2xl bg-red-500/15 border border-red-500/30 flex items-center justify-center mx-auto mb-4">
              <Send size={26} className="text-red-300" strokeWidth={1.75} />
            </div>
            <h3 className="text-white text-lg font-bold mb-2">{t.boxesTelegramRequiredTitle}</h3>
            <p className="text-zinc-400 text-sm leading-relaxed mb-5 max-w-sm mx-auto">
              {t.boxesTelegramRequiredDesc}
            </p>
            <button
              onClick={() => {
                if (typeof window === 'undefined') return;
                let session: string | null = null;
                try { session = window.localStorage.getItem('hvpn_session'); } catch { /* ignore */ }
                if (!session) {
                  setError(t.boxesLinkTelegramNoSession);
                  return;
                }
                haptic('medium');
                const base = window.location.origin;
                window.location.href = `${base}/api/auth/telegram/start-link?link=${encodeURIComponent(session)}`;
              }}
              className="inline-flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold px-5 py-3 rounded-xl active:scale-[0.98] transition-all shadow-[0_8px_24px_-8px_rgba(239,68,68,0.5)]"
            >
              <Send size={16} strokeWidth={2} />
              {t.boxesLinkTelegramButton}
            </button>
            {error && (
              <p className="text-red-300/80 text-xs mt-3">{error}</p>
            )}
          </div>
        ) : items.length === 0 && !loading && !error ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-12 text-center">
            <Package size={28} className="text-zinc-600 mx-auto mb-2" strokeWidth={1.5} />
            <p className="text-zinc-500 text-sm">{t.boxesHistoryEmpty}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((r) => {
              const styles = BOX_RARITY_STYLES[r.rarity];
              const isCoupon = r.rewardKind === 'discount_coupon';
              return (
                <div
                  key={r.id}
                  className={`rounded-xl bg-gradient-to-r ${styles.bg} border ${styles.ring} px-3 py-3`}
                >
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      {isCoupon ? (
                        <Tag size={16} className="text-fuchsia-300 shrink-0" strokeWidth={1.75} />
                      ) : r.boxKind === 'super' ? (
                        <Trophy size={16} className="text-amber-300 shrink-0" strokeWidth={1.75} />
                      ) : (
                        <Package size={16} className="text-zinc-300 shrink-0" strokeWidth={1.75} />
                      )}
                      <p className={`text-sm font-semibold ${styles.text} truncate`}>
                        {isCoupon
                          ? `${t.boxesCouponPrefix}${r.discountPercent ?? r.rewardValue}%`
                          : formatRewardHoursLabel(r.rewardHours, lang)}
                      </p>
                    </div>
                    <span className={`shrink-0 px-2 py-0.5 rounded-md text-[9px] font-bold tracking-wider uppercase ${styles.chip}`}>
                      {rarityLabel(r.rarity, t)}
                    </span>
                  </div>
                  <p className="text-zinc-500 text-[10px] mb-2">
                    {r.boxKind === 'super' ? t.boxesBoxSuper : t.boxesBoxDaily}
                    {' · '}
                    {new Date(r.createdAt).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>

                  {isCoupon && r.couponCode && (
                    <button
                      onClick={() => copyCouponCode(r.couponCode!)}
                      disabled={!!r.couponExpired}
                      className={`w-full px-3 py-2 rounded-lg flex items-center justify-between gap-2 transition-colors ${r.couponExpired ? 'bg-black/30 border border-white/5 cursor-not-allowed opacity-60' : 'bg-black/40 border border-white/15 hover:border-white/30 active:scale-[0.99]'}`}
                    >
                      <span className={`font-mono font-bold text-sm tracking-[0.16em] ${r.couponExpired ? 'text-zinc-500 line-through' : 'text-white'}`}>
                        {r.couponCode}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium">
                        {r.couponExpired ? (
                          <span className="text-zinc-500">{t.boxesCouponExpired}</span>
                        ) : copiedCode === r.couponCode ? (
                          <><Check size={12} className="text-emerald-400" strokeWidth={2.5} /><span className="text-emerald-400">{t.boxesCopied}</span></>
                        ) : (
                          <><Copy size={12} className="text-zinc-300" strokeWidth={2} /><span className="text-zinc-300">{t.boxesCopy}</span></>
                        )}
                      </span>
                    </button>
                  )}
                </div>
              );
            })}

            {hasMore && (
              <button
                onClick={() => fetchPage(items.length)}
                disabled={loading}
                className="w-full mt-2 px-4 py-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-zinc-200 text-sm font-medium transition-colors disabled:opacity-50"
              >
                {loading ? (
                  <span className="inline-flex items-center gap-2 justify-center">
                    <RefreshCw size={14} className="animate-spin" />
                    {t.boxesHistoryLoading}
                  </span>
                ) : `${t.boxesHistoryLoadMore} (${total - items.length})`}
              </button>
            )}
            {loading && items.length === 0 && (
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 flex items-center justify-center">
                <RefreshCw size={18} className="animate-spin text-zinc-500" />
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

const NavItem = memo(function NavItem({ icon, label, isActive, onClick, badge }: { icon: React.ReactNode; label: string; isActive: boolean; onClick: () => void; badge?: number }) {
  const hasBadge = typeof badge === 'number' && badge > 0;
  const badgeText = hasBadge ? (badge > 99 ? '99+' : String(badge)) : '';
  return (
    <button onClick={onClick} className={`flex flex-col items-center justify-center w-14 h-12 gap-0.5 transition-colors relative active:scale-90 ${isActive ? 'text-red-500' : 'text-zinc-600 hover:text-zinc-400'}`}>
      <div className={`relative ${isActive ? 'drop-shadow-[0_0_4px_rgba(239,68,68,0.5)]' : ''}`}>
        {icon}
        {hasBadge && (
          <span
            className="absolute -top-1.5 -right-2 min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-[9px] font-bold text-white flex items-center justify-center shadow-[0_0_8px_rgba(239,68,68,0.6)] border border-zinc-950"
            aria-label={`${badge} unread`}
          >
            {badgeText}
          </span>
        )}
      </div>
      <span className="text-[8px] font-medium tracking-wider uppercase">{label}</span>
      {isActive && <div className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-5 h-0.5 bg-red-500 rounded-full shadow-[0_0_4px_rgba(239,68,68,0.6)]" />}
    </button>
  );
});