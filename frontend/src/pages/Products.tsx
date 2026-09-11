import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import styles from './Products.module.scss';
import { ModifierGroupWithOptions, Ingredient, ProductRecipe } from '../lib/horecaTypes';
import { EditIcon, TrashIcon, XIcon } from '../components/Icons';

// 🍳 KDS routing (STEP 2, Roadmap "03.09.2026", migration 020) —
// 'kitchen'|'bar'|null. Retail-ზეც ჩნდება ტიპის დონეზე (backend-ის
// SELECT * ყოველთვის აბრუნებს ამ ველს), მაგრამ UI-ში ჩანს/რედაქტირდება
// მხოლოდ businessType === 'horeca'-ზე (ქვემოთ, ProductsProps).
type ProductStation = 'kitchen' | 'bar' | null;

// პროდუქტის ტიპის ინტერფეისი
interface Product {
  id: number;
  barcode: string | null;
  name: string;
  price: number;
  stock: number;
  station: ProductStation;
  // 🍲 HoReCa STEP 3.2 (BOM, migration 022) — Retail-ზეც ჩნდება
  // ტიპის დონეზე (backend-ის SELECT * ყოველთვის აბრუნებს), მაგრამ
  // UI-ში ჩანს/რედაქტირდება მხოლოდ businessType === 'horeca'-ზე,
  // Modifiers-ის იგივე კონვენციით.
  is_recipe_based: boolean;
}

interface ProductsProps {
  // App.tsx-ის GET /organizations/me-დან უკვე წამოღებული businessType
  // (Tables.tsx/OrderScreen.tsx-ის იგივე მოდელი) — null სანამ ჯერ არ
  // ჩაიტვირთა.
  businessType: 'retail' | 'horeca' | null;
}

// 📥 POST /api/products/import-ის პასუხის ფორმა (backend/src/routes/products.ts)
interface ProductImportSkippedRow {
  rowNumber: number;
  reason: string;
}

interface ProductImportResult {
  importedCount: number;
  skippedCount: number;
  skipped: ProductImportSkippedRow[];
}

