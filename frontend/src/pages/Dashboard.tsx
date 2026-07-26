// import { useState, useEffect } from 'react';
// import axios from 'axios';

// interface PaymentItem { name: string; quantity: number; price: number; }
// interface Payment { id: number; cashier_name: string; total_amount: number; created_at: string; items: PaymentItem[]; }
// interface Shift { id: number; cashier_name: string; status: 'open' | 'closed'; opened_at: string; closed_at: string | null; start_amount: number; end_amount_expected: number | null; end_amount_actual: number | null; difference: number | null; }

// export default function Dashboard() {
//   const [payments, setPayments] = useState<Payment[]>([]);
//   const [totalRevenue, setTotalRevenue] = useState(0);
//   const [shifts, setShifts] = useState<Shift[]>([]);
//   const [activeTab, setActiveTab] = useState<'sales' | 'shifts'>('sales');
//   const [cashierName, setCashierName] = useState('');
//   const [productName, setProductName] = useState('');
//   const [minPrice, setMinPrice] = useState('');
//   const [expandedRows, setExpandedRows] = useState<number[]>([]);

//   useEffect(() => {
//     if (activeTab === 'sales') loadPayments(); else loadShifts();
//   }, [cashierName, productName, minPrice, activeTab]);

//   const loadPayments = async () => {
//     try {
//       const res = await axios.get('http://localhost:5000/api/payments', { params: { cashierName, productName, minPrice } });
//       setPayments(res.data?.payments || []);
//       setTotalRevenue(res.data?.totalRevenue || 0);
//     } catch (err) { console.error(err); }
//   };

//   const loadShifts = async () => {
//     try {
//       const res = await axios.get('http://localhost:5000/api/shifts/history');
//       setShifts(res.data || []);
//     } catch (err) { console.error(err); }
//   };

//   const formatDate = (ds: string | null) => ds ? new Date(ds).toLocaleString('ka-GE', { hour12: false }) : '—';
//   const handleExport = (type: 'excel' | 'pdf') => {
//   const token = localStorage.getItem('token'); // ვიღებთ იუზერის აქტიურ ტოკენს
//   window.open(`http://localhost:5000/api/payments/export/${type}?token=${token}`, '_blank');
// };


//   const toggleRow = (id: number) => {
//     if (expandedRows.includes(id)) {
//       setExpandedRows(expandedRows.filter(rowId => rowId !== id));
//     } else {
//       setExpandedRows([...expandedRows, id]);
//     }
//   };

// import { useState, useEffect } from 'react';
// import axios from 'axios'; // ან თქვენი axios იმპორტი

// interface PaymentItem { name: string; quantity: number; price: number; }
// interface Payment { id: number; cashier_name: string; total_amount: number; created_at: string; items: PaymentItem[]; }
// interface Shift { id: number; cashier_name: string; status: 'open' | 'closed'; opened_at: string; closed_at: string | null; start_amount: number; end_amount_expected: number | null; end_amount_actual: number | null; difference: number | null; }

// export default function Dashboard() {
//   const [payments, setPayments] = useState<Payment[]>([]);
//   const [totalRevenue, setTotalRevenue] = useState(0);
//   const [shifts, setShifts] = useState<Shift[]>([]);
//   const [activeTab, setActiveTab] = useState<'sales' | 'shifts'>('sales');
//   const [cashierName, setCashierName] = useState('');
//   const [productName, setProductName] = useState('');
//   const [minPrice, setMinPrice] = useState('');
//   const [expandedRows, setExpandedRows] = useState<number[]>([]);

//   // ⚡ უსასრულო ლუპის პრევენცია და სწორი ჩატვირთვა ტაბის მიხედვით
//   useEffect(() => {
//     const token = localStorage.getItem('token');
//     // ვამატებთ ავტორიზაციის ჰედერებს ყველა რექვესტისთვის
//     if (token) {
//       axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
//     }

//     if (activeTab === 'sales') {
//       loadPayments();
//     } else {
//       loadShifts();
//     }
//   }, [activeTab, cashierName, productName, minPrice]); // რექვესტი გაიშვება მხოლოდ ამ ველების რეალური ცვლილებისას

//   const loadPayments = async () => {
//     try {
//       const res = await axios.get('http://localhost:5000/api/payments', { 
//         params: { cashierName, productName, minPrice } 
//       });
      
