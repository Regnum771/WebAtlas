export const layerGroups = [
  {
    id: 'group_admin',
    name: 'Ranh giới hành chính',
    layers: [
      { id: 'layer_provinces_2026', name: 'Ranh giới Tỉnh', defaultVisible: true, opacity: 1 },
      { id: 'layer_wards_2026', name: 'Ranh giới Xã/Phường', defaultVisible: true, opacity: 1 }
    ]
  },
  {
    id: 'group_water_resources',
    name: 'Tài nguyên nước',
    layers: [
      { id: 'layer_dams', name: 'Đập & Hồ chứa', defaultVisible: true, opacity: 1 },
      { id: 'layer_rivers', name: 'Mạng lưới sông ngòi', defaultVisible: true, opacity: 0.8 },
      { id: 'layer_stations', name: 'Trạm quan trắc', defaultVisible: false, opacity: 1 }
    ]
  },
  {
    id: 'group_hazards',
    name: 'Hiểm họa',
    layers: [
      { id: 'layer_flood', name: 'Vùng ngập lụt', defaultVisible: false, opacity: 0.6 },
      { id: 'layer_drought_survey', name: 'Vùng hạn hán', defaultVisible: false, opacity: 0.7 },
      { id: 'layer_saltwater_intrusion', name: 'Xâm nhập mặn', defaultVisible: false, opacity: 0.7 },
      { id: 'layer_flood_generation', name: 'Vùng sinh lũ', defaultVisible: false, opacity: 0.7 }
    ]
  }
];
