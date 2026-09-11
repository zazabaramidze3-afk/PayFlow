// ==========================================
// 🖨 Z-Report-ის ბეჭდვადი შაბლონი — Roadmap ეტაპი 7
// ==========================================
import { useTranslation } from 'react-i18next';
// ეკრანზე დამალულია (print.css-ის .print-area { display: none } default-ად),
// ჩნდება მხოლოდ window.print()-ის დროს. ციფრები ზუსტად იმეორებს Sales.tsx-ის
// ცვლის დახურვის მოდალში ნაჩვენებ მნიშვნელობებს (start/expected/actual/
// difference/receiptCount) — PUT /api/shifts/close-ის response.

export interface PrintableZReportData {
  // 🆔 UUID მიგრაცია (Roadmap STEP 1) — shifts.id ბექენდზე ახლა UUID
  // string-ია, აღარ არის SERIAL INTEGER.
  shiftId?: string;
  openedAt?: string;
  closedAt: string;
  cashierName?: string;
  start: number;
  expected: number;
  actual: number;
  difference: number;
  receiptCount: number;
  // 🩹 FIX (06.09.2026) — HoReCa STEP 4-ის tip-ის (migration 023/024)
  // ჯამური ჯამი ცვლაზე — undefined ძველი (migration 024-მდელი) ჩეკებზე,
  // 0-ზეც არ ჩანს ბლოკი (რადგან ჩვეულებრივ Retail POS checkout-ს tip
  // საერთოდ არ აქვს).
  tipTotal?: number;
}

interface PrintableZReportProps {
  report: PrintableZReportData;
}

export default function PrintableZReport({ report }: PrintableZReportProps) {
  const { t } = useTranslation();
  const differenceLabel = `${report.difference >= 0 ? '+' : ''}${report.difference.toFixed(2)} ₾`;

  return (
    <div className="print-area receipt-80mm">
      <h2>PayFlow</h2>
      <div style={{ textAlign: 'center', fontSize: '11px' }}>{t('dashboard.zReportPrint.subtitle')}</div>
      <hr />
      {report.shiftId !== undefined && <div>{t('dashboard.zReportPrint.shiftNumberLabel')} {report.shiftId}</div>}
      {report.cashierName && <div>{t('dashboard.zReportPrint.cashierLabel')} {report.cashierName}</div>}
      {report.openedAt && <div>{t('dashboard.zReportPrint.openedLabel')} {report.openedAt}</div>}
      <div>{t('dashboard.zReportPrint.closedLabel')} {report.closedAt}</div>
      <hr />
      <div className="receipt-row">
        <span>{t('dashboard.zReportPrint.startBalanceLabel')}</span>
        <span>{report.start.toFixed(2)} ₾</span>
      </div>
      <div className="receipt-row">
        <span>{t('dashboard.zReportPrint.receiptsSoldLabel')}</span>
        <span>{report.receiptCount}</span>
      </div>
      <div className="receipt-row">
        <span>{t('dashboard.zReportPrint.expectedAmountLabel')}</span>
        <span>{report.expected.toFixed(2)} ₾</span>
      </div>
      <div className="receipt-row">
        <span>{t('dashboard.zReportPrint.actualAmountLabel')}</span>
        <span>{report.actual.toFixed(2)} ₾</span>
      </div>
      {Number(report.tipTotal ?? 0) > 0 && (
        <div className="receipt-row">
          <span>{t('dashboard.zReportPrint.tipTotalLabel')}</span>
          <span>{Number(report.tipTotal).toFixed(2)} ₾</span>
        </div>
      )}
      <hr />
      <div className="receipt-row" style={{ fontWeight: 'bold', fontSize: '14px' }}>
        <span>{t('dashboard.zReportPrint.differenceLabel')}</span>
        <span>{differenceLabel}</span>
      </div>
      <hr />
      <div style={{ marginTop: '6mm', fontSize: '11px' }}>{t('dashboard.zReportPrint.signatureLine')}</div>
    </div>
  );
}