export default function Products({ businessType }: ProductsProps) {
  const { t } = useTranslation();
  // ძირითადი სტეიტები (State)
  const [products, setProducts] = useState<Product[]>([]);
  const [barcode, setBarcode] = useState('');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [station, setStation] = useState<ProductStation>(null);
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

  // 📥 Excel Import-ის სტეიტები
  const [importing, setImporting] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importResult, setImportResult] = useState<ProductImportResult | null>(null);
  const importFileInputRef = useRef<HTMLInputElement>(null);

  // ⚠️ Confirm მოდალი (window.confirm()-ის ჩანაცვლება)
  const [confirmModal, setConfirmModal] = useState<{ show: boolean; message: string; onConfirm: (() => void) | null }>({
    show: false,
    message: '',
    onConfirm: null,
  });

  // 🧩 HoReCa Module STEP 3.1 (Roadmap "03.09.2026", migration 021) —
  // მოდიფაიერების ჯგუფების მიბმა კონკრეტულ პროდუქტზე. ჯგუფების/ოფციების
  // CRUD-ი თავად Modifiers.tsx-ზეა (App.tsx-ის ცალკე ნავიგაცია) — აქ
  // მხოლოდ "რომელი ჯგუფებია მიბმული ამ პროდუქტზე" checklist-ია, ხილული
  // მხოლოდ რედაქტირების რეჟიმში (`editingId`-ს სჭირდება — ახალი,
  // ჯერ-არ-შენახული პროდუქტისთვის PUT /modifiers/products/:id-ს
  // მოსამართებელი id არ არსებობს).
  const [allModifierGroups, setAllModifierGroups] = useState<ModifierGroupWithOptions[]>([]);
  const [attachedGroupIds, setAttachedGroupIds] = useState<string[]>([]);
  const [modifiersLoadingForProduct, setModifiersLoadingForProduct] = useState(false);
  const [modifiersSaving, setModifiersSaving] = useState(false);

  const fetchAllModifierGroups = useCallback(async () => {
    try {
      const response = await axios.get<ModifierGroupWithOptions[]>('/api/modifiers/groups');
      setAllModifierGroups(response.data);
    } catch {
      // 🩹 მოდიფაიერების checklist უბრალოდ ცარიელი დარჩება — Products-ის
      // ძირითადი CRUD ფუნქციონალი ამაზე დამოკიდებული არაა.
    }
  }, []);

  useEffect(() => {
    if (businessType === 'horeca') fetchAllModifierGroups();
  }, [businessType, fetchAllModifierGroups]);

  // 🍲 HoReCa Module STEP 3.2 (Roadmap "03.09.2026", migration 022) —
  // რეცეპტის (BOM) მართვა კონკრეტულ პროდუქტზე. ინგრედიენტების CRUD-ი
  // თავად Ingredients.tsx-ზეა (App.tsx-ის ცალკე ნავიგაცია) — აქ მხოლოდ
  // "რა შედის ამ პროდუქტის რეცეპტში" რედაქტორია, Modifiers-ის attached-
  // groups checklist-ის იგივე პრინციპით (მხოლოდ რედაქტირების რეჟიმში).
  const [allIngredients, setAllIngredients] = useState<Ingredient[]>([]);
  const [isRecipeBased, setIsRecipeBased] = useState(false);
  const [recipeRows, setRecipeRows] = useState<{ ingredientId: string; quantityRequired: string }[]>([]);
  const [recipeLoadingForProduct, setRecipeLoadingForProduct] = useState(false);
  const [recipeSaving, setRecipeSaving] = useState(false);

  const fetchAllIngredients = useCallback(async () => {
    try {
      const response = await axios.get<Ingredient[]>('/api/ingredients');
      setAllIngredients(response.data);
    } catch {
      // 🩹 რეცეპტის რედაქტორი უბრალოდ ცარიელი დარჩება — Products-ის
      // ძირითადი CRUD ფუნქციონალი ამაზე დამოკიდებული არაა.
    }
  }, []);

  useEffect(() => {
    if (businessType === 'horeca') fetchAllIngredients();
  }, [businessType, fetchAllIngredients]);

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
      const response = await axios.get('/api/products');
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
      const response = await axios.get(`/api/products/barcode/${cleanBarcode}`);
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
      toast.error(t('products.toasts.restockQuantityInvalid'));
      return;
    }

    try {
      await axios.patch(`/api/products/${foundProduct.id}/restock`, {
        quantityToAdd: qty
      });
      setProducts(products.map(p => p.id === foundProduct.id ? { ...p, stock: p.stock + qty } : p));
      toast.success(t('products.toasts.restockSuccess'));
      closeScannerModal();
    } catch (err) {
      toast.error(t('products.toasts.restockFailed'));
    }
  };

  // სკანერით ახალი პროდუქტის დამატების ვალიდაცია
  const handleCreateScannedProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedPrice = parseFloat(price);
    const parsedStock = parseInt(stock);

    if (parsedPrice <= 0) {
      toast.error(t('products.toasts.priceInvalid'));
      return;
    }
    if (parsedStock < 0) {
      toast.error(t('products.toasts.stockInvalid'));
      return;
    }

    try {
      const response = await axios.post('/api/products', {
        barcode: scannedBarcode, name, price: parsedPrice, stock: parsedStock
      });
      setProducts([...products, response.data]);
      toast.success(t('products.toasts.productAdded'));
      closeScannerModal();
    } catch (error) {
      toast.error(t('products.toasts.productAddFailed'));
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
      toast.error(t('products.toasts.priceInvalid'));
      return;
    }
    if (isNaN(parsedStock) || parsedStock < 0) {
      toast.error(t('products.toasts.stockInvalid'));
      return;
    }

    const productData = {
      barcode: barcode.trim() || null,
      name,
      price: parsedPrice,
      stock: parsedStock,
      // 🍳 KDS routing (STEP 2) — მხოლოდ HoReCa-ზეა რედაქტირებადი
      // (ქვემოთ, ფორმის JSX); Retail-ზე ველი ყოველთვის null-ია.
      station: businessType === 'horeca' ? (station || null) : null,
    };

    try {
      if (editingId) {
        const response = await axios.put(`/api/products/${editingId}`, productData);
        setProducts(products.map(p => p.id === editingId ? response.data : p));
        setEditingId(null);
        toast.success(t('products.toasts.productUpdated'));
      } else {
        const response = await axios.post('/api/products', productData);
        setProducts([...products, response.data]);
        toast.success(t('products.toasts.productAdded'));
      }
      setBarcode(''); setName(''); setPrice(''); setStock(''); setStation(null);
    } catch (error) {
      toast.error(t('products.toasts.saveFailed'));
    }
  };

  // წაშლის ლოგიკა — ფაქტობრივი წაშლა (გამოიძახება confirm მოდალის დადასტურების შემდეგ)
  const performDelete = async (id: number) => {
    try {
      await axios.delete(`/api/products/${id}`);
      setProducts(products.filter(p => p.id !== id));
      toast.success(t('products.toasts.productDeleted'));
    } catch (error) {
      toast.error(t('products.toasts.deleteFailed'));
    }
  };

  const handleDelete = (id: number) => {
    setConfirmModal({
      show: true,
      message: t('products.confirmModal.deleteMessage'),
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
    setStation(product.station);

    // 🧩 STEP 3.1 — ამ პროდუქტზე უკვე მიბმული ჯგუფების წამოღება.
    if (businessType === 'horeca') {
      setModifiersLoadingForProduct(true);
      axios
        .get<ModifierGroupWithOptions[]>(`/api/modifiers/products/${product.id}`)
        .then(response => setAttachedGroupIds(response.data.map(g => g.id)))
        .catch(() => setAttachedGroupIds([]))
        .finally(() => setModifiersLoadingForProduct(false));

      // 🍲 STEP 3.2 — ამ პროდუქტის უკვე არსებული რეცეპტის წამოღება.
      setRecipeLoadingForProduct(true);
      axios
        .get<ProductRecipe>(`/api/products/${product.id}/recipe`)
        .then(response => {
          setIsRecipeBased(response.data.isRecipeBased);
          setRecipeRows(
            response.data.items.map(item => ({
              ingredientId: item.ingredient_id,
              quantityRequired: String(item.quantity_required),
            }))
          );
        })
        .catch(() => {
          setIsRecipeBased(false);
          setRecipeRows([]);
        })
        .finally(() => setRecipeLoadingForProduct(false));
    } else {
      setAttachedGroupIds([]);
      setIsRecipeBased(false);
      setRecipeRows([]);
    }
  };

  // 🧩 STEP 3.1 — checklist-ის toggle + შენახვა (PUT /modifiers/products/:id,
  // სრული ჩანაცვლების ენდპოინტი — modifiers.ts-ის კომენტარი).
  const toggleModifierGroup = (groupId: string) => {
    setAttachedGroupIds(prev => (prev.includes(groupId) ? prev.filter(id => id !== groupId) : [...prev, groupId]));
  };

  const handleSaveModifiers = async () => {
    if (!editingId) return;
    setModifiersSaving(true);
    try {
      await axios.put(`/api/modifiers/products/${editingId}`, { modifierGroupIds: attachedGroupIds });
      toast.success(t('products.toasts.modifiersSaved'));
    } catch (error) {
      toast.error(t('products.toasts.modifiersSaveFailed'));
    } finally {
      setModifiersSaving(false);
    }
  };

  // 🍲 STEP 3.2 — რეცეპტის ხაზების რედაქტორი (Modifiers.tsx-ის
  // ინლაინ ოფცია-ფორმის იგივე პრინციპი, ოღონდ ერთდროულად ბევრი ხაზი).
  const addRecipeRow = () => {
    setRecipeRows(prev => [...prev, { ingredientId: '', quantityRequired: '' }]);
  };

  const updateRecipeRow = (index: number, field: 'ingredientId' | 'quantityRequired', value: string) => {
    setRecipeRows(prev => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  const removeRecipeRow = (index: number) => {
    setRecipeRows(prev => prev.filter((_, i) => i !== index));
  };

  const handleSaveRecipe = async () => {
    if (!editingId) return;

    // 🩹 თითო ხაზს სჭირდება არჩეული ინგრედიენტი და დადებითი
    // რაოდენობა — Modifiers.tsx-ის price_delta-ვალიდაციის იგივე
    // "ცხადი toast, არა generic 400" პრინციპი.
    if (isRecipeBased) {
      for (const row of recipeRows) {
        const qty = Number(row.quantityRequired);
        if (!row.ingredientId || !Number.isFinite(qty) || qty <= 0) {
          toast.error(t('products.toasts.recipeRowInvalid'));
          return;
        }
      }
    }

    setRecipeSaving(true);
    try {
      await axios.put(`/api/products/${editingId}/recipe`, {
        isRecipeBased,
        items: isRecipeBased
          ? recipeRows.map(row => ({ ingredientId: row.ingredientId, quantityRequired: Number(row.quantityRequired) }))
          : [],
      });
      toast.success(t('products.toasts.recipeSaved'));
      fetchProducts();
    } catch (error) {
      toast.error(t('products.toasts.recipeSaveFailed'));
    } finally {
      setRecipeSaving(false);
    }
  };

  // 📥 Excel Import — ფაილის input-ის (დამალული) გახსნა ღილაკზე დაჭერით
  const handleImportClick = () => {
    importFileInputRef.current?.click();
  };

  // 📥 Excel Import — არჩეული .xlsx ფაილის ატვირთვა backend-ზე
  // (POST /products/import — PLAN - Product Excel Import & Dark Mode -
  // 02.09.2026.md-ის partial-import მიდგომა: importedCount/skippedCount
  // report-ის ჩვენება, დამატებულების სიის fetchProducts-ით განახლება).
  const handleImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // იგივე ფაილის ხელახლა არჩევის დაშვება
    if (!file) return;

    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await axios.post<ProductImportResult>('/api/products/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setImportResult(response.data);
      setImportModalOpen(true);

      if (response.data.importedCount > 0) {
        toast.success(t('products.toasts.importSuccess', { count: response.data.importedCount }));
        fetchProducts();
      } else if (response.data.skippedCount > 0) {
        toast.error(t('products.toasts.importAllSkipped'));
      }
    } catch (error: any) {
      const message = error?.response?.data?.error || t('products.toasts.importFailedFallback');
      toast.error(message);
    } finally {
      setImporting(false);
    }
  };

  const closeImportModal = () => {
    setImportModalOpen(false);
    setImportResult(null);
  };

  // 📥 Excel Import — ცარიელი ნიმუშის (template) ჩამოტვირთვა
  const downloadImportTemplate = async () => {
    try {
      const response = await axios.get('/api/products/import/template', { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const link = document.createElement('a');
      link.href = window.URL.createObjectURL(blob);
      link.download = 'product_import_template.xlsx';
      link.click();
    } catch (error) {
      toast.error(t('products.toasts.templateDownloadFailed'));
    }
  };

  // რეპორტების ექსპორტი (Excel / PDF)
  const exportToExcel = async () => {
    try {
      const url = `/api/products/export/excel${showOnlyLowStock ? '?type=low' : ''}`;
      const response = await axios.get(url, { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const link = document.createElement('a');
      link.href = window.URL.createObjectURL(blob);
      link.download = `products_report_${showOnlyLowStock ? 'low_stock' : 'all'}.xlsx`;
      link.click();
    } catch (error) {
      toast.error(t('products.toasts.excelExportFailed'));
    }
  };

  const exportToPDF = async () => {
    try {
      const url = `/api/products/export/pdf${showOnlyLowStock ? '?type=low' : ''}`;
      const response = await axios.get(url, { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const link = document.createElement('a');
      link.href = window.URL.createObjectURL(blob);
      link.download = `products_report_${showOnlyLowStock ? 'low_stock' : 'all'}.pdf`;
      link.click();
    } catch (error) {
      toast.error(t('products.toasts.pdfExportFailed'));
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
        <h2 className={styles.heading}>{t('products.pageTitle')}</h2>
        <div className={styles.headerActions}>
          <button type="button" onClick={downloadImportTemplate} className={styles.importTemplateLink}>{t('products.downloadTemplateBtn')}</button>
          <button type="button" onClick={handleImportClick} className={styles.importBtn} disabled={importing}>
            {importing ? t('nav.loading') : t('products.importBtn')}
          </button>
          <input
            type="file"
            ref={importFileInputRef}
            onChange={handleImportFileChange}
            accept=".xlsx"
            style={{ display: 'none' }}
          />
          <button type="button" onClick={exportToExcel} className={styles.exportExcel}>{t('products.exportExcelBtn')}</button>
          <button type="button" onClick={exportToPDF} className={styles.exportPdf}>{t('products.exportPdfBtn')}</button>
          <label className={`${styles.lowStockToggle} ${showOnlyLowStock ? styles.active : ''}`}>
            <input type="checkbox" checked={showOnlyLowStock} onChange={(e) => { setShowOnlyLowStock(e.target.checked); setCurrentPage(1); }} />
            {t('products.lowStockToggle', { count: lowStockCount })}
          </label>
        </div>
      </div>

      {/* საინფორმაციო ბანერი კრიტიკულ მარაგებზე */}
      {lowStockCount > 0 && !showOnlyLowStock && (
        <div className={styles.warningBanner}>
          {t('products.lowStockWarning', { count: lowStockCount })}
        </div>
      )}

      {/* პროდუქტის დამატების/რედაქტირების დაცული ფორმა */}
      <form onSubmit={handleSaveProduct} className={styles.form}>
        {/* შტრიხკოდი: ბლოკავს მინუსებს და ასოებს, ტოვებს მხოლოდ ციფრებს */}
        <input type="text" value={barcode} onChange={e => setBarcode(e.target.value.replace(/\D/g, ''))} className={styles.input} placeholder={t('products.barcodePlaceholder')} />
        {/* დასახელება */}
        <input type="text" value={name} onChange={e => setName(e.target.value)} className={styles.input} placeholder={t('products.namePlaceholder')} />
        {/* ფასი: მინიმალური ზღვარია 0.01 ბაზის კანონის შესაბამისად, ბლოკავს მინუსს */}
        <input type="number" step="0.01" min="0.01" value={price} onChange={e => { const val = Number(e.target.value); if (val >= 0 || e.target.value === '') setPrice(e.target.value); }} className={styles.input} placeholder={t('products.pricePlaceholder')} />
        {/* რაოდენობა: მინიმალური ზღვარია 0, ბლოკავს მინუსს კლავიატურიდან და ისრებიდან */}
        <input type="number" min="0" value={stock} onChange={e => { const val = Number(e.target.value); if (val >= 0 || e.target.value === '') setStock(e.target.value); }} className={styles.input} placeholder={t('products.stockPlaceholder')} />
        {/* 🍳 KDS routing (STEP 2, Roadmap "03.09.2026") — მხოლოდ HoReCa
            ორგანიზაციაში ჩანს. აქ განისაზღვრება, სად გაეგზავნება item
            KDS-ზე (KitchenDisplay.tsx) დამატებისთანავე. */}
        {businessType === 'horeca' && (
          <select
            value={station ?? ''}
            onChange={e => setStation((e.target.value || null) as ProductStation)}
            className={styles.input}
          >
            <option value="">{t('products.station.none')}</option>
            <option value="kitchen">{t('products.station.kitchen')}</option>
            <option value="bar">{t('products.station.bar')}</option>
          </select>
        )}

        <button type="submit" className={styles.submitBtn}>
          {editingId ? t('products.updateBtn') : t('products.addBtn')}
        </button>
      </form>

      {/* 🧩 STEP 3.1 (მოდიფაიერები, Roadmap "03.09.2026") — რომელი
          ჯგუფებია მიბმული ამ პროდუქტზე. მხოლოდ HoReCa-ზე და მხოლოდ
          უკვე-არსებული (რედაქტირებადი) პროდუქტისთვის ჩანს — ჯგუფების
          შექმნა/რედაქტირება "🧩 მოდიფაიერები" ცალკე გვერდზეა. */}
      {businessType === 'horeca' && editingId && (
        <div className={styles.modifierPanel}>
          <h3 className={styles.modifierPanelTitle}>{t('products.modifierPanel.title')}</h3>
          {allModifierGroups.length === 0 ? (
            <p className={styles.emptyState}>
              {t('products.modifierPanel.noGroups')}
            </p>
          ) : modifiersLoadingForProduct ? (
            <p className={styles.emptyState}>{t('nav.loading')}</p>
          ) : (
            <>
              <div className={styles.modifierChecklist}>
                {allModifierGroups.map(group => (
                  <label key={group.id} className={styles.modifierCheckItem}>
                    <input
                      type="checkbox"
                      checked={attachedGroupIds.includes(group.id)}
                      onChange={() => toggleModifierGroup(group.id)}
                    />
                    {group.name}
                    {group.is_required && <span className={styles.stockTag} style={{ background: '#FEF3C7', color: '#92400E' }}>{t('products.modifierPanel.requiredTag')}</span>}
                  </label>
                ))}
              </div>
              <button type="button" onClick={handleSaveModifiers} disabled={modifiersSaving} className={styles.submitBtn} style={{ marginTop: '12px' }}>
                {modifiersSaving ? t('products.savingEllipsis') : t('products.modifierPanel.saveBtn')}
              </button>
            </>
          )}
        </div>
      )}

      {/* 🍲 STEP 3.2 (რეცეპტი/BOM, Roadmap "03.09.2026") — ეს პროდუქტი
          ნედლეულისგან მზადდება თუ არა (მაგ. სტეიკი), და თუ კი — რომელი
          ინგრედიენტი რა რაოდენობით სჭირდება. false-ზე products.stock
          ძველებურად მუშაობს (მაგ. სასმელი). ინგრედიენტების CRUD
          "🍲 ინგრედიენტები" ცალკე გვერდზეა. */}
      {businessType === 'horeca' && editingId && (
        <div className={styles.modifierPanel}>
          <h3 className={styles.modifierPanelTitle}>{t('products.recipePanel.title')}</h3>
          <label className={styles.modifierCheckItem} style={{ marginBottom: '10px' }}>
            <input
              type="checkbox"
              checked={isRecipeBased}
              onChange={e => setIsRecipeBased(e.target.checked)}
            />
            {t('products.recipePanel.recipeBasedLabel')}
          </label>

          {isRecipeBased && (
            recipeLoadingForProduct ? (
              <p className={styles.emptyState}>{t('nav.loading')}</p>
            ) : allIngredients.length === 0 ? (
              <p className={styles.emptyState}>
                {t('products.recipePanel.noIngredients')}
              </p>
            ) : (
              <>
                {recipeRows.map((row, index) => (
                  <div key={index} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                    <select
                      value={row.ingredientId}
                      onChange={e => updateRecipeRow(index, 'ingredientId', e.target.value)}
                      className={styles.input}
                      style={{ flex: 2 }}
                    >
                      <option value="">{t('products.recipePanel.selectIngredientPlaceholder')}</option>
                      {allIngredients.map(ingredient => (
                        <option key={ingredient.id} value={ingredient.id}>
                          {ingredient.name} ({ingredient.unit})
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      value={row.quantityRequired}
                      onChange={e => { const v = Number(e.target.value); if (v >= 0 || e.target.value === '') updateRecipeRow(index, 'quantityRequired', e.target.value); }}
                      className={styles.input}
                      style={{ flex: 1 }}
                      placeholder={t('products.stockPlaceholder')}
                    />
                    <button type="button" onClick={() => removeRecipeRow(index)} className={styles.iconBtn} aria-label={t('products.recipePanel.removeIngredientAria')}><XIcon /></button>
                  </div>
                ))}
                <button type="button" onClick={addRecipeRow} className={styles.addRowBtn} style={{ marginBottom: '12px' }}>
                  {t('products.recipePanel.addRowBtn')}
                </button>
              </>
            )
          )}

          <div>
            <button type="button" onClick={handleSaveRecipe} disabled={recipeSaving} className={styles.submitBtn} style={{ marginTop: '4px' }}>
              {recipeSaving ? t('products.savingEllipsis') : t('products.recipePanel.saveBtn')}
            </button>
          </div>
        </div>
      )}

      {/* პროდუქტების ცხრილი */}
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>ID</th>
              <th>{t('products.barcodePlaceholder')}</th>
              <th>{t('products.namePlaceholder')}</th>
              <th>{t('products.pricePlaceholder')}</th>
              <th>{t('products.table.stock')}</th>
              <th>{t('products.table.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {currentProducts.length === 0 ? (
              <tr>
                <td colSpan={6} className={styles.emptyState}>{t('products.table.emptyState')}</td>
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
                      {product.stock} {t('dashboard.unitPcs')}
                    </span>
                    {product.stock === 0 ? (
                      <span className={`${styles.stockTag} ${styles.stockTagOut}`}>{t('products.table.outOfStock')}</span>
                    ) : product.stock <= 5 ? (
                      <span className={`${styles.stockTag} ${styles.stockTagLow}`}>{t('products.table.lowStock')}</span>
                    ) : null}
                  </td>
                  <td>
                    <div className={styles.rowActions}>
                      <button onClick={() => startEdit(product)} className={styles.iconBtn} aria-label={t('common.edit')}><EditIcon /></button>
                      <button onClick={() => handleDelete(product.id)} className={styles.iconBtn} aria-label={t('common.delete')}><TrashIcon /></button>
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
            <h3 className={styles.modalTitle}>{t('products.scannerModal.title', { code: scannedBarcode })}</h3>
            <button onClick={closeScannerModal} className={styles.modalCloseBtn} aria-label={t('common.close')}>&times;</button>

            {foundProduct && (
              <form onSubmit={handleRestockSubmit} className={styles.modalForm}>
                <p className={styles.modalText}>{t('products.scannerModal.foundLabel')} <strong>{foundProduct.name}</strong> {t('products.scannerModal.currentStockSuffix', { stock: foundProduct.stock })}</p>
                <input type="number" min="1" value={restockQuantity} onChange={e => { const val = Number(e.target.value); if (val >= 0 || e.target.value === '') setRestockQuantity(e.target.value); }} className={styles.modalFullInput} placeholder={t('products.scannerModal.restockQuantityPlaceholder')} required />
                <button type="submit" className={styles.restockBtn}>{t('products.scannerModal.restockSubmitBtn')}</button>
              </form>
            )}

            {isNewProductMode && (
              <form onSubmit={handleCreateScannedProduct} className={styles.modalForm}>
                <p className={styles.newProductLabel}>{t('products.scannerModal.newProductLabel')}</p>
                <input type="text" value={name} onChange={e => setName(e.target.value)} className={styles.modalFullInput} placeholder={t('products.namePlaceholder')} required />
                <input type="number" step="0.01" min="0.01" value={price} onChange={e => { const val = Number(e.target.value); if (val >= 0 || e.target.value === '') setPrice(e.target.value); }} className={styles.modalFullInput} placeholder={t('products.pricePlaceholder')} required />
                <input type="number" min="0" value={stock} onChange={e => { const val = Number(e.target.value); if (val >= 0 || e.target.value === '') setStock(e.target.value); }} className={styles.modalFullInput} placeholder={t('products.scannerModal.initialStockPlaceholder')} required />
                <button type="submit" className={styles.newProductBtn}>{t('products.scannerModal.addToDbBtn')}</button>
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
                {t('common.cancel')}
              </button>
              <button type="button" onClick={() => { confirmModal.onConfirm?.(); closeConfirmModal(); }} className={styles.confirmDeleteBtn}>
                {t('products.confirmModal.confirmDeleteBtn')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 📥 Excel Import-ის შედეგის მოდალი */}
      {importModalOpen && importResult && (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <h3 className={styles.modalTitle}>{t('products.importModal.title')}</h3>
            <button onClick={closeImportModal} className={styles.modalCloseBtn} aria-label={t('common.close')}>&times;</button>

            <p className={styles.modalText}>
              {t('products.importModal.importedLabel')} <strong>{importResult.importedCount}</strong>
              {' '}&nbsp;|&nbsp;{' '}
              {t('products.importModal.skippedLabel')} <strong>{importResult.skippedCount}</strong>
            </p>

            {importResult.skipped.length > 0 && (
              <div className={styles.importSkippedList}>
                {importResult.skipped.map((row) => (
                  <div key={row.rowNumber} className={styles.importSkippedRow}>
                    <span className={styles.importSkippedRowNumber}>{t('products.importModal.rowLabel', { number: row.rowNumber })}</span>
                    <span>{row.reason}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
