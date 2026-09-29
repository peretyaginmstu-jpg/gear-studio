/** What the Pro package contains and what it costs. Price 0 = free early access (no payment configured). */
export const proContents = [
  { id: 'stl', title: 'STL высокой детализации', hint: 'Плавные боковины зубьев для печати и обработки' },
  { id: 'dxf', title: 'Контур DXF', hint: 'Для лазера, гидроабразива, электроэрозии' },
  { id: 'pdf', title: 'Размерный лист PDF', hint: 'Три проекции, габариты и параметры' },
  { id: 'passport', title: 'Паспорт модели', hint: 'Все параметры и происхождение данных' },
] as const;

export interface ProOffer { priceRub: number; paymentsEnabled: boolean; source: 'early-access' | 'layers' }
export const earlyAccessOffer: ProOffer = { priceRub: 0, paymentsEnabled: false, source: 'early-access' };
export const priceLabel = (offer: ProOffer) => offer.priceRub > 0 ? `${offer.priceRub.toLocaleString('ru-RU')} ₽` : 'Бесплатно';
