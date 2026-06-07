import type { Metadata } from 'next';
import LegalLayout from '@/components/LegalLayout';

export const metadata: Metadata = {
  title: 'Политика конфиденциальности — Hundler VPN',
  description:
    'Как Hundler VPN обрабатывает и защищает данные пользователей. Минимальный объём собираемых данных, цели использования, права пользователя.',
};

/**
 * /privacy — privacy policy page rendered on the public site (mini-app
 * + landing footer + login screen all link here). Replaces the
 * external telegra.ph hosted version so we control the canonical URL
 * and keep the brand chrome consistent.
 *
 * Bot-side links (bot/, bot-chat/) intentionally still point at
 * telegra.ph per user request — they may be migrated separately.
 */
export default function PrivacyPolicyPage() {
  return (
    <LegalLayout
      title="Политика конфиденциальности"
      subtitle="Документ описывает, какие данные мы собираем при использовании Hundler VPN, для чего они нужны и как защищаются."
      updatedAt="21 марта 2026"
    >
      <Section number="1" title="Общие положения">
        <Clause num="1.1.">
          Настоящая Политика конфиденциальности (далее — «Политика») регулирует
          порядок обработки и защиты информации, которую Пользователь передаёт
          при использовании сервиса Hundler VPN (далее — «Сервис»).
        </Clause>
        <Clause num="1.2.">
          Используя Сервис, Пользователь подтверждает своё согласие с условиями
          Политики. Если Пользователь не согласен с условиями — он обязан
          прекратить использование Сервиса.
        </Clause>
      </Section>

      <Section number="2" title="Сбор информации">
        <Clause num="2.1.">Сервис может собирать следующие типы данных:</Clause>
        <ul>
          <li>идентификаторы аккаунта (Telegram ID, username, email);</li>
          <li>
            техническую информацию (IP-адрес, данные о браузере, устройстве и
            операционной системе);
          </li>
          <li>историю взаимодействий с Сервисом.</li>
        </ul>
        <Clause num="2.2.">
          Сервис не требует от Пользователя предоставления паспортных данных,
          документов, фотографий или другой личной информации, кроме минимально
          необходимой для работы.
        </Clause>
      </Section>

      <Section number="3" title="Использование информации">
        <Clause num="3.1.">
          Сервис может использовать полученную информацию исключительно для:
        </Clause>
        <ul>
          <li>обеспечения работы функционала;</li>
          <li>связи с Пользователем (уведомления, поддержка);</li>
          <li>анализа и улучшения работы Сервиса.</li>
        </ul>
      </Section>

      <Section number="4" title="Передача информации третьим лицам">
        <Clause num="4.1.">
          Администрация не передаёт полученные данные третьим лицам, за
          исключением случаев:
        </Clause>
        <ul>
          <li>если это требуется по закону;</li>
          <li>
            если это необходимо для исполнения обязательств перед Пользователем
            (например, при работе с платёжными системами);
          </li>
          <li>если Пользователь сам дал на это согласие.</li>
        </ul>
      </Section>

      <Section number="5" title="Хранение и защита данных">
        <Clause num="5.1.">
          Данные хранятся в течение срока, необходимого для достижения целей
          обработки.
        </Clause>
        <Clause num="5.2.">
          Администрация принимает разумные меры для защиты данных, но не
          гарантирует абсолютную безопасность информации при передаче через
          интернет.
        </Clause>
      </Section>

      <Section number="6" title="Отказ от ответственности">
        <Clause num="6.1.">
          Пользователь понимает и соглашается, что передача информации через
          интернет всегда сопряжена с рисками.
        </Clause>
        <Clause num="6.2.">
          Администрация не несёт ответственности за утрату, кражу или раскрытие
          данных, если это произошло по вине третьих лиц или самого
          Пользователя.
        </Clause>
      </Section>

      <Section number="7" title="Изменения в Политике">
        <Clause num="7.1.">
          Администрация вправе изменять условия Политики без предварительного
          уведомления.
        </Clause>
        <Clause num="7.2.">
          Продолжение использования Сервиса после внесения изменений означает
          согласие Пользователя с новой редакцией Политики.
        </Clause>
      </Section>
    </LegalLayout>
  );
}

/* Local presentational helpers — kept inline so the page stays
   self-contained and we don't pollute components/ with single-use
   atoms. Same components are duplicated in app/terms/page.tsx; if a
   third legal doc shows up we can hoist them. */

function Section({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2>
        <span className="legal-num">{number}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Clause({ num, children }: { num: string; children: React.ReactNode }) {
  return (
    <p className="clause">
      <span className="clause-num">{num}</span>
      {children}
    </p>
  );
}
