// frontend/src/lib/displayMode.ts
//
// 📱 დაინსტალირებული PWA-ს ("standalone") ამოცნობა. ასეთ რეჟიმში (მაგ. POS
// ტერმინალზე) საჯარო landing გვერდი არ გამოიყენება — მოლარე პირდაპირ აპში უნდა
// მოხვდეს (იხ. index.tsx), ამიტომ landing-ზე დასაბრუნებელი ბმულიც იქ არ ჩანს.

export function isStandalonePwa(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
