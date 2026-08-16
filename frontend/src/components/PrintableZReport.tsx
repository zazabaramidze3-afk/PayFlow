// ==========================================
// 🖨 Z-Report-ის ბეჭდვადი შაბლონი — Roadmap ეტაპი 7
// ==========================================
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
}

interface PrintableZReportProps {
  report: PrintableZReportData;
}

export default function PrintableZReport({ report }: PrintableZReportProps) {
  const differenceLabel = `${report.difference >= 0 ? '+' : ''}${report.difference.toFixed(2)} ₾`;

  return (
    <div className="print-area receipt-80mm">
      <h2>PayFlow</h2>
      <div style={{ textAlign: 'center', fontSize: '11px' }}>Z-რეპორტი (ცვლის დახურვა)</div>
      <hr />
      {report.shiftId !== undefined && <div>ცვლა #: {report.shiftId}</div>}
      {report.cashierName && <div>მოლარე: {report.cashierName}</div>}
      {report.openedAt && <div>გახსნა: {report.openedAt}</div>}
      <div>დახურვა: {report.closedAt}</div>
      <hr />
      <div className="receipt-row">
        <span>საწყისი ბალანსი:</span>
        <span>{report.start.toFixed(2)} ₾</span>
      </div>
      <div className="receipt-row">
        <span>გაყიდული ჩეკები:</span>
        <span>{report.receiptCount}</span>
      </div>
      <div className="receipt-row">
        <span>მოსალოდნელი თანხა:</span>
        <span>{report.expected.toFixed(2)} ₾</span>
      </div>
      <div className="receipt-row">
        <span>ფაქტობრივი თანხა:</span>
        <span>{report.actual.toFixed(2)} ₾</span>
      </div>
      <hr />
      <div className="receipt-row" style={{ fontWeight: 'bold', fontSize: '14px' }}>
        <span>სხვაობა:</span>
        <span>{differenceLabel}</span>
      </div>
      <hr />
      <div style={{ marginTop: '6mm', fontSize: '11px' }}>ხელმოწერა: ____________________</div>
    </div>
  );
}