//       // ⚡ ჩასწორდა: რადგან ბექენდი პირდაპირ მასივს აბრუნებს
//       const paymentData = Array.isArray(res.data) ? res.data : [];
//       setPayments(paymentData);
      
//       // ⚡ ჯამურ შემოსავალს ვითვლით იქვე, წამოსული მასივიდან გამომდინარე
//       const revenue = paymentData.reduce((sum: number, p: any) => sum + p.total_amount, 0);
//       setTotalRevenue(revenue);
//     } catch (err) { 
//       console.error("გაყიდვების წამოღების შეცდომა:", err); 
//     }
//   };

//   const loadShifts = async () => {
//     try {
//       const res = await axios.get('http://localhost:5000/api/shifts/history');
//       setShifts(res.data || []);
//     } catch (err) { 
//       console.error("ცვლების წამოღების შეცდომა:", err); 
//     }
//   };

//   const formatDate = (ds: string | null) => ds ? new Date(ds).toLocaleString('ka-GE', { hour12: false }) : '—';
  
//   const handleExport = (type: 'excel' | 'pdf') => {
//     const token = localStorage.getItem('token');
//     window.open(`http://localhost:5000/api/payments/export/${type}?token=${token}`, '_blank');
//   };

//   const toggleRow = (id: number) => {
//     if (expandedRows.includes(id)) {
//       setExpandedRows(expandedRows.filter(rowId => rowId !== id));
//     } else {
//       setExpandedRows([...expandedRows, id]);
//     }
//   };


  // return (
  //   <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
  //     <h2 style={{ marginBottom: '20px', color: '#1e293b' }}>📊 გაყიდვების მართვის პანელი</h2>

  //     {/* ტაბები */}
  //     <div style={{ display: 'flex', gap: '10px', marginBottom: '25px', borderBottom: '2px solid #e2e8f0', paddingBottom: '10px' }}>
  //       <button onClick={() => setActiveTab('sales')} style={{ ...tabStyle, background: activeTab === 'sales' ? '#2563eb' : 'transparent', color: activeTab === 'sales' ? '#fff' : '#64748b' }}>💰 გაყიდვების ისტორია</button>
  //       <button onClick={() => setActiveTab('shifts')} style={{ ...tabStyle, background: activeTab === 'shifts' ? '#2563eb' : 'transparent', color: activeTab === 'shifts' ? '#fff' : '#64748b' }}>🔄 მოლარეების ცვლები</button>
  //     </div>

  //     {/* გაყიდვების ტაბი */}
  //     {activeTab === 'sales' && (
  //       <>
  //         <div style={{ background: '#fff', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: '20px' }}>
  //           <span style={{ fontSize: '14px', color: '#64748b' }}>საერთო შემოსავალი</span>
  //           <h1 style={{ margin: '5px 0 0 0', color: '#10b981', fontSize: '2rem' }}>{(totalRevenue || 0).toFixed(2)} ₾</h1>
  //         </div>

  //         <div style={{ display: 'flex', gap: '15px', marginBottom: '20px', flexWrap: 'wrap' }}>
  //           <input type="text" placeholder="მოლარე..." value={cashierName} onChange={e => setCashierName(e.target.value)} style={inputStyle} />
  //           <input type="text" placeholder="პროდუქტი..." value={productName} onChange={e => setProductName(e.target.value)} style={inputStyle} />
  //           <input type="number" placeholder="ფასი..." value={minPrice} onChange={e => setMinPrice(e.target.value)} style={inputStyle} />
  //           <button onClick={() => handleExport('excel')} style={{ ...btnStyle, background: '#10b981' }}>Excel 📊</button>
  //           <button onClick={() => handleExport('pdf')} style={{ ...btnStyle, background: '#ef4444' }}>PDF 📄</button>
  //         </div>

  //         <div style={tableWrapperStyle}>
  //           <table style={{ width: '100%', borderCollapse: 'collapse' }}>
  //             <thead>
  //               <tr style={{ backgroundColor: '#f1f5f9' }}>
  //                 <th style={thTdStyle}>ID</th><th style={thTdStyle}>მოლარე</th><th style={thTdStyle}>თარიღი</th><th style={thTdStyle}>ფასი</th><th style={thTdStyle}>დეტალები</th>
  //               </tr>
  //             </thead>
  //             <tbody>
  //               {payments.map(p => {
  //                 const isExp = expandedRows.includes(p.id);
  //                 return (
  //                   <tr key={p.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
  //                     <td colSpan={5} style={{ padding: 0 }}>
  //                       <table style={{ width: '100%', borderCollapse: 'collapse' }}>
  //                         <tbody>
  //                           {/* მთავარი ხაზი */}
  //                           <tr style={{ background: isExp ? '#f8fafc' : 'transparent' }}>
  //                             <td style={{ ...thTdStyle, width: '10%' }}>#{p.id}</td>
  //                             <td style={{ ...thTdStyle, width: '25%' }}>{p.cashier_name || 'უცნობი'}</td>
  //                             <td style={{ ...thTdStyle, width: '30%' }}>{formatDate(p.created_at)}</td>
  //                             <td style={{ ...thTdStyle, width: '20%', fontWeight: 'bold' }}>{(p.total_amount || 0).toFixed(2)} ₾</td>
  //                             <td style={{ ...thTdStyle, width: '15%' }}>
  //                               <button onClick={() => toggleRow(p.id)} style={{ ...btnStyle, background: '#ffffff', padding: '5px 10px', height: 'auto' }}>
  //                                 {isExp ? '🔼' : '🔽'}
  //                               </button>
  //                             </td>
  //                           </tr>

  //                           {/* ჩამოშლილი პროდუქტების სია (დაბრუნებული ნაწილი) */}
  //                           {isExp && (
  //                             <tr>
  //                               <td colSpan={5} style={{ padding: '0 20px 15px 40px', backgroundColor: '#f8fafc' }}>
  //                                 <div style={{ borderLeft: '3px solid #cbd5e1', paddingLeft: '15px', marginTop: '10px' }}>
  //                                   {Array.isArray(p.items) && p.items.map((item, index) => (
  //                                     <div key={index} style={{ fontSize: '14px', color: '#1e5096', margin: '6px 0', fontFamily: 'monospace' }}>
  //                                       └── 📦 <span style={{ fontWeight: 'bold', color: '#0f172a' }}>{item?.name || 'პროდუქტი'}</span> — {item?.quantity || 0} ცალი × {(item?.price || 0).toFixed(2)} ₾
  //                                     </div>
  //                                   ))}
  //                                 </div>
  //                               </td>
  //                             </tr>
  //                           )}
  //                         </tbody>
  //                       </table>
  //                     </td>
  //                   </tr>
  //                 );
  //               })}

  //             </tbody>
  //           </table>
  //         </div>
  //       </>
  //     )}

