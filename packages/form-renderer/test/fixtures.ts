/**
 * Fixture za renderer: forma s uslovnom vidljivošću, opcijama iz sva tri izvora,
 * izračunatim poljem i `disabled` poljem — dovoljno da se provjere sve odluke
 * koje render model donosi (docs/04 §2–§7).
 */
export function rendererDefinition(): Record<string, unknown> {
  return {
    $schema: 'vfm-form/1',
    meta: {
      title: 'Servis vozila',
      description: 'Evidencija servisa',
      subject: 'TASK',
      language: 'bs',
    },
    layout: { columns: 2, sectionsCollapsible: true, stickySubmit: true },
    sections: [
      {
        key: 'osnovno',
        title: 'Osnovni podaci',
        order: 1,
        fields: [
          {
            key: 'servisTip',
            type: 'SINGLE_CHOICE',
            label: 'Tip servisa',
            required: true,
            order: 1,
            optionsSource: {
              kind: 'STATIC',
              items: [
                { value: 'MALI', label: 'Mali servis' },
                { value: 'VELIKI', label: 'Veliki servis' },
              ],
            },
          },
          {
            key: 'radionica',
            type: 'DROPDOWN',
            label: 'Radionica',
            order: 2,
            optionsSource: { kind: 'LIST', listCode: 'WORKSHOP' },
          },
          {
            key: 'vozilo',
            type: 'REFERENCE_VEHICLE',
            label: 'Vozilo',
            required: true,
            order: 3,
          },
          {
            key: 'kilometraza',
            type: 'INTEGER',
            label: 'Kilometraža',
            order: 4,
            validation: { min: 0, max: 2_000_000 },
          },
          {
            key: 'cijena',
            type: 'MONEY',
            label: 'Cijena',
            order: 5,
            visibleWhen: { field: 'servisTip', op: 'IN', value: ['VELIKI'] },
            validation: { min: 0, max: 5000, currency: 'BAM' },
          },
          {
            key: 'datumServisa',
            type: 'DATE',
            label: 'Datum servisa',
            required: true,
            order: 6,
          },
          {
            key: 'pristanak',
            type: 'BOOLEAN',
            label: 'Potvrda',
            order: 7,
            validation: { requiredTrue: true },
          },
          {
            key: 'zakljucano',
            type: 'TEXT',
            label: 'Zaključano polje',
            order: 8,
            disabled: true,
          },
        ],
      },
      {
        key: 'dodatno',
        title: 'Dodatno',
        order: 2,
        visibleWhen: { field: 'servisTip', op: '==', value: 'VELIKI' },
        fields: [
          {
            key: 'opis',
            type: 'TEXTAREA',
            label: 'Opis radova',
            order: 1,
            validation: { maxLength: 500 },
          },
          {
            key: 'cijenaPoSatu',
            type: 'COMPUTED',
            label: 'Cijena po satu',
            order: 2,
            computed: {
              // `MONEY` ulazi u izraz kao iznos u feninzima → /100 daje KM.
              expression: 'if(kilometraza > 0, round(cijena / 100 / 2, 2), 0)',
              resultType: 'DECIMAL',
              precision: 2,
            },
          },
        ],
      },
      {
        key: 'skrivena',
        title: 'Skrivena sekcija',
        order: 3,
        visibleWhen: { field: 'servisTip', op: '==', value: 'NIKAD' },
        fields: [{ key: 'napomena', type: 'TEXT', label: 'Napomena', order: 1 }],
      },
    ],
  };
}
