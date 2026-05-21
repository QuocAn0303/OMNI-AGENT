export const getDashboardTour = (t) => [
  {
    target: '.stat-grid',
    content: t('tour.dashboard.kpi'),
    placement: 'bottom',
    disableBeacon: true,
  },
  {
    target: '.dashboard-grid',
    content: t('tour.dashboard.charts'),
    placement: 'bottom',
  },
  {
    target: '.table-card',
    content: t('tour.dashboard.lowStock'),
    placement: 'top',
  },
];

export const getPosTour = (t) => [
  {
    target: '.pos-products__search',
    content: t('tour.pos.search'),
    placement: 'bottom',
    disableBeacon: true,
  },
  {
    target: '.pos-products__grid',
    content: t('tour.pos.grid'),
    placement: 'right',
  },
  {
    target: '.pos-cart',
    content: t('tour.pos.cart'),
    placement: 'left',
  },
];

export const getProductsTour = (t) => [
  {
    target: '.page-header',
    content: t('tour.products.header'),
    placement: 'bottom',
    disableBeacon: true,
  },
  {
    target: '.filters-bar',
    content: t('tour.products.filters'),
    placement: 'bottom',
  },
  {
    target: '.table-card',
    content: t('tour.products.table'),
    placement: 'top',
  },
];

export const getOrdersTour = (t) => [
  {
    target: '.page-header',
    content: t('tour.orders.header'),
    placement: 'bottom',
    disableBeacon: true,
  },
  {
    target: '.filters-bar',
    content: t('tour.orders.filters'),
    placement: 'bottom',
  },
  {
    target: '.table-card',
    content: t('tour.orders.table'),
    placement: 'top',
  },
];

export const getInventoryTour = (t) => [
  {
    target: '.page-header',
    content: t('tour.inventory.header'),
    placement: 'bottom',
    disableBeacon: true,
  },
  {
    target: '.ant-tabs-nav',
    content: t('tour.inventory.tabs'),
    placement: 'bottom',
  },
];
