// Hazır kural şablonları: kullanıcı düzenleyicide başlangıç noktası olarak açar, kaydetmeden çalışmaz.
// Etiketler anahtar olarak yazılır (dil değişse de kural çalışır).

export function ruleTemplates(t) {
  return [
    {
      key: 'reviewAlert',
      name: t('core.automation.templates.reviewAlert'),
      enabled: true,
      trigger: { type: 'notification' },
      conditions: [
        { field: 'source', op: 'eq', value: 'github' },
        { field: 'tags', op: 'contains', value: 'github:reason.review_requested' }
      ],
      actions: [{ command: 'pano/alert', params: { title: '{{title}}', body: '{{body}}' } }]
    },
    {
      key: 'pinPatch',
      name: t('core.automation.templates.pinPatch'),
      enabled: true,
      trigger: { type: 'notification' },
      conditions: [
        { field: 'source', op: 'eq', value: 'steam' },
        { field: 'tags', op: 'contains', value: 'steam:tag.patchNotes' }
      ],
      actions: [{ command: 'pano/pin', params: { id: '{{id}}' } }]
    },
    {
      key: 'morningCheck',
      name: t('core.automation.templates.morningCheck'),
      enabled: true,
      trigger: { type: 'schedule', cron: '0 9 * * 1-5' },
      conditions: [],
      actions: [{ command: 'pano/runAll', params: {} }]
    }
  ];
}