import { useState, useEffect } from 'react';
import axios from 'axios'; // 👈 აქ ეწერა 'react' და ეს აგდებდა თეთრ ეკრანს!

interface PaymentItem { name: string; quantity: number; price: number; }
interface Payment { id: number; cashier_name: string; total_amount: number; created_at: string; items: PaymentItem[]; }
interface Shift { id: number; cashier_name: string; status: 'open' | 'closed'; opened_at: string; closed_at: string | null; start_amount: number; end_amount_expected: number | null; end_amount_actual: number | null; difference: number | null; }

export default function Dashboard() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [activeTab, setActiveTab] = useState<'sales' | 'shifts'>('sales');
  const [cashierName, setCashierName] = useState('');
  const [productName, setProductName] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [expandedRows, setExpandedRows] = useState<number[]>([]);

  // მონაცემების ჩატვირთვა
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    }

    if (activeTab === 'sales') {
      loadPayments();
    } else {
      loadShifts();
    }
  }, [activeTab, cashierName, productName, minPrice]); 

  const loadPayments = async () => {
    try {
      const res = await axios.get('http://localhost:5000/api/payments', { 
        params: { cashierName, productName, minPrice } 
      });
      
      const paymentData = Array.isArray(res.data) ? res.data : [];
      setPayments(paymentData);
      
      const revenue = paymentData.reduce((sum: number, p: any) => sum + p.total_amount, 0);
      setTotalRevenue(revenue);
    } catch (err) { 
      console.error("გაყიდვების წამოღების შეცდომა:", err); 
    }
  };

  const loadShifts = async () => {
    try {
      const res = await axios.get('http://localhost:5000/api/shifts/history');
      setShifts(res.data || []);
    } catch (err) { 
      console.error("ცვლების წამოღების შეცდომა:", err); 
    }
  };

  const formatDate = (ds: string | null) => ds ? new Date(ds).toLocaleString('ka-GE', { hour12: false }) : '—';
  
  const handleExport = (type: 'excel' | 'pdf') => {
    const token = localStorage.getItem('token');
    window.open(`http://localhost:5000/api/payments/export/${type}?token=${token}`, '_blank');
  };

  const toggleRow = (id: number) => {
    if (expandedRows.includes(id)) {
      setExpandedRows(expandedRows.filter(rowId => rowId !== id));
    } else {
      setExpandedRows([...expandedRows, id]);
    }
  };


  return (
  <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
    <h2 style={{ marginBottom: '20px', color: '#1e293b' }}>📊 გაყიდვების მართვის პანელი</h2>

    {/* ტაბები */}
    <div style={{ display: 'flex', gap: '10px', marginBottom: '25px', borderBottom: '2px solid #e2e8f0', paddingBottom: '10px' }}>
      <button onClick={() => setActiveTab('sales')} style={{ ...tabStyle, background: activeTab === 'sales' ? '#2563eb' : 'transparent', color: activeTab === 'sales' ? '#fff' : '#64748b' }}>💰 გაყიდვების ისტორია</button>
      <button onClick={() => setActiveTab('shifts')} style={{ ...tabStyle, background: activeTab === 'shifts' ? '#2563eb' : 'transparent', color: activeTab === 'shifts' ? '#fff' : '#64748b' }}>🔄 მოლარეების ცვლები</button>
    </div>

    {/* გაყიდვების ტაბი */}
    {activeTab === 'sales' && (
      <>
        <div style={{ background: '#fff', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: '20px' }}>
          <span style={{ fontSize: '14px', color: '#64748b' }}>საერთო შემოსავალი</span>
          <h1 style={{ margin: '5px 0 0 0', color: '#10b981', fontSize: '2rem' }}>{(totalRevenue || 0).toFixed(2)} ₾</h1>
        </div>

        <div style={{ display: 'flex', gap: '15px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <input type="text" placeholder="🔎 მოლარე..." value={cashierName} onChange={e => setCashierName(e.target.value)} style={inputStyle} />
          <input type="text" placeholder="🔎 პროდუქტი..." value={productName} onChange={e => setProductName(e.target.value)} style={inputStyle} />
          <input type="number" placeholder="💰 მინ. ფასი..." value={minPrice} onChange={e => setMinPrice(e.target.value)} style={inputStyle} />
          <button onClick={() => handleExport('excel')} style={{ ...btnStyle, background: '#10b981' }}>Excel 📊</button>
          <button onClick={() => handleExport('pdf')} style={{ ...btnStyle, background: '#ef4444' }}>PDF 📄</button>
        </div>

        <div style={tableWrapperStyle}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#f1f5f9' }}>
                <th style={thTdStyle}>ID</th>
                <th style={thTdStyle}>მოლარე</th>
                <th style={thTdStyle}>თარიღი</th>
                <th style={thTdStyle}>ფასი</th>
                <th style={thTdStyle}>დეტალები</th>
              </tr>
            </thead>
            <tbody>
              {/* ⚡ Empty State - თუ გაყიდვები საერთოდ არ არის ბაზაში */}
              {payments.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: '30px', textAlign: 'center', color: '#64748b' }}>
                    📭 გაყიდვების ისტორია ცარიელია ან მონაცემები ვერ მოიძებნა
                  </td>
                </tr>
              ) : (
                payments.map(p => {
                  const isExp = expandedRows.includes(p.id);
                  return (
                    <tr key={p.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td colSpan={5} style={{ padding: 0 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <tbody>
                            {/* მთავარი ხაზი */}
                            <tr style={{ background: isExp ? '#f8fafc' : 'transparent' }}>
                              <td style={{ ...thTdStyle, width: '10%' }}>#{p.id}</td>
                              <td style={{ ...thTdStyle, width: '25%' }}>{p.cashier_name || 'უცნობი'}</td>
                              <td style={{ ...thTdStyle, width: '30%' }}>{formatDate(p.created_at)}</td>
                              <td style={{ ...thTdStyle, width: '20%', fontWeight: 'bold' }}>{(p.total_amount || 0).toFixed(2)} ₾</td>
                              <td style={{ ...thTdStyle, width: '15%' }}>
                                <button onClick={() => toggleRow(p.id)} style={{ ...btnStyle, background: '#ffffff', padding: '5px 10px', height: 'auto', border: '1px solid #cbd5e1' }}>
                                  {isExp ? '🔼' : '🔽'}
                                </button>
                              </td>
                            </tr>

                            {/* ჩამოშლილი პროდუქტების სია */}
                            {isExp && (
                              <tr>
                                <td colSpan={5} style={{ padding: '0 20px 15px 40px', backgroundColor: '#f8fafc' }}>
                                  <div style={{ borderLeft: '3px solid #cbd5e1', paddingLeft: '15px', marginTop: '10px' }}>
                                    {Array.isArray(p.items) && p.items.length > 0 ? (
                                      p.items.map((item, index) => (
                                        <div key={index} style={{ fontSize: '14px', color: '#1e5096', margin: '6px 0', fontFamily: 'monospace' }}>
                                          └── 📦 <span style={{ fontWeight: 'bold', color: '#0f172a' }}>{item?.name || 'პროდუქტი'}</span> — {item?.quantity || 0} ცალი × {(item?.price || 0).toFixed(2)} ₾
                                        </div>
                                      ))
                                    ) : (
                                      <div style={{ fontSize: '13px', color: '#64748b', fontStyle: 'italic' }}>
                                        ℹ️ ამ ქვითრის დეტალები არ არის ჩატვირთული
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </>
    )}


      {/* ცვლების ტაბი */}
      {activeTab === 'shifts' && (
        <div style={tableWrapperStyle}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#f1f5f9' }}>
                <th style={thTdStyle}>ID</th><th style={thTdStyle}>მოლარე</th><th style={thTdStyle}>სტატუსი</th><th style={thTdStyle}>გახსნა</th><th style={thTdStyle}>დახურვა</th><th style={thTdStyle}>საწყისი</th><th style={thTdStyle}>მოსალოდნელი</th><th style={thTdStyle}>ფაქტობრივი</th><th style={thTdStyle}>სხვაობა</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map(s => {
                const isOpen = s.status === 'open';
                const diff = s.difference || 0;
                return (
                  <tr key={s.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={thTdStyle}>#{s.id}</td><td style={{ ...thTdStyle, fontWeight: 'bold' }}>{s.cashier_name}</td>
                    <td>
                      <span style={{ background: isOpen ? '#dcfce7' : '#f1f5f9', color: isOpen ? '#15803d' : '#475569', padding: '4px 10px', borderRadius: '50px', fontSize: '13px', fontWeight: 'bold' }}>
                        {isOpen ? '🟢 ღიაა' : '🔴 closed'}
                      </span>
                    </td>
                    <td style={thTdStyle}>{formatDate(s.opened_at)}</td><td style={thTdStyle}>{formatDate(s.closed_at)}</td>
                    <td style={thTdStyle}>{s.start_amount.toFixed(2)} ₾</td>
                    <td style={thTdStyle}>{s.end_amount_expected !== null ? `${s.end_amount_expected.toFixed(2)} ₾` : '—'}</td>
                    <td style={thTdStyle}>{s.end_amount_actual !== null ? `${s.end_amount_actual.toFixed(2)} ₾` : '—'}</td>
                    <td style={{ ...thTdStyle, fontWeight: 'bold', color: isOpen ? '#1e293b' : diff < 0 ? '#ef4444' : '#10b981' }}>
                      {isOpen ? '—' : `${diff >= 0 ? '+' : ''}${diff.toFixed(2)} ₾`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const inputStyle = { padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none', fontSize: '14px', height: '40px', width: '180px', boxSizing: 'border-box' as const };
const thTdStyle = { padding: '14px 20px', fontSize: '15px' };
const tabStyle = { border: 'none', padding: '10px 20px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' as const, fontSize: '15px' };
const btnStyle = { color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' as const, height: '40px' };
const tableWrapperStyle = { background: '#fff', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', overflow: 'hidden' };
