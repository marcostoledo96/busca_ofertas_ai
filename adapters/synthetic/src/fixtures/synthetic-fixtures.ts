import type { SyntheticListingFixture } from '../types.js';

/**
 * 100% synthetic listing fixtures for offline pipeline testing, contract verification, and demo execution.
 *
 * Invariants:
 * - Deterministic, non-random IDs and non-routable .invalid URLs (RFC 2606).
 * - Zero real personal data (no real names, phones, emails, real Facebook URLs, cookies, or tokens).
 * - Raw price text preserving currency ambiguity ($300, ARS, USD, deposit, installments).
 * - Intentional cross-query duplicates (e.g. syn-001 across "Nintendo Switch Lite", "Switch Lite", "Nintendo Lite").
 * - Diverse sample covering potentially valid, ambiguous, and future rejectable categories.
 */
export const SYNTHETIC_FIXTURES: readonly SyntheticListingFixture[] = [
  // 1. Potentially Valid: ARS 250.000 (Turquoise)
  {
    externalId: 'syn-001',
    canonicalUrl: 'https://synthetic.invalid/listings/syn-001',
    title: 'Nintendo Switch Lite Turquesa usada',
    description:
      'Consola Nintendo Switch Lite color turquesa en excelente estado con cargador original y funda.',
    rawPriceText: 'ARS 250.000',
    sourceCurrencyCode: 'ARS',
    rawLocationText: 'Capital Federal, AMBA',
    rawConditionText: 'Used - Like New',
    rawAvailabilityText: 'In Stock',
    imageUrls: [
      'https://synthetic.invalid/images/syn-001-1.jpg',
      'https://synthetic.invalid/images/syn-001-2.jpg',
    ],
    matchingQueries: ['nintendo switch lite', 'switch lite', 'nintendo lite'],
    sellerInfo: { sellerType: 'individual', verified: false },
    attributes: { color: 'turquoise', condition: 'like_new', includesCharger: true },
    sourceMetadata: { category: 'video_games_consoles', locationId: 'loc-amba-caba' },
  },

  // 2. Potentially Valid: $ 250.000 pesos (Coral)
  {
    externalId: 'syn-002',
    canonicalUrl: 'https://synthetic.invalid/listings/syn-002',
    title: 'Nintendo Switch Lite Coral impecable',
    description:
      'Nintendo Switch Lite Coral como nueva, muy poco uso con cargador y memoria microSD 128GB.',
    rawPriceText: '$ 250.000 pesos',
    sourceCurrencyCode: 'ARS',
    rawLocationText: 'Palermo, Capital Federal',
    rawConditionText: 'Used - Like New',
    rawAvailabilityText: 'In Stock',
    imageUrls: ['https://synthetic.invalid/images/syn-002-1.jpg'],
    matchingQueries: ['nintendo switch lite'],
    sellerInfo: { sellerType: 'individual', verified: false },
    attributes: { color: 'coral', condition: 'like_new', includesCharger: true },
    sourceMetadata: { category: 'video_games_consoles', locationId: 'loc-amba-palermo' },
  },

  // 3. Potentially Valid: USD 300 (Yellow)
  {
    externalId: 'syn-003',
    canonicalUrl: 'https://synthetic.invalid/listings/syn-003',
    title: 'Consola portátil Nintendo Lite Amarilla',
    description:
      'Consola portátil Nintendo Switch Lite amarilla con protector de pantalla y estuche.',
    rawPriceText: 'USD 300',
    sourceCurrencyCode: 'USD',
    rawLocationText: 'Belgrano, Capital Federal',
    rawConditionText: 'Used - Good',
    rawAvailabilityText: 'In Stock',
    imageUrls: ['https://synthetic.invalid/images/syn-003-1.jpg'],
    matchingQueries: ['switch lite', 'nintendo lite'],
    sellerInfo: { sellerType: 'individual', verified: false },
    attributes: { color: 'yellow', condition: 'good', includesCharger: true },
    sourceMetadata: { category: 'video_games_consoles', locationId: 'loc-amba-belgrano' },
  },

  // 4. Potentially Valid: US$ 300 (Gray)
  {
    externalId: 'syn-004',
    canonicalUrl: 'https://synthetic.invalid/listings/syn-004',
    title: 'Nintendo Switch Lite Gris completa',
    description:
      'Consola Switch Lite gris completa en caja original con manuales y cargador de fábrica.',
    rawPriceText: 'US$ 300',
    sourceCurrencyCode: 'USD',
    rawLocationText: 'Caballito, Capital Federal',
    rawConditionText: 'Used - Like New',
    rawAvailabilityText: 'In Stock',
    imageUrls: ['https://synthetic.invalid/images/syn-004-1.jpg'],
    matchingQueries: ['nintendo switch lite', 'nintendo lite'],
    sellerInfo: { sellerType: 'individual', verified: false },
    attributes: { color: 'gray', condition: 'like_new', includesBox: true },
    sourceMetadata: { category: 'video_games_consoles', locationId: 'loc-amba-caballito' },
  },

  // 5. Ambiguous: $300 without explicit currency code
  {
    externalId: 'syn-005',
    canonicalUrl: 'https://synthetic.invalid/listings/syn-005',
    title: 'Switch Lite - $300',
    description: 'Switch Lite en caja impecable $300 billete o transferencia consultar.',
    rawPriceText: '$300',
    sourceCurrencyCode: null,
    rawLocationText: 'San Isidro, Buenos Aires',
    rawConditionText: 'Used - Like New',
    rawAvailabilityText: 'In Stock',
    imageUrls: ['https://synthetic.invalid/images/syn-005-1.jpg'],
    matchingQueries: ['nintendo switch lite', 'switch lite'],
    sellerInfo: { sellerType: 'individual', verified: false },
    attributes: { condition: 'like_new' },
    sourceMetadata: { category: 'video_games_consoles', locationId: 'loc-amba-san-isidro' },
  },

  // 6. Ambiguous: 250000 without currency symbol or code
  {
    externalId: 'syn-006',
    canonicalUrl: 'https://synthetic.invalid/listings/syn-006',
    title: 'Consola Switch Lite sin especificar moneda',
    description: 'Consola Nintendo Switch Lite funcionando bien, consultar precio.',
    rawPriceText: '250000',
    sourceCurrencyCode: null,
    rawLocationText: 'Vicente Lopez, Buenos Aires',
    rawConditionText: 'Used - Good',
    rawAvailabilityText: 'In Stock',
    imageUrls: ['https://synthetic.invalid/images/syn-006-1.jpg'],
    matchingQueries: ['switch lite'],
    sellerInfo: { sellerType: 'individual', verified: false },
    attributes: { condition: 'good' },
    sourceMetadata: { category: 'video_games_consoles', locationId: 'loc-amba-vicente-lopez' },
  },

  // 7. Potentially Valid: Blue with aesthetic details
  {
    externalId: 'syn-007',
    canonicalUrl: 'https://synthetic.invalid/listings/syn-007',
    title: 'Nintendo Switch Lite Azul con detalles estéticos',
    description:
      'Funciona perfecto la consola Nintendo Switch Lite pero tiene marcas de uso leves en la carcasa trasera.',
    rawPriceText: 'ARS 220.000',
    sourceCurrencyCode: 'ARS',
    rawLocationText: 'Moron, Buenos Aires',
    rawConditionText: 'Used - Fair',
    rawAvailabilityText: 'In Stock',
    imageUrls: ['https://synthetic.invalid/images/syn-007-1.jpg'],
    matchingQueries: ['nintendo switch lite', 'nintendo lite'],
    sellerInfo: { sellerType: 'individual', verified: false },
    attributes: { color: 'blue', condition: 'fair' },
    sourceMetadata: { category: 'video_games_consoles', locationId: 'loc-amba-moron' },
  },

  // 8. Future Rejectable: Accessory only (case)
  {
    externalId: 'syn-008',
    canonicalUrl: 'https://synthetic.invalid/listings/syn-008',
    title: 'Funda rígida para Nintendo Switch Lite',
    description:
      'Funda estuche de transporte antigolpes para consola Switch Lite. Atención: no incluye consola.',
    rawPriceText: 'ARS 25.000',
    sourceCurrencyCode: 'ARS',
    rawLocationText: 'Quilmes, Buenos Aires',
    rawConditionText: 'New',
    rawAvailabilityText: 'In Stock',
    imageUrls: ['https://synthetic.invalid/images/syn-008-1.jpg'],
    matchingQueries: ['nintendo switch lite', 'switch lite'],
    sellerInfo: { sellerType: 'store', verified: false },
    attributes: { itemType: 'accessory', condition: 'new' },
    sourceMetadata: { category: 'accessories', locationId: 'loc-amba-quilmes' },
  },

  // 9. Future Rejectable: Replacement part (screen)
  {
    externalId: 'syn-009',
    canonicalUrl: 'https://synthetic.invalid/listings/syn-009',
    title: 'Repuesto de pantalla LCD Nintendo Switch Lite',
    description: 'Pantalla de repuesto LCD original nueva para reparar Switch Lite rota.',
    rawPriceText: 'ARS 45.000',
    sourceCurrencyCode: 'ARS',
    rawLocationText: 'Ramos Mejia, Buenos Aires',
    rawConditionText: 'New',
    rawAvailabilityText: 'In Stock',
    imageUrls: ['https://synthetic.invalid/images/syn-009-1.jpg'],
    matchingQueries: ['nintendo switch lite'],
    sellerInfo: { sellerType: 'store', verified: false },
    attributes: { itemType: 'spare_part', condition: 'new' },
    sourceMetadata: { category: 'spare_parts', locationId: 'loc-amba-ramos-mejia' },
  },

  // 10. Future Rejectable: Broken / For parts
  {
    externalId: 'syn-010',
    canonicalUrl: 'https://synthetic.invalid/listings/syn-010',
    title: 'Nintendo Switch Lite para reparar o repuestos',
    description: 'No enciende la consola, para técnicos o repuestos, placa dañada por líquido.',
    rawPriceText: 'ARS 90.000',
    sourceCurrencyCode: 'ARS',
    rawLocationText: 'Avellaneda, Buenos Aires',
    rawConditionText: 'For Parts or Not Working',
    rawAvailabilityText: 'In Stock',
    imageUrls: ['https://synthetic.invalid/images/syn-010-1.jpg'],
    matchingQueries: ['nintendo switch lite', 'switch lite'],
    sellerInfo: { sellerType: 'individual', verified: false },
    attributes: { condition: 'broken', functional: false },
    sourceMetadata: { category: 'video_games_consoles', locationId: 'loc-amba-avellaneda' },
  },

  // 11. Future Rejectable: Only games (lot)
  {
    externalId: 'syn-011',
    canonicalUrl: 'https://synthetic.invalid/listings/syn-011',
    title: 'Lote solo juegos Nintendo Switch Lite',
    description:
      'Cartuchos de juegos físicos surtidos para Switch y Switch Lite, no incluye consola.',
    rawPriceText: 'ARS 60.000',
    sourceCurrencyCode: 'ARS',
    rawLocationText: 'Lomas de Zamora, Buenos Aires',
    rawConditionText: 'Used - Good',
    rawAvailabilityText: 'In Stock',
    imageUrls: ['https://synthetic.invalid/images/syn-011-1.jpg'],
    matchingQueries: ['switch lite'],
    sellerInfo: { sellerType: 'individual', verified: false },
    attributes: { itemType: 'games_only', condition: 'good' },
    sourceMetadata: { category: 'games', locationId: 'loc-amba-lomas' },
  },

  // 12. Future Rejectable: Empty box
  {
    externalId: 'syn-012',
    canonicalUrl: 'https://synthetic.invalid/listings/syn-012',
    title: 'Caja vacía Nintendo Switch Lite Zacian Zamazenta',
    description:
      'Solo la caja y los folletos de edición especial Zacian Zamazenta, ideal coleccionistas. Sin consola.',
    rawPriceText: 'ARS 15.000',
    sourceCurrencyCode: 'ARS',
    rawLocationText: 'Capital Federal, AMBA',
    rawConditionText: 'Used - Good',
    rawAvailabilityText: 'In Stock',
    imageUrls: ['https://synthetic.invalid/images/syn-012-1.jpg'],
    matchingQueries: ['nintendo switch lite'],
    sellerInfo: { sellerType: 'individual', verified: false },
    attributes: { itemType: 'empty_box', condition: 'good' },
    sourceMetadata: { category: 'packaging', locationId: 'loc-amba-caba' },
  },

  // 13. Deposit / Seña evidence
  {
    externalId: 'syn-013',
    canonicalUrl: 'https://synthetic.invalid/listings/syn-013',
    title: 'Nintendo Switch Lite con seña previa',
    description: 'Seña $20.000 saldo al retirar en efectivo en punto de encuentro.',
    rawPriceText: 'Seña $20.000',
    sourceCurrencyCode: null,
    rawLocationText: 'Olivos, Buenos Aires',
    rawConditionText: 'Used - Like New',
    rawAvailabilityText: 'In Stock',
    imageUrls: ['https://synthetic.invalid/images/syn-013-1.jpg'],
    matchingQueries: ['nintendo switch lite', 'switch lite'],
    sellerInfo: { sellerType: 'individual', verified: false },
    attributes: { paymentType: 'deposit_required' },
    sourceMetadata: { category: 'video_games_consoles', locationId: 'loc-amba-olivos' },
  },

  // 14. Installments / Cuotas evidence
  {
    externalId: 'syn-014',
    canonicalUrl: 'https://synthetic.invalid/listings/syn-014',
    title: 'Nintendo Switch Lite en cuotas fijas',
    description: '12 cuotas de $30.000 con tarjeta de crédito en local a la calle.',
    rawPriceText: '12 cuotas de $30.000',
    sourceCurrencyCode: null,
    rawLocationText: 'San Martin, Buenos Aires',
    rawConditionText: 'New',
    rawAvailabilityText: 'In Stock',
    imageUrls: ['https://synthetic.invalid/images/syn-014-1.jpg'],
    matchingQueries: ['nintendo switch lite'],
    sellerInfo: { sellerType: 'store', verified: false },
    attributes: { paymentType: 'installments' },
    sourceMetadata: { category: 'video_games_consoles', locationId: 'loc-amba-san-martin' },
  },
];
