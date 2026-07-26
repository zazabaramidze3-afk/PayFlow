import styles from './Sales.module.scss';
import { useState, useEffect } from 'react';
import axios from 'axios';

interface Product { id: number; name: string; price: number; stock: number; barcode?: string; }
interface CartItem { productId: number; name: string; price: number; quantity: number; maxStock: number; }

export default function Sales() {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [hasActiveShift, setHasActiveShift] = useState<boolean>(false);
  const [activeShift, setActiveShift] = useState<any>(null);
  const [startAmount, setStartAmount] = useState<string>('0');
  const [endAmountActual, setEndAmountActual] = useState<string>('0');
  const [showCloseModal, setShowCloseModal] = useState<boolean>(false);
  const [zReport, setZReport] = useState<any>(null);

  useEffect(() => {
    checkShiftStatus();
    let barcodeBuffer = '';
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' && (document.activeElement as HTMLInputElement).type === 'number') return;
      if (e.key === 'Enter') {
        if (barcodeBuffer.trim().length > 0) {
          handleBarcodeScanned(barcodeBuffer.trim());
          barcodeBuffer = '';
        }
      } else if (e.key !== 'Shift') {
        barcodeBuffer += e.key;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [products, cart]);

  const checkShiftStatus = async () => {
    try {
      const response = await axios.get('http://localhost:5000/api/shifts/status');
      setHasActiveShift(response.data.hasActiveShift);
      setActiveShift(response.data.shift);
      if (response.data.hasActiveShift) loadProducts();
    } catch (error) { console.error(error); }
  };

  const loadProducts = async () => {
    try {
      const response = await axios.get('http://localhost:5000/api/products');
      setProducts(response.data);
    } catch (error) { console.error(error); }
  };

  const handleOpenShift = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await axios.post('http://localhost:5000/api/shifts/open', { start_amount: parseFloat(startAmount) });
      checkShiftStatus();
    } catch (error: any) { alert(error.response?.data?.message || 'შეცდომა'); }
  };

  const handleCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await axios.put('http://localhost:5000/api/shifts/close', { end_amount_actual: parseFloat(endAmountActual) });
      setZReport(response.data);
      // მნიშვნელოვანია: არ ვცვლით hasActiveShift-ს ხელით აქ, რათა ეკრანი არ დაიბლოკოს მოდალის გამოჩენამდე
    } catch (error: any) {
      console.error('ცვლის დახურვის შეცდომა:', error.response?.data || error.message);
      alert(error.response?.data?.message || error.response?.data?.error || 'შეცდომა ცვლის დახურვისას');
    }
  };
  const handleBarcodeScanned = (scannedCode: string) => {
    const prod = products.find(p => p.barcode === scannedCode);
    if (!prod) return alert(`პროდუქტი კოდით [${scannedCode}] ვერ მოიძებნა!`);
    if (prod.stock <= 0) return alert('მარაგში აღარ არის!');
    const existing = cart.find(item => item.productId === prod.id);
    const currentQty = existing ? existing.quantity : 0;
    if (prod.stock < currentQty + 1) return alert('მარაგი არ არის საკმარისი!');

    if (existing) {
      setCart(cart.map(item => item.productId === prod.id ? { ...item, quantity: item.quantity + 1 } : item));
    } else {
      setCart([...cart, { productId: prod.id, name: prod.name, price: prod.price, quantity: 1, maxStock: prod.stock }]);
    }
  };

  const handleAddToCart = (e: React.FormEvent) => {
    e.preventDefault();
    const prod = products.find(p => p.id === Number(selectedProductId));
    if (!prod) return alert('აირჩიეთ პროდუქტი');
    const qty = parseInt(quantity);
    if (qty <= 0 || isNaN(qty)) return alert('არავალიდური რაოდენობა');
    const currentQty = cart.find(item => item.productId === prod.id)?.quantity || 0;
    if (prod.stock < currentQty + qty) return alert('მარაგი არ არის საკმარისი');

    if (currentQty > 0) {
      setCart(cart.map(item => item.productId === prod.id ? { ...item, quantity: item.quantity + qty } : item));
    } else {
      setCart([...cart, { productId: prod.id, name: prod.name, price: prod.price, quantity: qty, maxStock: prod.stock }]);
    }
    setQuantity('1');
  };

  const handleCheckout = async () => {
    if (cart.length === 0) return alert('კალათა ცარიელია!');
    try {
      await axios.post('http://localhost:5000/api/payments', { items: cart });
      alert('გაყიდვა დასრულდა!');
      setCart([]);
      loadProducts();
    } catch (error: any) { alert('გაყიდვა ჩავარდა!'); }
  };

  // ბლოკირებული ეკრანი გამოჩნდება მხოლოდ მაშინ, თუ ცვლა დახურულია და თან Z-Report-ს არ ვუყურებთ
  if (!hasActiveShift && !zReport) {
    return (
      <div className={styles.salesContainer}>
        <div className={styles.blockedScreen}>
          <div className={styles.blockedCard}>
            <h2>🔒 სალარო ბლოკირებულია</h2>
            <p>მუშაობის დასაწყებად აუცილებელია მიმდინარე დღის ცვლის გახსნა.</p>
            <form onSubmit={handleOpenShift}>
              <div className={styles.formGroup}>
                <label>საწყისი ნაღდი ფული სალაროში (₾)</label>
                <input type="number" min="0" value={startAmount} onChange={e => setStartAmount(e.target.value)} className={styles.inputField} />
              </div>
              <button type="submit" className={`${styles.btn} ${styles.btnSuccess}`} style={{ width: '100%', marginTop: '10px' }}>🚀 ცვლის გახსნა</button>
            </form>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className={styles.salesContainer}>
      {/* მთავარი სამუშაო პანელი ჩანს მხოლოდ მაშინ, როცა ცვლა რეალურად აქტიურია */}
      {hasActiveShift && (
        <>
          <div className={styles.topPanel}>
            <div><h2>🛒 გაყიდვების პანელი (POS)</h2><small>ცვლა #{activeShift?.id} | გახსნილია: {activeShift?.opened_at}</small></div>
            <button onClick={() => setShowCloseModal(true)} className={`${styles.btn} ${styles.btnDanger}`}>🛑 ცვლის დახურვა (Z-Report)</button>
          </div>

          <div className={styles.mainGrid}>
            <div className={styles.leftSide}>
              <h3 style={{ marginTop: 0, color: '#475569' }}>პროდუქტის დამატება ჩეკში</h3>
              <form onSubmit={handleAddToCart}>
                <div className={styles.formGroup}><label>აირჩიეთ პროდუქტი</label>
                  <select value={selectedProductId} onChange={e => setSelectedProductId(e.target.value)} className={styles.inputField}>
                    <option value="">-- აირჩიეთ სიიდან --</option>
                    {products.map(p => <option key={p.id} value={p.id} disabled={p.stock <= 0}>{p.name} ({p.price} ₾) — მარაგშია: {p.stock}</option>)}
                  </select>
                </div>
                <div className={styles.formGroup}><label>რაოდენობა</label>
                  <input type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} className={styles.inputField} />
                </div>
                <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} style={{ width: '100%' }}>კალათაში დამატება</button>
              </form>
            </div>

            <div className={styles.rightSide}>
              <h3 style={{ marginTop: 0, color: '#475569' }}>📝 მიმდინარე ჩეკი</h3>
              {cart.length === 0 ? <p style={{ color: '#94a3b8', textAlign: 'center', padding: '20px' }}>კალათა ცარიელია</p> : (
                <>
                  <table className={styles.cartTable}>
                    <thead><tr><th>დასახელება</th><th>ფასი</th><th>რაოდენობა</th><th>ჯამი</th><th></th></tr></thead>
                    <tbody>
                      {cart.map(item => (
                        <tr key={item.productId}><td>{item.name}</td><td>{item.price} ₾</td><td>{item.quantity} ცალი</td><td style={{ fontWeight: 'bold' }}>{(item.price * item.quantity).toFixed(2)} ₾</td>
                          <td><button onClick={() => setCart(cart.filter(i => i.productId !== item.productId))} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>❌</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className={styles.totalSection}><span className={styles.totalLabel}>სულ გადასახდელი:</span><span className={styles.totalValue}>{cart.reduce((s, i) => s + (i.price * i.quantity), 0).toFixed(2)} ₾</span></div>
                  <button onClick={handleCheckout} className={`${styles.btn} ${styles.btnSuccess}`} style={{ width: '100%', padding: '14px', fontSize: '16px' }}>გაყიდვის დასრულება (ჩეკის ბეჭდვა)</button>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* კომბინირებული მოდალი: სადაც ჯერ შეგვყავს ფაქტობრივი თანხა, ხოლო დახურვის შემდეგ იქვე ვხედავთ Z-Report-ს */}
      {showCloseModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalBody}>
            {!zReport ? (
              <>
                <h3>ცვლის დახურვა და ინკასაცია</h3>
                <p>შეიყვანეთ სალაროში არსებული ფაქტობრივი ნაღდი ფული.</p>
                <form onSubmit={handleCloseShift}>
                  <div className={styles.formGroup}><label>💵 ფაქტობრივი ნაღდი ფული (₾)</label>
                    <input type="number" min="0" value={endAmountActual} onChange={e => setEndAmountActual(e.target.value)} className={styles.inputField} />
                  </div>
                  <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                    <button type="button" onClick={() => setShowCloseModal(false)} className={`${styles.btn} ${styles.btnSecondary}`} style={{ flex: 1 }}>გაუქმება</button>
                    <button type="submit" className={`${styles.btn} ${styles.btnDanger}`} style={{ flex: 1 }}>დახურვა</button>
                  </div>
                </form>
              </>
            ) : (
              <div style={{ textAlign: 'center' }}>
                <h3 style={{ color: '#10b981' }}>📊 ცვლა დაიხურა (Z-Report)</h3>
                <div style={{ background: '#f8fafc', padding: '15px', borderRadius: '8px', margin: '20px 0', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>საწყისი:</span> <strong>{Number(zReport.start ?? 0).toFixed(2)} ₾</strong></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>მოსალოდნელი:</span> <strong>{Number(zReport.expected ?? 0).toFixed(2)} ₾</strong></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>ფაქტობრივი:</span> <strong>{Number(zReport.actual ?? 0).toFixed(2)} ₾</strong></div>
                  <hr style={{ border: 'none', borderTop: '1px solid #e2e8f0' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: (zReport.difference ?? 0) < 0 ? '#ef4444' : '#10b981' }}><span>სხვაობა:</span> <strong>{Number(zReport.difference ?? 0).toFixed(2)} ₾</strong></div>
                </div>
                <button onClick={() => { localStorage.removeItem('token'); window.location.reload(); }} className={`${styles.btn} ${styles.btnPrimary}`} style={{ width: '100%' }}>დასრულება და გასვლა</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
