import { useState, useEffect, useRef } from 'react';
import axios from 'axios';

interface Product {
  id: number;
  barcode: string | null;
  name: string;
  price: number;
  stock: number;
}

export default function Products() {
  const [products, setProducts] = useState<Product[]>([]);
  const [barcode, setBarcode] = useState('');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 9;

  const [scannerModalOpen, setScannerModalOpen] = useState(false);
  const [scannedBarcode, setScannedBarcode] = useState('');
  const [foundProduct, setFoundProduct] = useState<Product | null>(null);
  const [restockQuantity, setRestockQuantity] = useState('');
  const [isNewProductMode, setIsNewProductMode] = useState(false);
  
  // 🆕 ახალი სტეიტები მინიმალური ნაშთების კონტროლისთვის
  const [showOnlyLowStock, setShowOnlyLowStock] = useState(false);
  const [lowStockCount, setLowStockCount] = useState(0);
  
  const barcodeBufferRef = useRef<string>('');

  useEffect(() => {
    fetchProducts();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' && !scannerModalOpen) return;
      if (e.key === 'Enter') {
        const finalBarcode = barcodeBufferRef.current.trim();
        if (finalBarcode.length > 3) {
          handleBarcodeScanned(finalBarcode);
        }
        barcodeBufferRef.current = '';
      } else {
        if (e.key.length === 1) barcodeBufferRef.current += e.key;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [scannerModalOpen]);

  // 📉 ავტომატურად ვითვლით კრიტიკულ ნაშთებს, როდესაც პროდუქტების სია იცვლება
  useEffect(() => {
    if (Array.isArray(products)) {
      const lowItems = products.filter(p => p.stock <= 5);
      setLowStockCount(lowItems.length);
    }
  }, [products]);

  const fetchProducts = async () => {
    try {
      const response = await axios.get('http://localhost:5000/api/products');
      if (Array.isArray(response.data)) {
        setProducts(response.data);
      } else {
        setProducts([]);
      }
    } catch (error) {
      setProducts([]);
    }
  };
  const handleBarcodeScanned = async (bCode: string) => {
    setScannedBarcode(bCode);
    setScannerModalOpen(true);
    try {
      const response = await axios.get(`http://localhost:5000/api/products/barcode/${bCode}`);
      if (response.data.exists) {
        setFoundProduct(response.data.product);
        setIsNewProductMode(false);
      }
    } catch (error: any) {
      if (error.response && error.response.status === 404) {
        setIsNewProductMode(true);
        setFoundProduct(null);
      } else {
        closeScannerModal();
      }
    }
  };

  const handleRestockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!foundProduct || !restockQuantity) return;
    try {
      await axios.patch(`http://localhost:5000/api/products/${foundProduct.id}/restock`, {
        quantityToAdd: parseInt(restockQuantity)
      });
      setProducts(products.map(p => p.id === foundProduct.id ? { ...p, stock: p.stock + parseInt(restockQuantity) } : p));
      closeScannerModal();
    } catch (err) {
      alert('შეცდომა');
    }
  };

  const handleCreateScannedProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await axios.post('http://localhost:5000/api/products', {
        barcode: scannedBarcode, name, price: parseFloat(price), stock: parseInt(stock)
      });
      setProducts([...products, response.data]);
      closeScannerModal();
    } catch (error) {
      alert('შეცდომა');
    }
  };

  const closeScannerModal = () => {
    setScannerModalOpen(false);
    setFoundProduct(null);
    setIsNewProductMode(false);
    setScannedBarcode('');
    setRestockQuantity('');
    setName('');
    setPrice('');
    setStock('');
    setBarcode('');
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    const productData = { barcode: barcode.trim() || null, name, price: parseFloat(price), stock: parseInt(stock) };
    try {
      if (editingId) {
        const response = await axios.put(`http://localhost:5000/api/products/${editingId}`, productData);
        setProducts(products.map(p => p.id === editingId ? response.data : p));
        setEditingId(null);
      } else {
        const response = await axios.post('http://localhost:5000/api/products', productData);
        setProducts([...products, response.data]);
      }
      setBarcode(''); setName(''); setPrice(''); setStock('');
    } catch (error) {
      alert('შეცდომა');
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('წავშალოთ?')) return;
    try {
      await axios.delete(`http://localhost:5000/api/products/${id}`);
      setProducts(products.filter(p => p.id !== id));
    } catch (error) {
      alert('შეცდომა');
    }
  };

  const startEdit = (product: Product) => {
    setEditingId(product.id);
    setBarcode(product.barcode || '');
    setName(product.name);
    setPrice(product.price.toString());
    setStock(product.stock.toString());
  };

    // Excel გადმოწერა
  const exportToExcel = async () => {
    try {
      // ⚠️ თუ ეკრანზე ჩართულია showOnlyLowStock, ბექენდს გადავცემთ პარამეტრს, რომ მხოლოდ ამოწურვადები ჩაწეროს
      const url = `http://localhost:5000/api/products/export/excel${showOnlyLowStock ? '?type=low' : ''}`;
      const response = await axios.get(url, { responseType: 'blob' });
      
      const blob = new Blob([response.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const link = document.createElement('a');
      link.href = window.URL.createObjectURL(blob);
      link.download = `products_report_${showOnlyLowStock ? 'low_stock' : 'all'}.xlsx`;
      link.click();
    } catch (error) {
      alert('Excel ექსპორტი ჩავარდა');
    }
  };

  // PDF გადმოწერა
  const exportToPDF = async () => {
    try {
      const url = `http://localhost:5000/api/products/export/pdf${showOnlyLowStock ? '?type=low' : ''}`;
      const response = await axios.get(url, { responseType: 'blob' });
      
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const link = document.createElement('a');
      link.href = window.URL.createObjectURL(blob);
      link.download = `products_report_${showOnlyLowStock ? 'low_stock' : 'all'}.pdf`;
      link.click();
    } catch (error) {
      alert('PDF ექსპორტი ჩავარდა');
    }
  };


  // 📉 მონაცემების დინამიური ფილტრაცია მინიმალური ნაშთების მიხედვით
  const filteredProducts = showOnlyLowStock 
    ? products.filter(p => p.stock <= 5) 
    : products;

  // პაგინაციის გამოთვლა გაფილტრულ მასივზე
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentProducts = Array.isArray(filteredProducts) ? filteredProducts.slice(indexOfFirstItem, indexOfLastItem) : [];
  const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      
      {/* 🔝 ჰედერი, ექსპორტის ღილაკები და ფილტრი */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ margin: 0 }}>📦 პროდუქტების მართვა</h2>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Excel ექსპორტის ღილაკი */}
          <button
            type="button"
            onClick={exportToExcel}
            style={{
              background: '#10b981', color: '#fff', border: 'none', padding: '8px 14px',
              borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px',
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
            }}
          >
            🟩 Excel ექსპორტი
          </button>

          {/* PDF ექსპორტის ღილაკი */}
          <button
            type="button"
            onClick={exportToPDF}
            style={{
              background: '#ef4444', color: '#fff', border: 'none', padding: '8px 14px',
              borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px',
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
            }}
          >
            🟥 PDF ექსპორტი
          </button>

          {/* მხოლოდ ამოწურვადი პროდუქტების ფილტრი */}
          <label style={{
            display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer',
            fontSize: '14px', fontWeight: 'bold', color: showOnlyLowStock ? '#dc2626' : '#475569',
            background: showOnlyLowStock ? '#fee2e2' : '#f1f5f9', padding: '8px 12px', borderRadius: '6px',
            border: showOnlyLowStock ? '1px solid #fca5a5' : '1px solid #cbd5e1'
          }}>
            <input
              type="checkbox"
              checked={showOnlyLowStock}
              onChange={(e) => {
                setShowOnlyLowStock(e.target.checked);
                setCurrentPage(1);
              }}
              style={{ cursor: 'pointer' }}
            />
            ⚠️ მხოლოდ ამოწურვადი ({lowStockCount})
          </label>
        </div>
      </div>


      {/* ⚠️ Информационный баннер о критическом уровне запасов */}
      {lowStockCount > 0 && !showOnlyLowStock && (
        <div style={{
          background: '#fff3cd', color: '#856404', padding: '14px 20px', borderRadius: '6px',
          marginBottom: '20px', border: '1px solid #ffeeba', fontSize: '14px', fontWeight: '500'
        }}>
          ყურადღება: საწყობში <strong>{lowStockCount} დასახელების</strong> პროდუქტის მარაგი კრიტიკულ ზღვარზეა (5 ცალი ან ნაკლები)!
        </div>
      )}

      {/* Форма добавления/редактирования товара */}
      <form onSubmit={handleSaveProduct} style={{ background: '#fff', padding: '20px', borderRadius: '8px', marginBottom: '30px', display: 'flex', gap: '15px', alignItems: 'flex-end' }}>
        <input type="text" value={barcode} onChange={e => setBarcode(e.target.value)} style={inputStyle} placeholder="შტრიხკოდი" />
        <input type="text" value={name} onChange={e => setName(e.target.value)} style={inputStyle} placeholder="დასახელება" />
        <input type="number" step="0.01" value={price} onChange={e => setPrice(e.target.value)} style={inputStyle} placeholder="ფასი" />
        <input type="number" value={stock} onChange={e => setStock(e.target.value)} style={inputStyle} placeholder="რაოდენობა" />
        <button type="submit" style={{ background: '#2563eb', color: '#fff', padding: '10px 20px', border: 'none', borderRadius: '6px', height: '40px', cursor: 'pointer', fontWeight: 'bold' }}>{editingId ? 'განახლება' : 'დამატება'}</button>
      </form>

      {/* Таблица товаров */}
      <div style={{ background: '#fff', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
          <thead>
            <tr style={{ background: '#f1f5f9' }}>
              <th style={thTdStyle}>ID</th>
              <th style={thTdStyle}>შტრიხკოდი</th>
              <th style={thTdStyle}>დასახელება</th>
              <th style={thTdStyle}>ფასი</th>
              <th style={thTdStyle}>მარაგი</th>
              <th style={thTdStyle}>მოქმედება</th>
            </tr>
          </thead>
          <tbody>
            {currentProducts.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: '20px', textAlign: 'center', color: '#64748b' }}>პროდუქტები არ მოიძებნა</td>
              </tr>
            ) : (
              currentProducts.map(product => (
                <tr key={product.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={thTdStyle}>{product.id}</td>
                  <td style={thTdStyle}><code>{product.barcode || '-'}</code></td>
                  <td style={thTdStyle, { fontWeight: '500' }}>{product.name}</td>
                  <td style={thTdStyle}>{product.price} ₾</td>
                  
                  {/* 📉 Стилизованная ячейка остатков с цветными бейджами */}
                  <td style={thTdStyle}>
                    <span style={{ fontWeight: 'bold', color: product.stock <= 5 ? '#dc2626' : '#0f172a' }}>
                      {product.stock} ცალი
                    </span>
                    {product.stock === 0 ? (
                      <span style={{ marginLeft: '10px', background: '#fee2e2', color: '#991b1b', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}>🚫 ამოიწურა</span>
                    ) : product.stock <= 5 ? (
                      <span style={{ marginLeft: '10px', background: '#ffedd5', color: '#9a3412', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}>⚠️ იწურება</span>
                    ) : null}
                  </td>

                  <td style={thTdStyle}>
                    <button onClick={() => startEdit(product)} style={{ background: '#eab308', color: '#fff', border: 'none', padding: '6px 12px', marginRight: '5px', cursor: 'pointer', borderRadius: '4px', fontWeight: 'bold' }}>რედაქტირება</button>
                    <button onClick={() => handleDelete(product.id)} style={{ background: '#ef4444', color: '#fff', border: 'none', padding: '6px 12px', cursor: 'pointer', borderRadius: '4px', fontWeight: 'bold' }}>წაშლა</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Пагинация (отображается, если страниц больше одной) */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginTop: '20px' }}>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
            <button
              key={page}
              onClick={() => setCurrentPage(page)}
              style={{
                padding: '8px 12px', borderRadius: '4px', border: '1px solid #cbd5e1', cursor: 'pointer',
                background: currentPage === page ? '#2563eb' : '#fff',
                color: currentPage === page ? '#fff' : '#0f172a',
                fontWeight: 'bold'
              }}
            >
              {page}
            </button>
          ))}
        </div>
      )}

      {/* Модальное окно сканера штрихкодов */}
      {scannerModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', padding: '30px', borderRadius: '12px', width: '400px', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)' }}>
            <h3 style={{ margin: '0 0 15px 0', color: '#1e293b' }}>🎯 შტრიხკოდი: {scannedBarcode}</h3>
            <button onClick={closeScannerModal} style={{ float: 'right', marginTop: '-35px', background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: '#94a3b8' }}>&times;</button>
            
            {foundProduct && (
              <form onSubmit={handleRestockSubmit}>
                <p style={{ fontSize: '15px', color: '#334155' }}>ნაპოვნია: <strong>{foundProduct.name}</strong> (მიმდინარე მარაგი: {foundProduct.stock})</p>
                <input type="number" value={restockQuantity} onChange={e => setRestockQuantity(e.target.value)} style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} placeholder="რაოდენობა დასამატებლად" required />
                <button type="submit" style={{ background: '#16a34a', color: '#fff', width: '100%', padding: '10px', marginTop: '15px', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>მარაგის განახლება</button>
              </form>
            )}

            {isNewProductMode && (
              <form onSubmit={handleCreateScannedProduct} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <p style={{ color: '#b45309', fontWeight: 'bold', margin: '0' }}>➕ ახალი პროდუქტის რეგისტრაცია</p>
                <input type="text" value={name} onChange={e => setName(e.target.value)} style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} placeholder="დასახელება" required />
                <input type="number" step="0.01" value={price} onChange={e => setPrice(e.target.value)} style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} placeholder="ფასი" required />
                <input type="number" value={stock} onChange={e => setStock(e.target.value)} style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} placeholder="საწყისი მარაგი" required />
                <button type="submit" style={{ background: '#d97706', color: '#fff', padding: '10px', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>ბაზაში დამატება</button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const inputStyle = { padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none' };
const thTdStyle = { padding: '12px 15px', textAlign: 'left' as const };
