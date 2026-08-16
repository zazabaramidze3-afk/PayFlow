import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { toast } from 'react-hot-toast';
import styles from './Products.module.scss';

// პროდუქტის ტიპის ინტერფეისი
interface Product {
  id: number;
  barcode: string | null;
  name: string;
  price: number;
  stock: number;
}

export default function Products() {
  // ძირითადი სტეიტები (State)
  const [products, setProducts] = useState<Product[]>([]);
  const [barcode, setBarcode] = useState('');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 9;

  // სკანერისა და მოდალური ფანჯრის სტეიტები
  const [scannerModalOpen, setScannerModalOpen] = useState(false);
  const [scannedBarcode, setScannedBarcode] = useState('');
  const [foundProduct, setFoundProduct] = useState<Product | null>(null);
  const [restockQuantity, setRestockQuantity] = useState('');
  const [isNewProductMode, setIsNewProductMode] = useState(false);

  // კრიტიკული ნაშთების სტეიტები
  const [showOnlyLowStock, setShowOnlyLowStock] = useState(false);
  const [lowStockCount, setLowStockCount] = useState(0);
  const barcodeBufferRef = useRef<string>('');

  // ⚠️ Confirm მოდალი (window.confirm()-ის ჩანაცვლება)
  const [confirmModal, setConfirmModal] = useState<{ show: boolean; message: string; onConfirm: (() => void) | null }>({
    show: false,
    message: '',
    onConfirm: null,
  });

  // კლავიატურიდან შტრიხკოდის ავტომატური წაკითხვა
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

  // ამოწურვადი პროდუქტების რაოდენობის ავტომატური გადათვლა
  useEffect(() => {
    if (Array.isArray(products)) {
      const lowItems = products.filter(p => p.stock <= 5);
      setLowStockCount(lowItems.length);
    }
  }, [products]);

  // პროდუქტების წამოღება API-დან
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

  // შტრიხკოდის წაკითხვის და ვალიდაციის ლოგიკა
  const handleBarcodeScanned = async (bCode: string) => {
    const cleanBarcode = bCode.replace(/-/g, ''); // თუ შტრიხკოდში მინუსია, ვშლით
    setScannedBarcode(cleanBarcode);
    setScannerModalOpen(true);
    try {
      const response = await axios.get(`http://localhost:5000/api/products/barcode/${cleanBarcode}`);
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

  // მარაგის შევსება (Restock) სკანერის ფანჯრიდან
  const handleRestockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!foundProduct || !restockQuantity) return;

    const qty = parseInt(restockQuantity);
    if (isNaN(qty) || qty <= 0) {
      toast.error('დასამატებელი რაოდენობა უნდა იყოს 0-ზე მეტი!');
      return;
    }

    try {
      await axios.patch(`http://localhost:5000/api/products/${foundProduct.id}/restock`, {
        quantityToAdd: qty
      });
      setProducts(products.map(p => p.id === foundProduct.id ? { ...p, stock: p.stock + qty } : p));
      toast.success('მარაგი წარმატებით განახლდა!');
      closeScannerModal();
    } catch (err) {
      toast.error('მარაგის განახლება ვერ მოხერხდა!');
    }
  };

  // სკანერით ახალი პროდუქტის დამატების ვალიდაცია
  const handleCreateScannedProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedPrice = parseFloat(price);
    const parsedStock = parseInt(stock);

    if (parsedPrice <= 0) {
      toast.error('პროდუქტის ფასი უნდა იყოს 0-ზე მეტი!');
      return;
    }
    if (parsedStock < 0) {
      toast.error('პროდუქტის მარაგი არ შეიძლება იყოს უარყოფითი!');
      return;
    }

    try {
      const response = await axios.post('http://localhost:5000/api/products', {
        barcode: scannedBarcode, name, price: parsedPrice, stock: parsedStock
      });
      setProducts([...products, response.data]);
      toast.success('პროდუქტი წარმატებით დაემატა!');
      closeScannerModal();
    } catch (error) {
      toast.error('პროდუქტის დამატება ვერ მოხერხდა!');
    }
  };

  // მოდალის დახურვა და გასუფთავება
  const closeScannerModal = () => {
    setScannerModalOpen(false);
    setFoundProduct(null);
    setIsNewProductMode(false);
    setScannedBarcode('');
    setRestockQuantity('');
    setName(''); setPrice(''); setStock(''); setBarcode('');
  };

  // ძირითადი ფორმიდან პროდუქტის დამატება/განახლება მკაცრი ფილტრებით
  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedPrice = parseFloat(price);
    const parsedStock = parseInt(stock);

    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      toast.error('პროდუქტის ფასი უნდა იყოს 0-ზე მეტი!');
      return;
    }
    if (isNaN(parsedStock) || parsedStock < 0) {
      toast.error('პროდუქტის მარაგი არ შეიძლება იყოს უარყოფითი!');
      return;
    }

    const productData = {
      barcode: barcode.trim() || null,
      name,
      price: parsedPrice,
      stock: parsedStock
    };

    try {
      if (editingId) {
        const response = await axios.put(`http://localhost:5000/api/products/${editingId}`, productData);
        setProducts(products.map(p => p.id === editingId ? response.data : p));
        setEditingId(null);
        toast.success('პროდუქტი წარმატებით განახლდა!');
      } else {
        const response = await axios.post('http://localhost:5000/api/products', productData);
        setProducts([...products, response.data]);
        toast.success('პროდუქტი წარმატებით დაემატა!');
      }
      setBarcode(''); setName(''); setPrice(''); setStock('');
    } catch (error) {
      toast.error('შეცდომა მონაცემების შენახვისას!');
    }
  };

  // წაშლის ლოგიკა — ფაქტობრივი წაშლა (გამოიძახება confirm მოდალის დადასტურების შემდეგ)
  const performDelete = async (id: number) => {
    try {
      await axios.delete(`http://localhost:5000/api/products/${id}`);
      setProducts(products.filter(p => p.id !== id));
      toast.success('პროდუქტი წაიშალა');
    } catch (error) {
      toast.error('შეცდომა წაშლისას!');
    }
  };

  const handleDelete = (id: number) => {
    setConfirmModal({
      show: true,
      message: 'ნამდვილად გსურთ ამ პროდუქტის წაშლა?',
      onConfirm: () => performDelete(id),
    });
  };

  const closeConfirmModal = () => setConfirmModal({ show: false, message: '', onConfirm: null });

  // რედაქტირების დაწყება
  const startEdit = (product: Product) => {
    setEditingId(product.id);
    setBarcode(product.barcode || '');
    setName(product.name);
    setPrice(product.price.toString());
    setStock(product.stock.toString());
  };

  // რეპორტების ექსპორტი (Excel / PDF)
  const exportToExcel = async () => {
    try {
      const url = `http://localhost:5000/api/products/export/excel${showOnlyLowStock ? '?type=low' : ''}`;
      const response = await axios.get(url, { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const link = document.createElement('a');
      link.href = window.URL.createObjectURL(blob);
      link.download = `products_report_${showOnlyLowStock ? 'low_stock' : 'all'}.xlsx`;
      link.click();
    } catch (error) {
      toast.error('Excel ექსპორტი ჩავარდა!');
    }
  };

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
      toast.error('PDF ექსპორტი ჩავარდა!');
    }
  };

  const filteredProducts = showOnlyLowStock ? products.filter(p => p.stock <= 5) : products;
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentProducts = Array.isArray(filteredProducts) ? filteredProducts.slice(indexOfFirstItem, indexOfLastItem) : [];
  const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);

  return (
    <div className={styles.page}>

      {/* ჰედერი, ექსპორტის ღილაკები და ფილტრი */}
      <div className={styles.header}>
        <h2 className={styles.heading}>📦 პროდუქტების მართვა</h2>
        <div className={styles.headerActions}>
          <button type="button" onClick={exportToExcel} className={styles.exportExcel}>Excel ექსპორტი</button>
          <button type="button" onClick={exportToPDF} className={styles.exportPdf}>PDF ექსპორტი</button>
          <label className={`${styles.lowStockToggle} ${showOnlyLowStock ? styles.active : ''}`}>
            <input type="checkbox" checked={showOnlyLowStock} onChange={(e) => { setShowOnlyLowStock(e.target.checked); setCurrentPage(1); }} />
            ⚠ მხოლოდ ამოწურვადი ({lowStockCount})
          </label>
        </div>
      </div>

      {/* საინფორმაციო ბანერი კრიტიკულ მარაგებზე */}
      {lowStockCount > 0 && !showOnlyLowStock && (
        <div className={styles.warningBanner}>
          ყურადღება: საწყობში <strong>{lowStockCount} დასახელების</strong> პროდუქტის მარაგი კრიტიკულ ზღვარზეა (5 ცალი ან ნაკლები)!
        </div>
      )}

      {/* პროდუქტის დამატების/რედაქტირების დაცული ფორმა */}
      <form onSubmit={handleSaveProduct} className={styles.form}>
        {/* შტრიხკოდი: ბლოკავს მინუსებს და ასოებს, ტოვებს მხოლოდ ციფრებს */}
        <input type="text" value={barcode} onChange={e => setBarcode(e.target.value.replace(/\D/g, ''))} className={styles.input} placeholder="შტრიხკოდი" />
        {/* დასახელება */}
        <input type="text" value={name} onChange={e => setName(e.target.value)} className={styles.input} placeholder="დასახელება" />
        {/* ფასი: მინიმალური ზღვარია 0.01 ბაზის კანონის შესაბამისად, ბლოკავს მინუსს */}
        <input type="number" step="0.01" min="0.01" value={price} onChange={e => { const val = Number(e.target.value); if (val >= 0 || e.target.value === '') setPrice(e.target.value); }} className={styles.input} placeholder="ფასი" />
        {/* რაოდენობა: მინიმალური ზღვარია 0, ბლოკავს მინუსს კლავიატურიდან და ისრებიდან */}
        <input type="number" min="0" value={stock} onChange={e => { const val = Number(e.target.value); if (val >= 0 || e.target.value === '') setStock(e.target.value); }} className={styles.input} placeholder="რაოდენობა" />

        <button type="submit" className={styles.submitBtn}>
          {editingId ? 'განახლება' : 'დამატება'}
        </button>
      </form>

      {/* პროდუქტების ცხრილი */}
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>ID</th>
              <th>შტრიხკოდი</th>
              <th>დასახელება</th>
              <th>ფასი</th>
              <th>მარაგი</th>
              <th>მოქმედება</th>
            </tr>
          </thead>
          <tbody>
            {currentProducts.length === 0 ? (
              <tr>
                <td colSpan={6} className={styles.emptyState}>პროდუქტები არ მოიძებნა</td>
              </tr>
            ) : (
              currentProducts.map(product => (
                <tr key={product.id}>
                  <td>{product.id}</td>
                  <td><code className={styles.code}>{product.barcode || '-'}</code></td>
                  <td style={{ fontWeight: 500 }}>{product.name}</td>
                  <td>{product.price} ₾</td>
                  <td>
                    <span className={product.stock <= 5 ? styles.stockLow : styles.stockOk}>
                      {product.stock} ცალი
                    </span>
                    {product.stock === 0 ? (
                      <span className={`${styles.stockTag} ${styles.stockTagOut}`}>ამოიწურა</span>
                    ) : product.stock <= 5 ? (
                      <span className={`${styles.stockTag} ${styles.stockTagLow}`}>იცურება</span>
                    ) : null}
                  </td>
                  <td>
                    <div className={styles.rowActions}>
                      <button onClick={() => startEdit(product)} className={styles.editBtn}>რედაქტირება</button>
                      <button onClick={() => handleDelete(product.id)} className={styles.deleteBtn}>წაშლა</button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* პაგინაცია */}
      {totalPages > 1 && (
        <div className={styles.pagination}>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
            <button
              key={page}
              onClick={() => setCurrentPage(page)}
              className={`${styles.pageBtn} ${currentPage === page ? styles.pageBtnActive : ''}`}
            >
              {page}
            </button>
          ))}
        </div>
      )}

      {/* შტრიხკოდების სკანერის დაცული მოდალური ფანჯარა */}
      {scannerModalOpen && (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <h3 className={styles.modalTitle}>🔍 შტრიხკოდი: {scannedBarcode}</h3>
            <button onClick={closeScannerModal} className={styles.modalCloseBtn} aria-label="დახურვა">&times;</button>

            {foundProduct && (
              <form onSubmit={handleRestockSubmit} className={styles.modalForm}>
                <p className={styles.modalText}>ნაპოვნია: <strong>{foundProduct.name}</strong> (მიმდინარე მარაგი: {foundProduct.stock})</p>
                <input type="number" min="1" value={restockQuantity} onChange={e => { const val = Number(e.target.value); if (val >= 0 || e.target.value === '') setRestockQuantity(e.target.value); }} className={styles.modalFullInput} placeholder="რაოდენობა დასამატებლად" required />
                <button type="submit" className={styles.restockBtn}>მარაგის განახლება</button>
              </form>
            )}

            {isNewProductMode && (
              <form onSubmit={handleCreateScannedProduct} className={styles.modalForm}>
                <p className={styles.newProductLabel}>➕ ახალი პროდუქტის რეგისტრაცია</p>
                <input type="text" value={name} onChange={e => setName(e.target.value)} className={styles.modalFullInput} placeholder="დასახელება" required />
                <input type="number" step="0.01" min="0.01" value={price} onChange={e => { const val = Number(e.target.value); if (val >= 0 || e.target.value === '') setPrice(e.target.value); }} className={styles.modalFullInput} placeholder="ფასი" required />
                <input type="number" min="0" value={stock} onChange={e => { const val = Number(e.target.value); if (val >= 0 || e.target.value === '') setStock(e.target.value); }} className={styles.modalFullInput} placeholder="საწყისი მარაგი" required />
                <button type="submit" className={styles.newProductBtn}>ბაზაში დამატება</button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ⚠️ Confirm მოდალი (window.confirm()-ის ჩანაცვლება) */}
      {confirmModal.show && (
        <div className={styles.overlay} style={{ zIndex: 1100 }}>
          <div className={styles.confirmModal}>
            <div className={styles.confirmIcon}>⚠️</div>
            <p className={styles.confirmText}>{confirmModal.message}</p>
            <div className={styles.confirmActions}>
              <button type="button" onClick={closeConfirmModal} className={styles.cancelBtn}>
                გაუქმება
              </button>
              <button type="button" onClick={() => { confirmModal.onConfirm?.(); closeConfirmModal(); }} className={styles.confirmDeleteBtn}>
                დიახ, წაშლა
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
